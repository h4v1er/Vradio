<script setup>
// App 壳:顶栏 + 三视图(Player/Profile/Settings)+ 移动底部导航。
// 桌面 12 栏:主舞台 8 + 侧栏 4(上下文/队列/最近播放);移动单栏。
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { player } from './stores/player.js';
import { chat } from './stores/chat.js';
import { ui, setView } from './stores/ui.js';
import { http } from './lib/api/http.js';
import AmbientField from './components/ui/AmbientField.vue';
import OnAirIndicator from './components/ui/OnAirIndicator.vue';
import NowPlayingCard from './features/player/NowPlayingCard.vue';
import DjMessage from './features/dj/DjMessage.vue';
import MoodChips from './features/dj/MoodChips.vue';
import RequestComposer from './features/dj/RequestComposer.vue';
import QueuePanel from './features/queue/QueuePanel.vue';
import RadioContext from './features/radio-context/RadioContext.vue';
import ProfileView from './features/profile/ProfileView.vue';
import SettingsView from './features/settings/SettingsView.vue';

// 顶栏时钟(Doto 大数字)
const now = ref(new Date());
let timer = null;
onMounted(() => {
  timer = setInterval(() => (now.value = new Date()), 1000);
});
onBeforeUnmount(() => clearInterval(timer));

const timeStr = computed(() =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now.value),
);
const dateStr = computed(() =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(now.value),
);

// 顶栏环境摘要:天气 + 下一项日程
const weather = computed(() => {
  const w = chat.env?.weather;
  if (!w?.configured || w.error) return null;
  return `${w.city || ''} ${Math.round(w.temp)}° ${w.desc || ''}`;
});
const nextEvent = computed(() => {
  const cal = chat.env?.calendar;
  if (!cal?.configured) return null;
  const nowMs = Date.now();
  const next = (cal.events || []).find((e) => e.start > nowMs);
  if (!next) return '今日无日程';
  const t = new Date(next.start).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Shanghai',
  });
  return `${t} ${next.summary}`;
});

// 场景标题:优先当日计划串词,否则 DJ 最新一句
const scene = computed(
  () =>
    chat.plan?.say ||
    [...chat.messages].reverse().find((m) => m.role === 'assistant')?.say ||
    '深夜电台 · 按你的品味自动编排',
);

const recentPlays = ref([]);
onMounted(() => {
  http
    .get('/plays/today')
    .then((r) => (recentPlays.value = r.plays || []))
    .catch(() => {});
});

const ttsState = computed(() => chat.tts?.state ?? null);

// 移动底部导航
const NAV = [
  { key: 'player', label: 'Player' },
  { key: 'queue', label: 'Queue' },
  { key: 'profile', label: 'Profile' },
];
</script>

<template>
  <AmbientField />
  <div class="shell">
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="brand">
        <button class="wordmark" aria-label="回到播放器" @click="setView('player')">VRADIO</button>
        <OnAirIndicator :status="chat.ws" />
      </div>
      <div class="env meta-label">
        <span>{{ weather || '天气 · 未配置' }}</span>
        <span class="sep" aria-hidden="true">/</span>
        <span>{{ nextEvent || '日程 · 未配置' }}</span>
      </div>
      <nav class="topnav meta-label" aria-label="主导航">
        <button :class="{ on: ui.view === 'player' }" @click="setView('player')">player</button>
        <button :class="{ on: ui.view === 'profile' }" @click="setView('profile')">profile</button>
        <button :class="{ on: ui.view === 'settings' }" @click="setView('settings')">settings</button>
      </nav>
    </header>

    <!-- 非播放器视图 -->
    <main v-if="ui.view !== 'player'" class="plain">
      <ProfileView v-if="ui.view === 'profile'" @back="setView('player')" />
      <SettingsView v-else-if="ui.view === 'settings'" @back="setView('player')" />
      <QueuePanel v-else-if="ui.view === 'queue'" />
    </main>

    <!-- 播放器主视图 -->
    <main v-else class="grid">
      <section class="stage">
        <div class="scene">
          <div class="clock">
            <span class="time">{{ timeStr }}</span>
            <span class="date meta-label">{{ dateStr }} · CST</span>
          </div>
          <p class="scene-title">{{ scene }}</p>
        </div>

        <NowPlayingCard />

        <section class="dj-area" aria-label="DJ 对话">
          <div class="dj-head">
            <h2 class="meta-label">dj 对话</h2>
            <span class="meta-label" :class="{ thinking: player.dj.state === 'thinking' }">
              {{ player.dj.state === 'thinking' ? 'thinking…' : 'idle' }}
            </span>
          </div>
          <div class="messages" aria-live="polite">
            <p v-if="!chat.messages.length" class="empty meta-label">
              还没有对话 —— 问 DJ「现在适合听什么」,或者直接点歌
            </p>
            <DjMessage v-for="(m, i) in chat.messages" :key="i" :message="m" />
          </div>
          <MoodChips />
          <RequestComposer />
        </section>
      </section>

      <aside class="side">
        <section class="panel" aria-label="系统状态">
          <h2 class="meta-label">system</h2>
          <dl class="status">
            <div><dt class="meta-label">dj</dt><dd>{{ player.dj.state }}</dd></div>
            <div><dt class="meta-label">tts</dt><dd>{{ ttsState || 'off' }}</dd></div>
            <div><dt class="meta-label">ws</dt><dd>{{ chat.ws }}</dd></div>
          </dl>
        </section>

        <RadioContext />

        <QueuePanel />

        <section class="panel" aria-label="最近播放">
          <h2 class="meta-label">recent / 最近播放</h2>
          <p v-if="!recentPlays.length" class="empty meta-label">暂无记录</p>
          <ul v-else class="recent-list">
            <li v-for="p in recentPlays" :key="p.id">
              <span class="q-title">{{ p.title }}</span>
              <span class="q-artist">{{ p.artist }}</span>
            </li>
          </ul>
        </section>
      </aside>
    </main>

    <!-- 移动底部导航 -->
    <nav class="bottomnav" aria-label="底部导航">
      <button
        v-for="n in NAV"
        :key="n.key"
        :class="{ on: ui.view === n.key }"
        @click="setView(n.key)"
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
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 var(--vr-space-5);
  display: grid;
  gap: var(--vr-space-5);
}

