// 网易云适配器:NeteaseCloudMusicApi 的调用、超时与错误封装
// search / song_url(音质回退)/ lyric / recommend / 登录态与歌单
import db from '../db.js';

const BASE = process.env.NETEASE_BASE || 'http://localhost:3000';
const TIMEOUT_MS = 5000;

// cookie 策略(优先级从高到低):
// 1. NETEASE_COOKIE 环境变量(server/.env);
// 2. prefs 表 netease_cookie(设置页保存并验证,仅存本机 state.db,不上传);
// 3. 懒加载一次匿名注册 cookie —— 提升非会员歌曲的完整度与音质;
// 4. 都没有则裸请求(VIP 歌曲只返回 30 秒试听片段,由 songUrl 以 preview 标记)。
let anonCookie = null;

function getPrefCookie() {
  try {
    return db.prepare('SELECT value FROM prefs WHERE key = ?').get('netease_cookie')?.value || null;
  } catch {
    return null;
  }
}

export function setPrefCookie(cookie) {
  db.prepare(
    'INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run('netease_cookie', cookie);
}

export function clearPrefCookie() {
  db.prepare('DELETE FROM prefs WHERE key = ?').run('netease_cookie');
}

// 当前 cookie 来源:env / prefs / anonymous(设置页状态展示用,不回 cookie 值)
export function cookieSource() {
  if (process.env.NETEASE_COOKIE) return 'env';
  if (getPrefCookie()) return 'prefs';
  return 'anonymous';
}

async function ensureCookie() {
  if (process.env.NETEASE_COOKIE) return process.env.NETEASE_COOKIE;
  const pref = getPrefCookie();
  if (pref) return pref;
  if (anonCookie) return anonCookie;
  try {
    const data = await request('/register/anonimous');
    anonCookie = data?.cookie || '';
  } catch {
    anonCookie = ''; // 匿名注册失败不阻塞,降级为无 cookie
  }
  return anonCookie;
}

async function request(pathname, params) {
  const url = new URL(pathname, BASE);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`netease HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('netease 请求超时');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// 网易云歌曲 → Vradio 统一歌曲结构(供队列、前端、播放记录共用)
// 字段回退链:/search 用 artists/duration,/playlist/track/all 用 ar/dt,
// 旧接口用 al(封面)。注意:album.artist.img1v1Url 是通用占位头像,不能进回退链。
// vip:fee=1(会员)/ 4(付费专辑)—— 未登录时仅 30 秒试听,前端据此提示
export function toSong(s) {
  return {
    source: 'netease',
    songId: String(s.id),
    title: s.name,
    artist: (s.artists || s.ar || []).map((a) => a.name).join(' / '),
    album: s.album?.name || s.al?.name || '',
    coverUrl: s.album?.picUrl || s.al?.picUrl || '',
    durationMs: s.duration || s.dt || 0,
    vip: s.fee === 1 || s.fee === 4,
  };
}

// 批量补齐封面:/search 对部分歌曲缺 picUrl,经 /song/detail 一次补齐
export async function hydrateCovers(songs) {
  const missing = songs.filter((s) => s.songId && !s.coverUrl);
  if (!missing.length) return songs;
  const cookie = await ensureCookie();
  const data = await request('/song/detail', { ids: missing.map((s) => s.songId).join(','), cookie });
  const covers = new Map((data?.songs ?? []).map((s) => [String(s.id), s.al?.picUrl || '']));
  return songs.map((s) => (s.coverUrl ? s : { ...s, coverUrl: covers.get(s.songId) || '' }));
}

// 搜索歌曲
export async function search(keywords, { limit = 5 } = {}) {
  const cookie = await ensureCookie();
  const data = await request('/search', { keywords, limit, cookie });
  const songs = data?.result?.songs ?? [];
  return songs.map(toSong);
}

// 播放直链:音质逐级回退(lossless/exhigh 通常需 VIP,免费歌曲止步于 exhigh/higher)
// preview:上游返回 freeTrialInfo(未登录 VIP 歌曲 = 30 秒试听片段),必须诚实标注
const QUALITY_LEVELS = ['exhigh', 'higher', 'standard'];

export async function songUrl(songId) {
  const cookie = await ensureCookie();
  for (const level of QUALITY_LEVELS) {
    const data = await request('/song/url/v1', { id: songId, level, cookie });
    const item = data?.data?.[0];
    if (item?.url) {
      const ft = item.freeTrialInfo;
      return { url: item.url, level, preview: Boolean(ft), previewEndSec: ft?.end ?? null };
    }
  }
  return { url: null, level: null, preview: false, previewEndSec: null }; // 版权受限 / 需 VIP
}

// 校验 Cookie 是否有效登录:/login/status 未登录时 profile 为空。
// 返回 {valid, accountId, profile:{nickname, vipType}},供设置页保存前验证。
export async function loginStatus(cookie) {
  const data = await request('/login/status', { cookie });
  const d = data?.data ?? data ?? {};
  const profile = d.profile || null;
  return {
    valid: Boolean(profile),
    code: d.code ?? null, // 未登录时通常为 301,透传给设置页排障
    accountId: d.account?.id ?? profile?.userId ?? null,
    profile: profile ? { nickname: profile.nickname, vipType: profile.vipType } : null,
  };
}

// 登录后获取自己的歌单(含收藏);未配置有效 Cookie 时报错
export async function userPlaylists() {
  const status = await loginStatus(await ensureCookie());
  if (!status.valid || !status.accountId) {
    throw new Error('未登录:请先在设置页保存有效的网易云 Cookie');
  }
  const data = await request('/user/playlist', {
    uid: status.accountId,
    limit: 50,
    cookie: await ensureCookie(),
  });
  return (data?.playlist ?? [])
    .filter((l) => l.trackCount > 0)
    .map((l) => ({ id: String(l.id), name: l.name, trackCount: l.trackCount }));
}

// 歌单详情 + 曲目清单(公开歌单无需登录;导入后交给 DJ 学习)
const PLAYLIST_MAX_TRACKS = 500;

export async function playlistDetail(id) {
  const cookie = await ensureCookie();
  const [detail, tracks] = await Promise.all([
    request('/playlist/detail', { id, cookie }),
    request('/playlist/track/all', { id, limit: PLAYLIST_MAX_TRACKS, cookie }),
  ]);
  const pl = detail?.playlist ?? {};
  const songs = tracks?.songs ?? [];
  return {
    id: String(id),
    name: pl.name || `歌单 ${id}`,
    trackCount: pl.trackCount ?? songs.length,
    tracks: songs.map(toSong),
  };
}

// 歌词
export async function lyric(songId) {
  const data = await request('/lyric', { id: songId });
  return data?.lrc?.lyric || '';
}

// 推荐(免登录新歌速递;该接口的歌手/专辑嵌套在 song 字段下)
export async function recommend({ limit = 10 } = {}) {
  const data = await request('/personalized/newsong', { limit });
  const items = data?.result ?? [];
  return items.map((s) => {
    const song = s.song || s;
    return {
      source: 'netease',
      songId: String(song.id ?? s.id),
      title: song.name ?? s.name,
      artist: (song.artists || s.artists || []).map((a) => a.name).join(' / '),
      album: song.album?.name || s.album?.name || '',
      coverUrl: s.picUrl || song.album?.picUrl || '',
      durationMs: song.duration || s.duration || 0,
    };
  });
}
