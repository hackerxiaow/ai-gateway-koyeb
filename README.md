# AI Gateway

AI 渠道 API 代理网关 — 统一 `/v1` 接口转发，支持多上游渠道、后台管理、用量统计、备份恢复。

基于 [Cloudflare Workers](https://workers.cloudflare.com/) + [Hono](https://hono.dev/) + [D1](https://developers.cloudflare.com/d1/) 构建。

## 功能特性

- **多渠道转发** — OpenAI 兼容 / Anthropic 兼容 / Azure TTS / Agnes 视频 / Antigravity 反代，统一 `/v1` 入口
- **ZCode 兼容模式** — Antigravity 渠道可开启：清洗 Gemini 不支持的工具 Schema 并回传 `thought_signature`，编程 Agent 直连可用
- **免费模型默认启用** — OpenCode、Kilo 免费模型开箱即用，无需配置 API Key
- **后台管理** — 渠道管理、令牌管理、用量统计、模型排行
- **D1 存储** — 配置/会话/用量全部存储在 Cloudflare D1，KV 作可选回退
- **备份恢复** — R2 云端备份、Telegram 备份、导出/导入
- **故障转移** — 官方地址失败自动切换镜像地址，Key 健康检测自动降权
- **模型别名** — 对外隐藏 `:free/-free` 后缀，支持自定义显示名
- **令牌管理** — 批量添加、批量测试、到期时间控制
- **渠道 ID 可编辑** — 后台可直接修改渠道唯一标识

## 快速开始

### 前置条件

1. Cloudflare 账号（免费版即可）
2. [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) 已安装

```bash
npm install -g wrangler
```

### 创建 D1 数据库

```bash
wrangler d1 create ai-gateway-db
```

记下输出的 `database_id`，复制到 `wrangler.toml` 中替换。

### 配置 wrangler.toml

将 `wrangler.toml.example` 复制为 `wrangler.toml` 并填入你的 D1 ID：

```toml
name = "ai-gateway"
pages_build_output_dir = "dist"
compatibility_date = "2025-07-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "ai-gateway-db"
database_id = "你的 D1 数据库 ID"
```

如需 R2 备份功能，请在 Cloudflare 控制台激活 R2 并在后台创建对应 Bucket，之后取消以下注释：

```toml
# [[r2_buckets]]
# bucket_name = "ai-gateway-backup"
# binding = "ai_gateway_backup"
```

### 本地开发

```bash
npm install
npm run dev    # 构建 dist 产物并在本地模拟运行 Pages
```

### 部署

```bash
npm run deploy:pages  # 打包前端及 Worker 逻辑，并部署至 Cloudflare Pages
```

> **注**：本项目采用 Cloudflare Pages Advanced 模式部署（使用打包后的 `_worker.js`），支持动态路由与完整全栈能力。

部署后访问 `https://项目名.pages.dev` 即可看到首页。

## GitHub Actions 自动部署

本项目支持 GitHub Actions 自动部署。每次推送到 `main` 分支时自动构建并部署到 Cloudflare Pages。

### 配置步骤

1. Fork 本仓库到你的 GitHub 账号
2. 在 GitHub 仓库 → Settings → Secrets and variables → Actions 中添加：
   - `CF_API_TOKEN` — Cloudflare API Token（需具有 Pages 部署、D1 读取等相关权限）
   - `CF_ACCOUNT_ID` — Cloudflare Account ID
3. 在 `wrangler.toml` 中填好你的 D1 ID
4. Push 代码，Actions 将自动进行打包并触发 `wrangler pages deploy`

### 手动触发部署

在 GitHub 仓库 → Actions → Deploy to Cloudflare Pages → Run workflow

## 环境变量配置

请通过命令或 Cloudflare Pages 控制台的 **Settings → Environment variables** 进行绑定：

| 变量 / Secrets | 默认值 | 说明 |
|------|--------|------|
| `ADMIN_USERNAME` | `admin` | 管理后台账号 |
| `ADMIN_PASSWORD` | `admin` | 管理后台密码 |
| `AG_CLIENT_ID` | *(空)* | (可选) Antigravity 渠道的 Google OAuth Client ID |
| `AG_CLIENT_SECRET` | *(空)* | (可选) Antigravity 渠道的 Google OAuth Client Secret |
| `OPENCODE_MIRRORS_URL` | *(空)* | (可选) OpenCode 全局兜底镜像地址（多行或逗号分隔） |

> **提示**：Telegram 备份功能不在环境变量中配置，请直接登录管理后台的「备份」面板填写 Bot Token 与 User ID。

## 默认渠道配置

部署后自动创建以下渠道（无需配置即可使用）：

| 渠道 | 类型 | 说明 |
|------|------|------|
| OpenCode | OpenAI 兼容 | 免费模型，无需 API Key，含 3 个镜像地址故障转移 |
| Kilo | OpenAI 兼容 | 免费模型 + 前沿模型，无需 API Key |
| Azure TTS | 语音合成 | 内置 Azure 语音，无需 API 地址 |

## Antigravity 免费额度反代（`antigravity` 渠道）

Google 已停用 Gemini CLI 的个人免费额度（`loadCodeAssist` 直接判定 free-tier 不合格，请求返回
`403 SUBSCRIPTION_REQUIRED`），官方指定迁移到 [Antigravity](https://antigravity.google)。本渠道复刻
CLIProxyAPI 的 Antigravity 反代：Antigravity OAuth → `cloudcode-pa` 的 `v1internal`，
请求/响应与 Gemini 协议互转，同样统一在 `/v1/chat/completions`。

### 配置步骤

1. 后台「添加渠道」→ 渠道类型选 **Antigravity 反代**。
   - **API 地址**：自动填 `https://daily-cloudcode-pa.googleapis.com`，无需修改。
   - **获取 refresh_token**：点 **「用 Google 账号授权」** → Google 登录并同意 → 浏览器会跳转到
     `localhost:51121` 并提示「无法访问」（正常现象，回调地址是本机）→ 复制地址栏里 `code=`
     后面那一段（或整段地址）粘回弹窗，网关自动换取 refresh_token 并填入 API Keys。
   - **获取模型列表**：点 **「获取模型列表」** 会用该凭据拉取 Antigravity 可用模型名，追加到模型列表。
   - **GCP 项目 ID**：无需填写，网关自动 `loadCodeAssist` / `onboardUser` 解析。
   - **编程 Agent 兼容（内置，无需开关）**：网关默认深度清洗工具 Schema（合并 `allOf`、
     剥离 `oneOf`/`anyOf` 与长度约束、`type: ["string","null"]` → `nullable`、过滤悬空的 `required`），
     回传 `thought_signature` 支持多轮工具调用历史，并透传工具调用 id。ZCode / Claude Code 等
     Agent 可直接接入；各模型流式输出上限也已按实测钳制（gpt-oss 32768 / claude 64000 / Gemini 各档）。
2. 保存后在渠道里对模型点插头图标测试连通性。

> 模型名以「获取模型列表」返回的为准（例如 `gemini-3.5-flash`、`claude-sonnet-4-6` 等）。
> 网关不做白名单，填什么就透传什么，名字不对上游会报错。
>
> 在 ZCode 里作为「OpenAI 兼容」供应商接入：Base URL 填 `https://<网关域名>/v1`，
> 模型填 `<渠道ID>/<模型ID>`（如 `antigravity/gemini-3.5-flash`），API Key 填网关令牌。

## Vertex AI 反代（`vertex` 渠道）

复刻 CLIProxyAPI 的 Gemini Vertex executor：用 **GCP 服务账号** 私钥签 RS256 JWT 换 access_token
（KV 缓存），请求走

```
https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent
```

（`location = global` 时用 `https://aiplatform.googleapis.com`）。请求/响应与 Gemini 协议互转，
同样统一在 `/v1/chat/completions`。

### 配置步骤

1. GCP 控制台 → IAM 与管理 → 服务账号 → 创建服务账号（至少授予 `Vertex AI User`）→ 密钥 →
   新建密钥（JSON），下载得到的 JSON 整段复制。
2. 后台「添加渠道」→ 渠道类型选 **Vertex AI 反代**：
   - **API 地址**：自动填 `https://aiplatform.googleapis.com`，无需修改。
   - **服务账号 JSON**：把整段 JSON 粘进文本框（含换行没问题）；**多个账号之间空一行**即可轮流使用，
     网关会随机打散做负载均衡。
   - **区域 Location**：如 `us-central1`、`global`，留空默认 `us-central1`。
   - **校验凭据**：点「验证」会换一次 token 并用渠道里第一个模型试跑，直接告诉你结果。
3. 模型 ID 填 Vertex 上的 Gemini 模型名，如 `gemini-2.5-flash`、`gemini-2.5-pro`。

> `project_id` 从服务账号 JSON 里自动读取，无需单独填。
>
> 已知限制：Express 模式的 API Key 在 `aiplatform.googleapis.com` 通用端点会被 Google 拒绝
> （`API keys are not supported by this API`），请优先使用服务账号。

## Devin 反代（`devin` 渠道）

复刻 CLIProxyAPI 的 Devin executor + OAuth：

- **授权**：PKCE（无回调的「手动复制授权码」模式，适配 Cloudflare Worker）——
  点后台「用 Devin 账号授权」→ 在 Devin 页面登录确认 → 页面直接给出授权码 → 粘回弹窗即可
  自动换取并填入 session token（`devin-session-token$` 前缀）。
- **调用**：`POST https://server.codeium.com/exa.api_server_pb.ApiServerService/GetChatMessage`，
  Connect-RPC（`application/connect+proto`）+ protobuf 载荷；响应是 Connect 帧流，
  逐帧解析出思考 / 正文 / 工具调用 / 用量，再翻译成 OpenAI SSE（含 `reasoning_content`、
  工具调用分片、`stream_options.include_usage`）。
- **模型**：Devin 的模型名自带思考档位后缀（如 `swe-2`、`claude-opus-4-6`、`gemini-3-8-flash`，
  可加 `-high` / `-max` 等）；模型目录运行时从 `models.router-for.me` 拉取并缓存 3 小时，
  用于把模型名解析成上游 UID。
- **多账号**：渠道凭据每行一个 session token（或 Devin API Key），随机打散做负载均衡，
  失败自动切换；响应头 `x-devin-account` 标识实际账号。首帧即鉴权失败时也会切换下一个凭据。

> 注：会话 id 取自请求头 `x-session-id` / `x-conversation-id`（ZCode 等客户端会带），
> 非 UUID 时按 RFC4122 v5 映射成稳定 UUID，保证多轮对话复用上游会话缓存。

## OAuth 反代渠道（`claude` / `codex` / `kimi` / `grok`）

参照 CLIProxyAPI 的实现，内置四种 OAuth 反代渠道。渠道 `apiKeys` 里每行一个对应平台的
OAuth refresh_token，网关自动换取/缓存 access_token（KV 缓存、支持上游轮换续期），
请求协议自动互转，统一从 `/v1/chat/completions` 调用：

| 渠道类型 | OAuth 方式 | 上游 | 说明 |
|----------|-----------|------|------|
| `claude` | Claude Code 客户端 OAuth（PKCE，授权链接） | `api.anthropic.com/v1/messages` | Anthropic Messages 协议；原生 `/v1/messages` 请求直接透传 |
| `codex` | Codex CLI OAuth（PKCE，授权链接） | `chatgpt.com/backend-api/codex/responses` | OpenAI Responses 协议，自动带 `Chatgpt-Account-Id`；原生 `/v1/responses` 透传 |
| `kimi` | Kimi 设备码（RFC 8628，**国际站优先**） | `api.kimi.ai/coding/v1/chat/completions` | OpenAI 兼容直通，模型名自动归一化（如 `kimi-k2.8` → `kimi-for-coding`） |
| `grok` | xAI Grok CLI 设备码（OIDC 发现） | `cli-chat-proxy.grok.com/v1/responses` | OpenAI Responses 协议，带 Grok CLI 身份头；原生 `/v1/responses` 透传 |
| `codebuddy` | CodeBuddy 设备流（服务端签发 state，打开链接登录后轮询） | 国内版 `copilot.tencent.com/v2/chat/completions`；国际版 `www.workbuddy.ai/v2/chat/completions` | 腾讯 CodeBuddy / WorkBuddy 账号，后台可切换**国内版 / 国际版**（两套独立账号体系）；上游强制流式，非流式请求由网关本地聚合 |

### 配置步骤

1. 后台「添加渠道」→ 渠道类型选对应反代 → 点 **「授权登录获取 refresh_token」**：
   - **Claude / ChatGPT**：浏览器打开官方授权页登录同意后跳转到 `localhost:54545` /
     `localhost:1455`（「无法访问」属正常），复制地址栏 `code=` 后面那段（或整段地址）粘回弹窗。
   - **Kimi / Grok**：弹出设备码验证页并显示验证码，确认授权后弹窗自动完成，refresh_token
     自动填入 API Keys。
2. 点 **「获取模型列表」** 自动拉取（Claude / Kimi 支持）；Codex / Grok 手动填写模型，
   例如 Codex 填 `gpt-5.5`、`gpt-5.6` 等，Grok 填 `grok-4.6`、`grok-4.5` 等。
3. 保存后可点模型插头图标测试连通性。

> 授权入口使用各平台 CLI 的公开 OAuth 客户端（与 CLIProxyAPI 一致）。Codex 对出口 IP 有
> 地区限制，需部署在 OpenAI 支持的地区（Cloudflare Workers 默认出口通常可用）。

## CodeBuddy 反代（`codebuddy` 渠道，腾讯）

移植自 [Sliverkiss/workbuddy2api](https://github.com/Sliverkiss/workbuddy2api) 的上游协议实现（MIT），
并参考 [linbeize/workbuddy2api-gui](https://github.com/linbeize/workbuddy2api-gui) 补齐了国内版/国际版的双域细节。
把 **CodeBuddy / WorkBuddy 账号**变成 OpenAI 兼容渠道。上游本身是 OpenAI 兼容协议，
但有若干硬性要求，网关已全部代为处理：

| 上游要求 | 网关行为 |
|----------|----------|
| 拒绝非流式请求 | 出站强制 `stream: true`；客户端要非流式时由网关本地聚合为单条响应 |
| `tool_choice` 只接受字符串 | 对象形态自动归一（`{"type":"function","function":{"name":"x"}}` → `"x"`） |
| `role` 白名单不含 `developer` | 自动改写为 `system` |
| `image_url` 只接受对象形态 | 字符串形态自动包成 `{"url": "..."}` |
| 只认 `max_tokens`（不认新别名） | `max_completion_tokens` 自动翻译 |
| `tool_calls` 与 `tool` 结果必须成对 | 自动重排并剔除孤儿项，避免坏历史把整条会话顶死 |
| DeepSeek 系需显式开思考 | 自动注入 `thinking.type=enabled` + 默认档位，并回填 `reasoning_content` |
| 桌面端指纹风控 | 出站伪装官方客户端头组（`X-CodeBuddy-Request`、按 uid 派生的 `X-Machine-ID`/`X-Session-ID`、会话头族等） |

后台还提供 **「查询积分/套餐」** 与 **「签到」** 两个账号运维动作（见下文「每日签到」）。

### 国内版 / 国际版（两套独立账号体系）

CodeBuddy 与 WorkBuddy 是**两套互相独立的账号体系**，凭据不可混用。渠道配置里有一个
**「版本 / 区域」**下拉，选定后「API 地址」会自动同步为对应域名，授权、转发、积分查询全部按该区域走。

| 区域 | 对话 / 授权域名 | 积分·套餐域名 | Origin / Referer | 出站 UA 平台段 |
|------|----------------|--------------|------------------|---------------|
| `cn` 国内版 | `copilot.tencent.com` | `www.codebuddy.cn` | `www.codebuddy.cn` | `WorkBuddy` |
| `global` 国际版 | `www.workbuddy.ai` | `www.workbuddy.ai` | `www.workbuddy.ai` | `WorkBuddy AI` |

区域以渠道的 `region` 字段为准（`cn` / `global`）。**向后兼容**：未设置该字段的老渠道，
仍按「API 地址是否含 `workbuddy.ai`」判定，留空视为国内版。

> 积分查询端点会按区域依次尝试候选地址（国内版优先 `www.codebuddy.cn`，
> 国际版优先无 `/v2` 前缀形态），任一 404 自动回退到下一个，避免上游路径调整直接失效。
> 国际版上游**经常不返回 `authUrl`**，此时网关按区域兜底拼出登录页，不会让整个授权流程失败。

### 配置步骤

1. 后台「添加渠道」→ 渠道类型选 **CodeBuddy (腾讯) 反代** → 在 **「版本 / 区域」** 选国内版或国际版。
2. 点 **「授权登录获取 refresh_token」**：弹出窗口会打开**所选区域**的登录页，
   **用对应区域的账号完成登录即可，无需复制任何 code** —— 登录完成后弹窗会自动轮询并把 refresh_token 填入 API Keys。
3. 点 **「获取模型列表」** 自动拉取可用模型（如 `deepseek-v4.1-flash`）；也可手动填写。
4. 点 **「查询积分/套餐」** 可查看该账号的剩余积分与套餐明细。
5. 点 **「签到」** 可手动执行当日签到（重复签到上游会返回「今日已签到」，按成功处理，不会报错）。
6. **多账号**：API Keys 每行一个 refresh_token，网关按「健康度 + 随机」轮换，
   遇 401/403/429/5xx 自动换号。

> ⚠️ 一个渠道只能对应一个区域。若要在国内版和国际版各配账号，请**分别建两个渠道**。
> 切换已有渠道的区域后，原凭据会因属于另一套体系而失效，需重新授权。

### 每日签到（手动 + 定时）

签到走 billing 域的 `POST {billingBase}/v2/billing/meter/daily-checkin`（与积分查询同域同头），
同样按区域依次尝试候选地址。签完会**顺带刷新一次余额**，后台直接显示最新剩余积分。

- **手动**：渠道配置面板里点「签到」（取该渠道第一个启用凭据）。
- **定时**：`.github/workflows/checkin.yml` 每天 **09:07（北京时间）** 调用
  `POST /cron/checkin`，遍历**所有 codebuddy 渠道的全部启用凭据**逐个签到。
  也可在 Actions 页面手动触发（`workflow_dispatch`）。

`/cron/checkin` 同时接受 **GET / HEAD / POST**，遍历所有 codebuddy 渠道的全部启用凭据。

定时入口用 **`X-Cron-Token` 头**（或 `?token=`，或 POST body 的 `token` 字段）鉴权，
令牌由网关用 `ADMIN_PASSWORD` **单向派生**（HMAC-SHA256）：

```bash
printf '%s' 'codebuddy-checkin-cron-v1' \
  | openssl dgst -sha256 -hmac '<管理员密码>' -r | cut -d' ' -f1
```

把结果写进仓库 Secrets 的 `CHECKIN_CRON_TOKEN` 即可。

> **为什么不直接用管理员密码**：本仓库是 public，而管理员密码往往被复用到别处，
> 放进 Actions Secrets 的爆炸半径太大。派生令牌**不可反推**原密码，且**权限最小化** ——
> 只能触发签到，读不到任何渠道配置或 API Key。
>
> ⚠️ 修改 `ADMIN_PASSWORD` 后令牌会同步变化，需重新派生并更新 Secret。
> ⚠️ 未配置 `ADMIN_PASSWORD` 时该入口返回 503（**失败关闭**），不会变成无鉴权接口。

> 定时任务为什么放在 GitHub Actions：**Cloudflare Pages Functions 没有 cron 触发器**。
> 用 Actions 的 `schedule` 定时 curl 网关接口，无需额外 Worker，也不引入新的运行时。
> 注意 GitHub 的定时任务在高峰期可能延迟，且仓库连续 60 天无提交活动会被自动停用。

#### 让外部存活监控顺带触发签到（GET）

外部存活监控（UptimeRobot / BetterStack / 自建 curl 探针等）通常**只能配一个 URL 和一条 GET**，
不方便额外挂一套定时器。所以 `/cron/checkin` 也支持 GET，直接把监控地址指过来即可：

```bash
# 外部监控配这个 URL（GET，返回 200 即视为存活）
https://<你的域名>/cron/checkin?token=<CHECKIN_CRON_TOKEN>
```

**当日节流**（关键）：监控往往几分钟 ping 一次，绝不能每次都真签到。网关会把最近一次执行结果
记在 KV（`cron:checkin:state`），规则是：

| 情况 | 行为 |
|------|------|
| 当天还没执行过 | 正常签到（`action: "checkin"`） |
| 当天已**全部成功**（含全部「已签到」） | 直接跳过，**不打上游**（`action: "skipped"`） |
| 当天有失败，距上次尝试 **< 30 分钟** | 跳过（冷却中） |
| 当天有失败，距上次尝试 **≥ 30 分钟** | 允许重试 |
| 还没有任何 CodeBuddy 渠道 | 轻量返回 `total: 0`，**不落状态** |

日期按**东八区**判定，避免北京凌晨 0–8 点被算成前一天而漏签。

跳过时同样返回 **HTTP 200 + `success: true`**（只是 `action: "skipped"`），
这样监控不会因为「已经签过了」而误报红。

两个查询参数便于人工排查：

```bash
# 只看状态、不触发（查最近一次签到结果）
curl -H 'X-Cron-Token: <TOKEN>' 'https://<域名>/cron/checkin?status=1'

# 忽略当日节流，强制执行一次
curl -H 'X-Cron-Token: <TOKEN>' 'https://<域名>/cron/checkin?force=1'
```

> 建议：**外部监控 + GitHub Actions 二选一即可**，两者都指向同一个带节流的接口，
> 同时开着也不会重复签到（Actions 那一次多半会被节流跳过）。
> 若只保留外部监控，可以把 `.github/workflows/checkin.yml` 停用。

> ⚠️ 合规提示：该渠道使用 CodeBuddy 账号作为上游，仅限**本人授权账号**在私有环境使用，
> 请遵守目标平台服务条款。上游其余定时任务类能力（积分领取、token 保活等）未实现。

## Qwen 反代（`qwen` 渠道）

复刻 CLIProxyAPI v6 的 Qwen 实现与 Qwen Code CLI：设备码授权（RFC 8628）+ PKCE，
client_id `f0304373b74a44d2b584a3fb70ca9e56`，端点在 `chat.qwen.ai/api/v1/oauth2/*`，
scope `openid profile email model.completion`。上游为 OpenAI 兼容接口，基址取自 token 响应的
`resource_url`（默认 `https://portal.qwen.ai/v1`），请求 `/chat/completions` 直通。

- 后台「添加渠道」→ 类型选 **Qwen OAuth 反代** → 点 **「授权登录获取 refresh_token」**（设备码流程，
  弹窗自动轮询）→ refresh_token 自动填入 API Keys。
- 上游不提供 `/v1/models`，点「获取模型列表」返回内置清单：`coder-model`、`qwen3-coder-plus`、
  `qwen3-coder-flash`、`vision-model`（也可自行填写）。
- ⚠️ **实测状态（2026-09，含 Cloudflare 边缘出口复测）**：`device/code` 端点仍能正常下发设备码，
  但 `oauth2/token` 端点对换码/刷新请求一律返回 `405`（本机国内网络与 Workers 国际出口 SEA 实测一致，
  官方 qwen-code 客户端同样如此），因此 Qwen 免费 OAuth 目前**无法完成授权**——与社区反馈的
  「Qwen 免费额度已停止」一致。chat.qwen.ai 网页端聊天免费额度与此 API OAuth 额度是两回事。
  代码保留为正确实现，待上游恢复即可使用；现阶段如需 Qwen，建议用「OpenAI 兼容」渠道 + DashScope API Key。
- 注：Qwen 的阿里云 WAF 会拦截**没有 User-Agent** 的请求，本模块所有 OAuth 请求均已带 UA。

## DeepSeek 反代（`deepseek` 渠道）

DeepSeek **没有官方 OAuth**。该渠道支持两种凭据，按凭据前缀自动分流：

### 模式一：官方 API Key（`sk-` 开头）— 推荐，免费版可用

直连 `https://api.deepseek.com/chat/completions`（OpenAI 兼容），无 PoW、无额外 CPU 开销，
用现有渠道的 Key 轮换/健康检查逻辑。模型名按官方 API 支持的填（如 `deepseek-chat`、
`deepseek-reasoner`，以官方文档为准）。

### 模式二：网页 userToken — 免费额度路线，需 Workers Paid

复刻 GitHub 上 deepseek 网页反代的通行做法（参考 `NIyueeE/ds-free-api`、`CJackHwang/ds2api`、
`xiaoY233/Chat2API`）：

1. 凭据是 `chat.deepseek.com` 网页会话的 **userToken**（浏览器 `localStorage.userToken`，JWT，约 24 小时有效）
2. 每次请求：创建会话 → 取 PoW challenge → 解 **DeepSeekHashV1** PoW → 带 `x-ds-pow-response`
   请求 `/api/v0/chat/completion`（SSE）
3. 把 DeepSeek 的 `p/o/v` delta 事件流（`THINK`/`RESPONSE` fragment）翻译成 OpenAI 格式，
   思考内容映射到 `reasoning_content`

PoW 为纯 JS 实现（`src/deepseek-pow.ts`，Keccak-f[1600] 跳过 round 0，**不是**标准 SHA3-256），
已用官方向量校验通过；难度 144000 时平均约 0.33 秒、最坏约 0.65 秒纯 CPU。

### 工具调用（Function Calling）支持

DeepSeek 网页接口**不支持原生 function calling**，本渠道把 `tools` 降级成提示词注入实现
（移植自 `NIyueeE/ds-free-api` 的 `openai_adapter`，见 `src/deepseek-tools.ts`）：

1. **请求侧注入**：把工具定义 + 格式规范 + 行为指令（11 条规则 + 示例）拼成一段系统提示词，
   只注入一次（标准 ChatML 风格）。工具模式下自动强制开启深度思考（实测显著提升标签遵循度）。
2. **响应侧解析**：模型按约定用 `<|tool▁calls▁begin|>...<|tool▁calls▁end|>` 包裹 JSON 数组，
   检测器把它翻译回 OpenAI 的 `tool_calls`，流式下按增量 `arguments` 分片下发，`finish_reason` 置为 `tool_calls`。
3. **三层 JSON 自修复**：非法转义反斜杠 → 无引号 key → 模型兜底（4 种候选），提升弱模型输出的可用率。
4. **流式检测器**：滑动窗口缓冲（`SCAN_WINDOW=71`），标签被 chunk 切断也能正确识别；
   代码围栏（```）内的标签视为示例不解析；未闭合时 `flush` 兜底当正文吐出，不丢内容。

> 说明：标签里的 `▁` 是 **U+2581**（不是下划线），竖线用 **ASCII `|`**。用全角 `｜` 会被上游过滤导致模型混淆。
> 另：`\name` 这类无法消歧的路径（`\n` 是合法转义）按原算法**不修复**，与 ds-free-api 行为一致。

> ⚠️ **已在线上实测的两点限制**
> - **需要 Cloudflare Workers Paid 套餐**：PoW 是 CPU 密集计算，免费版 10ms CPU 上限会被运行时
>   以 `error code: 1102` 终止（本账号实测为 Free 套餐，故模式二当前不可用）。
> - 网页接口非官方 API，存在账号风控风险，且 userToken 约 24 小时过期需重新粘贴。

### 设备身份与 WAF 可达性（已实测）

`src/deepseek-auth-probe.ts` 复刻了 ds-free-api 的设备身份方案，用于诊断（挂 `/admin/api/ds-probe`）：

- **`device_id` 是纯本地派生的**，不需要浏览器：`derive_device_uuid()` 用 FNV-1a 双种子
  （`fnv1a(seed, 0)` 与 `fnv1a(seed, 0x9e3779b97f4a7c15)`）按 `api_base` 生成 RFC 4122 v4 UUID。
  同一配置重启后设备身份不变（每次都变会呈现为「无限多个新设备」，本身是风控信号）。
  本网关默认派生出 `52ef3cfc-f064-4697-8486-78c1b1da336a`。
- **客户端拟态只是 7 个静态请求头**：除 UA `DeepSeek/2.5.0 Android/35` 外，还带
  `X-Client-Version`、`X-Client-Platform`、`X-Client-Locale`、`X-Client-Bundle-Id`、
  `X-Device-Id`、`X-Device-Model`、`X-Client-Timezone-Offset`。全是常量，Workers 里 `fetch` 可直接带。

**WAF 实测结论：Cloudflare 出口 IP 未被拦截。** ds-free-api 文档提到 DeepSeek 的 CloudFront WAF
会挑战美国出口 IP，而 Workers 出口是全球任播、不可选国家。实测（2026-09-21，出口 `CF-RAY ...-SJC` 圣何塞）：

| 探测目标 | 结果 |
|---|---|
| `GET chat.deepseek.com/` | 200，无挑战，367ms |
| `GET /api/v0/users/current`（无凭据） | 200，业务错误 `{"code":40002,"msg":"Missing Token"}`，331ms |
| `POST /api/v0/chat/create_pow_challenge`（无凭据） | 200，同上，305ms |
| 连续 5 次 | 5/5 全部 200，零 WAF 挑战 |

请求完整穿透到业务层（拿到的是业务错误码而非 WAF 拦截页）。因此**「网关代登录换凭据」在技术上可行**，
并且已经实现（见下方「两种取凭据方式」）。

配置步骤：类型选 **DeepSeek 反代** → 用下面两种方式之一拿到凭据填入 API Keys →
点「验证已填凭据」校验。内置模型：`deepseek-v4-flash`、`deepseek-v4-pro`、
`deepseek-v4-flash-search`、`deepseek-v4-pro-search`（网页模式按其语义映射 `model_type`/`thinking`/`search`）。

### 两种取凭据方式（方案 A / 方案 B）

DeepSeek 渠道的凭据有两条获取路径，在渠道编辑面板里并排提供，**任选其一**：

| | 方案 A · 粘贴 userToken | 方案 B · 账号代登录 |
|---|---|---|
| 操作 | 自己从浏览器 `localStorage.userToken` 抠出来粘贴 | 填邮箱/手机号 + 密码，网关自动登录换取 |
| 密码是否经手网关 | **否** | **是**（AES-GCM 加密存储） |
| 有效期 | 约 24h，过期需重贴 | 同左，但可一键重新登录 |
| 适用 | 不想把密码交出去 | 想省事 / 需要经常续期 |

**方案 A**：点「粘贴 userToken」弹出三步引导（Application → Local Storage → `userToken`），
并给了一行 Console 兜底命令 `copy(localStorage.getItem('userToken'))`。粘贴框会实时识别凭据类型：
`sk-` 开头 → 官方 API Key（直连 `api.deepseek.com`，免费版可用）；`eyJ` 开头 → 网页 userToken
（走反代，PoW 约 0.3~0.7s CPU，需 Workers Paid）。

**方案 B**：点「账号代登录」填写账号密码，网关调用与真实客户端一致的链路：

```
POST {api_base}/users/login                    → user.token
POST {api_base}/users/auth_token/check_device  → 若 rotate 非 null 则轮换令牌
```

要点：

- **请求体与头完全对齐真实客户端**：`{email|mobile, password, area_code, device_id, os}`，
  另有 7 个 `x-*` 拟态头；`device_id` 由 `api_base` 确定性派生（见上），重启后设备身份不变。
- **信封判定不能只看 HTTP 状态**：DeepSeek 返回 `{code, msg, data:{biz_code, biz_msg, biz_data}}`，
  HTTP 200 也可能是业务失败，必须 `code === 0 && biz_code === 0` 才算成功。
- **`check_device` 失败不阻断登录**（照搬 ds-free-api `pool.rs` 的判断：真实客户端亦非关键路径）。
- **`rotate` 形态未知**：兼容字符串与 `{"token":"..."}` 对象，其余形态保持原 token。
- **禁言检测**：登录响应里 `user.chat.is_muted` 为 1/true 时提示账号受限（`mute_until` 一并透传）。

**密码存储**（`src/deepseek-account.ts`）：

- AES-GCM 可逆加密，密钥由 **`ADMIN_PASSWORD` + HKDF** 派生 → **不新增 Cloudflare 环境变量**
  （改 env_vars 会覆盖既有不可读 secret，风险更大）。
- 密文格式 `v1.<iv_b64>.<ct_b64>`，IV 每次随机；存的是密文，接口返回值里也会把密文脱敏成
  `hasPassword` 布尔 + `tokenPreview`（前 8 位 + 后 4 位）。
- ⚠️ **改管理员密码会使已存密码无法解密** —— 届时网关**失败关闭**并提示重新填写，
  绝不静默用错密码。UI 上已明确告知这一点，并给出「改用方案 A」的替代出口。
- ⚠️ 这是「把账号密码托管给网关」的取舍：仅在你信任自己部署的这套网关时启用。

相关接口（均在 `/admin/*` 管理鉴权下）：

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/admin/api/ds-probe` | 零凭据探测：本地派生 `device_id` + 打 3 个目标看 WAF |
| `POST` | `/admin/api/ds-probe/login` | 用一次性凭据实测登录（诊断用，有副作用） |
| `PUT` | `/admin/api/providers/:id/ds-account` | 保存账号（`password` 明文进、密文存；空串=清除） |
| `POST` | `/admin/api/providers/:id/ds-login` | 代登录换 userToken，成功后写回 `dsAccount.userToken` |
| `DELETE` | `/admin/api/providers/:id/ds-account` | 清除托管账号（密码与 token 一并删） |

## Z.AI 预设渠道（`zai` 渠道，智谱 GLM 国际站）

Z.AI **没有 OAuth**，官方只提供 API Key（在 z.ai 控制台「API Keys」里创建，编码套餐从
`z.ai/subscribe` 订阅）。因此本渠道是「预设」而非反代：填 API Key 即用，无 token 交换、无 PoW。

一个 `zai` 渠道同时兼容两种协议，网关按请求路径自动切换：

| 客户端请求 | 实际上游 |
|---|---|
| `/v1/chat/completions`（OpenAI 协议） | `https://api.z.ai/api/coding/paas/v4/chat/completions` |
| `/v1/messages`（Anthropic 协议，Claude Code 等） | `https://api.z.ai/api/anthropic/v1/messages` |

- 鉴权：`Authorization: Bearer <key>`（Anthropic 端点同时接受 `x-api-key`）
- 内置模型（点「获取模型」返回，可自行增删）：`glm-5.3`、`glm-5.3-flash`、`glm-4.7`、
  `glm-4.7-flash`、`glm-4.6`、`glm-4.5-air`
- 按量付费的通用端点如需使用，把 API 地址改成 `https://api.z.ai/api/paas/v4` 即可；
  中国大陆平台可改为 `https://open.bigmodel.cn/api/paas/v4`（或 Anthropic 用
  `https://open.bigmodel.cn/api/anthropic/v1`）。
- 注：编码套餐的 Key 与通用 API Key 不通用（官方说明「Team Plan Key is not interchangeable」）。

## Kimi 国际站 / 中国站

Kimi 有两套 host，`client_id` 相同，网关按渠道的 **API 地址**自动选站：

| | 国际站（默认） | 中国站 |
|---|---|---|
| OAuth | `https://auth.kimi.ai` | `https://auth.kimi.com` |
| API | `https://api.kimi.ai/coding` | `https://api.kimi.com/coding` |

新建 kimi 渠道时 API 地址默认填 `https://api.kimi.ai/coding`（国际站）；若要中国站，把地址改成
`https://api.kimi.com/coding` 再点授权即可——设备码页面会分别显示 `www.kimi.ai` / `www.kimi.com`。
这与官方 `kimi-code` CLI 的 region profile（`global` / `mainland-cn`）一致。





## 架构

```
客户端 → /v1/chat/completions → AI Gateway (Cloudflare Workers)
                                    ↓
                              D1 (主存储) ←→ KV (回退)
                                    ↓
                          渠道路由 + Key 健康检测
                                    ↓
                         opencode / kilo / agnes / tts / antigravity
```

## 项目结构

```
src/
├── index.ts          # 路由入口
├── proxy.ts          # API 转发核心
├── auth.ts           # 管理员登录
├── admin.ts          # 后台 API
├── pages.ts          # 管理后台前端
├── pages.css.ts      # 后台样式
├── storage.ts        # D1/KV 存储适配
├── config.ts         # 默认配置
├── types.ts          # TypeScript 类型
├── backup.ts         # 备份/恢复模块
├── azure-tts.ts      # Azure TTS 适配
├── azure-voices.ts   # Azure 音色列表
├── gemini-translate.ts # OpenAI <-> Gemini 协议翻译（Antigravity 复用）
├── antigravity.ts    # Antigravity 反代（OAuth + 协议翻译 + 可用模型）
├── codebuddy.ts      # CodeBuddy(腾讯) 反代（设备流授权 + 请求体改写 + SSE 规范化 + 积分查询 + 每日签到）
```

## License

MIT
