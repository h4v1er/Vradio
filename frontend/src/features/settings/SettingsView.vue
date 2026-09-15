<script setup>
// Settings:外部能力配置状态 + 音频输出(DevicePicker)+ 配置指引。
// 密钥本身只存在 server/.env(gitignore),此页只展示"已配置/未配置"。
// 网易云 Cookie 例外:走 /api/netease/cookie 存入本机 state.db(验证通过才落库)。
import { ref, reactive, computed, onMounted } from 'vue';
import { http } from '../../lib/api/http.js';
import { player } from '../../stores/player.js';
import { chat } from '../../stores/chat.js';
import DevicePicker from '../player/DevicePicker.vue';

const config = ref(null);
const error = ref(null);

onMounted(async () => {
  try {
    config.value = await http.get('/config');
  } catch (err) {
    error.value = err.message;
  }
  refreshNetease();
});

const ROWS = [
  { key: 'tts', label: 'Fish Audio TTS', desc: 'DJ 串词语音合成', env: 'FISH_API_KEY' },
  { key: 'weather', label: 'OpenWeather', desc: '天气注入编排', env: 'OPENWEATHER_API_KEY' },
  { key: 'feishu', label: '飞书日程', desc: '日程注入 + 日历 hook', env: 'FEISHU_APP_ID / FEISHU_APP_SECRET' },
];

// ── 网易云账户与歌单 ─────────────────────────────────────────
const cookieInput = ref('');
const cookieBusy = ref(false);
const cookieMsg = ref('');
const cookieErr = ref(false);
const cookieSource = ref('anonymous');
const cookieConfigured = computed(() => cookieSource.value !== 'anonymous');

const plInput = ref('');
const plBusy = ref(false);
const myLists = ref([]);
const imported = ref([]);
const importingId = ref(null);

async function refreshNetease() {
  try {
    cookieSource.value = (await http.get('/netease/cookie')).source;
  } catch {
    // 后端不可用时保持默认,不阻塞设置页其余部分
  }
  try {
    imported.value = (await http.get('/netease/playlists')).playlists;
  } catch {
    // 同上
  }
}

async function saveCookie() {
  cookieBusy.value = true;
  cookieErr.value = false;
  cookieMsg.value = '';
  try {
    const r = await http.post('/netease/cookie', { cookie: cookieInput.value });
    cookieSource.value = 'prefs';
    cookieInput.value = '';
    const nick = r.profile?.nickname ? ` ${r.profile.nickname}` : '';
    const vip = r.profile?.vipType ? ' · VIP 会员' : '';
    cookieMsg.value = `验证通过:${nick}${vip} —— VIP 歌曲已可完整播放`;
  } catch (err) {
    cookieErr.value = true;
    cookieMsg.value = err.message;
  } finally {
    cookieBusy.value = false;
  }
}

async function clearCookie() {
  cookieBusy.value = true;
  cookieErr.value = false;
  cookieMsg.value = '';
  try {
    const r = await http.post('/netease/cookie/clear');
    cookieSource.value = r.source;
    myLists.value = [];
    cookieMsg.value = '已清除,回退为匿名访问';
  } catch (err) {
    cookieErr.value = true;
    cookieMsg.value = err.message;
  } finally {
    cookieBusy.value = false;
  }
}

async function loadMyPlaylists() {
  plBusy.value = true;
  cookieErr.value = false;
  cookieMsg.value = '';
  try {
    myLists.value = (await http.get('/netease/my-playlists')).playlists;
  } catch (err) {
    cookieErr.value = true;
    cookieMsg.value = err.message;
  } finally {
    plBusy.value = false;
  }
}

// 链接或 ID 均可:playlist?id=xxx / playlist/xxx / 纯数字
function extractPlaylistId(input) {
  const s = String(input || '').trim();
  const m = s.match(/playlist\?id=(\d+)|playlist\/(\d+)/);
  if (m) return m[1] || m[2];
  return /^\d+$/.test(s) ? s : null;
}

async function importPlaylist(id) {
  plBusy.value = true;
  cookieErr.value = false;
  cookieMsg.value = '';
  importingId.value = id;
  try {
    const r = await http.post('/netease/playlist/import', { id });
    plInput.value = '';
    cookieMsg.value = `已导入「${r.playlist.name}」(${r.playlist.trackCount} 首),DJ 接下来会参考它`;
    await refreshNetease();
  } catch (err) {
    cookieErr.value = true;
    cookieMsg.value = err.message;
  } finally {
    plBusy.value = false;
    importingId.value = null;
  }
}

function importByInput() {
  const id = extractPlaylistId(plInput.value);
  if (!id) {
    cookieErr.value = true;
    cookieMsg.value = '请输入歌单 ID,或包含 playlist?id=… 的链接';
    return;
  }
  importPlaylist(id);
}

