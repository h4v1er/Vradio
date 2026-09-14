<script setup>
// App 壳:极简顶栏 + 居中单列舞台 + 右侧队列抽屉(默认收起)+ 移动底部导航。
// 视觉重心永远是「当前歌曲 + 电台氛围」;系统状态面板已移入 Settings。
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { player } from './stores/player.js';
import { chat } from './stores/chat.js';
import { ui, setView } from './stores/ui.js';
import { http } from './lib/api/http.js';
import AmbientField from './components/ui/AmbientField.vue';
import OnAirIndicator from './components/ui/OnAirIndicator.vue';
import PlayerHero from './features/player/PlayerHero.vue';
import DjMessage from './features/dj/DjMessage.vue';
import MoodChips from './features/dj/MoodChips.vue';
import RequestComposer from './features/dj/RequestComposer.vue';
import QueuePanel from './features/queue/QueuePanel.vue';
import RadioContext from './features/radio-context/RadioContext.vue';
import ProfileView from './features/profile/ProfileView.vue';
import SettingsView from './features/settings/SettingsView.vue';

// 顶栏日期(弱化展示,不放大时钟)
const now = ref(new Date());
let timer = null;
onMounted(() => {
  timer = setInterval(() => (now.value = new Date()), 60_000);
});
onBeforeUnmount(() => clearInterval(timer));

const dateStr = computed(() =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(now.value),
);

const weather = computed(() => {
  const w = chat.env?.weather;
  if (!w?.configured || w.error) return null;
  return `${w.city || ''} ${Math.round(w.temp)}° ${w.desc || ''}`;
});

