// 网易云适配器:NeteaseCloudMusicApi 的调用、超时与错误封装
// Phase 3 将补充:song_url(音质回退)、lyric、recommend 与音频流代理
const BASE = process.env.NETEASE_BASE || 'http://localhost:3000';
const TIMEOUT_MS = 5000;

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
export function toSong(s) {
  return {
    source: 'netease',
    songId: String(s.id),
    title: s.name,
    artist: (s.artists || []).map((a) => a.name).join(' / '),
    album: s.album?.name || '',
    coverUrl: s.album?.picUrl || '',
    durationMs: s.duration || 0,
  };
}

// 搜索歌曲
export async function search(keywords, { limit = 5 } = {}) {
  const data = await request('/search', { keywords, limit });
  const songs = data?.result?.songs ?? [];
  return songs.map(toSong);
}
