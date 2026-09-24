export interface Model {
  id: string
  enabled: boolean
  /** 对外显示名(alias)。客户端用 alias 调用，转发时映射回 id。留空时自动去除 :free//free 后缀。 */
  alias?: string
}

export interface ApiKeyEntry {
  key: string
  enabled: boolean
}

export interface Provider {
  id: string
  name: string
  baseUrl: string
  apiType?: 'openai' | 'anthropic'
  /**
   * 渠道类型: openai | openai-video | agnes-video | azure-tts | antigravity | vertex | devin
   *          | claude | codex | kimi | grok | qwen | codebuddy (OAuth 反代, 复刻 CLIProxyAPI)
   *          | deepseek (官方 API Key / 网页 userToken 反代) | zai (Z.AI 预设, 缺省 openai)
   *
   * codebuddy: 腾讯 CodeBuddy/WorkBuddy 账号反代（凭据为 refresh_token，上游 /v2/chat/completions
   *            强制 stream，非流式由网关本地聚合）。区域由 region 字段显式指定，
   *            留空时回退按 baseUrl 是否含 workbuddy.ai 判定。
   */
  type?: string
  /**
   * CodeBuddy 区域(仅 type=codebuddy 使用)：cn = 国内版(copilot.tencent.com / codebuddy.cn)，
   * global = 国际版(workbuddy.ai)。两套账号体系完全独立，凭据不可混用。
   */
  region?: 'cn' | 'global'
  apiKeys: ApiKeyEntry[]
  models: Model[]
  enabled: boolean
  /** OpenCode 镜像地址列表(后台可配置, 为空时回退 OPENCODE_MIRRORS_URL 环境变量) */
  mirrorUrls?: string[]
  /** GCP 项目 ID(仅 type=antigravity 使用; 一般留空由网关自动解析) */
  project?: string
  /** GCP 区域(仅 type=vertex 使用; 如 us-central1 / global, 留空默认 us-central1) */
  location?: string
  /** Azure TTS 音色配置(仅 type=azure-tts 使用) */
  voice?: string
  rate?: string
  volume?: string
  pitch?: string
  /**
   * DeepSeek 网页版账号(仅 type=deepseek 使用, 可选)。
   *
   * 用途：网关**代登录**换取 userToken，免去用户手动从浏览器抠 token。
   * 密码经 `deepseek-account.ts` 的 AES-GCM 可逆加密后存储(`passwordEnc`)，
   * 密钥由 `ADMIN_PASSWORD` + HKDF 派生 —— 因此**修改管理员密码会使已存密码失效**，
   * 届时需重新填写（网关会失败关闭并提示，不会静默用错密码）。
   *
   * ⚠️ 这是「把账号密码托管给网关」的取舍：方便 vs 托管风险。仅在你信任
   *    自己部署的这套网关时启用。留空则完全走「粘贴 userToken」的老路。
   */
  dsAccount?: {
    /** 邮箱（与 mobile 二选一） */
    email?: string
    /** 手机号（不含区号） */
    mobile?: string
    /** 区号，默认 +86 */
    areaCode?: string
    /** 密码密文（v1.<iv>.<ct>），永不明文存 */
    passwordEnc?: string
    /** 上次代登录成功拿到的 userToken（明文，另有约 24h 有效期） */
    userToken?: string
    /** 上次登录时间(ISO)，成功与失败都记，便于看时间线 */
    lastLoginAt?: string
    /** 上次登录结果简述（成功为 ok / 失败为错误摘要），用于 UI 显示 */
    lastLoginResult?: string
    /** 上次设备校验是否发生令牌轮换 */
    lastRotated?: boolean
    /**
     * 以下三个字段**仅存在于返回给前端的脱敏视图**（后端 redactProvider 注入），
     * 存储层不写这三个字段。类型上并列声明以便前端读取。
     */
    hasPassword?: boolean
    tokenSet?: boolean
    tokenPreview?: string
  }
  createdAt: string
  updatedAt: string
}

