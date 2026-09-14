# Vradio — 个人 AI 电台

Vradio 是一个个人 AI 电台:你对它说话,它读懂你的品味、作息、日程与天气,用 Claude Code 编排一场只属于你的电台直播——DJ 串词由 Fish Audio 合成语音,歌曲由网易云解析播放,推送到浏览器 PWA 或家里的 UPnP 音响。

## 四层架构

```
① 输入与外部能力   user/ 品味语料 · Claude Code 子进程 · 网易云 / Fish TTS / Feishu / 天气 / UPnP
② Node.js 本地服务  router 意图分流 · context 提示词组装 · claude 适配器 · scheduler 调度 · tts 缓存 · state.db
③ Context Window   人设 + 语料 + 环境注入 + 记忆 + 本次输入 + 执行轨迹 → { say, play[], reason, segue }
④ PWA 播放器       Vue3 + Vite · 单一 <audio> · WebSocket 聊天流 · Service Worker 缓存
```

## 技术栈

| 层 | 技术 |
|---|---|
| 大脑 | Claude Code CLI(子进程调用,结构化 JSON 决策,免 API key) |
| 本地服务 | Node.js + Express + SQLite(better-sqlite3)+ WebSocket + node-cron |
| 外部能力 | NeteaseCloudMusicApi(Docker)/ Fish Audio TTS / Feishu 日程 / OpenWeather / UPnP |
| 前端 | Vue 3 + Vite + PWA |

## 快速开始

```bash
# 一条命令启动:网易云 API 容器 + 本地服务(:8080)+ PWA 前端(:5173)
bash scripts/dev.sh
```

外部服务密钥配置见 `server/.env.example`;未配置的集成会优雅降级,不影响核心听歌链路。

## 目录结构

```
server/     本地服务:router.js / context.js / claude.js / scheduler.js / tts.js
            adapters/(netease/fish/feishu/weather/upnp) · user/ 品味语料 · prompts/ DJ 人设
frontend/   Vue3 PWA 播放器(Player / Queue / Profile / Settings)
scripts/    开发脚本
```

> 项目状态:施工中。README 将在功能完成后完善。