async function removePlaylist(id) {
  try {
    await http.post('/netease/playlist/remove', { id });
    await refreshNetease();
  } catch (err) {
    cookieErr.value = true;
    cookieMsg.value = err.message;
  }
}

// ── 外部服务密钥(Fish/OpenWeather/飞书,保存前验证,env 优先) ──
const secrets = reactive({
  fishApiKey: '',
  openweatherApiKey: '',
  openweatherCity: '',
  feishuAppId: '',
  feishuAppSecret: '',
});
const secBusy = reactive({ tts: false, weather: false, feishu: false });
const secMsg = reactive({ tts: '', weather: '', feishu: '' });
const secErr = reactive({ tts: false, weather: false, feishu: false });

const SEC_FIELDS = {
  tts: ['fishApiKey'],
  weather: ['openweatherApiKey', 'openweatherCity'],
  feishu: ['feishuAppId', 'feishuAppSecret'],
};

function secPayload(service) {
  const body = {};
  for (const f of SEC_FIELDS[service]) body[f] = secrets[f];
  return body;
}

async function saveSecrets(service) {
  secBusy[service] = true;
  secErr[service] = false;
  secMsg[service] = '';
  try {
    const r = await http.post('/config/secrets', secPayload(service));
    config.value = r.config;
    for (const f of SEC_FIELDS[service]) secrets[f] = '';
    secMsg[service] = r.warnings?.length ? `已保存。${r.warnings[0]}` : '已保存,已验证有效';
  } catch (err) {
    secErr[service] = true;
    secMsg[service] = err.message;
  } finally {
    secBusy[service] = false;
  }
}

async function clearSecrets(service) {
  secBusy[service] = true;
  secErr[service] = false;
  secMsg[service] = '';
  try {
    const r = await http.post('/config/secrets/clear', { service });
    config.value = r.config;
    secMsg[service] = '已清除';
  } catch (err) {
    secErr[service] = true;
    secMsg[service] = err.message;
  } finally {
    secBusy[service] = false;
  }
}

