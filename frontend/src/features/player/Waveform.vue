<script setup>
// 波形:播放时轻微响应(纯 CSS 条),reduced-motion 静止
import { player } from '../../stores/player.js';

const BARS = 36;
const bars = Array.from({ length: BARS }, (_, i) => {
  // 静态包络 + 随机微差,播放时按正弦相位轻摆
  const env = 0.35 + 0.65 * Math.abs(Math.sin(i * 0.55 + 1.7));
  return {
    height: Math.round(env * 100),
    delay: (i % 8) * -0.13,
  };
});
</script>

<template>
  <div class="waveform" :class="{ playing: player.isPlaying }" aria-hidden="true">
    <span
      v-for="(b, i) in bars"
      :key="i"
      class="bar"
      :style="{ height: `${b.height}%`, animationDelay: `${b.delay}s` }"
    ></span>
  </div>
</template>

<style scoped>
.waveform {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 40px;
}
.bar {
  flex: 1;
  min-width: 2px;
  border-radius: 1px;
  background: currentColor;
  opacity: 0.85;
  transform-origin: center;
}
.playing .bar {
  animation: sway 1.6s var(--vr-ease) infinite alternate;
}
@keyframes sway {
  from {
    transform: scaleY(0.55);
    opacity: 0.45;
  }
  to {
    transform: scaleY(1.1);
    opacity: 0.95;
  }
}
@media (prefers-reduced-motion: reduce) {
  .playing .bar {
    animation: none;
  }
}
</style>
