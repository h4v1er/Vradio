import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { ask, parseClaudeOutput, getLastRaw } from './claude.js';
import { buildPrompt, getEnvSnapshot } from './context.js';
import * as netease from './adapters/netease.js';
import * as upnp from './adapters/upnp.js';
import * as player from './player.js';
import * as tts from './tts.js';
import { todayPlan, generateDailyPlan } from './scheduler.js';
import { broadcast } from './stream.js';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 解析失败时把原始输出落盘,便于排障(cache/ 不入库)
function dumpClaudeRaw(err) {
  try {
    const dir = path.join(__dirname, 'cache');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'claude-debug.log'),
      `[${new Date().toISOString()}] ${err.message}\n${getLastRaw()}\n\n`,
      { flag: 'a' },
    );
  } catch {
    // 落盘失败不影响主流程
  }
}

export const apiRouter = Router();

// ── 意图分流(施工图 router.js 职责) ─────────────────────────
// 简单控制指令 → 直接处理;点歌 → 网易云适配器直达;
// 需要理解意图/编排内容/对话 → Claude 子进程
const CONTROL_PATTERNS = [
  { re: /^(播放|暂停|继续|停止|停)$/, action: 'toggle' },
  { re: /^(下一首|切歌|跳过)$/, action: 'next' },
  { re: /^(上一首|前一首)$/, action: 'prev' },
  { re: /^音量/, action: 'volume' },
];
const POINTSONG_PATTERN = /^(?:播放|来一首|点一首|放一首|来首|放首|想听)(.{1,50})$/;

function detectIntent(message) {
  for (const { re, action } of CONTROL_PATTERNS) {
    if (re.test(message)) return { kind: 'control', action };
  }
  const m = message.match(POINTSONG_PATTERN);
  if (m) return { kind: 'pointsong', keyword: m[1].trim() };
  return { kind: 'claude' };
}

function saveMessage(role, content) {
  db.prepare('INSERT INTO messages (role, content) VALUES (?, ?)').run(role, content);
}

// ── 各分支处理 ─────────────────────────────────────────────

// 控制指令:直接作用于播放队列状态机,并推送 now-playing
function handleControl(action, message) {
  let say = '收到。';
  let state;
  switch (action) {
    case 'toggle':
      state = player.toggle();
      say = state.isPlaying ? '继续播放。' : '已暂停。';
      break;
    case 'next':
      state = player.next();
      say = state.playing
        ? `为你切到《${state.playing.title}》——${state.playing.artist}。`
        : '队列没有更多了。';
      break;
    case 'prev':
      state = player.prev();
      say = state.playing ? `回到《${state.playing.title}》。` : '已经是第一首了。';
      break;
    case 'volume': {
      const m = message.match(/(\d{1,3})/);
      state = player.setVolume(m ? Number(m[1]) / 100 : 0.7);
      say = `音量已调到 ${Math.round(state.volume * 100)}%。`;
      break;
    }
  }
  broadcast('now-playing', state);
  return { type: 'control', action, say, play: [], reason: '本地控制指令', segue: '', degraded: false };
}

// 点歌直达:网易云搜索,不惊动 Claude
async function handlePointsong(keyword) {
  try {
    const songs = await netease.hydrateCovers(await netease.search(keyword, { limit: 2 }));
    if (!songs.length) {
      return { type: 'chat', say: `没找到「${keyword}」,换个说法试试?`, play: [], reason: '网易云无结果', segue: '', degraded: true };
    }
    const s = songs[0];
    // VIP 歌曲:探测是否只能拿到 30 秒试听片段,如实告知(不静默)
    let trialNote = '';
    if (s.vip) {
      try {
        const probe = await netease.songUrl(s.songId);
        if (probe.preview) {
          s.preview = true;
          trialNote = '——VIP 歌曲,未登录会员只能试听 30 秒(在设置页配置网易云 Cookie 可完整播放)。';
        }
      } catch {
        // 探测失败不阻塞点歌
      }
    }
    const say = `好的,为你播放《${s.title}》——${s.artist}。${trialNote}`;
    saveMessage('user', `点歌:${keyword}`);
    saveMessage('assistant', say);
    return {
      type: 'chat',
      say,
      play: songs.slice(0, 1),
      reason: '点歌直达(不经过大脑)',
      segue: songs.length > 1 ? `接下来也可以听《${songs[1].title}》` : '',
      degraded: false,
    };
  } catch (err) {
    return degrade(`点歌:${keyword}`, err.message);
  }
}

