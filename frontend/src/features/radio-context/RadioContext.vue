<script setup>
// 上下文面板:天气/日程/心情/模式,默认收起。
// 点击展开时向用户明示「上下文已连接」——环境数据参与 DJ 编排。
import { ref, computed } from 'vue';
import { chat } from '../../stores/chat.js';

const open = ref(false);
const connectedAt = ref(null);

function toggle() {
  open.value = !open.value;
  if (open.value) connectedAt.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

const weather = computed(() => chat.env?.weather);
const calendar = computed(() => chat.env?.calendar);
const nextEvent = computed(() => {
  const nowMs = Date.now();
  const e = (calendar.value?.events ?? []).find((x) => x.start > nowMs);
  return e
    ? `${new Date(e.start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' })} ${e.summary}`
    : '今日无日程';
});

function fmtEvent(ts) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' });
}
</script>

<template>
  <section class="ctx">
    <button class="head" :aria-expanded="open" @click="toggle">
      <span class="meta-label">radio context / 电台上下文</span>
      <span class="chev meta-label" aria-hidden="true">{{ open ? '−' : '+' }}</span>
    </button>

    <p v-if="open && connectedAt" class="connected meta-label" role="status">
      上下文已连接 · {{ connectedAt }}
    </p>

    <div v-if="open" class="body">
      <dl>
        <div>
          <dt class="meta-label">weather / 天气</dt>
          <dd>
            <template v-if="weather?.configured && !weather.error">
              {{ weather.city }} {{ weather.desc }},{{ Math.round(weather.temp) }}°C
              <span class="sub">体感 {{ Math.round(weather.feels) }}°</span>
            </template>
            <template v-else>未配置 / 暂不可用</template>
          </dd>
        </div>
        <div>
          <dt class="meta-label">calendar / 日程</dt>
          <dd>{{ calendar?.configured ? nextEvent : '未配置 / 暂不可用' }}</dd>
        </div>
        <div>
          <dt class="meta-label">schedule / 今日计划</dt>
          <dd class="plan">{{ chat.plan?.say || '尚未生成 —— 每天 07:00 / 09:00 自动编排' }}</dd>
        </div>
        <div>
          <dt class="meta-label">mode / 模式</dt>
          <dd>自动编排 · 品味语料 + 环境注入</dd>
        </div>
      </dl>

      <div v-if="calendar?.events?.length" class="events meta-label">
        <p>今日日程</p>
        <p v-for="(e, i) in calendar.events" :key="i">{{ fmtEvent(e.start) }} {{ e.summary }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ctx {
  background: var(--vr-panel);
  border: 1px solid var(--vr-line);
  border-radius: var(--vr-radius-m);
  padding: var(--vr-space-4);
  display: grid;
  gap: var(--vr-space-3);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 44px;
}
.chev {
  color: var(--vr-on-air);
  font-size: var(--vr-text-body);
}
.connected {
  color: var(--vr-on-air);
}
.body {
  display: grid;
  gap: var(--vr-space-3);
}
dl {
  display: grid;
  gap: var(--vr-space-3);
}
dl > div {
  display: grid;
  gap: var(--vr-space-1);
}
dd {
  font-size: var(--vr-text-body-sm);
}
.plan {
  color: var(--vr-ai);
  line-height: 1.6;
}
.sub {
  color: var(--vr-text-muted);
  font-size: var(--vr-text-caption);
}
.events {
  border-top: 1px solid var(--vr-line);
  padding-top: var(--vr-space-3);
  color: var(--vr-text-muted);
  display: grid;
  gap: var(--vr-space-1);
}
</style>
