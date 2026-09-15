// prefs 表读写助手:设置页保存的密钥/配置(state.db,gitignore,永不上传)
// 生效优先级:环境变量(server/.env)> prefs;sourceOf 供设置页标注来源
import db from './db.js';

export function getPref(key) {
  try {
    return db.prepare('SELECT value FROM prefs WHERE key = ?').get(key)?.value ?? null;
  } catch {
    return null;
  }
}

export function setPref(key, value) {
  db.prepare(
    'INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, String(value));
}

export function delPref(key) {
  db.prepare('DELETE FROM prefs WHERE key = ?').run(key);
}

// 生效值:环境变量优先,其次 prefs,都没有返回 null
export function effective(envKey, prefKey) {
  return process.env[envKey] || getPref(prefKey) || null;
}

// 配置来源:env / prefs / null(未配置)
export function sourceOf(envKey, prefKey) {
  if (process.env[envKey]) return 'env';
  if (getPref(prefKey)) return 'prefs';
  return null;
}
