import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';
import * as weather from './adapters/weather.js';
import * as feishu from './adapters/feishu.js';

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

// 片段 3:环境注入(weather / calendar / now)
// 未配置 key 注入「未配置」标记、调用失败注入「暂不可用」,DJ 串词自然跳过
export async function buildEnvironment() {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    dateStyle: 'full',
    timeStyle: 'short',
  });
  const lines = [`现在时间:${formatter.format(new Date())}(Asia/Shanghai)`];

  try {
    const w = await weather.now();
    lines.push(
      w.configured
        ? `天气:${w.city} ${w.desc},${w.temp}°C(体感 ${w.feels}°C,湿度 ${w.humidity}%)`
        : '天气:未配置(OPENWEATHER_API_KEY 未设置)',
    );
  } catch (err) {
    lines.push(`天气:暂不可用(${err.message})`);
  }

  try {
    const cal = await feishu.todayEvents();
    lines.push(
      cal.configured
        ? `今日日程:${cal.events.length
            ? cal.events
                .map(
                  (e) =>
                    `- ${new Date(e.start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' })} ${e.summary}`,
                )
                .join(';')
            : '(无安排)'}`
        : '日程:未配置(FEISHU_APP_ID 未设置)',
    );
  } catch (err) {
    lines.push(`日程:暂不可用(${err.message})`);
  }

  return lines.join('\n');
}

// 结构化环境数据(GET /api/env 与 RadioContext 面板用)
export async function getEnvSnapshot() {
  let w = { configured: false };
  let cal = { configured: false, events: [] };
  try {
    w = await weather.now();
  } catch (err) {
    w = { configured: true, error: err.message };
  }
  try {
    cal = await feishu.todayEvents();
  } catch (err) {
    cal = { configured: true, error: err.message, events: [] };
  }
  return { weather: w, calendar: cal };
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

// 片段 2.5:导入的网易云歌单摘要(设置页导入,听众亲自收藏 → 品味最强信号)
// 上限:8 个歌单 × 每单节选 15 首,控制注入体积
const IMPORTED_MAX_LISTS = 8;
const IMPORTED_MAX_TRACKS = 15;

export function buildImportedPlaylists() {
  try {
    const rows = db
      .prepare('SELECT name, tracks FROM netease_playlists ORDER BY created_at DESC LIMIT ?')
      .all(IMPORTED_MAX_LISTS);
    if (!rows.length) return null;
    return rows
      .map((r) => {
        const tracks = JSON.parse(r.tracks);
        const slice = tracks.slice(0, IMPORTED_MAX_TRACKS);
        return `### 歌单「${r.name}」(${tracks.length} 首,节选 ${slice.length} 首)\n${slice
          .map((t) => `- ${t.title} — ${t.artist}`)
          .join('\n')}`;
      })
      .join('\n\n');
  } catch {
    return null;
  }
}

// 六类片段组装:taste + routines + environment + history → system prompt
export async function buildPrompt({ message, toolResults = null, trace = null }) {
  const memory = buildMemory();
  const imported = buildImportedPlaylists();
  return [
    `<system>\n${buildSystemPrompt()}\n</system>`,
    `<用户品味语料>\n${buildCorpus()}\n</用户品味语料>`,
    ...(imported ? [`<导入歌单>\n${imported}\n</导入歌单>`] : []),
    `<环境注入>\n${await buildEnvironment()}\n</环境注入>`,
    `<记忆>\n最近对话:\n${memory.chat}\n最近播放:\n${memory.played}\n</记忆>`,
    `<本次请求>\n听众说:${message}${toolResults ? `\n工具结果(网易云搜索):\n${JSON.stringify(toolResults, null, 2)}` : ''}\n</本次请求>`,
    `<执行轨迹>\n${trace || '调度:无'}\n</执行轨迹>`,
  ].join('\n\n');
}
