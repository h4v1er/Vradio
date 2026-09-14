<script setup>
// "正在播放"实体控制台:全屏唯一象牙白亮色大块(视觉规格)
import { player, nowPlaying, nextUp, togglePlay, next, prev, setVolume } from '../../stores/player.js';
import Waveform from './Waveform.vue';
import ProgressRail from './ProgressRail.vue';

const COVER_FALLBACK =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#0a0d0b" opacity="0.06"/><circle cx="80" cy="80" r="26" fill="none" stroke="#0a0d0b" stroke-opacity="0.35" stroke-width="2"/><circle cx="80" cy="80" r="8" fill="#0a0d0b" fill-opacity="0.35"/></svg>',
  );
</script>

<template>
  <section class="console" aria-label="当前播放">
    <header class="head">
      <span class="meta-label">now playing</span>
      <span v-if="player.dj.state === 'thinking'" class="meta-label thinking">dj thinking…</span>
      <span v-else-if="nextUp" class="meta-label next">next / {{ nextUp.title }}</span>
    </header>

    <div class="main">
      <div class="cover">
        <img
          v-if="nowPlaying && !nowPlaying.unresolved"
          :src="nowPlaying.coverUrl || COVER_FALLBACK"
          :alt="`${nowPlaying.title} 封面`"
          @error="(e) => (e.target.src = COVER_FALLBACK)"
        />
        <div v-else class="cover-empty" aria-hidden="true"></div>
      </div>

      <div class="body">
        <template v-if="nowPlaying && !nowPlaying.unresolved">
          <h1 class="title">{{ nowPlaying.title }}</h1>
          <p class="artist">{{ nowPlaying.artist }}</p>
          <p v-if="nowPlaying.album" class="album meta-label">{{ nowPlaying.album }}</p>
        </template>
        <template v-else-if="nowPlaying?.unresolved">
          <h1 class="title">未能解析</h1>
          <p class="artist">{{ nowPlaying.unresolved }}</p>
          <p class="album meta-label">网易云未找到对应歌曲</p>
        </template>
        <template v-else>
          <h1 class="title">等待开播</h1>
          <p class="artist">说点什么,Vradio 为你选歌</p>
        </template>

        <Waveform class="wave" />

        <ProgressRail class="progress" />

        <div class="controls">
          <button class="ctrl" aria-label="上一首" @click="prev">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 5h2v14H6zM20 5v14l-10-7z" />
            </svg>
          </button>
          <button class="ctrl main-btn" :aria-label="player.isPlaying ? '暂停' : '播放'" @click="togglePlay">
            <svg v-if="!player.isPlaying" width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
            <svg v-else width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
            </svg>
          </button>
          <button class="ctrl" aria-label="下一首" @click="next">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M16 5h2v14h-2zM4 5v14l10-7z" />
            </svg>
          </button>

          <div class="volume">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M3 9v6h4l5 5V4L7 9z" />
            </svg>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              :value="player.volume"
              aria-label="音量"
              @input="setVolume(Number($event.target.value))"
            />
            <span class="vol-num meta-label">{{ Math.round(player.volume * 100) }}</span>
          </div>
        </div>
      </div>
    </div>

    <p v-if="player.stalled" class="stalled meta-label" role="status">缓冲中…</p>
  </section>
</template>

<style scoped>
.console {
  background: var(--vr-ivory);
  color: var(--vr-ink);
  border-radius: var(--vr-radius-l);
  padding: var(--vr-space-5);
  display: grid;
  gap: var(--vr-space-4);
  position: relative;
}
.head {
  display: flex;
  justify-content: space-between;
  gap: var(--vr-space-3);
}
.head .meta-label {
  color: var(--vr-ink-muted);
}
.thinking {
  color: var(--vr-ai);
}
.next {
  color: var(--vr-ink-muted);
}
.main {
  display: grid;
  grid-template-columns: minmax(120px, 200px) 1fr;
  gap: var(--vr-space-5);
  align-items: center;
}
.cover {
  aspect-ratio: 1;
  border-radius: var(--vr-radius-m);
  overflow: hidden;
  background: rgba(10, 13, 11, 0.06);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-empty {
  width: 100%;
  height: 100%;
  background-image: radial-gradient(circle, rgba(10, 13, 11, 0.25) 1px, transparent 1px);
  background-size: 12px 12px;
}
.body {
  display: grid;
  gap: var(--vr-space-2);
  min-width: 0;
}
.title {
  font-size: clamp(24px, 3vw, 40px);
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.artist {
  font-size: var(--vr-text-body);
  color: var(--vr-ink-muted);
}
.album {
  color: var(--vr-ink-muted);
}
.wave {
  color: var(--vr-ink);
  margin-top: var(--vr-space-3);
}
.controls {
  display: flex;
  align-items: center;
  gap: var(--vr-space-4);
  margin-top: var(--vr-space-3);
}
.ctrl {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  transition: background var(--vr-motion-fast) var(--vr-ease);
}
.ctrl:hover {
  background: rgba(10, 13, 11, 0.08);
}
.main-btn {
  background: var(--vr-ink);
  color: var(--vr-ivory);
  width: 56px;
  height: 56px;
}
.main-btn:hover {
  background: #1c211d;
}
.volume {
  display: flex;
  align-items: center;
  gap: var(--vr-space-2);
  margin-left: auto;
  color: var(--vr-ink-muted);
}
.volume input[type='range'] {
  width: 90px;
  accent-color: var(--vr-ink);
}
.vol-num {
  color: var(--vr-ink-muted);
  min-width: 28px;
  text-align: right;
}
.stalled {
  position: absolute;
  top: var(--vr-space-4);
  right: var(--vr-space-5);
  color: var(--vr-ink-muted);
}

/* 移动端:控制台不缩小,仅压缩内部间距 */
@media (max-width: 767px) {
  .console {
    padding: var(--vr-space-4);
  }
  .main {
    grid-template-columns: 104px 1fr;
    gap: var(--vr-space-4);
  }
  .volume input[type='range'] {
    width: 60px;
  }
}
</style>
