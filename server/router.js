import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { ask, parseClaudeOutput, getLastRaw } from './claude.js';
import { buildPrompt } from './context.js';
import * as netease from './adapters/netease.js';
import * as player from './player.js';
import { broadcast } from './stream.js';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 解析失败时把原始输出落盘,便于排障(cache/ 不入库)
function dumpClaudeRaw(err) {
  try {
    const dir = path.join(__dirname, 'cache');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'claude-debug.log'),
      `[${new Date().toISOString()}] ${err.message}\n${getLastRaw()}\n\n`,
      { flag: 'a' },
    );
  } catch {
    // 落盘失败不影响主流程
  }
}

export const apiRouter = Router();

// ── 意图分流(施工图 router.js 职责) ─────────────────────────
// 简单控制指令 → 直接处理;点歌 → 网易云适配器直达;
// 需要理解意图/编排内容/对话 → Claude 子进程
const CONTROL_PATTERNS = [
  { re: /^(播放|暂停|继续|停止|停)$/, action: 'toggle' },
  { re: /^(下一首|切歌|跳过)$/, action: 'next' },
  { re: /^(上一首|前一首)$/, action: 'prev' },
  { re: /^音量/, action: 'volume' },
];
const POINTSONG_PATTERN = /^(?:播放|来一首|点一首|放一首|来首|放首|想听)(.{1,50})$/;

function detectIntent(message) {
  for (const { re, action } of CONTROL_PATTERNS) {
    if (re.test(message)) return { kind: 'control', action };
  }
  const m = message.match(POINTSONG_PATTERN);
  if (m) return { kind: 'pointsong', keyword: m[1].trim() };
  return { kind: 'claude' };
}

function saveMessage(role, content) {
  db.prepare('INSERT INTO messages (role, content) VALUES (?, ?)').run(role, content);
}

// ── 各分支处理 ─────────────────────────────────────────────

// 控制指令:直接作用于播放队列状态机,并推送 now-playing
function handleControl(action, message) {
  let say = '收到。';
  let state;
  switch (action) {
    case 'toggle':
      state = player.toggle();
      say = state.isPlaying ? '继续播放。' : '已暂停。';
      break;
    case 'next':
      state = player.next();
      say = state.playing
        ? `为你切到《${state.playing.title}》——${state.playing.artist}。`
        : '队列没有更多了。';
      break;
    case 'prev':
      state = player.prev();
      say = state.playing ? `回到《${state.playing.title}》。` : '已经是第一首了。';
      break;
    case 'volume': {
      const m = message.match(/(\d{1,3})/);
      state = player.setVolume(m ? Number(m[1]) / 100 : 0.7);
      say = `音量已调到 ${Math.round(state.volume * 100)}%。`;
      break;
    }
  }
  broadcast('now-playing', state);
  return { type: 'control', action, say, play: [], reason: '本地控制指令', segue: '', degraded: false };
}

// 点歌直达:网易云搜索,不惊动 Claude
async function handlePointsong(keyword) {
  try {
    const songs = await netease.search(keyword, { limit: 2 });
    if (!songs.length) {
      return { type: 'chat', say: `没找到「${keyword}」,换个说法试试?`, play: [], reason: '网易云无结果', segue: '', degraded: true };
    }
    const s = songs[0];
    saveMessage('user', `点歌:${keyword}`);
    saveMessage('assistant', `好的,为你播放《${s.title}》——${s.artist}。`);
    return {
      type: 'chat',
      say: `好的,为你播放《${s.title}》——${s.artist}。`,
      play: songs.slice(0, 1),
      reason: '点歌直达(不经过大脑)',
      segue: songs.length > 1 ? `接下来也可以听《${songs[1].title}》` : '',
      degraded: false,
    };
  } catch (err) {
    return degrade(`点歌:${keyword}`, err.message);
  }
}

// 自然语言 → Claude 决策
async function handleClaude(message) {
  player.setDjState('thinking');
  broadcast('dj', { state: 'thinking' });

  const prompt = buildPrompt({ message });

  let output;
  try {
    output = parseClaudeOutput(await ask(prompt));
  } catch (err) {
    dumpClaudeRaw(err);
    player.setDjState('idle');
    broadcast('dj', { state: 'idle' });
    return degrade(message, err.message);
  }
  player.setDjState('idle');
  broadcast('dj', { state: 'idle' });

  const resolved = await resolvePlays(output.play);
  saveMessage('user', message);
  saveMessage('assistant', output.say);
  return {
    type: 'chat',
    say: output.say,
    play: resolved,
    reason: output.reason,
    segue: output.segue,
    degraded: false,
  };
}

