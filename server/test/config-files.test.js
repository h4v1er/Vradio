// 配置与语料接口测试:密钥不回显、语料文件名白名单与 50KB 上限。
// 内存库 + 无真实密钥环境,不碰网络、不写磁盘。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';

// 注意:必须在任何 server 模块 import 之前设置(静态 import 会先于模块体执行)
process.env.VRADIO_DB = ':memory:';
for (const k of [
  'FISH_API_KEY',
  'OPENWEATHER_API_KEY',
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'NETEASE_COOKIE',
]) {
  delete process.env[k];
}

let setPref;
let apiRouter;
let server;
let base;

before(async () => {
  // 动态导入,确保 db.js 读到 VRADIO_DB=:memory:,绝不落到真实 state.db
  ({ setPref } = await import('../prefs.js'));
  ({ apiRouter } = await import('../router.js'));
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  server = app.listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

test('GET /api/config 不回显任何密钥原文,只回配置来源', async () => {
  setPref('fish_api_key', 'sk-fake-fish-secret-12345');
  setPref('feishu_app_id', 'fs-fake-feishu-id-111');
  setPref('feishu_app_secret', 'fs-fake-feishu-secret-67890');
  setPref('openweather_api_key', 'ow-fake-weather-secret-999');

  const res = await fetch(`${base}/config`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes('sk-fake-fish-secret-12345'), '响应中不得出现 Fish key 原文');
  assert.ok(!text.includes('fs-fake-feishu-secret-67890'), '响应中不得出现飞书 secret 原文');
  assert.ok(!text.includes('ow-fake-weather-secret-999'), '响应中不得出现 OpenWeather key 原文');

  const j = JSON.parse(text);
  assert.equal(j.tts, true);
  assert.equal(j.sources.tts, 'prefs');
  assert.equal(j.sources.weather, 'prefs');
  assert.equal(j.sources.feishu, 'prefs');
});

test('GET /api/netease/cookie 只回配置来源,不回 Cookie 值', async () => {
  setPref('netease_cookie', 'MUSIC_U=super-secret-cookie-value-xyz');
  const res = await fetch(`${base}/netease/cookie`);
  const text = await res.text();
  assert.ok(!text.includes('super-secret-cookie-value-xyz'), '响应中不得出现 Cookie 原文');
  const j = JSON.parse(text);
  assert.deepEqual(j, { configured: true, source: 'prefs' });
});

test('POST /api/user/files 白名单外的文件名 → 400 且不落盘', async () => {
  for (const name of ['secrets.md', '../taste.md', 'taste.md.bak', '']) {
    const res = await fetch(`${base}/user/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content: 'x' }),
    });
    assert.equal(res.status, 400, `文件名 ${JSON.stringify(name)} 应被拒绝`);
    const j = await res.json();
    assert.match(j.error, /仅允许编辑/);
  }
});

test('POST /api/user/files 内容超过 50KB → 400(在写盘之前拦截)', async () => {
  const res = await fetch(`${base}/user/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'taste.md', content: 'x'.repeat(50_001) }),
  });
  assert.equal(res.status, 400);
  const j = await res.json();
  assert.match(j.error, /50KB/);
});

test('GET /api/user/files 只返回四个白名单文件', async () => {
  const res = await fetch(`${base}/user/files`);
  const j = await res.json();
  assert.deepEqual(
    j.files.map((f) => f.name),
    ['taste.md', 'routines.md', 'playlists.json', 'mood-rules.md'],
  );
});
