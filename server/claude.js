import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CWD = __dirname;

// 子进程超时(施工图:超时 kill;可经环境变量调整)
const TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS || 90000);

// ── 单并发互斥 ──────────────────────────────────────────────
// 同一时刻只允许一个 Claude 子进程(Max 订阅限流保护),后续请求排队。
let chain = Promise.resolve();

/**
 * 调用 Claude Code 子进程,返回 stdout 原始文本。
 * 失败/超时抛错,由调用方走降级路径。
 */
export function ask(prompt, { timeoutMs = TIMEOUT_MS } = {}) {
  const task = chain.then(() => runClaude(prompt, timeoutMs));
  chain = task.catch(() => {});
  return task;
}

function runClaude(prompt, timeoutMs) {
  return new Promise((resolve, reject) => {
    // 施工图命令:claude -p --output json;实际 CLI 为 --output-format json
    const child = spawn('claude', ['-p', prompt, '--output-format', 'json'], {
      cwd: CWD,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Claude 子进程超时(${timeoutMs}ms)`));
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`无法启动 claude:${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Claude 退出码 ${code}:${stderr.slice(-400)}`));
        return;
      }
      lastRaw = stdout;
      resolve(stdout);
    });
  });
}

// ── 输出解析:容错代码围栏 / 前后杂文 / CLI 结果包裹 ──────────

// 记录最近一次子进程原始输出,解析失败时由调用方落盘调试
let lastRaw = '';
export function getLastRaw() {
  return lastRaw;
}

// 从任意文本中尽力提取一个 JSON 对象:直接解析 → 代码围栏 → 花括号截取
function extractJsonObject(text) {
  const t = String(text).trim();
  if (!t) return null;

  try {
    return JSON.parse(t);
  } catch {
    /* 继续 */
  }

  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* 继续 */
    }
  }

  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      /* 继续 */
    }
  }
  return null;
}

export function parseClaudeOutput(raw) {
  lastRaw = String(raw);
  const envelope = extractJsonObject(raw);
  if (!envelope) throw new Error('Claude 输出不是有效 JSON');

  if (envelope.is_error) {
    throw new Error(`Claude 执行错误:${String(envelope.result ?? envelope.error ?? '').slice(0, 200)}`);
  }

  const parsed = unwrap(envelope);
  if (parsed) return parsed;
  throw new Error('Claude 输出不是有效 JSON');
}

// 剥掉 CLI 结果包裹,找到符合 {say, play[], reason, segue} 契约的对象
function unwrap(obj) {
  if (!obj || typeof obj !== 'object') return null;

  // --output-format json 的结果包裹:{type:'result', result:'<模型输出文本>'}
  if (typeof obj.result === 'string') {
    return unwrap(extractJsonObject(obj.result));
  }

  // 消息体包裹:content 数组提取 text 块再试
  if (Array.isArray(obj.content)) {
    const joined = obj.content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
    if (joined.trim()) {
      return unwrap(extractJsonObject(joined));
    }
  }

  if (typeof obj.say === 'string' || Array.isArray(obj.play)) {
    return normalize(obj);
  }
  return null;
}

// 契约校验:缺字段给默认值,play[] 只保留字符串
function normalize(obj) {
  return {
    say: typeof obj.say === 'string' ? obj.say.trim() : '',
    play: Array.isArray(obj.play)
      ? obj.play.filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim())
      : [],
    reason: typeof obj.reason === 'string' ? obj.reason.trim() : '',
    segue: typeof obj.segue === 'string' ? obj.segue.trim() : '',
  };
}
