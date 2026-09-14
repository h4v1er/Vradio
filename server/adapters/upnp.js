// UPnP 适配器:SSDP 发现 MediaRenderer → SOAP 控制 AVTransport / RenderingControl。
// 零第三方依赖(node:dgram + fetch + 正则解析 XML),无设备/失败全部优雅降级。
import dgram from 'node:dgram';
import os from 'node:os';
import db from '../db.js';

const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;
const MEDIA_RENDERER = 'urn:schemas-upnp-org:device:MediaRenderer:1';
const AVT = 'urn:schemas-upnp-org:service:AVTransport:1';
const RCS = 'urn:schemas-upnp-org:service:RenderingControl:1';
const DISCOVER_TIMEOUT_MS = 2500;
const DEVICE_TTL_MS = 10 * 60 * 1000;
const PREF_KEY = 'upnp_device';

// 局域网 IP:UPnP 设备无法访问 localhost,代理流地址必须用可达 IP
export function lanIp() {
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const i of infos ?? []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '127.0.0.1';
}

// ── 设备缓存(SSDP 结果 10 分钟内复用) ──────────────────────
let cache = { at: 0, devices: [] };

export function getDevices() {
  return Date.now() - cache.at < DEVICE_TTL_MS ? cache.devices : [];
}

// 当前选中的投放设备(存 prefs 表)
export function getSelected() {
  const row = db.prepare('SELECT value FROM prefs WHERE key = ?').get(PREF_KEY);
  return row ? JSON.parse(row.value) : null;
}

export function selectDevice(location) {
  const dev = getDevices().find((d) => d.location === location) ?? null;
  db.prepare("INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(PREF_KEY, JSON.stringify(dev));
  return dev;
}

export function unselect() {
  db.prepare('DELETE FROM prefs WHERE key = ?').run(PREF_KEY);
}

// ── SSDP 发现 ─────────────────────────────────────────────
// 广播 M-SEARCH,收集 MediaRenderer 响应,按 LOCATION 拉描述 XML。
// 无响应/描述缺失/网络不可达 → 返回空数组,不抛错。
export function discover({ timeoutMs = DISCOVER_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const locations = new Set();

    const finish = () => {
      try {
        sock.close();
      } catch {
        // 已关闭
      }
      Promise.allSettled([...locations].map(describeDevice))
        .then((results) => {
          cache = {
            at: Date.now(),
            devices: results
              .map((r) => (r.status === 'fulfilled' ? r.value : null))
              .filter(Boolean),
          };
          resolve(cache.devices);
        });
    };

    const timer = setTimeout(finish, timeoutMs);
    sock.on('message', (msg) => {
      const text = msg.toString();
      const st = text.match(/^ST:\s*(.+)$/im)?.[1]?.trim();
      if (st !== MEDIA_RENDERER) return;
      const loc = text.match(/^LOCATION:\s*(.+)$/im)?.[1]?.trim();
      if (loc) locations.add(loc);
    });

    sock.bind(() => {
      const query = [
        'M-SEARCH * HTTP/1.1',
        `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
        'MAN: "ssdp:discover"',
        'MX: 2',
        `ST: ${MEDIA_RENDERER}`,
        '',
        '',
      ].join('\r\n');
      sock.send(query, SSDP_PORT, SSDP_ADDR);
    });
    sock.on('error', () => {
      clearTimeout(timer);
      finish();
    });
  });
}

// 拉设备描述 XML,提取 friendlyName + AVTransport/RenderingControl 控制地址
async function describeDevice(location) {
  const res = await fetch(location, { signal: AbortSignal.timeout(4000) });
  const xml = await res.text();

  const name = xml.match(/<friendlyName[^>]*>([\s\S]*?)<\/friendlyName>/i)?.[1]?.trim() || '(未命名设备)';
  const services = {};
  for (const block of xml.matchAll(/<service>[\s\S]*?<\/service>/gi)) {
    const st = block[0].match(/<serviceType>([\s\S]*?)<\/serviceType>/i)?.[1]?.trim();
    const cu = block[0].match(/<controlURL>([\s\S]*?)<\/controlURL>/i)?.[1]?.trim();
    if (st === AVT) services.avTransport = resolveUrl(location, cu);
    if (st === RCS) services.renderingControl = resolveUrl(location, cu);
  }
  if (!services.avTransport) return null; // 不是播放器(桥接/服务器),跳过

  const host = location.match(/^https?:\/\/[^/]+/i)?.[0] || '';
  return {
    id: `${name}@${host}`,
    name,
    location,
    host,
    services,
    foundAt: new Date().toISOString(),
  };
}

function resolveUrl(base, ref) {
  if (!ref) return null;
  if (/^https?:\/\//i.test(ref)) return ref;
  return new URL(ref, base).toString();
}

// ── SOAP 调用 ────────────────────────────────────────────
function soapBody(serviceType, action, fields) {
  return `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body><u:${action} xmlns:u="${serviceType}">${fields.map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</u:${action}></s:Body>
</s:Envelope>`;
}

async function soap(url, serviceType, action, fields = []) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPACTION: `"${serviceType}#${action}"`,
    },
    body: soapBody(serviceType, action, fields),
    signal: AbortSignal.timeout(5000),
  });
  const text = await res.text();
  if (!res.ok || /<UPnPError>/.test(text)) {
    throw new Error(`UPnP ${action} 失败(${res.status})`);
  }
  return text;
}

// ── 控制动作(基于选中设备) ────────────────────────────────
export async function cast(device, { url, title }) {
  await soap(device.services.avTransport, AVT, 'SetAVTransportURI', [
    ['InstanceID', 0],
    ['CurrentURI', url],
    ['CurrentURIMetaData', ''],
  ]);
  await soap(device.services.avTransport, AVT, 'Play', [['InstanceID', 0], ['Speed', 1]]);

  // 确认真实进入播放状态(不伪造"已开始播放");
  // 真实响应标签常带命名空间属性(如 <CurrentTransportState xmlns:dt="...">),按 [^>]* 容错
  const info = await soap(device.services.avTransport, AVT, 'GetTransportInfo', [['InstanceID', 0]]);
  const state =
    info.match(/<CurrentTransportState[^>]*>([\s\S]*?)<\/CurrentTransportState>/i)?.[1] || 'UNKNOWN';
  return { ok: true, device: device.name, title, state };
}

export async function control(device, action, volume) {
  if (action === 'volume') {
    if (volume == null || !device.services.renderingControl) {
      throw new Error('该设备不支持音量控制');
    }
    return soap(device.services.renderingControl, RCS, 'SetVolume', [
      ['InstanceID', 0],
      ['Channel', 'Master'],
      ['DesiredVolume', Math.round(volume * 100)],
    ]);
  }
  const a = { play: 'Play', pause: 'Pause', resume: 'Play', stop: 'Stop' }[action];
  if (!a) throw new Error(`未知 UPnP 动作:${action}`);
  return soap(device.services.avTransport, AVT, a, [['InstanceID', 0], ['Speed', 1]]);
}
