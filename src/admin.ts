import { Context } from 'hono'
import {
  getProviders,
  getProvider,
  addProvider,
  updateProvider,
  deleteProvider,
  getProxyKeys,
  addProxyKey,
  updateProxyKey,
  deleteProxyKey,
  getUsageSummary,
  getAdminCredentials,
} from './storage'
import { testModelConnectionRotating } from './proxy'
import { testAntigravity, testAntigravityRotating, buildAntigravityAuthUrl, exchangeAntigravityCode, fetchAntigravityModels, fetchAntigravityQuota } from './antigravity'
import {
  buildClaudeAuthUrl, exchangeClaudeCode, testClaude, fetchClaudeModels,
} from './claude'
import {
  buildCodexAuthUrl, exchangeCodexCode, testCodex,
} from './codex'
import {
  startKimiDeviceFlow, pollKimiDeviceFlow, testKimi, fetchKimiModels,
} from './kimi'
import {
  startGrokDeviceFlow, pollGrokDeviceFlow, testGrok,
} from './grok'
import {
  startQwenDeviceFlow, pollQwenDeviceFlow, testQwen, fetchQwenModels,
} from './qwen'
import {
  testDeepSeek, fetchDeepSeekModels,
} from './deepseek'
import { fetchZaiModels } from './zai'
import { fetchOpenCodeModels, isOpenCodeProvider, resolveOpenCodeUrls, resolveProviderMirrorUrls, testOpenCodeModel } from './opencode'
import { PROXY_KEY_PREFIX, EXPIRY_OPTIONS, OPENCODE_DEFAULT_URL } from './config'
import type {
  Env,
  ApiResponse,
  Provider,
  Model,
  CreateProviderRequest,
  UpdateProviderRequest,
  CreateProxyKeyRequest,
  TestModelRequest,
} from './types'

// ===== 系统状态 =====

/**
 * 将 string[] 或正规对象数组统一转换为正规对象数组
 * 例: ["k1","k2"] → [{key:"k1",enabled:true},{key:"k2",enabled:true}]
 */
function normalizeArray<T>(
  items: unknown,
  mapFn: (val: string) => T
): T[] {
  if (!Array.isArray(items)) return []
  if (items.length === 0 || typeof items[0] === 'string') {
    return (items as string[]).map(mapFn)
  }
  return items as T[]
}

/** 规范化 mirrorUrls: 接受数组或换行/逗号分隔字符串, 去空去重 */
function normalizeMirrorUrls(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  const parts = Array.isArray(value)
    ? value as string[]
    : String(value).split('\n').flatMap(s => s.split(',')).map(s => s.trim())
  const cleaned = [...new Set(parts.map(s => String(s).trim()).filter(Boolean))]
  return cleaned.length > 0 ? cleaned : undefined
}

/** 从模型真实 id 生成对外 alias：去掉 :free、/free 或 -free 后缀 */
export function defaultModelAlias(id: string): string {
  return id
    .replace(/:(free)$/i, '')
    .replace(/\/(free)$/i, '')
    .replace(/-(free)$/i, '')
}

/**
 * 规范化模型列表。接受 string[] 或 {id, alias?, enabled?}[]。
 * alias 未提供时自动生成（去掉 :free//free 后缀）。
 */
function normalizeModels(value: unknown): Model[] {
  if (!Array.isArray(value)) return []
  if (value.length === 0) return []
  if (typeof value[0] === 'string') {
    return (value as string[]).map((id) => ({ id, enabled: true, alias: defaultModelAlias(id) }))
  }
  return (value as Array<{ id?: string; alias?: string; enabled?: boolean }>)
    .filter((m) => m && m.id)
    .map((m) => ({
      id: m.id!,
      enabled: m.enabled !== undefined ? m.enabled : true,
      alias: m.alias !== undefined && m.alias !== '' ? m.alias : defaultModelAlias(m.id!),
    }))
}

export async function handleStatus(c: Context<{ Bindings: Env }>) {
  const providers = await getProviders(c.env)
  const proxyKeys = await getProxyKeys(c.env)

  const totalModels = providers.reduce((sum, p) => sum + p.models.length, 0)
  const enabledModels = providers.reduce(
    (sum, p) => sum + p.models.filter((m) => m.enabled).length,
    0
  )

  return c.json<ApiResponse>({
    success: true,
    data: {
      providersCount: providers.length,
      enabledProvidersCount: providers.filter((p) => p.enabled).length,
      modelsCount: totalModels,
      enabledModelsCount: enabledModels,
      proxyKeysCount: proxyKeys.filter((k) => k.enabled).length,
      adminConfigured: !!(c.env.ADMIN_USERNAME && c.env.ADMIN_PASSWORD) || (await getAdminCredentials(c.env)) !== null,
      baseUrl: new URL(c.req.url).origin,
    },
  })
}

// ===== 渠道 CRUD =====

export async function handleGetProviders(c: Context<{ Bindings: Env }>) {
  const providers = await getProviders(c.env)
  return c.json<ApiResponse<Provider[]>>({ success: true, data: providers })
}

