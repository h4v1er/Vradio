// Vradio 评测集运行器(node:test 驱动,案例在 vradio-cases.jsonl)
//
// fixture 模式(默认,CI 同款):
//   npm run eval     (等价于 node --experimental-test-module-mocks --test evals/run-evals.mjs)
//   模型输出、网易云、天气、飞书全部来自案例内桩件;被测的是真实代码:
//   解析契约(claude.js)、意图分流与降级(router.js)、提示词分区(context.js)。
//   不产生任何真实模型调用与费用。
//
// live 模式(可选,需要 dev 环境 + 已配置密钥 + 网易云容器):
//   VRADIO_EVAL_LIVE=1 npm run eval
//   Claude 子进程与外部服务走真实调用,用于观察端到端行为;
//   与外部可用性相关的断言(tts/noClaude)自动跳过,结果取决于真实模型,不作评分。
//
// 说明:fixture 模式验证的是「管道」而非「模型质量」——模型是否听懂提示注入、
// 选歌是否有品味,只有 live 模式能观察,本评测集不对此打分、不编造准确率。
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import express from 'express';
import * as realClaude from '../claude.js';

const LIVE = process.env.VRADIO_EVAL_LIVE === '1';

process.env.VRADIO_DB = ':memory:';
if (!LIVE) {
  for (const k of [
    'FISH_API_KEY',
    'OPENWEATHER_API_KEY',
    'FEISHU_APP_ID',
    'FEISHU_APP_SECRET',
    'NETEASE_COOKIE',
  ]) {
    delete process.env[k];
  }
}

