<script setup>
// 投放设备选择:本机 / UPnP(SSDP 发现)。
// 无设备/失败给出可理解反馈;不伪造"已开始播放"。
import { ref, onMounted } from 'vue';
import { http } from '../../lib/api/http.js';
import { player } from '../../stores/player.js';

const devices = ref([]);
const selected = ref(null);
const scanning = ref(false);
const casting = ref(false);
const message = ref(null); // {kind:'ok'|'err', text}

const LOCAL = { id: 'local', name: '本机浏览器' };
const output = ref(LOCAL.id); // 当前输出:本机 / 选中 UPnP 设备

async function scan() {
  scanning.value = true;
  message.value = null;
  try {
    const res = await http.get('/upnp/devices');
    devices.value = res.devices;
    selected.value = res.selected;
    if (res.selected) output.value = res.selected.location;
  } catch (err) {
    message.value = { kind: 'err', text: `扫描失败:${err.message}` };
  } finally {
    scanning.value = false;
  }
}

async function pick(id) {
  output.value = id;
  if (id === LOCAL.id) {
    if (selected.value) await http.post('/upnp/unselect').catch(() => {});
    selected.value = null;
    message.value = { kind: 'ok', text: '输出切回本机' };
    return;
  }
  try {
    const res = await http.post('/upnp/select', { location: id });
    selected.value = res.selected;
    message.value = { kind: 'ok', text: `已选择 ${res.selected.name}` };
  } catch (err) {
    output.value = selected.value?.location ?? LOCAL.id;
    message.value = { kind: 'err', text: err.message };
  }
}

async function cast() {
  casting.value = true;
  message.value = null;
  try {
    const res = await http.post('/upnp/cast');
    message.value = {
      kind: 'ok',
      text: `已投放《${res.title}》到 ${res.device}(${res.state})`,
    };
  } catch (err) {
    message.value = { kind: 'err', text: err.message };
  } finally {
    casting.value = false;
  }
}

onMounted(scan);
</script>

<template>
  <section class="picker" aria-label="投放设备">
    <h2 class="meta-label">output / 音频输出</h2>

    <div class="devices">
      <label class="dev" :class="{ on: output === LOCAL.id }">
        <input type="radio" name="output" :checked="output === LOCAL.id" @change="pick(LOCAL.id)" />
        <span class="name">{{ LOCAL.name }}</span>
        <span class="meta-label">默认</span>
      </label>

      <label
        v-for="d in devices"
        :key="d.id"
        class="dev"
        :class="{ on: output === d.location }"
      >
        <input type="radio" name="output" :checked="output === d.location" @change="pick(d.location)" />
        <span class="name">{{ d.name }}</span>
        <span class="meta-label">upnp</span>
      </label>
    </div>

    <p v-if="!devices.length && !scanning" class="hint meta-label">
      未发现局域网播放设备 —— 检查音箱/电视是否开启 UPnP,或 <button class="link" @click="scan">重新扫描</button>
    </p>

    <div class="actions">
      <button class="btn" :disabled="scanning" @click="scan">
        {{ scanning ? '扫描中…' : '扫描设备' }}
      </button>
      <button
        class="btn primary"
        :disabled="casting || output === LOCAL.id || !player.playing"
        @click="cast"
      >
        {{ casting ? '投放中…' : '投放当前曲目' }}
      </button>
    </div>

    <p v-if="message" class="msg" :class="message.kind" role="status">{{ message.text }}</p>
  </section>
</template>

<style scoped>
.picker {
  display: grid;
  gap: var(--vr-space-3);
}
.devices {
  display: grid;
  gap: var(--vr-space-1);
}
.dev {
  display: flex;
  align-items: center;
  gap: var(--vr-space-3);
  padding: var(--vr-space-2) var(--vr-space-3);
  border: 1px solid var(--vr-line);
  border-radius: var(--vr-radius-s);
  cursor: pointer;
  min-height: 44px;
  transition: border-color var(--vr-motion-fast) var(--vr-ease);
}
.dev:hover {
  border-color: var(--vr-text-muted);
}
.dev.on {
  border-color: var(--vr-on-air);
  background: var(--vr-on-air-soft);
}
.dev input {
  accent-color: var(--vr-on-air);
}
.name {
  flex: 1;
  font-size: var(--vr-text-body-sm);
}
.hint {
  color: var(--vr-text-muted);
  display: grid;
  gap: var(--vr-space-1);
}
.link {
  color: var(--vr-on-air);
  text-decoration: underline;
  padding: var(--vr-space-1);
}
.actions {
  display: flex;
  gap: var(--vr-space-2);
}
.btn {
  font-family: var(--vr-font-mono);
  font-size: var(--vr-text-caption);
  letter-spacing: 0.06em;
  padding: var(--vr-space-2) var(--vr-space-4);
  border: 1px solid var(--vr-line);
  border-radius: var(--vr-radius-s);
  color: var(--vr-text);
  min-height: 44px;
  transition: border-color var(--vr-motion-fast) var(--vr-ease);
}
.btn:hover:not(:disabled) {
  border-color: var(--vr-text-muted);
}
.btn.primary {
  background: var(--vr-on-air);
  border-color: var(--vr-on-air);
  color: var(--vr-ink);
}
.btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.msg.ok {
  color: var(--vr-on-air);
  font-size: var(--vr-text-body-sm);
}
.msg.err {
  color: var(--vr-danger);
  font-size: var(--vr-text-body-sm);
}
</style>
