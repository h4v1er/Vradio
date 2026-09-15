// Feishu/Lark 适配器:tenant_access_token + 主日历今日事件
import { effective } from '../prefs.js';

const BASE = 'https://open.feishu.cn';
const TOKEN_TTL_MS = 100 * 60 * 1000; // token 有效期约 2 小时,提前轮换

let tokenCache = { at: 0, token: null };

export function isConfigured() {
  return Boolean(
    effective('FEISHU_APP_ID', 'feishu_app_id') && effective('FEISHU_APP_SECRET', 'feishu_app_secret'),
  );
}

// 验证凭据:能换到 tenant_access_token 即有效(设置页保存前调用)
export async function testCredentials(appId, appSecret) {
  const res = await fetch(`${BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    signal: AbortSignal.timeout(5000),
  });
  const j = await res.json();
  if (j.code !== 0) throw new Error(j.msg || `code ${j.code}`);
}

async function tenantToken() {
  if (tokenCache.token && Date.now() - tokenCache.at < TOKEN_TTL_MS) return tokenCache.token;
  const appId = effective('FEISHU_APP_ID', 'feishu_app_id');
  const appSecret = effective('FEISHU_APP_SECRET', 'feishu_app_secret');
  const res = await fetch(`${BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    signal: AbortSignal.timeout(5000),
  });
  const j = await res.json();
  if (j.code !== 0) throw new Error(`feishu token:${j.msg}`);
  tokenCache = { at: Date.now(), token: j.tenant_access_token };
  return j.tenant_access_token;
}

async function api(pathname, token) {
  const res = await fetch(BASE + pathname, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  const j = await res.json();
  if (j.code !== 0) throw new Error(`feishu api:${j.msg}`);
  return j.data;
}

// 今日日程(优先主日历);时间戳按 Asia/Shanghai 划分「今天」
export async function todayEvents() {
  if (!isConfigured()) return { configured: false, events: [] };

  const token = await tenantToken();
  const cals = await api('/open-apis/calendar/v4/calendars', token);
  const primary =
    cals.calendar_list?.find((c) => c.type === 'primary') ?? cals.calendar_list?.[0];
  if (!primary) return { configured: true, events: [] };

  const events = await api(
    `/open-apis/calendar/v4/calendars/${primary.calendar_id}/events?page_size=20`,
    token,
  );

  const TZ_OFFSET = 8 * 3600 * 1000; // Asia/Shanghai
  const dayStart = Math.floor((Date.now() + TZ_OFFSET) / 86400000) * 86400000 - TZ_OFFSET;
  const dayEnd = dayStart + 86400000;

  const list = (events.items ?? [])
    .filter((e) => {
      const t = Number(e.start_time?.timestamp);
      return Number.isFinite(t) && t >= dayStart && t < dayEnd;
    })
    .map((e) => ({
      summary: e.summary || '(无标题)',
      start: Number(e.start_time.timestamp),
    }))
    .sort((a, b) => a.start - b.start);

  return { configured: true, events: list };
}
