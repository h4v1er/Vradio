<script setup>
// DJ 消息:AI 消息淡紫边线区分;播放列表条目可点击进队列(Phase 9 接队列交互)
import { sendMessage } from '../../stores/chat.js';

defineProps({
  message: { type: Object, required: true }, // {role, say, play[], degraded, ts}
});

function playSong(entry) {
  if (!entry || entry.unresolved) return;
  sendMessage(`点一首${entry.artist} ${entry.title}`);
}
</script>

<template>
  <div class="msg" :class="message.role">
    <div class="bubble">
      <p class="say">{{ message.say }}</p>

      <ul v-if="message.play?.length" class="plays" aria-label="播放列表">
        <li v-for="(s, i) in message.play" :key="i">
          <button
            class="play-item"
            :disabled="Boolean(s.unresolved)"
            :title="s.unresolved ? '网易云未找到,点击无效' : '点击播放'"
            @click="playSong(s)"
          >
            <span class="idx meta-label">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="names">
              <span class="t">{{ s.title || s.unresolved }}</span>
              <span v-if="!s.unresolved" class="a">{{ s.artist }}</span>
            </span>
            <span v-if="s.unresolved" class="meta-label">未解析</span>
            <span v-else class="arrow" aria-hidden="true">▶</span>
          </button>
        </li>
      </ul>

      <p v-if="message.degraded" class="degraded meta-label">信号降级 · 部分能力不可用</p>
    </div>
  </div>
</template>

<style scoped>
.msg {
  display: flex;
}
.msg.user {
  justify-content: flex-end;
}
.msg.user .bubble {
  border-color: var(--vr-line);
  border-left-color: var(--vr-text-muted);
}
.bubble {
  max-width: 78%;
  border: 1px solid var(--vr-line);
  border-left: 2px solid var(--vr-ai);
  border-radius: var(--vr-radius-m);
  padding: var(--vr-space-3) var(--vr-space-4);
  background: var(--vr-surface);
  display: grid;
  gap: var(--vr-space-3);
  animation: rise var(--vr-motion) var(--vr-ease);
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}
.say {
  font-size: var(--vr-text-body);
  line-height: 1.6;
}
.plays {
  list-style: none;
  display: grid;
  gap: var(--vr-space-1);
}
.play-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--vr-space-3);
  padding: var(--vr-space-2) var(--vr-space-3);
  border-radius: var(--vr-radius-s);
  text-align: left;
  transition: background var(--vr-motion-fast) var(--vr-ease);
}
.play-item:hover:not(:disabled) {
  background: var(--vr-surface-raised);
}
.play-item:disabled {
  opacity: 0.5;
  cursor: default;
}
.idx {
  color: var(--vr-on-air);
}
.names {
  display: grid;
  min-width: 0;
  flex: 1;
}
.t {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.a {
  font-size: var(--vr-text-body-sm);
  color: var(--vr-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.arrow {
  color: var(--vr-on-air);
  font-size: 10px;
}
.degraded {
  color: var(--vr-danger);
}
</style>
