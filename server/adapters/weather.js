// OpenWeather 适配器:当前天气 + 10 分钟内存缓存
import { effective, getPref } from '../prefs.js';

const API = 'https://api.openweathermap.org/data/2.5/weather';
const CACHE_TTL_MS = 10 * 60 * 1000;

let cache = { at: 0, data: null };

export function isConfigured() {
  return Boolean(effective('OPENWEATHER_API_KEY', 'openweather_api_key'));
}

// 验证 key:200 即激活;401 多为新 key 未激活(10 分钟~2 小时),仍可保存但如实提示
export async function testKey(key, city = 'Shanghai') {
  const url = `${API}?q=${encodeURIComponent(city)}&appid=${key}&units=metric&lang=zh_cn`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) return { ok: true, activated: true };
    return { ok: true, activated: false, status: res.status };
  } catch (err) {
    return { ok: true, activated: false, status: 0, networkError: err.message };
  }
}

// 返回 {configured, city, desc, temp, feels, humidity};未配置/失败由调用方降级
export async function now() {
  if (!isConfigured()) return { configured: false };
  if (cache.data && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  const key = effective('OPENWEATHER_API_KEY', 'openweather_api_key');
  const city = process.env.OPENWEATHER_CITY || getPref('openweather_city') || 'Shanghai';
  const url = `${API}?q=${encodeURIComponent(city)}&appid=${key}&units=metric&lang=zh_cn`;

  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`weather HTTP ${res.status}`);
  const j = await res.json();

  cache.data = {
    configured: true,
    city: j.name,
    desc: j.weather?.[0]?.description ?? '',
    temp: j.main?.temp ?? null,
    feels: j.main?.feels_like ?? null,
    humidity: j.main?.humidity ?? null,
  };
  cache.at = Date.now();
  return cache.data;
}
