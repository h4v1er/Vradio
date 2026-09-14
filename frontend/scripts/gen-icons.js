// PWA 图标生成:零依赖 PNG 编码器(zlib + CRC32),画出深墨蓝圆角方 + 薄荷绿点阵环。
// 用法:node scripts/gen-icons.js → public/pwa-192.png / pwa-512.png
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BG = [7, 9, 13];
const MINT = [71, 231, 177];

// ── 极简 PNG 编码 ─────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ── 画图:圆角深墨蓝底 + 薄荷绿点 + 虚线环 ──────────────────
function draw(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.22; // 圆角
  const dotR = size * 0.13;
  const ringR = size * 0.31;
  const dash = 0.22; // 虚线占空比

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // 圆角矩形背景
      const dx = Math.max(radius - x, x - (size - 1 - radius), 0);
      const dy = Math.max(radius - y, y - (size - 1 - radius), 0);
      if (dx * dx + dy * dy > radius * radius) {
        buf[i + 3] = 0; // 透明
        continue;
      }
      buf[i] = BG[0];
      buf[i + 1] = BG[1];
      buf[i + 2] = BG[2];
      buf[i + 3] = 255;

      const d = Math.hypot(x - cx, y - cx);
      if (d <= dotR) {
        buf[i] = MINT[0];
        buf[i + 1] = MINT[1];
        buf[i + 2] = MINT[2];
      } else if (Math.abs(d - ringR) <= size * 0.016) {
        // 虚线环:按角度占空
        const ang = Math.atan2(y - cy, x - cx) / (2 * Math.PI);
        if ((ang + 1) % 1 < dash) {
          const a = 0.45;
          buf[i] = Math.round(MINT[0] * a + BG[0] * (1 - a));
          buf[i + 1] = Math.round(MINT[1] * a + BG[1] * (1 - a));
          buf[i + 2] = Math.round(MINT[2] * a + BG[2] * (1 - a));
        }
      }
    }
  }
  return buf;
}

const outDir = path.join(__dirname, '..', 'public');
for (const size of [192, 512]) {
  fs.writeFileSync(path.join(outDir, `pwa-${size}.png`), encodePng(size, draw(size)));
  console.log(`public/pwa-${size}.png ✓`);
}