export async function handleCreateProvider(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<CreateProviderRequest>()
  // opencode 未传地址时自动填充
  if (body.id === 'opencode' && !body.baseUrl) {
    body.baseUrl = OPENCODE_DEFAULT_URL
  }

  if (!body.id || !body.name || !body.baseUrl) {
    return c.json<ApiResponse>({ success: false, message: 'id、name、baseUrl 为必填项' }, 400)
  }

  const providers = await getProviders(c.env)
  if (providers.some((p) => p.id === body.id)) {
    return c.json<ApiResponse>({ success: false, message: `渠道 id "${body.id}" 已存在` }, 409)
  }

  const now = new Date().toISOString()
  const provider: Provider = {
    id: body.id,
    name: body.name,
    baseUrl: body.baseUrl.replace(/\/$/, ''),
    apiType: body.apiType || 'openai',
    type: body.type || 'openai',
apiKeys: normalizeArray(body.apiKeys, (k) => ({ key: k, enabled: true })),
    models: body.models
      ? normalizeModels(body.models)
      : [],
    mirrorUrls: normalizeMirrorUrls(body.mirrorUrls),
    project: body.project,
    location: body.location,
    voice: body.voice,
    rate: body.rate,
    volume: body.volume,
    pitch: body.pitch,
    enabled: body.enabled !== undefined ? body.enabled : true,
    createdAt: now,
    updatedAt: now,
  }

  await addProvider(c.env, provider)
  return c.json<ApiResponse<Provider>>({ success: true, data: provider }, 201)
}

export async function handleUpdateProvider(c: Context<{ Bindings: Env }>) {
  const id = c.req.param('id')
  if (!id) return c.json<ApiResponse>({ success: false, message: '缺少 id 参数' }, 400)
  const body = await c.req.json<UpdateProviderRequest>()

  const updates: Partial<Provider> = {}
  if (body.name !== undefined) updates.name = body.name
  if (body.baseUrl !== undefined) updates.baseUrl = body.baseUrl.replace(/\/$/, '')
  if (body.apiType !== undefined) updates.apiType = body.apiType
  if (body.type !== undefined) updates.type = body.type
  if (body.voice !== undefined) updates.voice = body.voice
  if (body.rate !== undefined) updates.rate = body.rate
  if (body.volume !== undefined) updates.volume = body.volume
  if (body.pitch !== undefined) updates.pitch = body.pitch
  if (body.mirrorUrls !== undefined) updates.mirrorUrls = normalizeMirrorUrls(body.mirrorUrls)
  if (body.project !== undefined) updates.project = body.project
  if (body.location !== undefined) updates.location = body.location
if (body.apiKeys !== undefined) {
    updates.apiKeys = normalizeArray(body.apiKeys, (k) => ({ key: k, enabled: true }))
  }
  if (body.enabled !== undefined) updates.enabled = body.enabled
  if (body.models !== undefined) {
    updates.models = normalizeModels(body.models)
  }

  const updated = await updateProvider(c.env, id, updates)
  if (!updated) {
    return c.json<ApiResponse>({ success: false, message: '渠道不存在' }, 404)
  }

  // 支持重命名渠道 ID: 删除旧 ID, 用新 ID 重建(保留完整配置)
  if (body.newId && body.newId !== id) {
    if (!/^[a-zA-Z0-9_-]+$/.test(body.newId)) {
      return c.json<ApiResponse>({ success: false, message: 'ID 只能包含字母/数字/下划线/连字符' }, 400)
    }
    const existing = await getProvider(c.env, body.newId)
    if (existing) {
      return c.json<ApiResponse>({ success: false, message: `渠道 ID "${body.newId}" 已存在` }, 400)
    }
    const renamed = { ...updated, id: body.newId, updatedAt: new Date().toISOString() }
    await deleteProvider(c.env, id)
    await addProvider(c.env, renamed)
    return c.json<ApiResponse<Provider>>({ success: true, data: renamed, message: '渠道 ID 已更新' })
  }

  return c.json<ApiResponse<Provider>>({ success: true, data: updated })
}

export async function handleDeleteProvider(c: Context<{ Bindings: Env }>) {
  const id = c.req.param('id')
  if (!id) return c.json<ApiResponse>({ success: false, message: '缺少 id 参数' }, 400)
  const deleted = await deleteProvider(c.env, id)
  if (!deleted) {
    return c.json<ApiResponse>({ success: false, message: '渠道不存在' }, 404)
  }
  return c.json<ApiResponse>({ success: true, message: '渠道已删除' })
}

export async function handleTestModel(c: Context<{ Bindings: Env }>) {
  const id = c.req.param('id')
  if (!id) return c.json<ApiResponse>({ success: false, message: '缺少 id 参数' }, 400)
  const { modelId } = await c.req.json<TestModelRequest>()

  if (!modelId) {
    return c.json<ApiResponse>({ success: false, message: 'modelId 为必填项' }, 400)
  }

  const provider = await getProvider(c.env, id)
  if (!provider) {
    return c.json<ApiResponse>({ success: false, message: '渠道不存在' }, 404)
  }

  const modelConfig = provider.models.find((m) => m.id === modelId)
  if (!modelConfig) {
    return c.json<ApiResponse>({ success: false, message: `模型 "${modelId}" 不存在于渠道 "${provider.name}"` }, 404)
  }

  const enabledKeys = provider.apiKeys.filter(k => k.enabled)
  // 多 key 轮询测试：逐个 key 尝试，遇 429/401/403/5xx 自动切换下一个 key，避免误报限流
  const ptype = provider.type || 'openai'
  const result = isOpenCodeProvider(provider.id)
    ? await testOpenCodeModel(provider.baseUrl, enabledKeys, modelId, resolveProviderMirrorUrls(c.env, provider))
    : ptype === 'antigravity'
      ? await testAntigravityRotating(c.env, enabledKeys.map(k => k.key), modelId, provider.project)
      : ['claude', 'codex', 'kimi', 'grok', 'qwen', 'deepseek'].includes(ptype)
        ? await testOAuthProviderRotating(c.env, ptype, enabledKeys.map(k => k.key), modelId, provider.baseUrl)
        : await testModelConnectionRotating(provider.baseUrl, enabledKeys.map(k => k.key), modelId, provider.apiType)

  return c.json<ApiResponse>({
    success: true,
    data: result,
  })
}