// 自然语言 → Claude 决策
async function handleClaude(message) {
  player.setDjState('thinking');
  broadcast('dj', { state: 'thinking' });

  const prompt = await buildPrompt({ message });

  let output;
  try {
    output = parseClaudeOutput(await ask(prompt));
  } catch (err) {
    dumpClaudeRaw(err);
    player.setDjState('idle');
    broadcast('dj', { state: 'idle' });
    return degrade(message, err.message);
  }
  player.setDjState('idle');
  broadcast('dj', { state: 'idle' });

  const resolved = await resolvePlays(output.play);
  saveMessage('user', message);
  saveMessage('assistant', output.say);
  return {
    type: 'chat',
    say: output.say,
    play: resolved,
    reason: output.reason,
    segue: output.segue,
    degraded: false,
  };
}

// play[] 条目「歌手 歌名」→ 网易云解析为真实歌曲;单条失败不阻塞整体
async function resolvePlays(entries) {
  const results = [];
  for (const entry of entries) {
    try {
      const songs = await netease.search(entry, { limit: 1 });
      if (songs.length) {
        results.push(songs[0]);
        continue;
      }
    } catch {
      // 解析失败,保留原始条目让前端展示
    }
    results.push({ unresolved: entry });
  }
  // /search 部分歌曲缺封面,经 /song/detail 一次批量补齐
  try {
    return await netease.hydrateCovers(results);
  } catch {
    return results;
  }
}

// 降级路径:Claude 不可用 → 点歌类按关键词直搜;其余返回可恢复错误
async function degrade(message, why) {
  const m = message.match(POINTSONG_PATTERN);
  if (m) {
    try {
      const songs = await netease.search(m[1], { limit: 1 });
      if (songs.length) {
        const s = songs[0];
        return {
          type: 'chat',
          say: `信号不太好,先为你播放《${s.title}》——${s.artist}。`,
          play: songs,
          reason: `降级路径:${why}`,
          segue: '',
          degraded: true,
        };
      }
    } catch {
      // 网易云也不可用,落到纯文本兜底
    }
  }
  return {
    type: 'chat',
    say: '电台信号不太好,稍后再试试。',
    play: [],
    reason: `降级路径:${why}`,
    segue: '',
    degraded: true,
  };
}

// 串词 → TTS:命中缓存直接 ready;未命中后台合成,完成经 WS 推送。
// 未配置 FISH_API_KEY 时整体降级为纯文字串词,不报错。
function arrangeTts(say) {
  if (!say || !tts.isConfigured()) return null;
  const hash = tts.ttsHash(say);
  const url = `/tts/${hash}.mp3`;
  if (tts.cached(hash)) {
    broadcast('tts', { hash, url, state: 'ready' });
    return { hash, url, state: 'ready' };
  }
  broadcast('tts', { hash, url, state: 'synth' });
  tts.synthesize(say)
    .then(() => broadcast('tts', { hash, url, state: 'ready' }))
    .catch((err) => broadcast('tts', { hash, state: 'failed', error: err.message }));
  return { hash, url, state: 'synth' };
}

// ── HTTP 契约 ──────────────────────────────────────────────

// GET /api/now —— 当前播放 + 队列 + DJ 状态(真实状态机)
apiRouter.get('/now', (req, res) => {
  res.json(player.getState());
});

// GET /api/next —— 下一首 / 当前队列
apiRouter.get('/next', (req, res) => {
  const state = player.getState();
  const next = state.index >= 0 && state.index < state.queue.length - 1
    ? state.queue[state.index + 1]
    : null;
  res.json({ next, queue: state.queue, index: state.index });
});

