<script setup>
// 心情 chips:单选可取消;选中即向 DJ 发起一次编排请求。
// 细描边低存在感;选中状态 = 轻微薄荷绿光,不做实底填充。
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
  min-height: 44px;
  padding: var(--vr-space-2) var(--vr-space-4);
  display: inline-flex;
  align-items: center;
  border: 1px solid rgba(148, 163, 210, 0.22);
  border-radius: 999px;
  color: var(--vr-text-muted);
  transition:
    color var(--vr-motion-fast) var(--vr-ease),
    border-color var(--vr-motion-fast) var(--vr-ease),
    background var(--vr-motion-fast) var(--vr-ease),
    box-shadow var(--vr-motion-fast) var(--vr-ease);
}
.chip:hover:not(:disabled) {
  color: var(--vr-text);
  border-color: var(--vr-line-strong);
}
.chip.on {
  color: var(--vr-on-air);
  border-color: rgba(71, 231, 177, 0.5);
  background: rgba(71, 231, 177, 0.06);
  box-shadow: 0 0 12px rgba(71, 231, 177, 0.12);
}
.chip:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
