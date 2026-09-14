import db from './db.js';

// 播放队列与当前播放状态。
// 本地服务是唯一的状态拥有者(施工图原则):PWA 通过 API/WS 读取与操作,
// 状态持久化到 state.db,重启后恢复。
let queue = [];
let currentIndex = -1;
let isPlaying = false;
let volume = Number(db.prepare("SELECT value FROM prefs WHERE key = 'volume'").get()?.value ?? 0.7);

let djState = 'idle'; // idle / thinking / speaking

function snapshot() {
  return {
    playing: currentIndex >= 0 ? queue[currentIndex] : null, // 当前歌曲对象
    queue,
    index: currentIndex,
    isPlaying, // 播放/暂停状态
    volume,
    dj: { state: djState },
  };
}

function persist() {
  db.prepare(
    `INSERT INTO player_state (id, playing, queue, updated_at) VALUES (1, ?, ?, datetime('now', 'localtime'))
     ON CONFLICT(id) DO UPDATE SET playing = excluded.playing, queue = excluded.queue, updated_at = excluded.updated_at`,
  ).run(
    currentIndex >= 0 ? JSON.stringify(queue[currentIndex]) : null,
    JSON.stringify(queue),
  );
  db.prepare("INSERT INTO prefs (key, value) VALUES ('volume', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(String(volume));
}

function restore() {
  const row = db.prepare('SELECT playing, queue FROM player_state WHERE id = 1').get();
  if (!row?.queue) return;
  try {
    const restored = JSON.parse(row.queue);
    if (Array.isArray(restored)) queue = restored;
    if (row.playing) {
      const p = JSON.parse(row.playing);
      currentIndex = queue.findIndex((s) => s.songId === p.songId);
    }
    if (currentIndex >= 0) isPlaying = false; // 重启后默认暂停,由用户手动继续
  } catch {
    queue = [];
    currentIndex = -1;
  }
}

function recordPlay(song) {
  if (!song || song.unresolved) return;
  db.prepare(
    'INSERT INTO plays (source, song_id, title, artist, album, cover_url, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(song.source, song.songId, song.title, song.artist, song.album, song.coverUrl, song.durationMs);
}

export function getState() {
  return snapshot();
}

export function getDjState() {
  return djState;
}

export function setDjState(state) {
  djState = state;
}

// 追加到队尾(同 songId 去重)
export function enqueue(songs) {
  const fresh = songs.filter((s) => !s.unresolved && !queue.some((q) => q.songId === s.songId));
  queue.push(...fresh);
  persist();
  return snapshot();
}

// 插入队首并立即播放(点歌直达用)
export function playNow(song) {
  if (!song || song.unresolved) return snapshot();
  queue.unshift(song);
  currentIndex = 0;
  isPlaying = true;
  recordPlay(song);
  persist();
  return snapshot();
}

// 空闲时自动开播(DJ 编排用)
export function startIfIdle() {
  if (currentIndex < 0 && queue.length > 0) {
    currentIndex = 0;
    isPlaying = true;
    recordPlay(queue[0]);
    persist();
  }
  return snapshot();
}

export function toggle() {
  isPlaying = !isPlaying;
  persist();
  return snapshot();
}

export function next() {
  if (currentIndex >= 0 && currentIndex < queue.length - 1) {
    currentIndex += 1;
    isPlaying = true;
    recordPlay(queue[currentIndex]);
    persist();
  }
  return snapshot();
}

export function prev() {
  if (currentIndex > 0) {
    currentIndex -= 1;
    isPlaying = true;
    recordPlay(queue[currentIndex]);
    persist();
  }
  return snapshot();
}

export function setVolume(v) {
  volume = Math.min(1, Math.max(0, v));
  persist();
  return snapshot();
}

export function removeAt(i) {
  if (i >= 0 && i < queue.length) {
    queue.splice(i, 1);
    if (i === currentIndex) {
      currentIndex = -1;
      isPlaying = false;
    } else if (i < currentIndex) {
      currentIndex -= 1;
    }
    persist();
  }
  return snapshot();
}

export function clear() {
  queue = [];
  currentIndex = -1;
  isPlaying = false;
  persist();
  return snapshot();
}

restore();
