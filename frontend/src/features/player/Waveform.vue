<script setup>
// 波形:发光的细线频谱,播放时按真实播放进度逐根点亮(数据驱动,非假动画),
// 并带极轻微的呼吸摆动;reduced-motion 静止。
import { computed } from 'vue';
import { player } from '../../stores/player.js';

const N = 48;
const bars = Array.from({ length: N }, (_, i) => {
  // 静态包络:两端低、中段起伏;每根随机周期与相位
  const env = 0.25 + 0.75 * Math.abs(Math.sin(i * 0.42 + 1.3));
  return {
    height: Math.round((0.3 + 0.7 * env) * 100),
    delay: -(Math.random() * 3).toFixed(2),
    dur: (2.4 + Math.random() * 1.6).toFixed(2),
  };
});

const lit = computed(() =>
  player.duration ? Math.round((player.currentTime / player.duration) * N) : 0,
);
</script>

<template>
  <div class="waveform" :class="{ playing: player.isPlaying }" aria-hidden="true">
    <span
      v-for="(b, i) in bars"
      :key="i"
      class="bar"
      :class="{ lit: i < lit }"
      :style="{ height: `${b.height}%`, '--d': `${b.dur}s`, '--dl': `${b.delay}s` }"
    ></span>
  </div>
</template>

<style scoped>
.waveform {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 56px;
}
.bar {
  width: 2px;
  border-radius: 1px;
  background: rgba(94, 112, 190, 0.5); /* 未点亮:低饱和靛蓝细线 */
  transform-origin: center;
  transition:
    background var(--vr-motion) var(--vr-ease),
    box-shadow var(--vr-motion) var(--vr-ease);
}
.bar.lit {
  background: var(--vr-on-air);
  box-shadow: 0 0 6px rgba(71, 231, 177, 0.32); /* 克制微光 */
}
.playing .bar {
  animation: breathe var(--d) var(--vr-ease) infinite;
  animation-delay: var(--dl);
}
@keyframes breathe {
  0%,
  100% {
    transform: scaleY(0.72);
  }
  50% {
    transform: scaleY(1.18);
  }
}
@media (prefers-reduced-motion: reduce) {
  .playing .bar {
    animation: none;
  }
}
</style>
