<script setup>
// 请求输入:下划线式极简输入框 + 44px 薄荷发送键。
// 提交用小型行内状态(dots),不遮挡播放器;错误就地展示。
import { ref } from 'vue';
import { chat, sendMessage } from '../../stores/chat.js';

const text = ref('');

function submit() {
  const t = text.value;
  if (!t.trim() || chat.sending) return;
  text.value = '';
  sendMessage(t);
}
</script>

<template>
  <div class="composer">
    <div class="box" :class="{ sending: chat.sending }">
      <input
        v-model="text"
        type="text"
        placeholder="告诉 Vradio 你想听什么…"
        aria-label="给 DJ 发消息"
        :disabled="chat.sending"
        @keydown.enter="submit"
      />
      <button
        class="send"
        :disabled="chat.sending || !text.trim()"
        aria-label="发送"
        @click="submit"
      >
        <span v-if="chat.sending" class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />
        </svg>
      </button>
    </div>
    <p v-if="chat.error" class="error meta-label" role="alert">{{ chat.error }}</p>
  </div>
</template>

<style scoped>
.composer {
  display: grid;
  gap: var(--vr-space-2);
}
.box {
  display: flex;
  align-items: center;
  gap: var(--vr-space-2);
  border-bottom: 1px solid var(--vr-line-strong); /* 下划线式,无盒子 */
  padding: var(--vr-space-2) 0;
  transition: border-color var(--vr-motion-fast) var(--vr-ease);
}
.box:focus-within {
  border-color: var(--vr-ai);
}
.box.sending {
  border-color: var(--vr-ai-soft);
}
input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  outline: none;
  color: var(--vr-text);
  font: inherit;
  font-size: var(--vr-text-body);
  padding: var(--vr-space-2) 0;
}
input::placeholder {
  color: var(--vr-text-muted);
}
.send {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--vr-ink);
  background: var(--vr-on-air);
  transition:
    opacity var(--vr-motion-fast) var(--vr-ease),
    transform var(--vr-motion-fast) var(--vr-ease),
    box-shadow var(--vr-motion-fast) var(--vr-ease);
}
.send:hover:not(:disabled) {
  transform: scale(1.04);
  box-shadow: 0 0 20px var(--vr-on-air-soft);
}
.send:active:not(:disabled) {
  transform: scale(0.96);
}
.send:disabled {
  opacity: 0.35;
  cursor: default;
}
.dots {
  display: inline-flex;
  gap: 3px;
}
.dots i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  animation: blink 1s infinite;
}
.dots i:nth-child(2) {
  animation-delay: 0.2s;
}
.dots i:nth-child(3) {
  animation-delay: 0.4s;
}
@keyframes blink {
  0%,
  100% {
    opacity: 0.25;
  }
  50% {
    opacity: 1;
  }
}
.error {
  color: var(--vr-danger);
}
</style>
