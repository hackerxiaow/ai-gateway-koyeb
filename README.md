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

> ⚠️ **已在线上实测的两点限制**
> - **需要 Cloudflare Workers Paid 套餐**：PoW 是 CPU 密集计算，免费版 10ms CPU 上限会被运行时
>   以 `error code: 1102` 终止（本账号实测为 Free 套餐，故模式二当前不可用）。
> - 网页接口非官方 API，存在账号风控风险，且 userToken 约 24 小时过期需重新粘贴。

配置步骤：类型选 **DeepSeek 反代** → 把 API Key 或 userToken 填入 API Keys →
点「验证 userToken / API Key」校验。内置模型：`deepseek-v4-flash`、`deepseek-v4-pro`、
`deepseek-v4-flash-search`、`deepseek-v4-pro-search`（网页模式按其语义映射 `model_type`/`thinking`/`search`）。

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
```

## License

MIT