// GET /api/plays/today —— 当日播放记录(state.db)
apiRouter.get('/plays/today', (req, res) => {
  const rows = db
    .prepare("SELECT * FROM plays WHERE date(played_at) = date('now', 'localtime') ORDER BY id DESC")
    .all();
  res.json({ plays: rows });
});

// GET /api/plan/today —— 当日播放计划(scheduler 生成,可能为 null)
apiRouter.get('/plan/today', (req, res) => {
  res.json({ plan: todayPlan() });
});

// POST /api/plan/generate —— 手动触发计划生成(调试与演示用)
apiRouter.post('/plan/generate', async (req, res) => {
  try {
    res.json(await generateDailyPlan({ reason: '手动触发' }));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── UPnP 投放(施工图 Phase 7) ────────────────────────────
// 无设备/未选中/控制失败均返回明确错误,前端据此置灰或提示,不阻塞主线。

// GET /api/upnp/devices —— SSDP 发现局域网 MediaRenderer(每次调用实时扫描)
apiRouter.get('/upnp/devices', async (req, res) => {
  const devices = await upnp.discover();
  res.json({ devices, selected: upnp.getSelected() });
});

// POST /api/upnp/select —— 选择投放设备(存 prefs)
apiRouter.post('/upnp/select', (req, res) => {
  const dev = upnp.selectDevice(String(req.body?.location || ''));
  if (!dev) return res.status(404).json({ error: '设备不存在,请先 GET /api/upnp/devices' });
  broadcast('upnp', { event: 'selected', device: dev.name });
  res.json({ selected: dev });
});

// POST /api/upnp/unselect
apiRouter.post('/upnp/unselect', (req, res) => {
  upnp.unselect();
  broadcast('upnp', { event: 'unselected' });
  res.json({ selected: null });
});

// POST /api/upnp/cast —— 把当前曲目推送到选中设备播放
// 设备无法访问 localhost,流地址用局域网 IP 的 /api/stream 代理。
apiRouter.post('/upnp/cast', async (req, res) => {
  const device = upnp.getSelected();
  if (!device) return res.status(400).json({ error: '未选择投放设备' });

  const { playing } = player.getState();
  if (!playing || playing.unresolved) {
    return res.status(400).json({ error: '当前没有可投放的曲目' });
  }

  const url = `http://${upnp.lanIp()}:${process.env.VRADIO_PORT || 8080}/api/stream/${playing.id}`;
  try {
    const result = await upnp.cast(device, { url, title: `${playing.title}——${playing.artist}` });
    broadcast('upnp', { event: 'cast', ...result });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `投放失败:${err.message}` });
  }
});

// POST /api/upnp/control —— 控制选中设备 {action: play|pause|resume|stop|volume, volume: 0-1}
apiRouter.post('/upnp/control', async (req, res) => {
  const device = upnp.getSelected();
  if (!device) return res.status(400).json({ error: '未选择投放设备' });
  try {
    await upnp.control(device, String(req.body?.action || ''), req.body?.volume);
    broadcast('upnp', { event: 'control', action: req.body?.action });
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/env —— 天气与今日日程(顶栏 / RadioContext 面板用)
apiRouter.get('/env', async (req, res) => {
  res.json(await getEnvSnapshot());
});

// POST /api/queue/remove —— 从队列移除(QueuePanel 用)
apiRouter.post('/queue/remove', (req, res) => {
  const i = Number(req.body?.index);
  const state = player.removeAt(Number.isInteger(i) ? i : -1);
  broadcast('now-playing', state);
  res.json(state);
});

// POST /api/queue/play —— 点击队列项直接播放
apiRouter.post('/queue/play', (req, res) => {
  const i = Number(req.body?.index);
  const state = player.playAt(Number.isInteger(i) ? i : -1);
  broadcast('now-playing', state);
  res.json(state);
});

// POST /api/queue/move —— 拖拽排序 {from, to}(键鼠/键盘共用)
apiRouter.post('/queue/move', (req, res) => {
  const from = Number(req.body?.from);
  const to = Number(req.body?.to);
  const state = player.move(Number.isInteger(from) ? from : -1, Number.isInteger(to) ? to : -1);
  broadcast('now-playing', state);
  res.json(state);
});

// POST /api/queue/clear —— 清空队列
apiRouter.post('/queue/clear', (req, res) => {
  const state = player.clear();
  broadcast('now-playing', state);
  res.json(state);
});

// ── 用户语料文件读写(Profile 页编辑) ──────────────────────
// 仅本地服务;文件名白名单,拒绝任意路径写入
const USER_FILES = ['taste.md', 'routines.md', 'playlists.json', 'mood-rules.md'];
const USER_DIR = path.join(__dirname, 'user');

apiRouter.get('/user/files', (req, res) => {
  const files = USER_FILES.map((name) => {
    try {
      return { name, content: fs.readFileSync(path.join(USER_DIR, name), 'utf8') };
    } catch {
      return { name, content: null };
    }
  });
  res.json({ files });
});

apiRouter.post('/user/files', (req, res) => {
  const name = String(req.body?.name || '');
  if (!USER_FILES.includes(name)) {
    return res.status(400).json({ error: `仅允许编辑:${USER_FILES.join('、')}` });
  }
  const content = String(req.body?.content ?? '');
  if (content.length > 50_000) {
    return res.status(400).json({ error: '文件过大(限 50KB)' });
  }
  try {
    fs.writeFileSync(path.join(USER_DIR, name), content, 'utf8');
    res.json({ ok: true, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/config —— 外部能力配置状态(Settings 页用,不暴露密钥值)
apiRouter.get('/config', (req, res) => {
  res.json({
    tts: tts.isConfigured(),
    weather: Boolean(process.env.OPENWEATHER_API_KEY),
    feishu: Boolean(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET),
    netease: process.env.NETEASE_BASE || 'http://localhost:3000',
    port: Number(process.env.VRADIO_PORT || 8080),
  });
});

// ── 网易云账户与歌单(设置页:配置 Cookie → VIP 完整播放;导入歌单 → DJ 学习) ──

// GET /api/netease/cookie —— 配置状态(只回来源,不回 Cookie 值)
apiRouter.get('/netease/cookie', (req, res) => {
  const source = netease.cookieSource();
  res.json({ configured: source !== 'anonymous', source });
});

// POST /api/netease/cookie —— 保存前先用 /login/status 验证,无效不落库
apiRouter.post('/netease/cookie', async (req, res) => {
  const cookie = String(req.body?.cookie || '').trim();
  if (!cookie) return res.status(400).json({ error: 'Cookie 不能为空' });
  try {
    const status = await netease.loginStatus(cookie);
    if (!status.valid) {
      return res
        .status(400)
        .json({ error: 'Cookie 无效(未登录或已过期),请重新从 music.163.com 导出 MUSIC_U=… 一段' });
    }
    netease.setPrefCookie(cookie);
    res.json({ ok: true, profile: status.profile });
  } catch (err) {
    res.status(502).json({ error: `验证失败:${err.message}` });
  }
});

// POST /api/netease/cookie/clear —— 回退到匿名访问
apiRouter.post('/netease/cookie/clear', (req, res) => {
  netease.clearPrefCookie();
  res.json({ ok: true, source: netease.cookieSource() });
});

// GET /api/netease/my-playlists —— 登录后自己的歌单(未配置有效 Cookie 报 400)
apiRouter.get('/netease/my-playlists', async (req, res) => {
  try {
    res.json({ playlists: await netease.userPlaylists() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/netease/playlist/import {id} —— 拉取歌单曲目落库(公开歌单无需登录)
apiRouter.post('/netease/playlist/import', async (req, res) => {
  const id = String(req.body?.id || '').trim();
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: '歌单 ID 无效(应为一串数字)' });
  try {
    const pl = await netease.playlistDetail(id);
    if (!pl.tracks.length) return res.status(400).json({ error: '歌单为空或无法访问' });
    db.prepare(
      `INSERT INTO netease_playlists (playlist_id, name, tracks) VALUES (?, ?, ?)
       ON CONFLICT(playlist_id) DO UPDATE SET name = excluded.name, tracks = excluded.tracks,
         created_at = datetime('now', 'localtime')`,
    ).run(pl.id, pl.name, JSON.stringify(pl.tracks));
    res.json({ ok: true, playlist: { id: pl.id, name: pl.name, trackCount: pl.tracks.length } });
  } catch (err) {
    res.status(502).json({ error: `导入失败:${err.message}` });
  }
});

// GET /api/netease/playlists —— 已导入歌单列表(DJ 学习语料)
apiRouter.get('/netease/playlists', (req, res) => {
  const rows = db
    .prepare('SELECT playlist_id, name, tracks, created_at FROM netease_playlists ORDER BY created_at DESC')
    .all();
  res.json({
    playlists: rows.map((r) => {
      let trackCount = 0;
      try {
        trackCount = JSON.parse(r.tracks).length;
      } catch {
        // 数据异常时按 0 计,不阻塞列表展示
      }
      return { id: r.playlist_id, name: r.name, trackCount, createdAt: r.created_at };
    }),
  });
});

// POST /api/netease/playlist/remove {id}
apiRouter.post('/netease/playlist/remove', (req, res) => {
  db.prepare('DELETE FROM netease_playlists WHERE playlist_id = ?').run(String(req.body?.id || ''));
  res.json({ ok: true });
});

// GET /api/stream/:songId —— 音频流代理:
// 网易云直链音质回退;Range 透传 206;Referer/UA 伪装(参考旧项目 NeteaseController 实现模式)
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

apiRouter.get('/stream/:songId', async (req, res) => {
  try {
    const { url } = await netease.songUrl(req.params.songId);
    if (!url) return res.status(404).json({ error: '暂无播放资源(版权受限或需 VIP)' });

    const headers = { Referer: 'https://music.163.com/', 'User-Agent': UA };
    if (req.headers.range) headers.Range = req.headers.range;

    const upstream = await fetch(url, { headers, redirect: 'follow' });
    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).json({ error: '上游音频获取失败' });
    }

    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.set('Content-Type', ct);
    res.set('Accept-Ranges', 'bytes');
    const cr = upstream.headers.get('content-range');
    if (cr) res.set('Content-Range', cr);
    const cl = upstream.headers.get('content-length');
    if (cl) res.set('Content-Length', cl);

    Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: `音频流代理失败:${err.message}` });
    else res.destroy();
  }
});

// POST /api/chat —— 用户请求入口:分流 → 执行 → {say, play[], reason, segue}
apiRouter.post('/chat', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) {
    return res.status(400).json({ error: 'message 不能为空' });
  }

  const intent = detectIntent(message);
  broadcast('chat', { role: 'user', say: message });

  try {
    let result;
    if (intent.kind === 'control') result = handleControl(intent.action, message);
    else if (intent.kind === 'pointsong') result = await handlePointsong(intent.keyword);
    else result = await handleClaude(message);

    // 点歌直达 → 插队立即播放;DJ 编排 → 进队列、空闲时开播
    if (result.play?.length) {
      let state;
      if (intent.kind === 'pointsong') state = player.playNow(result.play[0]);
      else {
        player.enqueue(result.play);
        state = player.startIfIdle();
      }
      broadcast('now-playing', state);
    }

    // 串词合成语音(Fish Audio,未配置则纯文字)
    result.tts = arrangeTts(result.say);

    // 统一出口:每个响应都推送 WS 聊天事件
    broadcast('chat', { role: 'assistant', say: result.say, play: result.play, degraded: result.degraded });
    return res.json(result);
  } catch (err) {
    const result = await degrade(message, err.message);
    broadcast('chat', { role: 'assistant', say: result.say, play: result.play, degraded: result.degraded });
    return res.json(result);
  }
});
