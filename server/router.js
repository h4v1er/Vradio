import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ask, parseClaudeOutput, getLastRaw } from './claude.js';
import { buildPrompt } from './context.js';
import * as netease from './adapters/netease.js';
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

// 控制指令:直接应答(Phase 3 起真正作用于播放器)
function handleControl(action) {
  const says = {
    toggle: '好的,播放状态已切换。',
    next: '为你切到下一首。',
    prev: '回到上一首。',
    volume: '音量已调整。',
  };
  const say = says[action] || '收到。';
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
  const prompt = buildPrompt({ message });

  let output;
  try {
    output = parseClaudeOutput(await ask(prompt));
  } catch (err) {
    dumpClaudeRaw(err);
    return degrade(message, err.message);
  }

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

// GET /api/now —— 当前播放 + DJ 状态
// 占位实现:Phase 3 起由播放队列与 state.db 提供真实数据
apiRouter.get('/now', (req, res) => {
  res.json({
    playing: null,
    queue: [],
    dj: { state: 'idle' },
  });
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
    if (intent.kind === 'control') result = handleControl(intent.action);
    else if (intent.kind === 'pointsong') result = await handlePointsong(intent.keyword);
    else result = await handleClaude(message);

    // 统一出口:每个响应都推送 WS 聊天事件
    broadcast('chat', { role: 'assistant', say: result.say, play: result.play, degraded: result.degraded });
    return res.json(result);
  } catch (err) {
    const result = await degrade(message, err.message);
    broadcast('chat', { role: 'assistant', say: result.say, play: result.play, degraded: result.degraded });
    return res.json(result);
  }
});
