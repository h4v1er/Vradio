<script setup>
// 深夜电台主视觉:星云氛围中的封面辉光 + 歌曲信息 + 发光细线波形/进度 + 控制。
// 播放逻辑全部沿用 stores/player.js(服务端是状态唯一拥有者),此处只做视觉。
import { computed } from 'vue';
import {
  player,
  nowPlaying,
  nextUp,
  togglePlay,
  next,
  prev,
  setVolume,
} from '../../stores/player.js';
import Waveform from './Waveform.vue';
import ProgressRail from './ProgressRail.vue';

const COVER_FALLBACK =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#0b1130"/><circle cx="80" cy="80" r="26" fill="none" stroke="#4b3d99" stroke-opacity="0.55" stroke-width="2"/><circle cx="80" cy="80" r="8" fill="#47e7b1" fill-opacity="0.55"/></svg>',
  );

const coverUrl = computed(() => nowPlaying.value?.coverUrl || COVER_FALLBACK);
const haloStyle = computed(() => ({ backgroundImage: `url("${coverUrl.value}")` }));
const playable = computed(() => Boolean(nowPlaying.value && !nowPlaying.value.unresolved));
</script>

<template>
  <section class="hero" aria-label="当前播放">
    <header class="hero-head">
      <span class="np meta-label"><i class="dot" aria-hidden="true"></i>now playing</span>
      <span class="side">
        <span v-if="player.dj.state === 'thinking'" class="meta-label thinking">dj thinking…</span>
        <span v-else-if="nextUp" class="meta-label">next · {{ nextUp.title }}</span>
        <span v-else class="station" aria-hidden="true">98.7</span>
      </span>
    </header>

    <div class="cover-zone">
      <div v-if="nowPlaying" class="halo" :style="haloStyle" aria-hidden="true"></div>
      <div v-else class="halo empty-halo" aria-hidden="true"></div>
      <div class="cover">
        <img
          v-if="playable"
          :src="coverUrl"
          :alt="`${nowPlaying.title} 封面`"
          @error="(e) => (e.target.src = COVER_FALLBACK)"
        />
        <div v-else class="cover-empty" aria-hidden="true"><span class="ring"></span></div>
      </div>
    </div>

    <div class="info">
      <template v-if="nowPlaying && !nowPlaying.unresolved">
        <h1 class="title">{{ nowPlaying.title }}</h1>
        <p class="artist">{{ nowPlaying.artist }}</p>
        <p v-if="nowPlaying.album" class="album meta-label">{{ nowPlaying.album }}</p>
        <p v-if="nowPlaying.preview" class="vip meta-label" role="status">
          vip 试听 · 30 秒(配置 NETEASE_COOKIE 可完整播放)
        </p>
      </template>
      <template v-else-if="nowPlaying?.unresolved">
        <h1 class="title">未能解析</h1>
        <p class="artist">{{ nowPlaying.unresolved }}</p>
        <p class="album meta-label">网易云未找到对应歌曲</p>
      </template>
      <template v-else>
        <h1 class="title">深夜电台</h1>
        <p class="artist">说点什么,Vradio 为你选歌</p>
      </template>
    </div>

    <Waveform />

    <ProgressRail />

    <div class="controls">
      <button
        class="ctrl"
        :disabled="!player.queue.length || player.index <= 0"
        aria-label="上一首"
        @click="prev"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6 5h2v14H6zM20 5v14l-10-7z" />
        </svg>
      </button>
      <button
        class="ctrl main-btn"
        :disabled="!playable"
        :aria-label="player.isPlaying ? '暂停' : '播放'"
        @click="togglePlay"
      >
        <svg v-if="!player.isPlaying" width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
        <svg v-else width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
        </svg>
      </button>
      <button class="ctrl" :disabled="!nextUp" aria-label="下一首" @click="next">
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
          :style="{ '--vol': Math.round(player.volume * 100) }"
          aria-label="音量"
          @input="setVolume(Number($event.target.value))"
        />
        <span class="vol-num meta-label">{{ Math.round(player.volume * 100) }}</span>
      </div>
    </div>

    <p v-if="player.stalled && playable" class="stalled meta-label" role="status">buffering…</p>
  </section>
</template>

<style scoped>
.hero {
  display: grid;
  justify-items: center;
  gap: var(--vr-space-3);
  text-align: center;
  padding: var(--vr-space-5) 0 var(--vr-space-4); /* 压缩留白:1440×900 首屏要露出 DJ 串词面板 */
}

