<script setup>
// 进度轨:可拖动 + 键盘(原生 range),细线 + 薄荷微光,Doto 显示时长。
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
    <div class="times">
      <span>{{ fmt(player.currentTime) }}</span>
      <span>{{ fmt(player.duration) }}</span>
    </div>
  </div>
</template>

<style scoped>
.rail {
  display: grid;
  gap: var(--vr-space-2);
  width: 100%;
}
input[type='range'] {
  appearance: none;
  width: 100%;
  height: 2px;
  border-radius: 1px;
  background: linear-gradient(
    to right,
    var(--vr-on-air) 0%,
    var(--vr-on-air) calc(var(--p, 0) * 1%),
    rgba(148, 163, 210, 0.18) calc(var(--p, 0) * 1%),
    rgba(148, 163, 210, 0.18) 100%
  );
  cursor: pointer;
}
input[type='range']::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--vr-on-air);
  box-shadow: 0 0 10px rgba(71, 231, 177, 0.55);
  transition: transform var(--vr-motion-fast) var(--vr-ease);
}
input[type='range']::-webkit-slider-thumb:hover {
  transform: scale(1.15);
}
input[type='range']:active::-webkit-slider-thumb {
  transform: scale(1.25);
}
input[type='range']::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: none;
  background: var(--vr-on-air);
  box-shadow: 0 0 10px rgba(71, 231, 177, 0.55);
}
input[type='range']:disabled {
  opacity: 0.35;
  cursor: default;
}
.times {
  display: flex;
  justify-content: space-between;
}
.times span {
  font-family: var(--vr-font-display); /* Doto 数字 */
  font-size: var(--vr-text-caption);
  letter-spacing: 0.06em;
  color: var(--vr-text-muted);
}
</style>