// ===== Key / 模型连通性测试（通过服务端代理，避免 CORS） =====

function buildAuthHeaders(apiKey: string, apiType?: string): Record<string, string> {
  if (apiType === 'anthropic') {
    const h: Record<string, string> = { 'anthropic-version': '2023-06-01' }
    if (apiKey) h['x-api-key'] = apiKey
    return h
  }
  if (!apiKey) return {}
  return { 'Authorization': `Bearer ${apiKey}` }
}

export async function handleTestKeyNew(c: Context<{ Bindings: Env }>) {
  const { url, apiKey, apiType, providerType, providerId, mirrorUrls, freeOnly, model, project } = await c.req.json<{
    url: string
    apiKey: string
    apiType?: string
    providerType?: string
    providerId?: string
    mirrorUrls?: string[] | string
    freeOnly?: boolean
    model?: string
    project?: string
  }>()

  // antigravity: apiKey 即 refresh_token
  if (providerType === 'antigravity') {
    const r = await testAntigravity(c.env, apiKey, model || 'gemini-3.5-flash', project)
    return c.json<ApiResponse>({
      success: true,
      data: { success: r.success, statusCode: r.statusCode || 0, message: r.message },
    })
  }

  // OAuth 反代渠道: apiKey 即 refresh_token
  if (providerType && ['claude', 'codex', 'kimi', 'grok', 'qwen', 'deepseek'].includes(providerType)) {
    const r = await testOAuthProvider(c.env, providerType, apiKey, model || OAUTH_DEFAULT_MODELS[providerType], url)
    return c.json<ApiResponse>({
      success: true,
      data: { success: r.success, statusCode: r.statusCode || 0, message: r.message },
    })
  }

  // Z.AI: 上游 /models 需有效 Key，这里回内置清单（供「获取模型」按钮使用）
  if (providerType === 'zai') {
    const models = fetchZaiModels().models
    const list = (freeOnly ? models.filter((m) => /flash|air/i.test(m)) : models).map((id) => ({ id }))
    return c.json<ApiResponse>({
      success: true,
      data: { success: true, statusCode: 200, data: { object: 'list', data: list } },
    })
  }

  if (!url) {
    return c.json<ApiResponse>({ success: false, message: 'url 为必填项' }, 400)
  }

  if (providerId && isOpenCodeProvider(providerId)) {
    // 没填 key 时检查是否配了镜像，避免迷惑性报错
    if (!apiKey) {
      const mirrors = normalizeMirrorUrls(mirrorUrls) ?? resolveOpenCodeUrls(c.env)
      if (mirrors.length === 0) {
        return c.json<ApiResponse>({
          success: true,
          data: { success: false, statusCode: 0, message: '请先填写 API Key 或配置镜像地址' },
        })
      }
    }
    const result = await fetchOpenCodeModels(url, [{ key: apiKey, enabled: true }], normalizeMirrorUrls(mirrorUrls) ?? resolveOpenCodeUrls(c.env))
    return c.json<ApiResponse>({
      success: true,
      data: {
        success: result.success,
        statusCode: result.statusCode || 0,
        message: result.message,
        data: freeOnly ? filterFreeModels(result.data) : result.data,
      },
    })
  }

  const cleanBase = url.replace(/\/$/, '')
  try {
    const response = await fetch(`${cleanBase}/models`, {
      method: 'GET', headers: buildAuthHeaders(apiKey, apiType), signal: AbortSignal.timeout(15000),
    })

    let data: unknown = null
    if (response.ok) {
      try { data = await response.json() } catch { /* ignore */ }
    }

    return c.json<ApiResponse>({
      success: true,
      data: { success: response.ok, statusCode: response.status, data: freeOnly ? filterFreeModels(data) : data },
    })
  } catch (err) {
    return c.json<ApiResponse>({
      success: true,
      data: { success: false, statusCode: 0, message: (err as Error).message || '连接失败' },
    })
  }
}

/**
 * 从 /models 响应中过滤出免费模型。
 * 兼容 OpenAI 兼容格式（data: [{ id, ... }]）与 OpenRouter/kilo 格式（pricing.prompt === '0' 或 id 含 :free / /free）。
 */