// play[] 条目「歌手 歌名」→ 网易云解析为真实歌曲;单条失败不阻塞整体
async function resolvePlays(entries) {
  const results = [];
  for (const entry of entries) {
    try {
      const songs = await netease.search(entry, { limit: 1 });
      if (songs.length) {
        results.push(songs[0]);
        continue;
      }
    } catch {
      // 解析失败,保留原始条目让前端展示
    }
    results.push({ unresolved: entry });
  }
  return results;
}

// 降级路径:Claude 不可用 → 点歌类按关键词直搜;其余返回可恢复错误
async function degrade(message, why) {
  const m = message.match(POINTSONG_PATTERN);
  if (m) {
    try {
      const songs = await netease.search(m[1], { limit: 1 });
      if (songs.length) {
        const s = songs[0];
        return {
          type: 'chat',
          say: `信号不太好,先为你播放《${s.title}》——${s.artist}。`,
          play: songs,
          reason: `降级路径:${why}`,
          segue: '',
          degraded: true,
        };
      }
    } catch {
      // 网易云也不可用,落到纯文本兜底
    }
  }
  return {
    type: 'chat',
    say: '电台信号不太好,稍后再试试。',
    play: [],
    reason: `降级路径:${why}`,
    segue: '',
    degraded: true,
  };
}

// ── HTTP 契约 ──────────────────────────────────────────────

// GET /api/now —— 当前播放 + 队列 + DJ 状态(真实状态机)
apiRouter.get('/now', (req, res) => {
  res.json(player.getState());
});

// GET /api/next —— 下一首 / 当前队列
apiRouter.get('/next', (req, res) => {
  const state = player.getState();
  const next = state.index >= 0 && state.index < state.queue.length - 1
    ? state.queue[state.index + 1]
    : null;
  res.json({ next, queue: state.queue, index: state.index });
});

// GET /api/plays/today —— 当日播放记录(state.db)
apiRouter.get('/plays/today', (req, res) => {
  const rows = db
    .prepare("SELECT * FROM plays WHERE date(played_at) = date('now', 'localtime') ORDER BY id DESC")
    .all();
  res.json({ plays: rows });
});

// POST /api/queue/remove —— 从队列移除(QueuePanel 用)
apiRouter.post('/queue/remove', (req, res) => {
  const i = Number(req.body?.index);
  const state = player.removeAt(Number.isInteger(i) ? i : -1);
  broadcast('now-playing', state);
  res.json(state);
});

// GET /api/stream/:songId —— 音频流代理:
// 网易云直链音质回退;Range 透传 206;Referer/UA 伪装(参考旧项目 NeteaseController 实现模式)
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

apiRouter.get('/stream/:songId', async (req, res) => {
  try {
    const { url } = await netease.songUrl(req.params.songId);
    if (!url) return res.status(404).json({ error: '暂无播放资源(版权受限或需 VIP)' });

    const headers = { Referer: 'https://music.163.com/', 'User-Agent': UA };
    if (req.headers.range) headers.Range = req.headers.range;

    const upstream = await fetch(url, { headers, redirect: 'follow' });
    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).json({ error: '上游音频获取失败' });
    }

    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.set('Content-Type', ct);
    res.set('Accept-Ranges', 'bytes');
    const cr = upstream.headers.get('content-range');
    if (cr) res.set('Content-Range', cr);
    const cl = upstream.headers.get('content-length');
    if (cl) res.set('Content-Length', cl);

    Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: `音频流代理失败:${err.message}` });
    else res.destroy();
  }
});

// POST /api/chat —— 用户请求入口:分流 → 执行 → {say, play[], reason, segue}
apiRouter.post('/chat', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) {
    return res.status(400).json({ error: 'message 不能为空' });
  }

  const intent = detectIntent(message);
  broadcast('chat', { role: 'user', say: message });

  try {
    let result;
    if (intent.kind === 'control') result = handleControl(intent.action, message);
    else if (intent.kind === 'pointsong') result = await handlePointsong(intent.keyword);
    else result = await handleClaude(message);

    // 点歌直达 → 插队立即播放;DJ 编排 → 进队列、空闲时开播
    if (result.play?.length) {
      let state;
      if (intent.kind === 'pointsong') state = player.playNow(result.play[0]);
      else {
        player.enqueue(result.play);
        state = player.startIfIdle();
      }
      broadcast('now-playing', state);
    }

    // 统一出口:每个响应都推送 WS 聊天事件
    broadcast('chat', { role: 'assistant', say: result.say, play: result.play, degraded: result.degraded });
    return res.json(result);
  } catch (err) {
    const result = await degrade(message, err.message);
    broadcast('chat', { role: 'assistant', say: result.say, play: result.play, degraded: result.degraded });
    return res.json(result);
  }
});
