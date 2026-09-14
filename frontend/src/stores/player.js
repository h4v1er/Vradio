// 播放器 store:前端唯一 <audio>,服务端是状态唯一拥有者。
// 所有状态变更(播放/暂停/切歌/音量)都经 POST /api/chat 走服务端,
// 再通过 WS now-playing 事件回流 —— 前端只做渲染与本地进度。
import { reactive, computed } from 'vue';
import { http } from '../lib/api/http.js';

const audio = new Audio();
audio.preload = 'auto';

export const player = reactive({
  playing: null, // 当前曲目(song 对象,可能为 {unresolved})
  queue: [],
  index: -1,
  isPlaying: false,
  volume: 0.7,
  dj: { state: 'idle' }, // idle | thinking
  currentTime: 0,
  duration: 0,
  stalled: false, // 加载中/无资源时的本地状态
});

export const nowPlaying = computed(() => player.playing);
export const hasQueue = computed(() => player.queue.length > 0);
export const nextUp = computed(() =>
  player.index >= 0 && player.index < player.queue.length - 1
    ? player.queue[player.index + 1]
    : null,
);

// 服务端快照 → 本地状态(路由进入与 WS now-playing 共用)
// 歌曲对象键名与服务端一致:songId / coverUrl
export function applySnapshot(s) {
  const songChanged = player.playing?.songId !== s.playing?.songId;
  player.playing = s.playing;
  player.queue = s.queue ?? [];
  player.index = s.index ?? -1;
  player.isPlaying = Boolean(s.isPlaying);
  player.volume = s.volume ?? player.volume;
  if (s.dj) player.dj = s.dj;

  if (songChanged) {
    if (s.playing && !s.playing.unresolved) {
      audio.src = `/api/stream/${s.playing.songId}`;
      audio.play().catch(() => {});
    } else {
      audio.removeAttribute('src');
      audio.load();
    }
  }
  if (player.isPlaying && player.playing && !player.playing.unresolved) {
    audio.play().catch(() => {});
  } else {
    audio.pause();
  }
  audio.volume = player.volume;
  prefetchNext();
}

// 预取下一首(仅暖缓存,不播放)
function prefetchNext() {
  const n = nextUp.value;
  if (n && !n.unresolved) {
    fetch(`/api/stream/${n.songId}`, { headers: { Range: 'bytes=0-2047' } }).catch(() => {});
  }
}

// ── 音频元素事件(纯本地:进度/缓冲/结束) ────────────────────
audio.addEventListener('timeupdate', () => {
  player.currentTime = audio.currentTime;
  player.duration = audio.duration || 0;
});
audio.addEventListener('waiting', () => {
  player.stalled = true;
});
audio.addEventListener('playing', () => {
  player.stalled = false;
});
audio.addEventListener('ended', () => {
  // 服务端推进队列:走统一控制指令
  http.post('/chat', { message: '下一首' }).catch(() => {});
});

// ── 动作:一律经服务端 ─────────────────────────────────────
export function togglePlay() {
  return http.post('/chat', { message: player.isPlaying ? '暂停' : '继续' });
}
export function next() {
  return http.post('/chat', { message: '下一首' });
}
export function prev() {
  return http.post('/chat', { message: '上一首' });
}
export function setVolume(v) {
  const clamped = Math.min(1, Math.max(0, v));
  player.volume = clamped; // 本地即时生效
  audio.volume = clamped;
  return http.post('/chat', { message: `音量${Math.round(clamped * 100)}` });
}
export function seek(t) {
  audio.currentTime = t;
  player.currentTime = t;
}

// 本地音量(DJ 串词压低声时用,不惊动服务端状态)
export function setLocalVolume(v) {
  audio.volume = v;
}