const CASES = readFileSync(new URL('./vradio-cases.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const DEFAULT_SONG = {
  source: 'netease',
  songId: '186016',
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  coverUrl: 'https://example.com/cover.jpg',
  durationMs: 269000,
  vip: false,
};

let current = null; // 当前用例(桩件按它切换行为)
let claudeCalls = 0;
let apiRouter;
let ctx;
let server;
let base;

const stats = { total: CASES.length, pass: 0, fail: 0 };
const startedAt = Date.now();

before(async () => {
  if (!LIVE) {
    mock.module('../claude.js', {
      namedExports: {
        ask: async () => {
          claudeCalls += 1;
          const a = current?.ask ?? {};
          if (a.error) throw new Error(a.error);
          return a.output ?? '';
        },
        parseClaudeOutput: realClaude.parseClaudeOutput,
        getLastRaw: () => '',
      },
    });
    mock.module('../adapters/netease.js', {
      namedExports: {
        search: async () => current?.netease?.songs ?? [DEFAULT_SONG],
        hydrateCovers: async (s) => s,
        songUrl: async () => ({ url: 'https://example.com/a.mp3', level: 'exhigh', preview: false }),
      },
    });
    mock.module('../adapters/weather.js', {
      namedExports: {
        isConfigured: () => current?.env?.weather === 'configured',
        now: async () => {
          if (current?.env?.weather === 'error') throw new Error('weather 请求超时');
          return {
            configured: current?.env?.weather === 'configured',
            city: '上海',
            desc: '小雨',
            temp: 22,
            feels: 21,
            humidity: 80,
          };
        },
        testKey: async () => ({ ok: true, activated: true }),
      },
    });
    mock.module('../adapters/feishu.js', {
      namedExports: {
        isConfigured: () => current?.env?.calendar === 'configured',
        todayEvents: async () => {
          if (current?.env?.calendar === 'error') throw new Error('feishu 请求超时');
          return { configured: current?.env?.calendar === 'configured', events: [] };
        },
        testCredentials: async () => {},
      },
    });
  }
  ({ apiRouter } = await import('../router.js'));
  ctx = await import('../context.js');
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
  console.log(
    `\n[eval] 用例 ${stats.total} · 通过 ${stats.pass} · 失败 ${stats.fail} · 耗时 ${Date.now() - startedAt}ms · ${
      LIVE ? 'LIVE 模式(真实模型与外部服务)' : 'fixture 模式(桩件,无真实调用与费用)'
    }`,
  );
});

// ── 断言引擎(只断言案例里声明的内容,不额外打分) ────────────
function assertCaseExpectations(c, body) {
  const e = c.expect ?? {};
  if (e.say) {
    assert.ok(typeof body.say === 'string' && body.say.trim(), `${c.id}: say 应为非空文本`);
  }
  if (e.playMin != null) {
    const n = body.play?.length ?? 0;
    assert.ok(n >= e.playMin, `${c.id}: play 应至少 ${e.playMin} 首,实际 ${n}`);
  }
  if (e.playMax != null) {
    const n = body.play?.length ?? 0;
    assert.ok(n <= e.playMax, `${c.id}: play 应最多 ${e.playMax} 首,实际 ${n}`);
  }
  if (e.playUnresolved != null) {
    const n = (body.play ?? []).filter((p) => p.unresolved).length;
    assert.equal(n, e.playUnresolved, `${c.id}: 未解析条目应为 ${e.playUnresolved},实际 ${n}`);
  }
  if (e.degraded !== undefined) {
    assert.equal(body.degraded, e.degraded, `${c.id}: degraded 应为 ${e.degraded},实际 ${body.degraded}`);
  }
  if (!LIVE && e.tts === 'null') {
    assert.equal(body.tts, null, `${c.id}: TTS 未配置应返回 tts=null`);
  }
  if (!LIVE && e.noClaude) {
    assert.equal(claudeCalls, 0, `${c.id}: 该路径不应调用模型`);
  }
  if (e.reasonMatch) {
    assert.match(String(body.reason ?? ''), new RegExp(e.reasonMatch), `${c.id}: reason 应匹配 ${e.reasonMatch}`);
  }
  for (const f of e.forbid ?? []) {
    assert.ok(!JSON.stringify(body).includes(f), `${c.id}: 响应不得包含「${f}」`);
  }
}

async function runChatCase(c) {
  const res = await fetch(`${base}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: c.input }),
  });
  assert.equal(res.status, 200, `${c.id}: /api/chat 应返回 200`);
  assertCaseExpectations(c, await res.json());
}

function runParseCase(c) {
  let err = null;
  let out = null;
  try {
    out = realClaude.parseClaudeOutput(c.input);
  } catch (e) {
    err = e;
  }
  const e = c.expect ?? {};
  if (e.valid) {
    assert.ok(out, `${c.id}: 应解析成功`);
    if (e.playMax != null) {
      assert.ok(out.play.length <= e.playMax, `${c.id}: play 应最多 ${e.playMax} 首`);
    }
  } else {
    assert.ok(err, `${c.id}: 应解析失败`);
    if (e.errorMatch) {
      assert.match(err.message, new RegExp(e.errorMatch), `${c.id}: 错误信息应匹配 ${e.errorMatch}`);
    }
  }
}

async function runPromptCase(c) {
  const prompt = await ctx.buildPrompt({ message: c.input, trace: '评测用例' });
  const requestZone = prompt.split('<本次请求>')[1]?.split('</本次请求>')[0] ?? '';
  assert.ok(requestZone.includes(c.input), `${c.id}: 用户输入应出现在 <本次请求> 数据区块`);
  const systemZone = prompt.split('<system>')[1]?.split('</system>')[0] ?? '';
  for (const f of c.expect?.notInSystem ?? []) {
    assert.ok(!systemZone.includes(f), `${c.id}: 「${f}」不得进入 <system> 系统区块`);
  }
  for (const f of c.expect?.contains ?? []) {
    assert.ok(prompt.includes(f), `${c.id}: 提示词应包含「${f}」`);
  }
}

// ── 用例注册:每个案例一条 node:test 测试 ───────────────────
for (const c of CASES) {
  test(`[${c.id}] ${c.desc}`, async () => {
    try {
      current = c;
      claudeCalls = 0;
      if (c.kind === 'parse') runParseCase(c);
      else if (c.kind === 'prompt') await runPromptCase(c);
      else await runChatCase(c);
      stats.pass += 1;
    } catch (err) {
      stats.fail += 1;
      throw err;
    }
  });
}
