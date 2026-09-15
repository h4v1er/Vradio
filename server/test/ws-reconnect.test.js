// WS 断线重连测试:退避计算(纯函数)+ 重连状态机(伪 WebSocket + 伪定时器)。
// 不发起任何真实网络连接。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelay, connectWs } from '../../frontend/src/lib/api/ws.js';

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.onopen?.();
  }

  message(data) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  close() {
    this.onclose?.();
  }
}

function setupGlobals() {
  globalThis.WebSocket = FakeWebSocket;
  globalThis.location = { protocol: 'http:', host: 'localhost:5173' };
}

beforeEach(() => {
  FakeWebSocket.instances.length = 0;
});

test('退避计算:1 秒起步、指数翻倍、15 秒封顶', () => {
  assert.equal(backoffDelay(0), 1000);
  assert.equal(backoffDelay(1), 2000);
  assert.equal(backoffDelay(2), 4000);
  assert.equal(backoffDelay(3), 8000);
  assert.equal(backoffDelay(4), 15000); // 16000 被 15s 封顶
  assert.equal(backoffDelay(10), 15000);
});

test('重连状态机:断线按退避重连,重连成功后 attempt 归零', (t) => {
  setupGlobals();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const statuses = [];
  const dispose = connectWs({ onStatus: (s) => statuses.push(s) });

  const ws1 = FakeWebSocket.instances[0];
  ws1.open();
  assert.deepEqual(statuses, ['connected']);

  // 第一次断线 → 1 秒后重连
  ws1.close();
  assert.deepEqual(statuses, ['connected', 'disconnected']);
  t.mock.timers.tick(999);
  assert.equal(FakeWebSocket.instances.length, 1, '1 秒未到不应重连');
  t.mock.timers.tick(1);
  assert.equal(FakeWebSocket.instances.length, 2, '1 秒到应创建第 2 个连接');

  // 第 2 个连接成功 → attempt 归零;再断线应仍按 1 秒重连(而不是 2 秒)
  const ws2 = FakeWebSocket.instances[1];
  ws2.open();
  ws2.close();
  t.mock.timers.tick(999);
  assert.equal(FakeWebSocket.instances.length, 2);
  t.mock.timers.tick(1);
  assert.equal(FakeWebSocket.instances.length, 3, '成功重连后退避应重置为 1 秒');

  dispose();
});

test('重连状态机:连续失败退避翻倍直至 15 秒封顶', (t) => {
  setupGlobals();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dispose = connectWs({});

  // 从未连接成功,连续断线:1s → 2s → 4s → 8s → 15s
  const steps = [
    [1000, 2],
    [2000, 3],
    [4000, 4],
    [8000, 5],
    [15000, 6],
  ];
  for (const [delay, expectCount] of steps) {
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    ws.close();
    t.mock.timers.tick(delay);
    assert.equal(
      FakeWebSocket.instances.length,
      expectCount,
      `断线 ${delay}ms 后应创建第 ${expectCount} 个连接`,
    );
  }
  dispose();
});

test('调用返回的关闭函数后不再重连', (t) => {
  setupGlobals();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dispose = connectWs({});
  dispose();
  const ws = FakeWebSocket.instances[0];
  ws.close(); // closed=true,onclose 里不再排程
  t.mock.timers.tick(60000);
  assert.equal(FakeWebSocket.instances.length, 1, '关闭后不应再创建连接');
});
