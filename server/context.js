import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_DIR = path.join(__dirname, 'user');
const PERSONA_PATH = path.join(__dirname, 'prompts', 'dj-persona.md');

// 语料注入长度上限(超长截断,风险清单 #8)
const CORPUS_MAX_CHARS = 2000;

function readCorpusFile(file) {
  try {
    const raw = fs.readFileSync(path.join(USER_DIR, file), 'utf8').trim();
    if (raw.length > CORPUS_MAX_CHARS) {
      return `${raw.slice(0, CORPUS_MAX_CHARS)}\n\n…(已截断,原 ${raw.length} 字符)`;
    }
    return raw;
  } catch {
    return '(文件不存在)';
  }
}

// 片段 1:系统提示词(dj-persona)
export function buildSystemPrompt() {
  return fs.readFileSync(PERSONA_PATH, 'utf8');
}

// 片段 2:用户品味语料(user/*.md,仅作为数据注入)
export function buildCorpus() {
  return [
    ['taste.md(音乐品味)', readCorpusFile('taste.md')],
    ['routines.md(作息习惯)', readCorpusFile('routines.md')],
    ['playlists.json(歌单)', readCorpusFile('playlists.json')],
    ['mood-rules.md(心情规则)', readCorpusFile('mood-rules.md')],
  ]
    .map(([label, body]) => `### ${label}\n${body}`)
    .join('\n\n');
}

// 片段 3:环境注入(weather / calendar / now;Phase 5 接入真实适配器)
export function buildEnvironment() {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    dateStyle: 'full',
    timeStyle: 'short',
  });
  return [
    `现在时间:${formatter.format(new Date())}(Asia/Shanghai)`,
    '天气:未配置(OPENWEATHER_API_KEY 未设置)',
    '日程:未配置(FEISHU_APP_ID 未设置)',
  ].join('\n');
}

// 片段 4:已检索记忆(state.db 最近对话与播放)
export function buildMemory({ messages = 12, plays = 8 } = {}) {
  const recent = db
    .prepare('SELECT role, content FROM messages ORDER BY id DESC LIMIT ?')
    .all(messages)
    .reverse();
  const recentPlays = db
    .prepare('SELECT title, artist, played_at FROM plays ORDER BY id DESC LIMIT ?')
    .all(plays)
    .reverse();

  const chat = recent
    .map((m) => `${m.role === 'user' ? '听众' : 'DJ'}:${m.content}`)
    .join('\n') || '(暂无历史)';
  const played = recentPlays
    .map((p) => `- ${p.played_at} 《${p.title}》${p.artist}`)
    .join('\n') || '(暂无)';
  return { chat, played };
}

// 六类片段组装:taste + routines + environment + history → system prompt
export function buildPrompt({ message, toolResults = null, trace = null }) {
  const memory = buildMemory();
  return [
    `<system>\n${buildSystemPrompt()}\n</system>`,
    `<用户品味语料>\n${buildCorpus()}\n</用户品味语料>`,
    `<环境注入>\n${buildEnvironment()}\n</环境注入>`,
    `<记忆>\n最近对话:\n${memory.chat}\n最近播放:\n${memory.played}\n</记忆>`,
    `<本次请求>\n听众说:${message}${toolResults ? `\n工具结果(网易云搜索):\n${JSON.stringify(toolResults, null, 2)}` : ''}\n</本次请求>`,
    `<执行轨迹>\n${trace || '调度:无'}\n</执行轨迹>`,
  ].join('\n\n');
}
