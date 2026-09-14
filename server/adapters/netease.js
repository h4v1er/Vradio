// 网易云适配器:NeteaseCloudMusicApi 的调用、超时与错误封装
// search / song_url(音质回退)/ lyric / recommend
const BASE = process.env.NETEASE_BASE || 'http://localhost:3000';
const TIMEOUT_MS = 5000;

// cookie 策略:
// 1. NETEASE_COOKIE(用户登录 music.163.com 导出的 MUSIC_U cookie)优先 —— VIP 歌曲可完整播放;
// 2. 否则懒加载一次匿名注册 cookie —— 提升非会员歌曲的完整度与音质;
// 3. 都没有则裸请求(VIP 歌曲只返回 30 秒试听片段,由 songUrl 以 preview 标记)。
let anonCookie = null;
async function ensureCookie() {
  if (process.env.NETEASE_COOKIE) return process.env.NETEASE_COOKIE;
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
// 封面回退链:album.picUrl → al.picUrl(旧字段)→ 歌手头像
// vip:fee=1(会员)/ 4(付费专辑)—— 未登录时仅 30 秒试听,前端据此提示
export function toSong(s) {
  return {
    source: 'netease',
    songId: String(s.id),
    title: s.name,
    artist: (s.artists || []).map((a) => a.name).join(' / '),
    album: s.album?.name || '',
    // 注意:album.artist.img1v1Url 是通用占位头像,不能进回退链
    coverUrl: s.album?.picUrl || s.al?.picUrl || '',
    durationMs: s.duration || 0,
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
