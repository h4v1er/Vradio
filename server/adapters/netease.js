// 网易云适配器:NeteaseCloudMusicApi 的调用、超时与错误封装
// search / song_url(音质回退)/ lyric / recommend
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
// 封面回退链:album.picUrl → al.picUrl(旧字段)→ 歌手头像
export function toSong(s) {
  return {
    source: 'netease',
    songId: String(s.id),
    title: s.name,
    artist: (s.artists || []).map((a) => a.name).join(' / '),
    album: s.album?.name || '',
    coverUrl: s.album?.picUrl || s.al?.picUrl || s.album?.artist?.img1v1Url || '',
    durationMs: s.duration || 0,
  };
}

// 搜索歌曲
export async function search(keywords, { limit = 5 } = {}) {
  const data = await request('/search', { keywords, limit });
  const songs = data?.result?.songs ?? [];
  return songs.map(toSong);
}

// 播放直链:音质逐级回退(lossless/exhigh 通常需 VIP,免费歌曲止步于 exhigh/higher)
const QUALITY_LEVELS = ['exhigh', 'higher', 'standard'];

export async function songUrl(songId) {
  for (const level of QUALITY_LEVELS) {
    const data = await request('/song/url/v1', { id: songId, level });
    const url = data?.data?.[0]?.url;
    if (url) return { url, level };
  }
  return { url: null, level: null }; // 版权受限 / 需 VIP
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