function filterFreeModels(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data
  const arr = (data as { data?: unknown }).data
  if (!Array.isArray(arr)) return data

  const isFree = (m: Record<string, unknown>): boolean => {
    const id = String(m.id || '').toLowerCase()
    // 命名约定: openrouter 风格 :free 后缀, kilo 风格 /free 后缀或 id 含 free
    if (id.endsWith(':free') || id.endsWith('/free') || id.includes('free')) return true
    // pricing 约定: prompt === 0
    const pricing = m.pricing as Record<string, unknown> | undefined
    if (pricing) {
      const prompt = pricing.prompt
      if (prompt === 0 || prompt === '0' || prompt === '0.000000000000' || Number(prompt) === 0) return true
    }
    return false
  }

  return { ...data, data: arr.filter((m) => m && typeof m === 'object' && isFree(m as Record<string, unknown>)) }
}

export async function handleTestModelNew(c: Context<{ Bindings: Env }>) {
  const { url, apiKey, apiType, providerType, model, providerId, mirrorUrls, project } = await c.req.json<{
    url: string
    apiKey: string
    apiType?: string
    providerType?: string
    model: string
    providerId?: string
    mirrorUrls?: string[] | string
    project?: string
  }>()

  // antigravity: apiKey 即 refresh_token
  if (providerType === 'antigravity') {
    const r = await testAntigravity(c.env, apiKey, model, project)
    return c.json<ApiResponse>({
      success: true,
      data: { success: r.success, statusCode: r.statusCode || 0, message: r.message },
    })
  }

  // OAuth 反代渠道: apiKey 即 refresh_token
  if (providerType && ['claude', 'codex', 'kimi', 'grok', 'qwen', 'deepseek'].includes(providerType)) {
    const r = await testOAuthProvider(c.env, providerType, apiKey, model, url)
    return c.json<ApiResponse>({
      success: true,
      data: { success: r.success, statusCode: r.statusCode || 0, message: r.message },
    })
  }

  if (!url || !model) {
    return c.json<ApiResponse>({ success: false, message: 'url、model 为必填项' }, 400)
  }

  if (providerId && isOpenCodeProvider(providerId)) {
    const apiKeys = apiKey ? [{ key: apiKey, enabled: true }] : []
    const result = await testOpenCodeModel(url, apiKeys, model, normalizeMirrorUrls(mirrorUrls) ?? resolveOpenCodeUrls(c.env))
    return c.json<ApiResponse>({
      success: true,
      data: { success: result.success, statusCode: result.statusCode || 0, message: result.message },
    })
  }

  const cleanBase = url.replace(/\/$/, '')
  const endpoint = apiType === 'anthropic' ? 'messages' : 'chat/completions'

  try {
    const response = await fetch(`${cleanBase}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...buildAuthHeaders(apiKey, apiType) },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
      signal: AbortSignal.timeout(15000),
    })

    return c.json<ApiResponse>({
      success: true,
      data: { success: response.ok, statusCode: response.status },
    })
  } catch (err) {
    return c.json<ApiResponse>({
      success: true,
      data: { success: false, statusCode: 0, message: (err as Error).message || '连接失败' },
    })
  }
}

// ===== Antigravity 内置 OAuth 授权 + 可用模型 =====

export async function handleAntigravityOAuthStart(c: Context<{ Bindings: Env }>) {
  try {
    const { url, state } = await buildAntigravityAuthUrl(c.env)
    return c.json<ApiResponse<{ url: string; state: string }>>({ success: true, data: { url, state } })
  } catch (err) {
    return c.json<ApiResponse>({ success: false, message: (err as Error).message || '生成授权链接失败' }, 500)
  }
}

export async function handleAntigravityOAuthComplete(c: Context<{ Bindings: Env }>) {
  const { code, state } = await c.req.json<{ code?: string; state?: string }>()
  if (!code || !state) {
    return c.json<ApiResponse>({ success: false, message: 'code、state 为必填项' }, 400)
  }
  try {
    const { refreshToken } = await exchangeAntigravityCode(c.env, code, state)
    return c.json<ApiResponse<{ refresh_token: string }>>({ success: true, data: { refresh_token: refreshToken } })
  } catch (err) {
    return c.json<ApiResponse>({ success: false, message: (err as Error).message || '换取 token 失败' }, 400)
  }
}

/** 拉取 Antigravity 可用模型列表（用于回填模型配置） */
export async function handleAntigravityModels(c: Context<{ Bindings: Env }>) {
  const { apiKey } = await c.req.json<{ apiKey?: string }>()
  if (!apiKey) {
    return c.json<ApiResponse>({ success: false, message: '请先填写 refresh_token' }, 400)
  }
  const r = await fetchAntigravityModels(c.env, apiKey)
  return c.json<ApiResponse<{ models: string[]; message?: string; raw?: unknown }>>({
    success: r.success,
    data: { models: r.models, message: r.message, raw: r.raw },
    message: r.message,
  })
}

/** 返回 Antigravity 渠道/账号清单（不调用 Google，供「刷新账号」用） */
export async function handleAntigravityAccounts(c: Context<{ Bindings: Env }>) {
  const providers = await getProviders(c.env)
  const channels = providers
    .filter((p) => (p.type || '') === 'antigravity' && p.enabled)
    .map((p) => ({
      id: p.id,
      name: p.name,
      accountCount: p.apiKeys.filter((k) => k.enabled && k.key && k.key.trim()).length,
    }))
  return c.json<ApiResponse<{ channels: unknown[] }>>({ success: true, data: { channels } })
}

/** 查询 Antigravity 额度（侧边栏「额度」用，凭据在服务端读取）
 *  - 空 body：返回所有已启用渠道的全部账号
 *  - { channelId, index }：只返回该渠道指定账号（账号级「查询」按钮用）
 */
export async function handleAntigravityQuotaAll(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<{ channelId?: string; index?: number }>().catch(() => ({} as { channelId?: string; index?: number }))
  const providers = await getProviders(c.env)
  const ags = providers.filter((p) => (p.type || '') === 'antigravity' && p.enabled)

  // 单账号查询
  if (body.channelId) {
    const p = ags.find((x) => x.id === body.channelId)
    if (!p) return c.json<ApiResponse>({ success: false, message: `渠道 "${body.channelId}" 不存在` }, 404)
    const keys = p.apiKeys.filter((k) => k.enabled).map((k) => k.key).filter((k) => k && k.trim())
    const idx = Math.max(0, Number(body.index) || 0)
    if (!keys[idx]) return c.json<ApiResponse>({ success: false, message: `该渠道第 ${idx + 1} 个账号不存在` }, 404)
    const accounts = await fetchAntigravityQuota(c.env, [keys[idx]], p.project)
    if (accounts[0]) accounts[0].index = idx
    return c.json<ApiResponse<{ accounts: unknown[] }>>({ success: true, data: { accounts } })
  }

  // 全部渠道
  const channels: Array<{ id: string; name: string; accounts: unknown[] }> = []
  for (const p of ags) {
    const keys = p.apiKeys.filter((k) => k.enabled).map((k) => k.key).filter((k) => k && k.trim())
    if (keys.length === 0) {
      channels.push({ id: p.id, name: p.name, accounts: [] })
      continue
    }
    const accounts = await fetchAntigravityQuota(c.env, keys, p.project)
    channels.push({ id: p.id, name: p.name, accounts })
  }
  return c.json<ApiResponse<{ channels: unknown[] }>>({ success: true, data: { channels } })
}

// ===== OAuth 反代渠道内置授权（claude / codex / kimi / grok） =====

const OAUTH_PROVIDERS = new Set(['claude', 'codex', 'kimi', 'grok', 'qwen'])
// 无 OAuth 流程、凭据需从浏览器复制的渠道类型（deepseek 网页版 userToken）
const MANUAL_TOKEN_PROVIDERS = new Set(['deepseek'])

/** 测试用默认模型（新增渠道尚未填写模型时） */
const OAUTH_DEFAULT_MODELS: Record<string, string> = {
  claude: 'claude-sonnet-4-5-20250929',
  codex: 'gpt-5.5',
  kimi: 'kimi-for-coding',
  grok: 'grok-4.6',
  qwen: 'coder-model',
  deepseek: 'deepseek-v4-flash',
}

interface OAuthPollResult {
  status: 'pending' | 'ok' | 'error'
  message?: string
  refreshToken?: string
}

/** 发起授权：claude/codex 返回授权链接；kimi/grok/qwen 返回设备码信息 */
export async function handleOAuthStart(c: Context<{ Bindings: Env }>) {
  const provider = c.req.param('provider') || ''
  const body = await c.req.json<{ baseUrl?: string }>().catch(() => ({} as { baseUrl?: string }))
  if (!OAUTH_PROVIDERS.has(provider)) {
    return c.json<ApiResponse>({ success: false, message: `不支持的 OAuth 渠道类型: ${provider}` }, 400)
  }
  try {
    if (provider === 'claude') {
      const { url, state } = await buildClaudeAuthUrl(c.env)
      return c.json<ApiResponse<{ mode: 'redirect'; url: string; state: string }>>({ success: true, data: { mode: 'redirect', url, state } })
    }
    if (provider === 'codex') {
      const { url, state } = await buildCodexAuthUrl(c.env)
      return c.json<ApiResponse<{ mode: 'redirect'; url: string; state: string }>>({ success: true, data: { mode: 'redirect', url, state } })
    }
    const flow = provider === 'kimi'
      ? await startKimiDeviceFlow(c.env, body.baseUrl)
      : provider === 'qwen'
        ? await startQwenDeviceFlow(c.env)
        : await startGrokDeviceFlow(c.env)
    return c.json<ApiResponse<{ mode: 'device'; state: string; verification_uri: string; verification_uri_complete?: string; user_code: string; interval: number }>>({
      success: true,
      data: { mode: 'device', state: flow.state, verification_uri: flow.verificationUri, verification_uri_complete: flow.verificationUriComplete, user_code: flow.userCode, interval: flow.interval },
    })
  } catch (err) {
    return c.json<ApiResponse>({ success: false, message: (err as Error).message || '发起授权失败' }, 500)
  }
}

/** 完成授权（claude/codex：code + state 换 refresh_token） */
export async function handleOAuthComplete(c: Context<{ Bindings: Env }>) {
  const provider = c.req.param('provider') || ''
  const { code, state } = await c.req.json<{ code?: string; state?: string }>()
  if (!code || !state) {
    return c.json<ApiResponse>({ success: false, message: 'code、state 为必填项' }, 400)
  }
  try {
    if (provider === 'claude') {
      const { refreshToken } = await exchangeClaudeCode(c.env, code, state)
      return c.json<ApiResponse<{ refresh_token: string }>>({ success: true, data: { refresh_token: refreshToken } })
    }
    if (provider === 'codex') {
      const { refreshToken } = await exchangeCodexCode(c.env, code, state)
      return c.json<ApiResponse<{ refresh_token: string }>>({ success: true, data: { refresh_token: refreshToken } })
    }
    return c.json<ApiResponse>({ success: false, message: `${provider} 渠道使用设备码授权，请用轮询接口` }, 400)
  } catch (err) {
    return c.json<ApiResponse>({ success: false, message: (err as Error).message || '换取 token 失败' }, 400)
  }
}

/** 设备码授权轮询（kimi/grok）：pending / ok(refresh_token) / error */
export async function handleOAuthPoll(c: Context<{ Bindings: Env }>) {
  const provider = c.req.param('provider') || ''
  const { state } = await c.req.json<{ state?: string }>()
  if (!state) {
    return c.json<ApiResponse>({ success: false, message: 'state 为必填项' }, 400)
  }
  try {
    const r = provider === 'kimi'
      ? await pollKimiDeviceFlow(c.env, state)
      : provider === 'qwen'
        ? await pollQwenDeviceFlow(c.env, state)
        : provider === 'grok'
          ? await pollGrokDeviceFlow(c.env, state)
          : null
    if (!r) {
      return c.json<ApiResponse>({ success: false, message: `${provider} 渠道使用授权链接，请用 complete 接口` }, 400)
    }
    // 前端按 refresh_token 读取(claude/codex 的 complete 接口也是这个命名), 这里两种都给出, 避免字段名不一致导致静默不收尾
    const data = { ...r, refresh_token: r.refreshToken } as OAuthPollResult & { refresh_token?: string }
    return c.json<ApiResponse<OAuthPollResult>>({ success: true, data })
  } catch (err) {
    return c.json<ApiResponse>({ success: false, message: (err as Error).message || '轮询失败' }, 500)
  }
}


/** 拉取可用模型（claude / kimi，凭据为 refresh_token） */
export async function handleOAuthModels(c: Context<{ Bindings: Env }>) {
  const provider = c.req.param('provider') || ''
  const { apiKey, baseUrl } = await c.req.json<{ apiKey?: string; baseUrl?: string }>()
  if (!apiKey) {
    return c.json<ApiResponse>({ success: false, message: '请先填写 refresh_token' }, 400)
  }
  if (provider === 'claude') {
    const r = await fetchClaudeModels(c.env, apiKey)
    return c.json<ApiResponse<{ models: string[]; message?: string }>>({ success: r.success, data: { models: r.models, message: r.message }, message: r.message })
  }
  if (provider === 'kimi') {
    const r = await fetchKimiModels(c.env, apiKey, baseUrl)
    return c.json<ApiResponse<{ models: string[]; message?: string }>>({ success: r.success, data: { models: r.models, message: r.message }, message: r.message })
  }
  if (provider === 'qwen') {
    // 上游无 /v1/models，返回本地维护清单
    const r = fetchQwenModels()
    return c.json<ApiResponse<{ models: string[] }>>({ success: true, data: { models: r.models } })
  }
  if (provider === 'deepseek') {
    const r = fetchDeepSeekModels()
    return c.json<ApiResponse<{ models: string[] }>>({ success: true, data: { models: r.models } })
  }
  return c.json<ApiResponse>({ success: false, message: `${provider} 渠道请手动填写模型列表` }, 400)
}

/** 单凭据连通性测试分发（OAuth 渠道） */
async function testOAuthProvider(
  env: Env,
  provider: string,
  refreshToken: string,
  modelId: string,
  baseUrl?: string,
): Promise<{ success: boolean; message: string; statusCode?: number }> {
  if (provider === 'claude') return testClaude(env, refreshToken, modelId)
  if (provider === 'codex') return testCodex(env, refreshToken, modelId)
  if (provider === 'kimi') return testKimi(env, refreshToken, modelId, baseUrl)
  if (provider === 'grok') return testGrok(env, refreshToken, modelId)
  if (provider === 'qwen') return testQwen(env, refreshToken, modelId)
  if (provider === 'deepseek') return testDeepSeek(env, refreshToken, modelId)
  return { success: false, message: `未知 OAuth 渠道类型: ${provider}` }
}

/** 多凭据轮换测试（OAuth 渠道），与 testModelConnectionRotating 语义一致 */
async function testOAuthProviderRotating(
  env: Env,
  provider: string,
  refreshTokens: string[],
  modelId: string,
  baseUrl?: string,
): Promise<{ success: boolean; message: string; statusCode?: number }> {
  const list = (refreshTokens || []).filter((t) => t && t.trim())
  if (list.length === 0) return { success: false, message: '该渠道未配置任何 refresh_token', statusCode: 0 }
  let last: { success: boolean; message: string; statusCode?: number } = { success: false, message: '连接失败', statusCode: 0 }
  for (let i = 0; i < list.length; i++) {
    const r = await testOAuthProvider(env, provider, list[i].trim(), modelId, baseUrl)
    if (r.success) {
      return { ...r, message: list.length > 1 ? `${r.message} (账号 #${i + 1}/${list.length})` : r.message }
    }
    last = r
    const st = r.statusCode || 0
    if (st === 429 || st === 401 || st === 403 || st >= 500) continue
    break
  }
  return last
}

// ===== 令牌管理 =====

export async function handleGetProxyKeys(c: Context<{ Bindings: Env }>) {
  const keys = await getProxyKeys(c.env)
  const maskedKeys = keys.map((k) => ({
    ...k,
    key: k.key.length > 12
      ? k.key.substring(0, 8) + '****' + k.key.substring(k.key.length - 4)
      : k.key,
  }))
  return c.json<ApiResponse>({ success: true, data: maskedKeys })
}

export async function handleCreateProxyKey(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<CreateProxyKeyRequest>()
  const id = crypto.randomUUID()
  const randomPart = crypto.randomUUID().replace(/-/g, '')
  const key = `${PROXY_KEY_PREFIX}${randomPart}`

  // 计算过期时间
  let expiresAt: string | null = null
  if (body.expiresIn && body.expiresIn !== 'forever') {
    const ttl = EXPIRY_OPTIONS[body.expiresIn]
    if (ttl) {
      expiresAt = new Date(Date.now() + ttl * 1000).toISOString()
    }
  }

  const proxyKey = {
    id,
    key,
    name: body.name || `Key-${new Date().toLocaleDateString()}`,
    enabled: true,
    createdAt: new Date().toISOString(),
    expiresAt,
  }

  await addProxyKey(c.env, proxyKey)
  return c.json<ApiResponse>({
    success: true,
    data: proxyKey,
    message: '请立即保存此 Key，关闭后将不再显示',
  }, 201)
}

export async function handleDeleteProxyKey(c: Context<{ Bindings: Env }>) {
  const id = c.req.param('id')
  if (!id) return c.json<ApiResponse>({ success: false, message: '缺少 id 参数' }, 400)
  const deleted = await deleteProxyKey(c.env, id)
  if (!deleted) {
    return c.json<ApiResponse>({ success: false, message: '令牌不存在' }, 404)
  }
  return c.json<ApiResponse>({ success: true, message: '令牌已删除' })
}

export async function handleUpdateProxyKey(c: Context<{ Bindings: Env }>) {
  const id = c.req.param('id')
  if (!id) return c.json<ApiResponse>({ success: false, message: '缺少 id 参数' }, 400)
  const body = await c.req.json<{ enabled?: boolean; regenerate?: boolean }>()
  const updates: Partial<import('./types').ProxyKey> = {}
  if (body.enabled !== undefined) updates.enabled = body.enabled
  // 重新生成: 生成新的 key 值(旧 key 立即失效)
  if (body.regenerate) {
    const randomPart = crypto.randomUUID().replace(/-/g, '')
    updates.key = `${PROXY_KEY_PREFIX}${randomPart}`
    updates.createdAt = new Date().toISOString()
  }
  const updated = await updateProxyKey(c.env, id, updates)
  if (!updated) {
    return c.json<ApiResponse>({ success: false, message: '令牌不存在' }, 404)
  }
  return c.json<ApiResponse>({ success: true, data: updated })
}

// ===== Token 用量统计 =====

export async function handleTtsPreview(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<{ provider?: string; voice?: string; text?: string }>().catch(() => ({} as { provider?: string; voice?: string; text?: string }))
  const providerId = body.provider || 'tts'
  const provider = await getProvider(c.env, providerId)
  if (!provider) return c.json<ApiResponse>({ success: false, message: `渠道 "${providerId}" 不存在` }, 404)
  if ((provider.type || 'openai') !== 'azure-tts') {
    return c.json<ApiResponse>({ success: false, message: `渠道 "${providerId}" 不是 azure-tts 类型` }, 400)
  }
  const { synthesizeAzureTts } = await import('./azure-tts')
  const voice = body.voice || provider.voice || 'zh-CN-XiaoxiaoNeural'
  // 试听文本按音色语言自动匹配, 避免中文音色念英文
  const previewText = (v: string): string => {
    if (v.startsWith('zh-')) return '你好,这是语音试听,欢迎使用。'
    if (v.startsWith('ja-')) return 'こんにちは、これは音声プレビューです。'
    if (v.startsWith('ko-')) return '안녕하세요, 음성 미리보기입니다.'
    if (v.startsWith('fr-')) return 'Bonjour, ceci est un aperçu vocal.'
    if (v.startsWith('de-')) return 'Hallo, dies ist eine Sprachvorschau.'
    if (v.startsWith('ru-')) return 'Здравствуйте, это голосовой предпросмотр.'
    if (v.startsWith('es-')) return 'Hola, esta es una vista previa de voz.'
    if (v.startsWith('it-')) return 'Ciao, questa è un\'anteprima vocale.'
    if (v.startsWith('pt-')) return 'Olá, esta é uma prévia de voz.'
    if (v.startsWith('ar-')) return 'مرحباً، هذه معاينة صوتية.'
    if (v.startsWith('hi-')) return 'नमस्ते, यह एक आवाज़ पूर्वावलोकन है।'
    if (v.startsWith('id-')) return 'Halo, ini adalah pratinjau suara.'
    if (v.startsWith('th-')) return 'สวัสดี นี่คือตัวอย่างเสียง'
    if (v.startsWith('vi-')) return 'Xin chào, đây là bản xem trước giọng nói.'
    if (v.startsWith('tr-')) return 'Merhaba, bu bir ses önizlemesidir.'
    if (v.startsWith('pl-')) return 'Cześć, to jest podgląd głosu.'
    if (v.startsWith('nl-')) return 'Hallo, dit is een spraakvoorbeeld.'
    if (v.startsWith('sv-')) return 'Hej, detta är en röstförhandsvisning.'
    if (v.startsWith('uk-')) return 'Привіт, це голосовий попередній перегляд.'
    if (v.startsWith('cs-')) return 'Ahoj, toto je hlasová ukázka.'
    if (v.startsWith('da-')) return 'Hej, dette er en stemmeprøve.'
    if (v.startsWith('fi-')) return 'Hei, tämä on ääniesikatselu.'
    if (v.startsWith('el-')) return 'Γεια σας, αυτή είναι μια προεπισκόπηση φωνής.'
    if (v.startsWith('he-')) return 'שלום, זוהי תצוגה מקדימה של קול.'
    if (v.startsWith('nb-')) return 'Hei, dette er en taleprøve.'
    if (v.startsWith('en-')) return 'Hello, this is a voice preview.'
    return '你好,这是语音试听,欢迎使用。'
  }
  const text = (body.text || previewText(voice)).slice(0, 100)
  try {
    const { audio, usedVoice } = await synthesizeAzureTts(text, {
      voice,
      rate: provider.rate || '+0%',
      volume: provider.volume || '+0%',
      pitch: provider.pitch || '+0Hz',
    })
    return new Response(audio, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audio.byteLength),
        'X-Azure-TTS-Voice': usedVoice,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json<ApiResponse>({ success: false, message: `试听失败: ${message}` }, 502)
  }
}

export async function handleGetUsage(c: Context<{ Bindings: Env }>) {
  const q = c.req.query('days')
  // 默认显示今天(1天)
  const days = Math.min(Math.max(parseInt(q || '1') || 1, 1), 30)
  const summary = await getUsageSummary(c.env, days)
  return c.json<ApiResponse>({ success: true, data: summary })
}

/** 校验 Vertex 凭据：服务账号 JSON 或 Express API Key（后台「验证凭据」按钮用） */
export async function handleVertexVerify(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<{ credential?: string; model?: string; location?: string }>().catch(() => ({} as { credential?: string; model?: string; location?: string }))
  const credential = (body.credential || '').trim()
  if (!credential) return c.json<ApiResponse<null>>({ success: false, message: '请先填写服务账号 JSON 或 API Key' }, 400)
  const { testVertex } = await import('./vertex')
  const result = await testVertex(c.env, credential, body.model?.trim() || undefined, body.location?.trim() || undefined)
  return c.json<ApiResponse<{ message: string; statusCode?: number }>>(
    result.success
      ? { success: true, data: { message: result.message, statusCode: result.statusCode } }
      : { success: false, message: result.message },
    result.success ? 200 : 400,
  )
}

/** Devin 授权：生成 PKCE 授权链接（无回调模式，页面直接给 code） */
export async function handleDevinOAuthStart(c: Context<{ Bindings: Env }>) {
  try {
    const { startDevinOAuth } = await import('./devin')
    const { url, state } = await startDevinOAuth(c.env)
    return c.json<ApiResponse<{ url: string; state: string }>>({ success: true, data: { url, state } })
  } catch (err) {
    return c.json<ApiResponse>({ success: false, message: (err as Error).message || '生成授权链接失败' }, 500)
  }
}

/** Devin 授权：用 code 换 session token 并拉取用户信息 */
export async function handleDevinOAuthComplete(c: Context<{ Bindings: Env }>) {
  const { code, state } = await c.req.json<{ code?: string; state?: string }>().catch(() => ({} as { code?: string; state?: string }))
  if (!code) return c.json<ApiResponse>({ success: false, message: '请填写授权码 code' }, 400)
  try {
    const { completeDevinOAuth } = await import('./devin')
    const result = await completeDevinOAuth(c.env, code, state || '')
    return c.json<ApiResponse<{ session_token: string; user_name?: string; user_id?: string; org_id?: string }>>({
      success: true,
      data: { session_token: result.sessionToken, user_name: result.userName, user_id: result.userId, org_id: result.orgId },
    })
  } catch (err) {
    return c.json<ApiResponse>({ success: false, message: (err as Error).message || '换取 token 失败' }, 400)
  }
}

/** 校验 Devin 凭据（GET /v3/self） */
export async function handleDevinVerify(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<{ credential?: string; model?: string }>().catch(() => ({} as { credential?: string; model?: string }))
  const credential = (body.credential || '').trim()
  if (!credential) return c.json<ApiResponse<null>>({ success: false, message: '请先填写 session token，或点「用 Devin 账号授权」' }, 400)
  const { testDevin } = await import('./devin')
  const result = await testDevin(c.env, credential, body.model?.trim() || undefined)
  return c.json<ApiResponse<{ message: string }>>(
    result.success ? { success: true, data: { message: result.message } } : { success: false, message: result.message },
    result.success ? 200 : 400,
  )
}
