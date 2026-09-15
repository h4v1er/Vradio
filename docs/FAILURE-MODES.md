# 故障模式与降级行为

本文档列出每个环节失败时**用户看到什么、系统如何兜底、证据在哪里**。与实现一一对应:修改对应实现时,请同步更新本表。

证据列说明:

- `test:` → 自动化单测(`npm test`),给出具体测试名。
- `eval:` → 评测用例(`npm run eval`,fixture 模式),给出用例 id。
- `手动验证` → 依赖真实外部服务/设备,无自动化测试,给出验证方法。

## 核心链路故障

| 故障 | 检测/触发 | 用户可见表现 | 实现位置 | 证据 |
|---|---|---|---|---|
| Claude 子进程无法启动 / 退出码非 0 / 超时(默认 90s) | `ask()` reject | 点歌类消息:降级直搜网易云并如实告知"信号不太好";其余消息:"电台信号不太好,稍后再试试。" 响应 `degraded: true`,`reason` 带具体原因。HTTP 仍 200 | `server/router.js` handleClaude / degrade | test: 「Claude 超时 → 返回 degraded 响应,HTTP 仍 200」「Claude 退出码非 0 → 返回 degraded 响应」 |
| Claude 输出不是 JSON / 违反输出契约(缺字段、错类型、超限) | `parseClaudeOutput` 严格校验抛错 | 同上 degrade;原始输出落盘 `server/cache/claude-debug.log` 供排障(已 gitignore)。**不会静默补全为成功结果** | `server/claude.js` validateContract / `server/router.js` dumpClaudeRaw | test: `claude-output.test.js` 全部 19 项;chat-flow 「输出非法 JSON」「缺失契约字段」「play 超过 8 首上限」;eval: `format-error-*` 5 条 |
| 网易云容器宕机 / 搜索超时 | 适配器请求抛错(5s 超时) | 点歌:降级兜底文本,`degraded: true`;DJ 编排:该首歌保留为未解析条目(`unresolved`),不阻塞其余歌曲与串词 | `server/adapters/netease.js` / `server/router.js` resolvePlays | test: 「网易云搜索失败时 /api/chat 不崩溃,返回 degraded 兜底」;eval: `search-fail-claude` |
| 网易云搜索无结果 | 搜索结果为空数组 | 如实告知"没找到「××」,换个说法试试?",`degraded: true` | `server/router.js` handlePointsong | eval: `pointsong-empty` |
| 歌曲版权受限/需 VIP(无播放直链) | `songUrl` 返回 `url: null` | `/api/stream/:songId` 返回 404「暂无播放资源(版权受限或需 VIP)」;未解析条目前端可手动移除 | `server/adapters/netease.js` songUrl 音质逐级回退 | 手动验证:点一首下架/纯 VIP 歌,观察 404 与队列表现(需真实容器,无自动测试) |
| VIP 歌曲未登录(只有 30 秒试听) | 点歌前探测 `freeTrialInfo` | 串词如实标注「VIP 歌曲,未登录会员只能试听 30 秒(在设置页配置网易云 Cookie 可完整播放)」;配置本人 Cookie 后按账号权益完整播放 | `server/router.js` handlePointsong / `server/adapters/netease.js` songUrl | 手动验证:未登录点一首 VIP 歌(需真实容器);探测失败不阻塞点歌 |
| 网易云 Cookie 失效/未登录 | 保存前 `/login/status` 验证(`profile` 存在才算登录) | 无效不落库,报错透传上游状态码(含匿名会话提示);已存 Cookie 失效后播放自然回落到试听,不报错 | `server/adapters/netease.js` loginStatus / `server/router.js` POST /api/netease/cookie | 手动验证:粘贴伪造 Cookie 保存(需容器);GET /api/netease/cookie 不回显值见 test 「GET /api/netease/cookie 只回配置来源,不回 Cookie 值」 |
| Fish Audio 未配置 | `tts.isConfigured()` 为 false | 串词纯文字展示,响应 `tts: null`,不报错 | `server/router.js` arrangeTts | test: 「TTS 未配置 → 仍返回文字串词,tts 为 null」 |
| Fish Audio 合成失败/超时(20s) | `synthesize` reject | 文字串词照常展示;WS 推送 `tts` 事件 `state: failed`(含错误信息),不阻塞播放 | `server/router.js` arrangeTts 的 catch 分支 | 手动验证:配置错误 key 触发合成失败(需真实服务;`tts: null` 的未配置路径已有单测) |
| 天气未配置 | `weather.isConfigured()` 为 false | 环境注入「天气:未配置(OPENWEATHER_API_KEY 未设置)」,DJ 串词自然跳过 | `server/context.js` buildEnvironment | eval: `weather-unconfigured` |
| 天气请求失败 | `weather.now()` 抛错 | 环境注入「天气:暂不可用(原因)」,不阻塞 | `server/context.js` buildEnvironment | eval: `weather-unavailable` |
| 飞书未配置 | `feishu.isConfigured()` 为 false | 环境注入「日程:未配置(FEISHU_APP_ID 未设置)」 | `server/context.js` buildEnvironment | eval: `calendar-unconfigured` |
| 飞书请求失败 | `todayEvents()` 抛错 | 环境注入「日程:暂不可用(原因)」;日历 hook 静默跳过 | `server/context.js` buildEnvironment / `server/scheduler.js` calendarHook | eval: `calendar-unavailable` |
| UPnP 无设备 / 控制失败 | SSDP 扫描结果为空 / SOAP 请求失败 | 设备列表为空,UI 置灰并提供重扫入口;cast/control 返回 502 带原因,不阻塞本机播放 | `server/adapters/upnp.js` / `server/router.js` upnp 路由 | 手动验证:无 UPnP 设备的网络环境直接观察(需局域网设备,无自动测试) |
| WebSocket 断线 | 前端 `onclose` | 指数退避重连(1s 起步翻倍,15s 封顶),重连成功后 attempt 归零;期间 ON AIR 灰显 OFFLINE,HTTP 请求不受影响 | `frontend/src/lib/api/ws.js` | test: `ws-reconnect.test.js` 全部 4 项(退避计算 + 3 条状态机) |
| 音频流代理上游失败 | 上游 fetch 非 2xx | 未开始响应时返回 502「音频流代理失败:原因」;已开始响应则销毁连接 | `server/router.js` GET /api/stream | 手动验证:构造无直链歌曲 ID 请求 /api/stream(需真实容器) |
| 前端断网(静态资源) | Service Worker 缓存 | 已缓存静态资源可打开壳,数据请求失败有错误态;网络恢复后 WS 自动重连 | `frontend/` vite-plugin-pwa | 手动验证:dev 构建后离线刷新(需浏览器) |

