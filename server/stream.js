import { WebSocketServer } from 'ws';

let wss = null;

export function initWs(server) {
  wss = new WebSocketServer({ server, path: '/stream' });
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'hello', ts: Date.now() }));
  });
}

// 施工图 WS /stream:推送 now-playing、队列变更、TTS 状态、聊天事件
export function broadcast(type, data) {
  if (!wss) return;
  const payload = JSON.stringify({ type, data, ts: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}
