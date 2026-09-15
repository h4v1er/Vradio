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

// ── 输出解析:容错提取(围栏/包裹/杂文)→ 严格契约校验 ────────

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

  // 出现任一契约字段即视为候选对象,进入严格校验(缺失/错型/超限 → 抛错)
  if ('say' in obj || 'play' in obj || 'reason' in obj || 'segue' in obj) {
    return validateContract(obj);
  }
  return null;
}

// ── 输出契约严格校验 ────────────────────────────────────────
// 契约 {say: string, play: string[], reason: string, segue: string}。
// 容错只发生在「提取 JSON」环节(围栏/包裹/杂文);提取到对象之后必须严格:
// 缺失字段 / 类型错误 / 超限一律抛错,由调用方走降级路径,绝不静默补全为成功结果。
export const OUTPUT_LIMITS = {
  SAY_MAX: 2000,
  REASON_MAX: 500,
  SEGUE_MAX: 500,
  PLAY_MAX_ITEMS: 8,
  PLAY_ITEM_MAX: 200,
};

export function validateContract(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('输出契约错误:顶层必须是 JSON 对象');
  }

  const say = obj.say;
  if (typeof say !== 'string') {
    throw new Error(`输出契约错误:say 缺失或不是字符串(收到 ${say === null ? 'null' : typeof say})`);
  }
  if (!say.trim()) throw new Error('输出契约错误:say 不能为空字符串');
  if (say.length > OUTPUT_LIMITS.SAY_MAX) {
    throw new Error(`输出契约错误:say 超过 ${OUTPUT_LIMITS.SAY_MAX} 字符上限`);
  }

  if (!Array.isArray(obj.play)) {
    throw new Error('输出契约错误:play 缺失或不是数组');
  }
  if (obj.play.length > OUTPUT_LIMITS.PLAY_MAX_ITEMS) {
    throw new Error(
      `输出契约错误:play 最多 ${OUTPUT_LIMITS.PLAY_MAX_ITEMS} 首,收到 ${obj.play.length} 首`,
    );
  }
  obj.play.forEach((p, i) => {
    if (typeof p !== 'string' || !p.trim()) {
      throw new Error(`输出契约错误:play 第 ${i + 1} 项必须为非空字符串`);
    }
    if (p.length > OUTPUT_LIMITS.PLAY_ITEM_MAX) {
      throw new Error(`输出契约错误:play 第 ${i + 1} 项超过 ${OUTPUT_LIMITS.PLAY_ITEM_MAX} 字符上限`);
    }
  });

  for (const field of ['reason', 'segue']) {
    const value = obj[field];
    if (typeof value !== 'string') {
      throw new Error(`输出契约错误:${field} 缺失或不是字符串`);
    }
    const max = field === 'reason' ? OUTPUT_LIMITS.REASON_MAX : OUTPUT_LIMITS.SEGUE_MAX;
    if (value.length > max) {
      throw new Error(`输出契约错误:${field} 超过 ${max} 字符上限`);
    }
  }

  return {
    say: say.trim(),
    play: obj.play.map((p) => p.trim()),
    reason: obj.reason.trim(),
    segue: obj.segue.trim(),
  };
}
