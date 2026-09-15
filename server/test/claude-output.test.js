// Claude 输出契约测试:容错提取(代码围栏/CLI 包裹/前后杂文)必须保留,
// 但提取后的对象必须严格通过 Schema 校验 —— 缺失/错型/超限抛错,由调用方降级,不静默补全。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeOutput, validateContract, OUTPUT_LIMITS } from '../claude.js';

const VALID = {
  say: '晚上好,来点爵士。',
  play: ['Norah Jones — Sunrise'],
  reason: '夜晚适合爵士',
  segue: '接下来放点轻松的。',
};

test('解析合法输出:完整契约', () => {
  const out = parseClaudeOutput(JSON.stringify(VALID));
  assert.deepEqual(out, VALID);
});

test('解析合法输出:play 为空数组、reason/segue 为空字符串也合法', () => {
  const out = parseClaudeOutput(JSON.stringify({ say: '你好', play: [], reason: '', segue: '' }));
  assert.deepEqual(out, { say: '你好', play: [], reason: '', segue: '' });
});

test('解析带 markdown 代码围栏的输出', () => {
  const raw = '这是今天的安排:\n```json\n' + JSON.stringify(VALID) + '\n```';
  const out = parseClaudeOutput(raw);
  assert.equal(out.say, VALID.say);
  assert.deepEqual(out.play, VALID.play);
});

test('解析 CLI 外层结果包裹 {type:"result", result:"<模型输出文本>"}', () => {
  const raw = JSON.stringify({ type: 'result', result: JSON.stringify(VALID) });
  const out = parseClaudeOutput(raw);
  assert.equal(out.say, VALID.say);
  assert.deepEqual(out.play, VALID.play);
});

test('解析前后夹杂文字的输出', () => {
  const raw = `好的,这是回答。\n${JSON.stringify(VALID)}\n以上,希望你喜欢。`;
  const out = parseClaudeOutput(raw);
  assert.equal(out.say, VALID.say);
});

test('say 字段缺失 → 抛错(不静默补全)', () => {
  const { say, ...rest } = VALID;
  assert.throws(() => parseClaudeOutput(JSON.stringify(rest)), /say 缺失/);
});

test('play 字段缺失 → 抛错', () => {
  const { play, ...rest } = VALID;
  assert.throws(() => parseClaudeOutput(JSON.stringify(rest)), /play 缺失/);
});

test('reason 字段缺失 → 抛错', () => {
  const { reason, ...rest } = VALID;
  assert.throws(() => parseClaudeOutput(JSON.stringify(rest)), /reason 缺失/);
});

test('segue 字段缺失 → 抛错', () => {
  const { segue, ...rest } = VALID;
  assert.throws(() => parseClaudeOutput(JSON.stringify(rest)), /segue 缺失/);
});

test('say 类型错误(数字)→ 抛错', () => {
  assert.throws(
    () => parseClaudeOutput(JSON.stringify({ ...VALID, say: 123 })),
    /say 缺失或不是字符串/,
  );
});

test('say 为空字符串 → 抛错', () => {
  assert.throws(() => parseClaudeOutput(JSON.stringify({ ...VALID, say: '   ' })), /say 不能为空/);
});

test('play 元素类型错误 → 抛错', () => {
  assert.throws(
    () => parseClaudeOutput(JSON.stringify({ ...VALID, play: ['歌名', 42] })),
    /play 第 2 项必须为非空字符串/,
  );
});

test('play 超过 8 首上限 → 抛错', () => {
  const nine = Array.from({ length: OUTPUT_LIMITS.PLAY_MAX_ITEMS + 1 }, (_, i) => `歌 ${i + 1}`);
  assert.throws(() => parseClaudeOutput(JSON.stringify({ ...VALID, play: nine })), /最多 8 首/);
});

test('play 单项超过 200 字符 → 抛错', () => {
  assert.throws(
    () => parseClaudeOutput(JSON.stringify({ ...VALID, play: ['x'.repeat(201)] })),
    /第 1 项超过 200 字符/,
  );
});

test('say 超过 2000 字符 → 抛错', () => {
  assert.throws(
    () => parseClaudeOutput(JSON.stringify({ ...VALID, say: 'x'.repeat(2001) })),
    /say 超过 2000/,
  );
});

test('reason 超过 500 字符 → 抛错', () => {
  assert.throws(
    () => parseClaudeOutput(JSON.stringify({ ...VALID, reason: 'x'.repeat(501) })),
    /reason 超过 500/,
  );
});

test('完全无法解析的文本 → 抛错', () => {
  assert.throws(() => parseClaudeOutput('抱歉,我今天不想输出 JSON。'), /不是有效 JSON/);
});

test('is_error 包裹 → 抛错', () => {
  assert.throws(
    () => parseClaudeOutput(JSON.stringify({ is_error: true, result: '模型执行失败' })),
    /Claude 执行错误/,
  );
});

test('validateContract 顶层不是对象 → 抛错', () => {
  assert.throws(() => validateContract(null), /顶层必须是 JSON 对象/);
  assert.throws(() => validateContract([1, 2]), /顶层必须是 JSON 对象/);
});
