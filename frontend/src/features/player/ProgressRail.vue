<script setup>
// 进度轨:可拖动 + 键盘(原生 range),显示已播/总时长
import { computed } from 'vue';
import { player, seek } from '../../stores/player.js';

const pct = computed(() =>
  player.duration ? Math.min(100, (player.currentTime / player.duration) * 100) : 0,
);

function fmt(t) {
  if (!Number.isFinite(t)) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
</script>

<template>
  <div class="rail">
    <input
      type="range"
      min="0"
      :max="player.duration || 0"
      step="0.5"
      :value="player.currentTime"
      :style="{ '--p': pct }"
      :disabled="!player.duration"
      aria-label="播放进度"
      @input="seek(Number($event.target.value))"
    />
    <div class="times meta-label">
      <span>{{ fmt(player.currentTime) }}</span>
      <span>{{ fmt(player.duration) }}</span>
    </div>
  </div>
</template>

<style scoped>
.rail {
  display: grid;
  gap: var(--vr-space-2);
}
input[type='range'] {
  appearance: none;
  width: 100%;
  height: 3px;
  border-radius: 2px;
  background: linear-gradient(
    to right,
    currentColor 0%,
    currentColor calc(var(--p, 0) * 1%),
    color-mix(in srgb, currentColor 20%, transparent) calc(var(--p, 0) * 1%),
    color-mix(in srgb, currentColor 20%, transparent) 100%
  );
  cursor: pointer;
}
input[type='range']::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: currentColor;
  border: 3px solid var(--vr-ivory);
  box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 40%, transparent);
}
input[type='range']:disabled {
  opacity: 0.4;
  cursor: default;
}
.times {
  display: flex;
  justify-content: space-between;
  color: var(--vr-ink-muted);
}
</style>