function sourceLabel(key) {
  const s = config.value?.sources?.[key];
  if (s === 'env') return '已配置(server/.env)';
  if (s === 'prefs') return '已配置(本页保存)';
  return '未配置';
}
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
      <h2 class="meta-label">runtime / 运行状态</h2>
      <p class="hint meta-label">开发状态面板(主视图已移除,仅设置页可见)</p>
      <dl class="rows">
        <div class="row">
          <div class="info">
            <dt>DJ 大脑</dt>
            <dd class="meta-label">Claude 子进程编排</dd>
          </div>
          <div class="state">
            <span
              class="dot"
              :class="player.dj.state === 'thinking' ? 'on' : 'off'"
              aria-hidden="true"
            ></span>
            <span class="meta-label">{{ player.dj.state }}</span>
          </div>
        </div>
        <div class="row">
          <div class="info">
            <dt>TTS 串词</dt>
            <dd class="meta-label">Fish Audio 语音合成</dd>
          </div>
          <div class="state">
            <span
              class="dot"
              :class="chat.tts?.state === 'ready' ? 'on' : 'off'"
              aria-hidden="true"
            ></span>
            <span class="meta-label">{{ chat.tts ? chat.tts.state : 'off' }}</span>
          </div>
        </div>
        <div class="row">
          <div class="info">
            <dt>WebSocket</dt>
            <dd class="meta-label">/stream 实时事件流</dd>
          </div>
          <div class="state">
            <span
              class="dot"
              :class="chat.ws === 'connected' ? 'on' : 'off'"
              aria-hidden="true"
            ></span>
            <span class="meta-label">{{ chat.ws }}</span>
          </div>
        </div>
      </dl>
    </div>

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
            <span class="meta-label">{{ config ? sourceLabel(r.key) : '…' }}</span>
          </div>
          <code class="env">{{ r.env }}</code>
        </div>
      </dl>

      <div class="sec-block">
        <h3 class="sec-title">Fish Audio TTS</h3>
        <form class="sec-form single" @submit.prevent="saveSecrets('tts')">
          <input
            v-model="secrets.fishApiKey"
            type="password"
            placeholder="粘贴 API Key"
            aria-label="Fish Audio API Key"
            :disabled="secBusy.tts"
          />
          <div class="actions">
            <button type="submit" class="act" :disabled="secBusy.tts || !secrets.fishApiKey.trim()">
              {{ secBusy.tts ? '验证中…' : '保存' }}
            </button>
            <button
              type="button"
              class="act ghost"
              :disabled="!config?.tts || secBusy.tts"
              @click="clearSecrets('tts')"
            >
              清除
            </button>
          </div>
        </form>
        <p v-if="secMsg.tts" class="cookie-msg meta-label" :class="{ err: secErr.tts }" role="status">
          {{ secMsg.tts }}
        </p>
      </div>

      <div class="sec-block">
        <h3 class="sec-title">OpenWeather</h3>
        <form class="sec-form" @submit.prevent="saveSecrets('weather')">
          <input
            v-model="secrets.openweatherApiKey"
            type="password"
            placeholder="粘贴 API Key"
            aria-label="OpenWeather API Key"
            :disabled="secBusy.weather"
          />
          <input
            v-model="secrets.openweatherCity"
            type="text"
            placeholder="城市(默认 Shanghai)"
            aria-label="天气城市"
            :disabled="secBusy.weather"
          />
          <div class="actions">
            <button
              type="submit"
              class="act"
              :disabled="secBusy.weather || (!secrets.openweatherApiKey.trim() && !secrets.openweatherCity.trim())"
            >
              {{ secBusy.weather ? '验证中…' : '保存' }}
            </button>
            <button
              type="button"
              class="act ghost"
              :disabled="!config?.weather || secBusy.weather"
              @click="clearSecrets('weather')"
            >
              清除
            </button>
          </div>
        </form>
        <p v-if="secMsg.weather" class="cookie-msg meta-label" :class="{ err: secErr.weather }" role="status">
          {{ secMsg.weather }}
        </p>
      </div>

      <div class="sec-block">
        <h3 class="sec-title">飞书日程</h3>
        <form class="sec-form" @submit.prevent="saveSecrets('feishu')">
          <input
            v-model="secrets.feishuAppId"
            type="password"
            placeholder="App ID(cli_…)"
            aria-label="飞书 App ID"
            :disabled="secBusy.feishu"
          />
          <input
            v-model="secrets.feishuAppSecret"
            type="password"
            placeholder="App Secret"
            aria-label="飞书 App Secret"
            :disabled="secBusy.feishu"
          />
          <div class="actions">
            <button
              type="submit"
              class="act"
              :disabled="secBusy.feishu || !secrets.feishuAppId.trim() || !secrets.feishuAppSecret.trim()"
            >
              {{ secBusy.feishu ? '验证中…' : '保存' }}
            </button>
            <button
              type="button"
              class="act ghost"
              :disabled="!config?.feishu || secBusy.feishu"
              @click="clearSecrets('feishu')"
            >
              清除
            </button>
          </div>
        </form>
        <p v-if="secMsg.feishu" class="cookie-msg meta-label" :class="{ err: secErr.feishu }" role="status">
          {{ secMsg.feishu }}
        </p>
      </div>

      <p class="hint meta-label">
        密钥仅保存在本机 state.db,验证通过才写入;也可在 server/.env 配置(环境变量优先)。
      </p>
    </div>

    <div class="panel">
      <DevicePicker />
    </div>

    <div class="panel">
      <h2 class="meta-label">netease / 网易云账户与歌单</h2>

      <dl class="rows">
        <div class="row">
          <div class="info">
            <dt>登录 Cookie</dt>
            <dd class="meta-label">VIP 歌曲完整播放需要</dd>
          </div>
          <div class="state">
            <span class="dot" :class="cookieConfigured ? 'on' : 'off'" aria-hidden="true"></span>
            <span class="meta-label">
              {{ cookieSource === 'env' ? '已配置(server/.env)' : cookieSource === 'prefs' ? '已配置(本页保存)' : '匿名访问' }}
            </span>
          </div>
        </div>
      </dl>

      <form class="inline-form" @submit.prevent="saveCookie">
        <input
          v-model="cookieInput"
          type="password"
          placeholder="粘贴 MUSIC_U=… 或完整 Cookie(只复制值也行,自动补前缀)"
          aria-label="网易云 Cookie"
          :disabled="cookieBusy"
        />
        <button type="submit" class="act" :disabled="cookieBusy || !cookieInput.trim()">
          {{ cookieBusy ? '验证中…' : '保存并验证' }}
        </button>
        <button
          type="button"
          class="act ghost"
          :disabled="!cookieConfigured || cookieBusy"
          @click="clearCookie"
        >
          清除
        </button>
      </form>
      <p class="hint meta-label">
        保持 music.163.com 登录态 → 开发者工具 → Application → Cookies → music.163.com
        → 双击 MUSIC_U 行的「值」列全选复制(不带前缀也可以,保存时会自动补上)。
        Cookie 仅保存在本机 state.db,验证通过才写入,不上传、不出网。
      </p>

      <form class="inline-form" @submit.prevent="importByInput">
        <input
          v-model="plInput"
          type="text"
          placeholder="歌单链接或 ID(公开歌单无需登录)"
          aria-label="歌单链接或 ID"
          :disabled="plBusy"
        />
        <button type="submit" class="act" :disabled="plBusy || !plInput.trim()">导入歌单</button>
      </form>
      <div class="row-actions">
        <button
          type="button"
          class="act ghost"
          :disabled="!cookieConfigured || plBusy"
          @click="loadMyPlaylists"
        >
          {{ plBusy ? '获取中…' : '获取我的歌单' }}
        </button>
        <span v-if="!cookieConfigured" class="hint meta-label">配置 Cookie 后可一键拉取你自己的歌单</span>
      </div>

      <ul v-if="myLists.length" class="lists" aria-label="我的歌单">
        <li v-for="l in myLists" :key="l.id" class="list-item">
          <div class="info">
            <dt>{{ l.name }}</dt>
            <dd class="meta-label">{{ l.trackCount }} 首</dd>
          </div>
          <button class="act ghost" :disabled="plBusy" @click="importPlaylist(l.id)">
            {{ importingId === l.id ? '导入中…' : '导入' }}
          </button>
        </li>
      </ul>

      <ul v-if="imported.length" class="lists" aria-label="已导入歌单">
        <li v-for="l in imported" :key="l.id" class="list-item">
          <div class="info">
            <dt>{{ l.name }}</dt>
            <dd class="meta-label">{{ l.trackCount }} 首 · 已交给 DJ 学习</dd>
          </div>
          <button class="act ghost danger" :disabled="plBusy" @click="removePlaylist(l.id)">移除</button>
        </li>
      </ul>
      <p v-else class="empty meta-label">未导入歌单 —— 导入后 DJ 会学习你的真实品味,选歌优先从中取材</p>

      <p v-if="cookieMsg" class="cookie-msg meta-label" :class="{ err: cookieErr }" role="status">
        {{ cookieMsg }}
      </p>
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

