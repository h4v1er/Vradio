<script setup>
// Settings:外部能力配置状态 + 音频输出(DevicePicker)+ 配置指引。
// 密钥本身只存在 server/.env(gitignore),此页只展示"已配置/未配置"。
import { ref, onMounted } from 'vue';
import { http } from '../../lib/api/http.js';
import DevicePicker from '../player/DevicePicker.vue';

const config = ref(null);
const error = ref(null);

onMounted(async () => {
  try {
    config.value = await http.get('/config');
  } catch (err) {
    error.value = err.message;
  }
});

const ROWS = [
  { key: 'tts', label: 'Fish Audio TTS', desc: 'DJ 串词语音合成', env: 'FISH_API_KEY' },
  { key: 'weather', label: 'OpenWeather', desc: '天气注入编排', env: 'OPENWEATHER_API_KEY' },
  { key: 'feishu', label: '飞书日程', desc: '日程注入 + 日历 hook', env: 'FEISHU_APP_ID / FEISHU_APP_SECRET' },
];
</script>

<template>
  <section class="settings" aria-label="设置">
    <header class="head">
      <div>
        <h1 class="title">Settings / 设置</h1>
        <p class="sub meta-label">外部能力按需配置,缺失时自动降级,不影响电台收听</p>
      </div>
      <button class="back" @click="$emit('back')">← 返回电台</button>
    </header>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <div class="panel">
      <h2 class="meta-label">capabilities / 外部能力</h2>
      <dl class="rows">
        <div v-for="r in ROWS" :key="r.key" class="row">
          <div class="info">
            <dt>{{ r.label }}</dt>
            <dd class="meta-label">{{ r.desc }}</dd>
          </div>
          <div class="state">
            <span
              class="dot"
              :class="config ? (config[r.key] ? 'on' : 'off') : 'unknown'"
              aria-hidden="true"
            ></span>
            <span class="meta-label">
              {{ config ? (config[r.key] ? '已配置' : '未配置') : '…' }}
            </span>
          </div>
          <code class="env">{{ r.env }}</code>
        </div>
      </dl>
      <p class="hint meta-label">
        配置方法:复制 server/.env.example 为 server/.env,填入对应 key 后重启后端。
      </p>
    </div>

    <div class="panel">
      <DevicePicker />
    </div>

    <div class="panel">
      <h2 class="meta-label">service / 服务信息</h2>
      <dl class="rows">
        <div class="row">
          <div class="info">
            <dt>网易云 API</dt>
            <dd class="meta-label">binaryify/netease_cloud_music_api</dd>
          </div>
          <code class="env">{{ config?.netease || '…' }}</code>
        </div>
        <div class="row">
          <div class="info">
            <dt>后端端口</dt>
            <dd class="meta-label">Node 本地服务</dd>
          </div>
          <code class="env">{{ config?.port || '…' }}</code>
        </div>
      </dl>
    </div>
  </section>
</template>

<style scoped>
.settings {
  display: grid;
  gap: var(--vr-space-5);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: var(--vr-space-4);
}
.title {
  font-size: var(--vr-text-heading);
  letter-spacing: -0.01em;
}
.sub {
  color: var(--vr-text-muted);
  margin-top: var(--vr-space-1);
}
.back {
  font-family: var(--vr-font-mono);
  font-size: var(--vr-text-caption);
  padding: var(--vr-space-2) var(--vr-space-4);
  border: 1px solid var(--vr-line);
  border-radius: var(--vr-radius-s);
  min-height: 44px;
}
.panel {
  background: var(--vr-panel);
  border: 1px solid var(--vr-line);
  border-radius: var(--vr-radius-m);
  padding: var(--vr-space-4);
  display: grid;
  gap: var(--vr-space-4);
}
.rows {
  display: grid;
}
.row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--vr-space-2) var(--vr-space-4);
  align-items: center;
  padding: var(--vr-space-3) 0;
  border-bottom: 1px solid var(--vr-line);
}
.row:last-child {
  border-bottom: none;
}
.info dt {
  font-size: var(--vr-text-body-sm);
  font-weight: 500;
}
.info dd {
  color: var(--vr-text-muted);
}
.state {
  display: flex;
  align-items: center;
  gap: var(--vr-space-2);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.dot.on {
  background: var(--vr-on-air);
}
.dot.off {
  background: var(--vr-text-muted);
}
.dot.unknown {
  background: transparent;
  border: 1px solid var(--vr-line);
}
.env {
  grid-column: 1 / -1;
  font-family: var(--vr-font-mono);
  font-size: var(--vr-text-caption);
  color: var(--vr-text-muted);
  background: var(--vr-bg);
  border: 1px solid var(--vr-line);
  border-radius: var(--vr-radius-s);
  padding: var(--vr-space-1) var(--vr-space-2);
}
.hint {
  color: var(--vr-text-muted);
  line-height: 1.7;
}
.error {
  color: var(--vr-danger);
}
</style>