export interface ProxyKey {
  id: string
  key: string
  name: string
  enabled: boolean
  createdAt: string
  expiresAt?: string | null
}

export interface Session {
  username: string
  expiresAt: number
}

/** 单次请求的用量记录 */
export interface UsageRecord {
  /** ISO 时间戳 */
  ts: string
  /** 提供商 ID */
  provider: string
  /** 模型名（含提供商前缀，如 opencode/deepseek-v4-flash-free） */
  model: string
  /** 使用的转发 Key（前 8 位 + ***） */
  token: string
  /** 是否成功 */
  ok: boolean
  /** 响应状态码 */
  status: number
  /** 输入 tokens */
  promptTokens: number
  /** 输出 tokens */
  completionTokens: number
  /** 耗时毫秒 */
  latencyMs: number
}

/** 用量聚合结果（管理后台展示用） */
export interface UsageSummary {
  /** 时间范围天数 */
  days: number
  /** 总请求数 */
  totalRequests: number
  /** 成功请求数 */
  successRequests: number
  /** 总输入 tokens */
  totalPromptTokens: number
  /** 总输出 tokens */
  totalCompletionTokens: number
  /** 平均耗时 ms */
  avgLatencyMs: number
  /** 按模型聚合（降序） */
  byModel: Array<{ model: string; requests: number; promptTokens: number; completionTokens: number }>
  /** 按提供商聚合 */
  byProvider: Array<{ provider: string; requests: number; promptTokens: number; completionTokens: number }>
  /** 每日趋势（升序） */
  daily: Array<{ date: string; requests: number; promptTokens: number; completionTokens: number }>
}

export interface ProxyRequestBody {
  model?: string
  messages?: Array<{ role: string; content: string }>
  [key: string]: unknown
}

export interface TestModelRequest {
  modelId: string
}

export interface CreateProviderRequest {
  id: string
  name: string
  baseUrl: string
  apiType?: 'openai' | 'anthropic'
  type?: string
  /** CodeBuddy 区域(仅 type=codebuddy 使用)：cn 国内版 / global 国际版 */
  region?: 'cn' | 'global'
  apiKeys?: Array<{ key: string; enabled: boolean }>
  models?: Array<{ id: string; enabled: boolean }> | string[]
  mirrorUrls?: string[] | string
  project?: string
  location?: string
  voice?: string
  rate?: string
  volume?: string
  pitch?: string
  enabled?: boolean
}

export interface UpdateProviderRequest {
  name?: string
  baseUrl?: string
  apiType?: 'openai' | 'anthropic'
  type?: string
  /** CodeBuddy 区域(仅 type=codebuddy 使用)：cn 国内版 / global 国际版 */
  region?: 'cn' | 'global'
  apiKeys?: Array<{ key: string; enabled: boolean }>
  models?: Array<{ id: string; enabled: boolean }> | string[]
  mirrorUrls?: string[] | string
  project?: string
  location?: string
  voice?: string
  rate?: string
  volume?: string
  pitch?: string
  enabled?: boolean
  /** 修改渠道 ID 时的新 ID */
  newId?: string
}

export interface CreateProxyKeyRequest {
  name?: string
  expiresIn?: string // '30d' | '90d' | '180d' | '1y' | 'forever'
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  message?: string
}

export interface Env {
  DB?: D1Database
  PG?: any
  ai_gateway_backup?: R2Bucket
  ADMIN_USERNAME?: string
  ADMIN_PASSWORD?: string
  OPENCODE_MIRRORS_URL?: string
  /** Antigravity OAuth 客户端凭据, 经 Worker 密钥下发(wrangler secret put), 不入库 */
  AG_CLIENT_ID?: string
  AG_CLIENT_SECRET?: string
}

/** 备份数据: D1 全量导出(kv_store 配置 + usage_records 用量) */
export interface BackupData {
  version: 1
  exportedAt: string
  kv: Array<{ key: string; value: string }>
  usage: Array<{
    ts: string
    provider: string
    model: string
    token: string
    ok: number
    status: number
    prompt_tokens: number
    completion_tokens: number
    latency_ms: number
  }>
}