.hero-head {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.np {
  display: inline-flex;
  align-items: center;
  gap: var(--vr-space-2);
}
.np .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vr-on-air);
  box-shadow: 0 0 8px var(--vr-on-air);
}
.thinking {
  color: var(--vr-ai);
}
.station {
  font-family: var(--vr-font-display); /* Doto 装饰数字 */
  font-size: var(--vr-text-body);
  color: var(--vr-text-muted);
  opacity: 0.45;
  letter-spacing: 0.08em;
}

/* 封面 + 辉光(背景艺术,不影响 UI 层) */
.cover-zone {
  position: relative;
  width: min(280px, 56vw);
  aspect-ratio: 1;
  display: grid;
  place-items: center;
}
.halo {
  position: absolute;
  inset: -8%;
  border-radius: 50%;
  background-size: cover;
  background-position: center;
  filter: blur(48px);
  opacity: 0.5;
}
.empty-halo {
  background: radial-gradient(circle, var(--vr-nebula-violet), transparent 70%);
  opacity: 0.35;
  animation: halo-pulse 4s var(--vr-ease) infinite;
}
.cover {
  position: relative;
  width: 68%;
  aspect-ratio: 1;
  border-radius: var(--vr-radius-l);
  overflow: hidden;
  border: 1px solid var(--vr-line);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-empty {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background: var(--vr-surface);
}
.ring {
  width: 46%;
  aspect-ratio: 1;
  border-radius: 50%;
  border: 1px solid var(--vr-line-strong);
}

.info {
  display: grid;
  gap: var(--vr-space-1);
  justify-items: center;
}
.title {
  font-size: clamp(26px, 3.4vw, 40px);
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.12;
  max-width: 24ch;
}
.artist {
  color: var(--vr-text-muted);
  font-size: var(--vr-text-body);
}
.album {
  color: var(--vr-text-muted);
  opacity: 0.7;
}
.vip {
  color: var(--vr-on-air);
}

.controls {
  display: flex;
  align-items: center;
  gap: var(--vr-space-4);
}
.ctrl {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 1px solid var(--vr-line);
  display: grid;
  place-items: center;
  color: var(--vr-text);
  transition:
    background var(--vr-motion-fast) var(--vr-ease),
    border-color var(--vr-motion-fast) var(--vr-ease),
    box-shadow var(--vr-motion-fast) var(--vr-ease),
    transform var(--vr-motion-fast) var(--vr-ease),
    opacity var(--vr-motion-fast) var(--vr-ease);
}
.ctrl:hover:not(:disabled) {
  background: var(--vr-surface-raised);
  border-color: var(--vr-line-strong);
}
.ctrl:active:not(:disabled) {
  transform: scale(0.94);
}
.ctrl:disabled {
  opacity: 0.3;
  cursor: default;
}
.main-btn {
  width: 64px;
  height: 64px;
  background: var(--vr-on-air);
  color: var(--vr-ink);
  border-color: transparent;
}
.main-btn:hover:not(:disabled) {
  background: var(--vr-on-air);
  box-shadow: 0 0 32px var(--vr-on-air-soft);
}
.main-btn:active:not(:disabled) {
  transform: scale(0.96);
}
.volume {
  display: flex;
  align-items: center;
  gap: var(--vr-space-2);
  margin-left: auto;
  color: var(--vr-text-muted);
}
.volume input[type='range'] {
  appearance: none;
  width: 84px;
  height: 2px;
  border-radius: 1px;
  background: linear-gradient(
    to right,
    var(--vr-text-muted) 0%,
    var(--vr-text-muted) calc(var(--vol, 0) * 1%),
    rgba(148, 163, 210, 0.18) calc(var(--vol, 0) * 1%),
    rgba(148, 163, 210, 0.18) 100%
  );
  cursor: pointer;
}
.volume input[type='range']::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--vr-text-muted);
  transition:
    background var(--vr-motion-fast) var(--vr-ease),
    transform var(--vr-motion-fast) var(--vr-ease);
}
.volume input[type='range']:hover::-webkit-slider-thumb {
  background: var(--vr-on-air);
}
.volume input[type='range']:active::-webkit-slider-thumb {
  transform: scale(1.3);
}
.volume input[type='range']::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: none;
  background: var(--vr-text-muted);
}
.vol-num {
  min-width: 26px;
  text-align: right;
}
.stalled {
  color: var(--vr-on-air);
}
@keyframes halo-pulse {
  0%,
  100% {
    opacity: 0.3;
  }
  50% {
    opacity: 0.5;
  }
}

/* 移动端:压缩留白,不缩小触控目标 */
@media (max-width: 767px) {
  .hero {
    padding: var(--vr-space-5) 0 var(--vr-space-4);
    gap: var(--vr-space-3);
  }
  .cover-zone {
    width: 58vw;
  }
  .controls {
    gap: var(--vr-space-3);
  }
  .volume input[type='range'] {
    width: 64px;
  }
}
</style>