// 队列抽屉:桌面右侧窄栏 / 移动全屏,默认收起,ESC 关闭
const queueOpen = ref(false);
function toggleQueue() {
  queueOpen.value = !queueOpen.value;
}
function closeQueue() {
  queueOpen.value = false;
}
function onKey(e) {
  if (e.key === 'Escape') closeQueue();
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

// DJ 串词面板:首屏只显示最新一句(最多 5 行),展开看全部对话
const dialogueOpen = ref(false);
const latestSay = computed(
  () => [...chat.messages].reverse().find((m) => m.role === 'assistant') || null,
);

// 最近播放:收进队列抽屉底部,不占主视觉
const recentPlays = ref([]);
onMounted(() => {
  http
    .get('/plays/today')
    .then((r) => (recentPlays.value = r.plays || []))
    .catch(() => {});
});

// 移动底部导航:Player / Queue(抽屉)/ Profile
const NAV = [
  { key: 'player', label: 'Player', action: () => setView('player') },
  { key: 'queue', label: 'Queue', action: toggleQueue },
  { key: 'profile', label: 'Profile', action: () => setView('profile') },
];
</script>

<template>
  <AmbientField />
  <div class="shell">
    <!-- 顶栏:Vradio + ON AIR + 天气/日期;其他导航弱化 -->
    <header class="topbar">
      <div class="brand">
        <button class="wordmark" aria-label="回到播放器" @click="setView('player')">VRADIO</button>
        <OnAirIndicator :status="chat.ws" />
      </div>
      <div class="top-right">
        <span class="env meta-label">
          <template v-if="weather">{{ weather }}</template>
          <template v-else>深夜电台</template>
          <span class="sep" aria-hidden="true">/</span>
          <span>{{ dateStr }}</span>
        </span>
        <nav class="topnav meta-label" aria-label="主导航">
          <button class="desktop-only" :class="{ on: queueOpen }" @click="toggleQueue">
            queue<span v-if="player.queue.length" class="count">{{ player.queue.length }}</span>
          </button>
          <button class="desktop-only" :class="{ on: ui.view === 'profile' }" @click="setView('profile')">
            profile
          </button>
          <button :class="{ on: ui.view === 'settings' }" @click="setView('settings')">settings</button>
        </nav>
      </div>
    </header>

    <!-- 非播放器视图 -->
    <main v-if="ui.view !== 'player'" class="plain">
      <ProfileView v-if="ui.view === 'profile'" @back="setView('player')" />
      <SettingsView v-else @back="setView('player')" />
    </main>

    <!-- 播放器主视图:居中单列 -->
    <main v-else class="stage">
      <section class="hero" v-reveal>
        <PlayerHero />
      </section>

      <section class="dj-panel" v-reveal aria-label="DJ 串词">
        <header class="dj-head">
          <h2 class="meta-label">dj 串词</h2>
          <span class="meta-label" :class="{ thinking: player.dj.state === 'thinking' }">
            {{ player.dj.state === 'thinking' ? 'thinking…' : 'live' }}
          </span>
        </header>

        <div v-if="latestSay || chat.plan?.say" class="latest">
          <DjMessage v-if="latestSay" :message="latestSay" compact />
          <DjMessage v-else :message="{ role: 'assistant', say: chat.plan.say }" compact />
        </div>
        <p v-else class="empty meta-label">DJ 还没说话 —— 问一句「现在适合听什么」,或者直接点歌</p>

        <button
          class="toggle-dialogue meta-label"
          :aria-expanded="dialogueOpen"
          @click="dialogueOpen = !dialogueOpen"
        >
          {{ dialogueOpen ? '收起对话 −' : `全部对话 +${chat.messages.length}` }}
        </button>

        <div v-if="dialogueOpen" class="dialogue" aria-live="polite">
          <div class="messages">
            <DjMessage v-for="(m, i) in chat.messages" :key="i" :message="m" />
          </div>
        </div>
      </section>

      <section class="interact" v-reveal aria-label="与 DJ 对话">
        <MoodChips />
        <RequestComposer />
      </section>
    </main>

    <!-- 队列抽屉:默认收起,不抢主视觉 -->
    <div class="drawer-backdrop" :class="{ open: queueOpen }" aria-hidden="true" @click="closeQueue"></div>
    <aside
      class="drawer"
      :class="{ open: queueOpen }"
      :inert="!queueOpen"
      role="dialog"
      aria-label="播放队列"
    >
      <header class="drawer-head">
        <span class="meta-label">queue / 接下来播放</span>
        <button class="close" aria-label="关闭队列" @click="closeQueue">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>
      <div class="drawer-body">
        <QueuePanel />
        <RadioContext />
        <section class="recent" aria-label="最近播放">
          <h2 class="meta-label">recent / 最近播放</h2>
          <p v-if="!recentPlays.length" class="empty meta-label">暂无记录</p>
          <ul v-else class="recent-list">
            <li v-for="p in recentPlays" :key="p.id">
              <span class="q-title">{{ p.title }}</span>
              <span class="q-artist">{{ p.artist }}</span>
            </li>
          </ul>
        </section>
      </div>
    </aside>

    <!-- 移动底部导航(固定) -->
    <nav class="bottomnav" aria-label="底部导航">
      <button
        v-for="n in NAV"
        :key="n.key"
        :class="{ on: n.key === 'queue' ? queueOpen : ui.view === n.key }"
        @click="n.action"
      >
        <span class="meta-label">{{ n.label }}</span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
.shell {
  position: relative;
  z-index: 1;
  max-width: 1120px;
  margin: 0 auto;
  padding: 0 var(--vr-space-5);
}

/* ── 顶栏:极简,细下划线 ── */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vr-space-4);
  padding: var(--vr-space-4) 0;
  border-bottom: 1px solid var(--vr-line);
}
.brand {
  display: flex;
  align-items: center;
  gap: var(--vr-space-4);
}
.wordmark {
  font-family: var(--vr-font-mono);
  font-size: var(--vr-text-body);
  font-weight: 700;
  letter-spacing: 0.32em;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
}
.top-right {
  display: flex;
  align-items: center;
  gap: var(--vr-space-5);
}
.env {
  display: inline-flex;
  gap: var(--vr-space-2);
  align-items: center;
  opacity: 0.75;
}
.sep {
  opacity: 0.4;
}
.topnav {
  display: flex;
  gap: var(--vr-space-4);
}
.topnav button {
  display: inline-flex;
  align-items: center;
  gap: var(--vr-space-2);
  padding: var(--vr-space-1) var(--vr-space-2);
  min-height: 44px;
  color: var(--vr-text-muted);
  opacity: 0.75;
  transition:
    color var(--vr-motion-fast) var(--vr-ease),
    opacity var(--vr-motion-fast) var(--vr-ease);
}
.topnav button:hover {
  color: var(--vr-text);
  opacity: 1;
}
.topnav button.on {
  color: var(--vr-on-air);
  opacity: 1;
}
.count {
  font-family: var(--vr-font-display);
  font-size: var(--vr-text-caption);
  color: var(--vr-on-air);
}

/* ── 居中单列舞台 ── */
.stage {
  max-width: 680px;
  margin: 0 auto;
  padding-bottom: var(--vr-space-6);
  display: grid;
  gap: var(--vr-space-6);
  align-content: start;
}

