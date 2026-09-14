// 对话 store:消息流、WS 事件分发、TTS 串词、环境快照、心情。
// assistant 消息统一由 WS chat 事件回流(离线时回退 HTTP 响应),避免重复。
import { reactive } from 'vue';
import { http } from '../lib/api/http.js';
import { connectWs } from '../lib/api/ws.js';
import { player, applySnapshot, setLocalVolume } from './player.js';

export const chat = reactive({
  messages: [], // {role:'user'|'assistant', say, play[], degraded, ts}
  ws: 'disconnected', // connected | disconnected
  tts: null, // {hash, url, state:'synth'|'ready'|'failed'}
  plan: null, // 当日播放计划
  env: null, // {weather, calendar}
  sending: false,
  error: null,
});

// TTS 串词播放:就绪即播放,期间压低歌曲音量(DJ 说话),结束恢复。
// 串词与音乐不重叠 —— 模拟真实电台"人声优先"。
const ttsAudio = new Audio();
let musicVolumeBefore = null;

function playTts({ url }) {
  ttsAudio.src = url;
  musicVolumeBefore = null;
  if (player.isPlaying) {
    musicVolumeBefore = player.volume;
    // 压低不静音;仅改本地音量,不惊动服务端状态
    setLocalVolume(Math.min(player.volume, 0.15));
  }
  ttsAudio.play().catch(() => {});
  ttsAudio.onended = () => {
    if (musicVolumeBefore !== null) setLocalVolume(musicVolumeBefore);
  };
}

export function sendMessage(text) {
  const msg = String(text || '').trim();
  if (!msg || chat.sending) return Promise.resolve(null);
  chat.sending = true;
  chat.error = null;
  chat.messages.push({ role: 'user', say: msg, ts: Date.now() });
  return http
    .post('/chat', { message: msg })
    .then((res) => {
      if (res.tts) chat.tts = res.tts;
      // WS 未连接时用 HTTP 响应兜底展示 assistant 消息
      if (chat.ws !== 'connected' && res.say) {
        chat.messages.push({
          role: 'assistant',
          say: res.say,
          play: res.play,
          degraded: res.degraded,
          ts: Date.now(),
        });
      }
      return res;
    })
    .catch((err) => {
      chat.error = err.message;
    })
    .finally(() => {
      chat.sending = false;
    });
}

export function setMood(mood) {
  if (!mood) return Promise.resolve(null);
  return sendMessage(`我想听${mood}一点的歌,帮我排几首。`);
}

// 应用启动:拉快照 + 连 WS
export function initChat() {
  http
    .get('/now')
    .then(applySnapshot)
    .catch(() => {});
  http
    .get('/env')
    .then((e) => (chat.env = e))
    .catch(() => {});
  http
    .get('/plan/today')
    .then((p) => (chat.plan = p.plan))
    .catch(() => {});

  connectWs({
    onStatus: (s) => (chat.ws = s),
    onEvent: (type, data) => {
      switch (type) {
        case 'chat':
          if (data.role === 'assistant') {
            chat.messages.push({
              role: 'assistant',
              say: data.say,
              play: data.play,
              degraded: data.degraded,
              ts: Date.now(),
            });
          }
          break;
        case 'now-playing':
          applySnapshot(data);
          break;
        case 'dj':
          player.dj = data;
          break;
        case 'tts':
          chat.tts = data;
          if (data.state === 'ready') playTts(data);
          break;
        case 'plan':
          chat.plan = { ...chat.plan, ...data };
          break;
        case 'upnp':
          break; // Phase 9 DevicePicker 使用
      }
    },
  });
}
