# Vradio — 个人 AI 电台

> 你对它说话,它读懂你的品味、作息、日程与天气,用 Claude 编排一场只属于你的电台直播。
> DJ 串词由 Fish Audio 合成语音,歌曲经网易云解析播放,推送到浏览器 PWA 或家里的 UPnP 音响。

深墨蓝的夜间电波控制台,薄荷绿 `#47e7b1` 是唯一的"信号灯",象牙白的实体播放控制台是唯一的亮色大块——设计语言取自 Nothing 的克制与点阵气质。

## 四层架构

```
┌─ ① 输入与外部能力 ──────────────────────────────────────────┐
│ user/ 语料(taste/routines/playlists/mood-rules,可在线编辑)   │
│ Claude Code 子进程(claude -p --output-format json)           │
│ NeteaseCloudMusicApi(Docker :3000)                           │
│ Fish Audio TTS / Feishu 日程 / OpenWeather / UPnP            │
└───────────────────────┬─────────────────────────────────────┘
┌─ ② Node.js 本地服务(:8080)─▼───────────────────────────────┐
│ router.js 意图分流(控制/点歌直达/自然语言)                   │
│ context.js 六片段提示词组装    claude.js 大脑适配器(互斥/超时)│
│ scheduler.js 节奏调度(cron + 日历 hook)                      │
│ tts.js 语音合成与哈希缓存      adapters/(netease/fish/…)     │
│ state.db(SQLite:消息/播放/计划/偏好/播放器状态)              │
└───────────────────────┬─────────────────────────────────────┘
┌─ ③ Context Window ───▼─────────────────────────────────────┐
│ DJ 人设 + 品味语料 + 天气/日程/时间注入 + 记忆 + 本次输入     │
│ + 执行轨迹 → Claude 输出 { say, play[], reason, segue }      │
└───────────────────────┬─────────────────────────────────────┘
┌─ ④ PWA 播放器(:5173)─▼─────────────────────────────────────┐
│ Vue3 + Vite · 单一 <audio> · WS /stream 实时流               │
│ Player / Queue / Profile / Settings · Service Worker 缓存    │
└─────────────────────────────────────────────────────────────┘
```

核心原则:**本地服务是播放状态的唯一拥有者**;用户语料、日程、外部 API 返回只作为数据注入,永不当作指令执行;每个外部依赖都适配器化,缺 key / 服务宕机时优雅降级,不阻塞核心听歌链路。

## 快速开始

前置:Node.js ≥ 22、Docker(或原生运行 NeteaseCloudMusicApi)、Claude Code CLI 已登录。

```bash
# 一条命令启动:网易云 API 容器(:3000)+ 本地服务(:8080)+ PWA 前端(:5173)
bash scripts/dev.sh
```

浏览器打开 http://localhost:5173,说"早上好,今天适合听什么?"——DJ 会结合天气、日程与你的品味编排串词与队列。

外部服务密钥(可选,全部可降级):

```bash
cp server/.env.example server/.env   # 填入 FISH_API_KEY / OPENWEATHER_API_KEY / FEISHU_APP_ID …
```

## API 契约

| 接口 | 职责 |
|---|---|
| `POST /api/chat` | 意图分流:控制指令直接执行;点歌直达网易云;自然语言走 Claude 编排,返回 `{say, play[], reason, segue, tts}` |
| `GET /api/now` | 当前播放 + 队列 + DJ 状态 |
| `GET /api/next` | 下一首 / 当前队列 |
| `GET /api/plays/today` | 当日播放记录(state.db) |
| `GET /api/plan/today` · `POST /api/plan/generate` | 当日播放计划(scheduler 生成/手动触发) |
| `POST /api/queue/play` · `remove` · `move` · `clear` | 队列操作(点击/移除/拖拽排序) |
| `GET /api/user/files` · `POST /api/user/files` | Profile 页在线编辑品味语料(白名单校验) |
| `GET /api/env` · `GET /api/config` | 天气/日程快照;外部能力配置状态(不暴露密钥) |
| `GET /api/upnp/devices` · `POST /api/upnp/select·cast·control` | SSDP 发现 + 投放/控制家庭音响 |
| `GET /api/stream/:songId` | 音频流代理(音质回退、Range 206、Referer 伪装) |
| `WS /stream` | 推送 `chat` / `now-playing` / `dj` / `tts` / `plan` / `upnp` 事件 |
| `GET /tts/[hash].mp3` | TTS 缓存音频(Fish Audio,文本哈希去重) |

## 降级矩阵(实测演练)

| 故障 | 表现 |
|---|---|
| Claude 子进程失败/超时 | 点歌类按关键词直搜网易云;其余返回"电台信号不太好",`degraded: true` |
| 网易云容器宕机 | 点歌/DJ 编排均降级为信号提示,播放状态机不受影响,恢复后自愈 |
| VIP/会员歌曲未登录 | 仅 30 秒试听,串词与播放器如实标注;`server/.env` 配 `NETEASE_COOKIE` 后完整播放 |
| Fish Audio 未配置 | `tts: null`,串词纯文字展示 |
| 天气/飞书未配置或失败 | 环境注入"未配置/暂不可用"标记,DJ 串词自然跳过 |
| UPnP 无设备 | 设备列表为空,UI 置灰并给出重扫入口 |
| WS 断线 | 前端指数退避重连,ON AIR 变灰 OFFLINE;请求走 HTTP 兜底 |
| 断网(PWA) | Service Worker 缓存静态资源,壳可打开,恢复后自动重连 |

## 设计令牌(前端)

`frontend/src/styles/tokens.css` 统一管理,组件内不硬编码:

```
背景 #07090d  表面 #0e1218 / #151b22  正文 #f1f1eb  次要 #8d96a3
状态 薄荷绿 #47e7b1   AI 淡紫 #9a72ff   控制台 象牙白 #ece9df / 墨 #0a0d0b
字体 Space Grotesk / Space Mono / Doto(自托管)+ PingFang SC 回退
动效 160–220ms;唯一持续动效 = 星尘漂移 / ON AIR 呼吸 / 波形,reduced-motion 全停
```

## 目录结构

```
server/      本地服务:router.js · context.js · claude.js · scheduler.js · tts.js · player.js
             adapters/(netease · feishu · weather · upnp) · user/ 品味语料 · prompts/ DJ 人设
frontend/    Vue3 PWA:features/(player · queue · dj · radio-context · profile · settings)
             stores/ · lib/api · styles/ tokens.css · scripts/gen-icons.js
scripts/     dev.sh 一键启动
```

## 截图

> 占位:浏览器打开 http://localhost:5173 后补充桌面(1440px)与移动(390px)截图。

## License

MIT