/* ── DJ 串词面板:半透明深蓝;在视口内时微光增强(.near 由 v-reveal 维护) ── */
.dj-panel {
  background: var(--vr-panel);
  border: 1px solid var(--vr-line);
  border-radius: var(--vr-radius-m);
  padding: var(--vr-space-4) var(--vr-space-5);
  display: grid;
  gap: var(--vr-space-3);
  transition: border-color var(--vr-motion) var(--vr-ease);
}
.dj-panel.near {
  border-color: var(--vr-line-strong);
}
.dj-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.dj-head .thinking {
  color: var(--vr-ai);
}
.latest {
  display: grid;
}
.empty {
  color: var(--vr-text-muted);
}
.toggle-dialogue {
  justify-self: start;
  min-height: 44px;
  color: var(--vr-text-muted);
  transition: color var(--vr-motion-fast) var(--vr-ease);
}
.toggle-dialogue:hover {
  color: var(--vr-on-air);
}
.dialogue {
  display: grid;
  gap: var(--vr-space-3);
  border-top: 1px solid var(--vr-line);
  padding-top: var(--vr-space-4);
}
.messages {
  display: grid;
  gap: var(--vr-space-3);
  max-height: 380px;
  overflow-y: auto;
  padding-right: var(--vr-space-2);
}

/* ── 对话输入区 ── */
.interact {
  display: grid;
  gap: var(--vr-space-4);
}

/* ── 队列抽屉 ── */
.drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(380px, 92vw);
  z-index: 20;
  background: rgba(6, 9, 24, 0.96);
  border-left: 1px solid var(--vr-line);
  display: grid;
  grid-template-rows: auto 1fr;
  transform: translateX(105%);
  visibility: hidden;
  transition:
    transform var(--vr-motion-slow) var(--vr-ease),
    visibility 0s var(--vr-motion-slow);
}
.drawer.open {
  transform: translateX(0);
  visibility: visible;
  transition: transform var(--vr-motion-slow) var(--vr-ease);
}
.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--vr-space-4) var(--vr-space-5);
  border-bottom: 1px solid var(--vr-line);
  min-height: 64px;
}
.close {
  width: 44px;
  height: 44px;
  border-radius: var(--vr-radius-s);
  display: grid;
  place-items: center;
  color: var(--vr-text-muted);
  transition:
    color var(--vr-motion-fast) var(--vr-ease),
    background var(--vr-motion-fast) var(--vr-ease);
}
.close:hover {
  color: var(--vr-text);
  background: var(--vr-surface-raised);
}
.drawer-body {
  overflow-y: auto;
  padding: var(--vr-space-4) var(--vr-space-5) var(--vr-space-6);
  display: grid;
  gap: var(--vr-space-5);
  align-content: start;
}
/* 抽屉内去掉面板自身底色,避免嵌套盒子 */
.drawer-body :deep(.queue),
.drawer-body :deep(.ctx) {
  background: transparent;
  border: none;
  padding: 0;
}
.drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 19;
  background: rgba(5, 8, 23, 0.55);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--vr-motion-slow) var(--vr-ease);
}
.drawer-backdrop.open {
  opacity: 1;
  pointer-events: auto;
}

/* ── 最近播放(抽屉内) ── */
.recent {
  display: grid;
  gap: var(--vr-space-2);
}
.recent-list {
  list-style: none;
  display: grid;
}
.recent-list li {
  display: flex;
  gap: var(--vr-space-2);
  padding: var(--vr-space-2) 0;
  border-bottom: 1px solid var(--vr-line);
  font-size: var(--vr-text-body-sm);
}
.recent-list li:last-child {
  border-bottom: none;
}
.q-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.q-artist {
  color: var(--vr-text-muted);
  font-size: var(--vr-text-caption);
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 非播放器视图 ── */
.plain {
  max-width: 880px;
  margin: 0 auto;
  padding: var(--vr-space-5) 0 var(--vr-space-6);
}

/* ── 移动端:单栏沉浸播放器 + 固定底导航 ── */
.bottomnav {
  display: none;
}
@media (max-width: 767px) {
  .shell {
    padding: 0 var(--vr-space-4);
  }
  .env,
  .topnav .desktop-only {
    display: none; /* 移动顶部只有品牌 + ON AIR(+ settings 弱入口) */
  }
  .top-right {
    gap: 0;
  }
  .stage {
    gap: var(--vr-space-5);
    padding-bottom: 96px; /* 给固定底导航留位 */
  }
  .dj-panel {
    padding: var(--vr-space-4);
  }
  .drawer {
    width: 100%;
  }
  .bottomnav {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 15;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    background: rgba(6, 9, 24, 0.92);
    border-top: 1px solid var(--vr-line);
    backdrop-filter: blur(12px);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .bottomnav button {
    min-height: 56px;
    display: grid;
    place-items: center;
    color: var(--vr-text-muted);
  }
  .bottomnav button.on {
    color: var(--vr-on-air);
  }
}
</style>
