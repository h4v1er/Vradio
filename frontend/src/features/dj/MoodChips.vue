<script setup>
// 心情 chips:单选可取消;选中即向 DJ 发起一次编排请求
import { ref } from 'vue';
import { setMood } from '../../stores/chat.js';

const MOODS = ['Chill', 'Happy', 'Melancholy', 'Lonely', 'Nostalgic', 'Dreamy'];
const active = ref(null);
const busy = ref(false);

function pick(mood) {
  const next = active.value === mood ? null : mood;
  active.value = next;
  if (!next) return;
  busy.value = true;
  setMood(next).finally(() => {
    busy.value = false;
  });
}
</script>

<template>
  <div class="moods" role="group" aria-label="心情选择">
    <span class="meta-label">mood</span>
    <button
      v-for="m in MOODS"
      :key="m"
      class="chip"
      :class="{ on: active === m }"
      :disabled="busy"
      :aria-pressed="active === m"
      @click="pick(m)"
    >
      {{ m }}
    </button>
  </div>
</template>

<style scoped>
.moods {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--vr-space-2);
}
.chip {
  font-family: var(--vr-font-mono);
  font-size: var(--vr-text-caption);
  letter-spacing: 0.06em;
  padding: var(--vr-space-1) var(--vr-space-3);
  border: 1px solid var(--vr-line);
  border-radius: 999px;
  color: var(--vr-text-muted);
  transition:
    color var(--vr-motion-fast) var(--vr-ease),
    border-color var(--vr-motion-fast) var(--vr-ease),
    background var(--vr-motion-fast) var(--vr-ease);
}
.chip:hover:not(:disabled) {
  color: var(--vr-text);
  border-color: var(--vr-text-muted);
}
.chip.on {
  color: var(--vr-ink);
  background: var(--vr-on-air);
  border-color: var(--vr-on-air);
}
.chip:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
