<script setup>
// ON AIR 指示器:WS 在线 → 薄荷绿呼吸;离线 → 灰 OFFLINE
defineProps({
  status: { type: String, default: 'disconnected' }, // connected | disconnected
});
</script>

<template>
  <div class="on-air" :class="{ live: status === 'connected' }" role="status">
    <span class="dot" aria-hidden="true"></span>
    <span class="meta-label">{{ status === 'connected' ? 'on air' : 'offline' }}</span>
  </div>
</template>

<style scoped>
.on-air {
  display: inline-flex;
  align-items: center;
  gap: var(--vr-space-2);
  padding: var(--vr-space-1) var(--vr-space-3);
  border: 1px solid var(--vr-line);
  border-radius: 999px;
  color: var(--vr-text-muted);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}
.live {
  color: var(--vr-on-air);
  border-color: var(--vr-on-air-soft);
  background: var(--vr-on-air-soft);
}
.live .dot {
  animation: breathe 2.4s var(--vr-ease) infinite;
}
@keyframes breathe {
  0%,
  100% {
    opacity: 1;
    box-shadow: 0 0 0 0 var(--vr-on-air-soft);
  }
  50% {
    opacity: 0.55;
    box-shadow: 0 0 0 6px transparent;
  }
}
@media (prefers-reduced-motion: reduce) {
  .live .dot {
    animation: none;
  }
}
</style>