## 凭据存储现状与风险(如实说明)

- **现状**:三方密钥(Fish/OpenWeather/飞书)与网易云 Cookie 保存于本机 `server/state.db`(SQLite `prefs` 表),**明文存储**;该文件已 gitignore,不上传、不回显(接口只返回来源 `env/prefs/none`)。
- **威胁模型**:本地单用户应用,信任边界是「密钥不进仓库、不上传、接口不回显」。**不覆盖**:能读取你本机文件的进程(其他软件、恶意脚本)可读到明文密钥。
- **已有防护**:保存前真实验证后落库(无效不落库);全 git 历史无真实密钥;`GET /api/config` 与 `GET /api/netease/cookie` 不回显值(有单测)。
- **改进项(已评估,暂不实施)**:迁入系统钥匙串(macOS Keychain / 凭据库)。当前不实施的原因:密钥读取在每次请求的热路径上(`isConfigured` 每请求调用),钥匙串每查一次需一次子进程/系统调用,需要引入进程内缓存与设置页写入的同步策略;且测试与 CI 环境无钥匙串,需双后端回退。对一个单用户本地应用,复杂度收益比不划算。**若未来做多用户/部署版,此项升级为必须**并需重新做安全评估。

## 明确不做的事

- 不提供任何绕过第三方音乐服务版权/会员限制的能力;Cookie 仅用于按本人账号权益播放。
- 不把「降级」伪装成成功:所有降级响应带 `degraded: true` 或如实提示文案。
