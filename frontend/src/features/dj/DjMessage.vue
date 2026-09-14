<script setup>
// DJ 消息:半透明深蓝面板 + 很细的紫色左边线标明 AI 串词。
// compact 模式(主视图面板)正文最多 5 行,展开后完整展示。
// 播放列表条目点击 → 真实点歌请求。
import { sendMessage } from '../../stores/chat.js';

defineProps({
  message: { type: Object, required: true }, // {role, say, play[], degraded, ts}
  compact: { type: Boolean, default: false },
});

function playSong(entry) {
  if (!entry || entry.unresolved) return;
  sendMessage(`点一首${entry.artist} ${entry.title}`);
}
</script>

<template>
  <div class="msg" :class="message.role">
    <div class="bubble" :class="{ compact }">
      <p class="say" :class="{ clamped: compact }">{{ message.say }}</p>

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
.bubble {
  max-width: 100%;
  background: var(--vr-panel); /* 半透明深蓝 */
  border-left: 2px solid var(--vr-ai); /* 细紫左边线 = AI 串词 */
  border-radius: var(--vr-radius-m);
  padding: var(--vr-space-3) var(--vr-space-4);
  display: grid;
  gap: var(--vr-space-3);
  animation: rise var(--vr-motion) var(--vr-ease);
}
.msg.user .bubble {
  border-left-color: var(--vr-line-strong);
  background: rgba(10, 15, 38, 0.35);
}
.msg.user .say {
  color: var(--vr-text-muted);
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
/* 嵌在 DJ 串词面板里:去掉自身底色,只留细紫左边线 */
.bubble.compact {
  background: transparent;
  padding: 0;
  padding-left: var(--vr-space-3);
  border-radius: 0;
  animation: none;
}
.clamped {
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.plays {
  list-style: none;
  display: grid;
}
.play-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--vr-space-3);
  padding: var(--vr-space-3) var(--vr-space-2);
  min-height: 44px;
  text-align: left;
  border-top: 1px solid var(--vr-line);
  transition: background var(--vr-motion-fast) var(--vr-ease);
}
.play-item:first-child {
  border-top: none;
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
