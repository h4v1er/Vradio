// /api/chat 全链路测试:Claude 子进程与网易云适配器全部 mock,
// 数据库用内存库(:memory:),不碰任何真实网络服务或密钥。
import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import * as realClaude from '../claude.js';

// 测试环境固定:内存库 + 清掉可能残留的真实密钥环境变量
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

// ── 桩件(每个测试可改行为;router 经 mock.module 调用这些委托函数) ──
const neteaseImpl = {
  search: async () => {
    throw new Error('测试未配置 netease.search 桩件');
  },
  hydrateCovers: async (songs) => songs,
  songUrl: async () => ({ url: 'https://example.com/a.mp3', level: 'exhigh', preview: false }),
};
let askImpl = async () => {
  throw new Error('测试未配置 claude ask 桩件');
};
const claudeCalls = { count: 0 };

const SONG = {
  source: 'netease',
  songId: '186016',
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  coverUrl: 'https://example.com/cover.jpg',
  durationMs: 269000,
  vip: false,
};

let apiRouter;
let server;
let base;

before(async () => {
  mock.module('../adapters/netease.js', {
    namedExports: {
      search: (...a) => neteaseImpl.search(...a),
      hydrateCovers: (...a) => neteaseImpl.hydrateCovers(...a),
      songUrl: (...a) => neteaseImpl.songUrl(...a),
    },
  });
  mock.module('../claude.js', {
    namedExports: {
      ask: async (...a) => {
        claudeCalls.count += 1;
        return askImpl(...a);
      },
      parseClaudeOutput: realClaude.parseClaudeOutput,
      getLastRaw: () => '',
    },
  });
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

beforeEach(() => {
  claudeCalls.count = 0;
});

async function chat(message) {
  const res = await fetch(`${base}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  return { status: res.status, body: await res.json() };
}

test('控制指令「播放」不调用 Claude,直接切换播放状态', async () => {
  const { status, body } = await chat('播放');
  assert.equal(status, 200);
  assert.equal(body.type, 'control');
  assert.equal(body.degraded, false);
  assert.equal(claudeCalls.count, 0);
});

test('控制指令「暂停/继续」不调用 Claude', async () => {
  for (const msg of ['暂停', '继续']) {
    const { body } = await chat(msg);
    assert.equal(body.type, 'control');
    assert.equal(body.action, 'toggle');
  }
  assert.equal(claudeCalls.count, 0);
});

test('控制指令「音量 70」解析音量数字并生效,不调用 Claude', async () => {
  const { body } = await chat('音量 70');
  assert.equal(body.type, 'control');
  assert.equal(body.action, 'volume');
  assert.match(body.say, /70%/);
  assert.equal(claudeCalls.count, 0);
  const now = await (await fetch(`${base}/now`)).json();
  assert.equal(now.volume, 0.7);
});

test('控制指令「下一首/上一首」在空队列时安全兜底,不调用 Claude', async () => {
  const n = await chat('下一首');
  assert.match(n.body.say, /队列没有更多了/);
  const p = await chat('上一首');
  assert.match(p.body.say, /已经是第一首了/);
  assert.equal(claudeCalls.count, 0);
});

test('点歌「播放 晴天」直达网易云搜索,不调用 Claude', async () => {
  neteaseImpl.search = async () => [SONG];
  const { status, body } = await chat('播放 晴天');
  assert.equal(status, 200);
  assert.match(body.say, /晴天/);
  assert.equal(body.play.length, 1);
  assert.equal(body.play[0].songId, '186016');
  assert.equal(body.degraded, false);
  assert.equal(claudeCalls.count, 0);
});

test('自然语言请求调用模型适配器,输出解析为真实歌曲并进入队列', async () => {
  neteaseImpl.search = async () => [SONG];
  askImpl = async () =>
    JSON.stringify({
      say: '晚上好,为你挑了一首。',
      play: ['周杰伦 — 晴天'],
      reason: '夜晚适合听周杰伦',
      segue: '下一首换点民谣。',
    });
  const { status, body } = await chat('晚上适合听什么');
  assert.equal(status, 200);
  assert.equal(claudeCalls.count, 1);
  assert.equal(body.degraded, false);
  assert.equal(body.play.length, 1);
  assert.equal(body.play[0].songId, '186016'); // 「歌手 — 歌名」已解析为真实歌曲
  const now = await (await fetch(`${base}/now`)).json();
  assert.equal(now.playing?.songId, '186016');
  assert.equal(now.isPlaying, true);
});

test('Claude 超时 → 返回 degraded 响应,HTTP 仍 200', async () => {
  askImpl = async () => {
    throw new Error('Claude 子进程超时(90000ms)');
  };
  const { status, body } = await chat('今天有点累,随便聊聊');
  assert.equal(status, 200);
  assert.equal(body.degraded, true);
  assert.equal(body.play.length, 0);
  assert.match(body.reason, /超时/);
});

test('Claude 退出码非 0 → 返回 degraded 响应', async () => {
  askImpl = async () => {
    throw new Error('Claude 退出码 1:output too long');
  };
  const { body } = await chat('给我推荐点音乐');
  assert.equal(body.degraded, true);
  assert.match(body.reason, /退出码 1/);
});

test('Claude 输出非法 JSON → 返回 degraded 响应', async () => {
  askImpl = async () => '抱歉,我今天不想输出 JSON。';
  const { body } = await chat('随便来点音乐');
  assert.equal(body.degraded, true);
  assert.match(body.reason, /不是有效 JSON/);
});

test('Claude 输出缺失契约字段 → 契约校验拦截,返回 degraded', async () => {
  askImpl = async () => JSON.stringify({ play: ['周杰伦 — 晴天'], reason: '', segue: '' });
  const { body } = await chat('来点音乐');
  assert.equal(body.degraded, true);
  assert.match(body.reason, /say 缺失/);
});

test('Claude 输出 play 超过 8 首上限 → 契约校验拦截,返回 degraded', async () => {
  askImpl = async () =>
    JSON.stringify({
      say: '给你一份大歌单',
      play: Array.from({ length: 9 }, (_, i) => `歌 ${i + 1}`),
      reason: '',
      segue: '',
    });
  const { body } = await chat('来点音乐');
  assert.equal(body.degraded, true);
  assert.match(body.reason, /最多 8 首/);
});

test('网易云搜索失败时 /api/chat 不崩溃,返回 degraded 兜底', async () => {
  neteaseImpl.search = async () => {
    throw new Error('netease 请求超时');
  };
  const { status, body } = await chat('播放 晴天');
  assert.equal(status, 200);
  assert.equal(body.degraded, true);
  assert.match(body.say, /信号不太好/);
});

test('TTS 未配置 → 仍返回文字串词,tts 为 null', async () => {
  neteaseImpl.search = async () => [SONG];
  askImpl = async () =>
    JSON.stringify({
      say: '今晚的月光很适合一首慢歌。',
      play: ['周杰伦 — 晴天'],
      reason: '夜晚',
      segue: '',
    });
  const { body } = await chat('今晚适合听什么');
  assert.equal(body.degraded, false);
  assert.ok(body.say.length > 0);
  assert.equal(body.tts, null);
});

test('message 为空 → 400', async () => {
  const { status } = await chat('   ');
  assert.equal(status, 400);
});