/* ── 网易云账户与歌单 ── */
.inline-form {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: var(--vr-space-2);
  align-items: center;
}
.inline-form:has(input[type='text']) {
  grid-template-columns: 1fr auto;
}
.inline-form input,
.sec-form input {
  background: var(--vr-bg);
  border: 1px solid var(--vr-line);
  border-radius: var(--vr-radius-s);
  padding: var(--vr-space-2) var(--vr-space-3);
  color: var(--vr-text);
  font-family: var(--vr-font-mono);
  font-size: var(--vr-text-caption);
  min-height: 44px;
  min-width: 0;
  width: 100%;
}
.inline-form input:focus-visible,
.sec-form input:focus-visible {
  outline: 2px solid var(--vr-on-air);
  outline-offset: 1px;
}
.inline-form input:disabled,
.sec-form input:disabled {
  opacity: 0.5;
}
.act {
  font-family: var(--vr-font-mono);
  font-size: var(--vr-text-caption);
  padding: var(--vr-space-2) var(--vr-space-4);
  border: 1px solid var(--vr-line-strong);
  border-radius: var(--vr-radius-s);
  min-height: 44px;
  white-space: nowrap;
}
.act:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.act.ghost {
  border-color: var(--vr-line);
  color: var(--vr-text-muted);
}
.act.danger {
  border-color: transparent;
  color: var(--vr-danger);
}
.row-actions {
  display: flex;
  align-items: center;
  gap: var(--vr-space-3);
  flex-wrap: wrap;
}
.lists {
  display: grid;
  gap: var(--vr-space-2);
  list-style: none;
  padding: 0;
  margin: 0;
}
.list-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--vr-space-3);
  padding: var(--vr-space-2) var(--vr-space-3);
  background: var(--vr-bg);
  border: 1px solid var(--vr-line);
  border-radius: var(--vr-radius-s);
}
.list-item .info {
  min-width: 0;
}
.list-item dt {
  font-size: var(--vr-text-body-sm);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.list-item dd {
  color: var(--vr-text-muted);
}
.cookie-msg {
  color: var(--vr-on-air);
}
.cookie-msg.err {
  color: var(--vr-danger);
}
.empty {
  color: var(--vr-text-muted);
}

/* ── 外部服务密钥输入 ── */
.sec-block {
  display: grid;
  gap: var(--vr-space-2);
  padding-top: var(--vr-space-3);
  border-top: 1px solid var(--vr-line);
}
.sec-title {
  font-family: var(--vr-font-mono);
  font-size: var(--vr-text-caption);
  font-weight: 500;
  color: var(--vr-text-muted);
  letter-spacing: 0.08em;
}
.sec-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--vr-space-2);
}
.sec-form.single {
  grid-template-columns: 1fr auto;
}
.sec-form .actions {
  grid-column: 1 / -1;
  display: flex;
  gap: var(--vr-space-2);
  flex-wrap: wrap;
}
</style>
