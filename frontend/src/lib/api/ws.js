// WS /stream 客户端:自动重连(指数退避)+ 状态回调(on-air 指示器用)
// 事件类型:hello / chat / now-playing / dj / tts / plan / upnp
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export function connectWs({ onEvent, onStatus } = {}) {
  let closed = false;
  let attempt = 0;
  let timer = null;

  function open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/stream`);

    ws.onopen = () => {
      attempt = 0;
      onStatus?.('connected');
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      onEvent?.(msg.type, msg.data, msg.ts);
    };
    ws.onclose = () => {
      onStatus?.('disconnected');
      if (closed) return;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt++, RECONNECT_MAX_MS);
      timer = setTimeout(open, delay);
    };
    ws.onerror = () => ws.close();
  }

  open();
  return () => {
    closed = true;
    clearTimeout(timer);
  };
}