/* 顶栏 */
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
}
.env {
  display: flex;
  gap: var(--vr-space-2);
  align-items: center;
}
.sep {
  opacity: 0.5;
}
.topnav {
  display: flex;
  gap: var(--vr-space-4);
}
.topnav button {
  padding: var(--vr-space-1) var(--vr-space-2);
  min-height: 44px;
  color: var(--vr-text-muted);
  transition: color var(--vr-motion-fast) var(--vr-ease);
}
.topnav button:hover {
  color: var(--vr-text);
}
.topnav button.on {
  color: var(--vr-on-air);
}

/* 12 栏网格 */
.grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: var(--vr-space-5);
  padding-bottom: var(--vr-space-6);
}
.stage {
  grid-column: span 8;
  display: grid;
  gap: var(--vr-space-5);
  align-content: start;
}
.side {
  grid-column: span 4;
  display: grid;
  gap: var(--vr-space-4);
  align-content: start;
}

/* 时间/场景 */
.scene {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--vr-space-4);
  padding-top: var(--vr-space-4);
}
.time {
  font-family: var(--vr-font-display);
  font-size: var(--vr-text-display-lg);
  line-height: 1;
  letter-spacing: 0.02em;
}
.date {
  display: block;
  margin-top: var(--vr-space-2);
}
.scene-title {
  max-width: 46ch;
  text-align: right;
  color: var(--vr-text-muted);
  font-size: var(--vr-text-body-sm);
}

/* DJ 对话区 */
.dj-area {
  display: grid;
  gap: var(--vr-space-4);
  background: var(--vr-panel);
  border: 1px solid var(--vr-line);
  border-radius: var(--vr-radius-l);
  padding: var(--vr-space-5);
}
.dj-head {
  display: flex;
  justify-content: space-between;
}
.dj-head .thinking {
  color: var(--vr-ai);
}
.messages {
  display: grid;
  gap: var(--vr-space-3);
  max-height: 320px;
  overflow-y: auto;
  padding-right: var(--vr-space-2);
}
.empty {
  color: var(--vr-text-muted);
}

/* 右栏面板 */
.panel {
  background: var(--vr-panel);
  border: 1px solid var(--vr-line);
  border-radius: var(--vr-radius-m);
  padding: var(--vr-space-4);
  display: grid;
  gap: var(--vr-space-3);
}
.status {
  display: grid;
  gap: var(--vr-space-2);
}
.status > div {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.status dd {
  font-family: var(--vr-font-mono);
  font-size: var(--vr-text-caption);
  color: var(--vr-on-air);
}
.recent-list {
  list-style: none;
  display: grid;
  gap: var(--vr-space-1);
}
.recent-list li {
  display: flex;
  align-items: center;
  gap: var(--vr-space-2);
  padding: var(--vr-space-2);
  border-radius: var(--vr-radius-s);
  font-size: var(--vr-text-body-sm);
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 40%;
}

/* 非播放器视图 */
.plain {
  max-width: 880px;
  padding: var(--vr-space-5) 0 var(--vr-space-6);
}

/* 底部导航(仅移动) */
.bottomnav {
  display: none;
}

/* 窄桌面:侧栏收为下方两栏 */
@media (max-width: 1023px) {
  .side {
    grid-column: span 12;
    grid-template-columns: repeat(2, 1fr);
  }
  .stage {
    grid-column: span 12;
  }
}

/* 移动单栏 */
@media (max-width: 767px) {
  .shell {
    padding: 0 var(--vr-space-4);
    gap: var(--vr-space-4);
  }
  .env,
  .topnav {
    display: none;
  }
  .scene {
    flex-direction: column;
    align-items: flex-start;
  }
  .scene-title {
    text-align: left;
  }
  .time {
    font-size: var(--vr-text-display-md);
  }
  .dj-area {
    padding: var(--vr-space-4);
  }
  .messages {
    max-height: none;
  }
  .side {
    grid-template-columns: 1fr;
  }
  .bottomnav {
    position: sticky;
    bottom: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    background: var(--vr-panel);
    border-top: 1px solid var(--vr-line);
    backdrop-filter: blur(12px);
    margin: 0 calc(-1 * var(--vr-space-4));
    padding: var(--vr-space-2) var(--vr-space-4) calc(var(--vr-space-2) + env(safe-area-inset-bottom));
    z-index: 10;
  }
  .bottomnav button {
    min-height: 48px;
    display: grid;
    place-items: center;
    color: var(--vr-text-muted);
  }
  .bottomnav button.on {
    color: var(--vr-on-air);
  }
}
</style>
