import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { effective } from './prefs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 施工图:Fish Audio -> cache/tts/*.mp3 -> /tts/[hash].mp3
// 以「音色 + 文本」哈希为缓存键,避免重复合成同一段串词
const CACHE_DIR = path.join(__dirname, 'cache', 'tts');
const API = 'https://api.fish.audio/v1/tts';
const VOICE_ID = process.env.FISH_VOICE_ID || '03397b4c4bbf4d02bd63a5a55baaa2ed';
const TIMEOUT_MS = 20000;

export function isConfigured() {
  return Boolean(effective('FISH_API_KEY', 'fish_api_key'));
}

// 验证 API Key:/user 需鉴权(无效 key 返回 401),不消耗合成积分(设置页保存前调用)
export async function testKey(key) {
  const res = await fetch('https://api.fish.audio/user', {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Fish Audio 返回 ${res.status}${detail ? `:${detail.slice(0, 120)}` : ''}`);
  }
}

export function ttsHash(text) {
  return crypto.createHash('sha1').update(`${VOICE_ID}:${text}`).digest('hex');
}

export function ttsPath(hash) {
  return path.join(CACHE_DIR, `${hash}.mp3`);
}

export function cached(hash) {
  return fs.existsSync(ttsPath(hash));
}

// 合成一段串词,写入缓存,返回哈希;失败抛错由调用方降级
export async function synthesize(text) {
  const key = effective('FISH_API_KEY', 'fish_api_key');
  if (!key) throw new Error('FISH_API_KEY 未配置');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        reference_id: VOICE_ID,
        format: 'mp3',
        latency: 'normal',
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Fish Audio HTTP ${res.status}:${detail.slice(0, 200)}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const hash = ttsHash(text);
    fs.writeFileSync(ttsPath(hash), buf);
    return hash;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Fish Audio 请求超时');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// GET /tts/[hash].mp3 —— 缓存音频(带长缓存头,前端可反复取用)
export const ttsRouter = Router();

ttsRouter.get('/tts/:hash.mp3', (req, res) => {
  const file = ttsPath(String(req.params.hash));
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'TTS 音频不存在(可能还在合成中)' });
  }
  res.set('Content-Type', 'audio/mpeg');
  res.set('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(file).pipe(res);
});
