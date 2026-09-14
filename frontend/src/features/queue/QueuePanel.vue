<script setup>
// 队列面板:当前曲荧光边线+序号突出;点击播放/移除/拖拽排序。
// 拖拽使用原生 HTML5 drag,每个条目带「上移/下移」按钮作键盘替代(focus 可见)。
import { ref } from 'vue';
import { player, playQueueAt, removeQueueAt, moveQueue } from '../../stores/player.js';

const dragging = ref(null); // 被拖拽条目下标

function onDrop(to) {
  const from = dragging.value;
  dragging.value = null;
  if (from === null || from === to) return;
  moveQueue(from, to).catch(() => {});
}

function onDragEnd() {
  dragging.value = null;
}
</script>

<template>
  <section class="queue" aria-label="接下来播放">
    <h2 class="meta-label">
      queue / 接下来播放<span v-if="player.queue.length"> · {{ player.queue.length }}</span>
    </h2>

    <p v-if="!player.queue.length" class="empty meta-label">队列为空 —— 点歌或让 DJ 编排</p>

    <ol v-else class="list">
      <li
        v-for="(s, i) in player.queue"
        :key="`${s.songId ?? s.unresolved}-${i}`"
        class="item"
        :class="{ current: i === player.index, dragging: dragging === i }"
        draggable="true"
        @dragstart="dragging = i"
        @dragover.prevent
        @drop="onDrop(i)"
        @dragend="onDragEnd"
      >
        <span class="idx meta-label">{{ String(i + 1).padStart(2, '0') }}</span>

        <button class="names" :class="{ now: i === player.index }" @click="playQueueAt(i)">
          <span class="t">
            {{ s.title || s.unresolved }}
            <span v-if="i === player.index" class="now-tag meta-label">playing</span>
          </span>
          <span class="a">{{ s.artist || (s.unresolved ? '未解析' : '') }}</span>
        </button>

        <div class="ops">
          <button
            class="op"
            aria-label="上移"
            :disabled="i === 0"
            @click="moveQueue(i, i - 1)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 4l6 8H6z" />
            </svg>
          </button>
          <button
            class="op"
            aria-label="下移"
            :disabled="i === player.queue.length - 1"
            @click="moveQueue(i, i + 1)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 20l-6-8h12z" />
            </svg>
          </button>
          <button class="op danger" aria-label="移除" @click="removeQueueAt(i)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" />
            </svg>
          </button>
        </div>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.queue {
  background: var(--vr-panel);
  border: 1px solid var(--vr-line);
  border-radius: var(--vr-radius-m);
  padding: var(--vr-space-4);
  display: grid;
  gap: var(--vr-space-3);
}
.empty {
  color: var(--vr-text-muted);
}
.list {
  list-style: none;
  display: grid;
  gap: var(--vr-space-1);
  max-height: 360px;
  overflow-y: auto;
}
.item {
  display: flex;
  align-items: center;
  gap: var(--vr-space-2);
  padding: var(--vr-space-1);
  border-radius: var(--vr-radius-s);
  transition: background var(--vr-motion-fast) var(--vr-ease);
}
.item:hover {
  background: var(--vr-surface-raised);
}
.item.dragging {
  opacity: 0.45;
}
.item.current {
  background: var(--vr-on-air-soft);
  border-left: 2px solid var(--vr-on-air); /* 当前曲:薄荷细线标识 */
  padding-left: calc(var(--vr-space-1) + var(--vr-space-2));
}
.idx {
  min-width: 22px;
  text-align: right;
}
.item.current .idx {
  color: var(--vr-on-air);
  font-weight: 700;
}
.names {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
  text-align: left;
  padding: var(--vr-space-1) var(--vr-space-2);
  border-radius: var(--vr-radius-s);
  min-height: 44px;
  justify-content: center;
}
.t {
  font-size: var(--vr-text-body-sm);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: var(--vr-space-2);
}
.a {
  font-size: var(--vr-text-caption);
  color: var(--vr-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.now-tag {
  color: var(--vr-on-air);
  flex-shrink: 0;
}
.ops {
  display: flex;
  gap: var(--vr-space-1);
}
.op {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: var(--vr-radius-s);
  color: var(--vr-text-muted);
  transition:
    color var(--vr-motion-fast) var(--vr-ease),
    background var(--vr-motion-fast) var(--vr-ease);
}
.op:hover:not(:disabled) {
  color: var(--vr-text);
  background: var(--vr-surface-raised);
}
.op.danger:hover:not(:disabled) {
  color: var(--vr-danger);
}
.op:disabled {
  opacity: 0.3;
  cursor: default;
}
</style>
