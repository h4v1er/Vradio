import cron from 'node-cron';
import db from './db.js';
import { ask, parseClaudeOutput } from './claude.js';
import { buildPrompt } from './context.js';
import * as player from './player.js';
import * as feishu from './adapters/feishu.js';
import { broadcast } from './stream.js';

const TZ = { timezone: 'Asia/Shanghai' };

function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

// 生成当日播放计划:走一遍完整 Claude 编排,结果落 plan 表并 WS 推送。
// 供 cron(07:00 / 09:00 / 日历 hook)与手动 POST /api/plan/generate 使用。
export async function generateDailyPlan({ reason = 'manual' } = {}) {
  const prompt = await buildPrompt({
    message: '请为今天生成一份电台播放计划:考虑当前时段、今日日程与用户品味,按输出契约回复。',
    trace: `调度触发:${reason}`,
  });

  player.setDjState('thinking');
  broadcast('dj', { state: 'thinking' });

  try {
    const output = parseClaudeOutput(await ask(prompt));
    const planDate = todayStr();
    db.prepare('DELETE FROM plan WHERE plan_date = ?').run(planDate);
    db.prepare('INSERT INTO plan (plan_date, content) VALUES (?, ?)').run(
      planDate,
      JSON.stringify({ reason, ...output }),
    );
    broadcast('plan', { planDate, state: 'ready', ...output });
    return { planDate, state: 'ready', ...output };
  } finally {
    player.setDjState('idle');
    broadcast('dj', { state: 'idle' });
  }
}

// 当日最新计划(可能为 null)
export function todayPlan() {
  const row = db
    .prepare('SELECT * FROM plan WHERE plan_date = ? ORDER BY id DESC LIMIT 1')
    .get(todayStr());
  return row ? { planDate: row.plan_date, ...JSON.parse(row.content) } : null;
}

// 日历 hook:日程开始前 1 小时内触发一次编排(会议前提醒)。
// 以「事件开始时间」为键去重,同一事件只触发一次;未配置/失败静默降级。
async function calendarHook() {
  if (!feishu.isConfigured()) return;
  try {
    const cal = await feishu.todayEvents();
    const now = Date.now();
    const next = cal.events.find((e) => e.start > now);
    if (!next || next.start - now > 60 * 60 * 1000) return;

    const key = `calhook:${next.start}`;
    if (db.prepare('SELECT value FROM prefs WHERE key = ?').get(key)) return;

    await generateDailyPlan({ reason: `日历 hook:${next.summary}` });
    db.prepare(
      "INSERT INTO prefs (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(key);
  } catch {
    // 日历 hook 失败不阻塞其他调度
  }
}

export function startScheduler() {
  // 施工图示例时间点:07:00 起床计划、09:00 早间计划
  cron.schedule('0 7 * * *', () => generateDailyPlan({ reason: '07:00 起床' }).catch(() => {}), TZ);
  cron.schedule('0 9 * * *', () => generateDailyPlan({ reason: '09:00 早间' }).catch(() => {}), TZ);

  // 小时级播台检查:日历 hook + 队列有歌且空闲 → 续播
  cron.schedule('0 * * * *', () => {
    calendarHook().catch(() => {});
    const state = player.getState();
    if (state.queue.length > 0 && !state.isPlaying) {
      broadcast('now-playing', player.startIfIdle());
    }
  }, TZ);

  console.log('[vradio] scheduler 已启动:07:00 / 09:00 计划生成 + 每小时播台检查(Asia/Shanghai)');
}
