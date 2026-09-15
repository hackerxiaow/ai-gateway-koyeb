import { Context } from 'hono'
import { getProvider, getProviders } from './storage'
import { getKV } from './storage-adapter'
import { KV_KEYS, KEY_HEALTH_COOLDOWN_MS, KEY_HEALTH_MAX_FAILURES } from './config'
import type { Env, ProxyRequestBody, UsageRecord } from './types'
import { isOpenCodeProvider, proxyOpenCodeRequest, resolveOpenCodeUrls, resolveProviderMirrorUrls } from './opencode'
import { addUsageRecord } from './storage'

/** 从响应体提取 token 用量（OpenAI / Anthropic 兼容） */
function extractUsage(body: unknown): { promptTokens: number; completionTokens: number } {
  try {
    const data = body as any
    const usage = data?.usage
    if (usage) {
      const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0
      const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0
      return { promptTokens: prompt, completionTokens: completion }
    }
  } catch { /* ignore */ }
  return { promptTokens: 0, completionTokens: 0 }
}

/** 读取响应体（保留原始字节），返回 JSON 解析结果与原始 Response */
async function readResponseWithUsage(response: Response): Promise<{ body: string; json: unknown }> {
  const buf = await response.arrayBuffer()
  const body = new TextDecoder().decode(buf)
  let json: unknown = null
  try {
    json = JSON.parse(body)
  } catch {
    // 非纯 JSON（SSE 流式响应）：逐行解析 data: 块，取最后一个带 usage 的 chunk（参照 one-api-cf 逻辑）
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim()
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const parsed = JSON.parse(payload) as Record<string, unknown>
        if (parsed && typeof parsed === 'object' && parsed.usage) json = parsed
      } catch {
        // 忽略非 JSON 行
      }
    }
  }
  return { body, json }
}

// ===== Key 健康状态类型和辅助函数 =====

interface KeyHealth {
  failures: number
  lastFailed: boolean
  demotedAt?: number  // 首次达到降权阈值的时间戳 (Date.now())
}
type HealthMap = Record<string, KeyHealth>

const HEALTH_KEY = (providerId: string) => KV_KEYS.KEY_HEALTH_PREFIX + providerId

async function readHealth(env: Env, providerId: string): Promise<HealthMap> {
  const raw = await getKV(env).get(HEALTH_KEY(providerId))
  return raw ? JSON.parse(raw) : {}
}

async function writeHealth(env: Env, providerId: string, health: HealthMap): Promise<void> {
  // 只保存有失败记录的 key，避免 KV 膨胀
  const filtered: HealthMap = {}
  for (const [k, v] of Object.entries(health)) {
    if (v.failures > 0) filtered[k] = v
  }
  if (Object.keys(filtered).length > 0) {
    await getKV(env).put(HEALTH_KEY(providerId), JSON.stringify(filtered))
  } else {
    // 全部健康，删除 KV 条目
    await getKV(env).delete(HEALTH_KEY(providerId)).catch(() => {})
  }
}

/** 解析模型 ID，如 "deepseek/deepseek-chat" → { providerId, modelId } */
function parseModelId(model: string): { providerId: string; modelId: string } | null {
  const slashIndex = model.indexOf('/')
  if (slashIndex === -1) return null
  return {
    providerId: model.substring(0, slashIndex),
    modelId: model.substring(slashIndex + 1),
  }
}

/** 根据模型别名/ID 在渠道模型列表中查找配置（优先 alias 精确匹配，其次 id 精确匹配） */
export function findModelConfig(
  models: Array<{ id: string; enabled?: boolean; alias?: string }>,
  requested: string,
): { id: string; alias?: string; enabled?: boolean } | undefined {
  // 1) 精确匹配 id
  const byId = models.find((m) => m.id === requested)
  if (byId) return byId
  // 2) 精确匹配 alias
  const byAlias = models.find((m) => m.alias && m.alias === requested)
  if (byAlias) return byAlias
  // 3) 后缀容错：请求不带 free 后缀，但 id 带（如 stepfun/step-3.7-flash vs stepfun/step-3.7-flash:free, hy3 vs hy3-free）
  const withFreeSuffix = models.find((m) => m.alias === requested || m.id === requested || `${requested}:free` === m.id || `${requested}/free` === m.id || `${requested}-free` === m.id)
  return withFreeSuffix
}

/** 测试模型连接，发送最小请求验证 */
export async function testModelConnection(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  apiType?: 'openai' | 'anthropic'
): Promise<{ success: boolean; message: string; statusCode?: number }> {
  try {
    const cleanBase = baseUrl.replace(/\/$/, '')
    const endpoint = apiType === 'anthropic' ? 'messages' : 'chat/completions'
    const url = `${cleanBase}/${endpoint}`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (apiKey) {
      if (apiType === 'anthropic') {
        headers['x-api-key'] = apiKey
        headers['anthropic-version'] = '2023-06-01'
      } else {
        headers['Authorization'] = `Bearer ${apiKey}`
      }
    } else if (apiType === 'anthropic') {
      headers['anthropic-version'] = '2023-06-01'
    }

    let response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
        stream: true,
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      const altResponse = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(15000),
      }).catch(() => null)
      if (altResponse && altResponse.ok) {
        response = altResponse
      }
    }

    if (response.ok) {
      return { success: true, message: '连接成功', statusCode: response.status }
    }

    // fetch 响应体只能消费一次: 先读文本, 再尝试解析 JSON; 若先 json() 失败再 text() 会抛
    // "Body has already been used" 从而掩盖真实状态码(如 429)
    const rawBody = await response.text()
    let errorBody = rawBody
    try {
      const errorData = JSON.parse(rawBody) as { error?: { message?: string }; message?: string }
      errorBody = errorData?.error?.message || errorData?.message || rawBody
    } catch {
      // 非 JSON 响应, 直接使用原始文本
    }

    return {
      success: false,
      message: `HTTP ${response.status}: ${errorBody.substring(0, 200)}`,
      statusCode: response.status,
    }
  } catch (err) {
    const error = err as Error
    return {
      success: false,
      message: `连接失败: ${error.message?.substring(0, 200) || '未知错误'}`,
    }
  }
}

/**
 * 多 Key 轮询测试模型连接。
 * 依次尝试每个已启用 key；遇到限流(429)、鉴权失败(401/403) 或上游 5xx 时自动切换到下一个 key；
 * 命中可用 key 立即返回成功。用于后台"测试模型"，避免单个 key 被限流时误报整个渠道不可用。
 */
export async function testModelConnectionRotating(
  baseUrl: string,
  keys: string[],
  modelId: string,
  apiType?: 'openai' | 'anthropic'
): Promise<{ success: boolean; message: string; statusCode?: number; keyIndex?: number }> {
  const list = (keys || []).filter((k) => k && k.trim())
  if (list.length === 0) {
    return { success: false, message: '该渠道未启用任何 API Key', statusCode: 0 }
  }

  let last: { success: boolean; message: string; statusCode?: number } | null = null
  for (let i = 0; i < list.length; i++) {
    const r = await testModelConnection(baseUrl, list[i], modelId, apiType)
    if (r.success) {
      return {
        ...r,
        keyIndex: i,
        message: list.length > 1 ? `${r.message} (key #${i + 1}/${list.length})` : r.message,
      }
    }
    last = r
    const st = r.statusCode || 0
    // 限流 / 鉴权失败 / 上游服务端错误 → 换下一个 key 重试
    if (st === 429 || st === 401 || st === 403 || st >= 500) continue
    // 其他错误（模型不存在、请求参数错误等）与具体 key 无关，直接返回
    break
  }
  return last || { success: false, message: '连接失败', statusCode: 0 }
}

/** 处理 /v1/chat/completions 等 API 转发（OpenAI/Anthropic 兼容 & 多模态 multipart 透传） */
export async function handleProxy(c: Context<{ Bindings: Env }>) {
  const startedAt = Date.now()
  try {
    // 判断请求类型: multipart 表单(音频转录/图片编辑/变体) body 原样透传, 其余按 JSON
    const contentType = c.req.header('content-type') || ''
    const isMultipart = contentType.toLowerCase().includes('multipart/form-data')

    let body: ProxyRequestBody
    let rawForm: FormData | null = null
    let rawBodyArray: ArrayBuffer | null = null

    if (isMultipart) {
      // 参考 one-api-cf: multipart 请求 model 在 form 字段中, body 原样转给上游
      try {
        rawForm = await c.req.formData()
        rawBodyArray = await c.req.arrayBuffer()
      } catch {
        return c.json({ error: { message: 'Invalid multipart form body', type: 'invalid_request_error' } }, 400)
      }
      body = { model: String(rawForm.get('model') || '') }
    } else if (c.req.method === 'GET' || c.req.method === 'HEAD') {
      // GET/HEAD(如 videos/status 回查): 无 body, model 从查询参数取
      body = { model: c.req.query('model') || '' }
    } else {
      try {
        body = await c.req.json<ProxyRequestBody>()
      } catch {
        return c.json({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }, 400)
      }
    }
    const model = body.model as string | undefined
    const subPathRaw = c.req.url.includes('/v1/') ? c.req.url.split('/v1/')[1]?.split('?')[0] || '' : ''

    // GET /v1/videos/status 是任务回查, 不需要 model 路由(由渠道指定)
    if (!model && !(c.req.method === 'GET' && subPathRaw === 'videos/status')) {
      return c.json({ error: { message: '缺少 model 参数', type: 'invalid_request_error' } }, 400)
    }
    const modelSafe = model as string

    // GET /v1/videos/status?channel=xxx&task_id=yyy — agnes 异步任务回查
    if (c.req.method === 'GET' && subPathRaw === 'videos/status') {
      const statusProviderId = c.req.query('channel') || c.req.query('provider')
      if (!statusProviderId) {
        return c.json({ error: { message: '请指定 channel 参数(如 /v1/videos/status?channel=myvideo&task_id=xxx)', type: 'invalid_request_error' } }, 400)
      }
      const statusProvider = await getProvider(c.env, statusProviderId)
      if (!statusProvider) {
        return c.json({ error: { message: `渠道 "${statusProviderId}" 不存在`, type: 'invalid_request_error' } }, 404)
      }
      if ((statusProvider.type || 'openai') !== 'agnes-video') {
        return c.json({ error: { message: `渠道 "${statusProviderId}" 不是 agnes-video 类型`, type: 'invalid_request_error' } }, 400)
      }
      const { queryAgnesVideoStatus } = await import('./video-proxy')
      const statusKeys = statusProvider.apiKeys.filter(k => k.enabled)
      const statusApiKey = statusKeys[0]?.key || 'public'
      const statusTaskId = c.req.query('task_id') || ''
      if (!statusTaskId) {
        return c.json({ error: { message: 'task_id is required', type: 'invalid_request_error' } }, 400)
      }
      return queryAgnesVideoStatus(statusProvider.baseUrl, statusApiKey, statusTaskId)
    }

    const parsed = parseModelId(model as string)
    if (!parsed) {
      return c.json({
        error: {
          message: `模型格式错误 "${model}"，请使用 提供商ID/模型ID 格式`,
          type: 'invalid_request_error',
        },
      }, 400)
    }

    const { providerId, modelId } = parsed
    const provider = await getProvider(c.env, providerId)

    if (!provider) {
      return c.json({
        error: { message: `提供商 "${providerId}" 不存在`, type: 'invalid_request_error' },
      }, 404)
    }

    if (!provider.enabled) {
      return c.json({
        error: { message: `提供商 "${provider.name}" 已禁用`, type: 'provider_disabled' },
      }, 403)
    }

    const modelConfig = findModelConfig(provider.models, modelId)
    if (!modelConfig) {
      return c.json({
        error: { message: `模型 "${modelId}" 未在提供商 "${provider.name}" 中配置`, type: 'invalid_request_error' },
      }, 404)
    }
    if (!modelConfig.enabled) {
      return c.json({
        error: { message: `模型 "${modelId}" 已禁用`, type: 'model_disabled' },
      }, 403)
    }

    const enabledKeys = provider.apiKeys.filter(k => k.enabled)
    // 对外用 alias(如果有)，转发给上游用真实 id
    const forwardBody = { ...body, model: modelConfig.id }
    const url = new URL(c.req.url)
    const subPath = url.pathname.replace(/^\/v1\//, '') || 'chat/completions'
    // multipart 请求: 透传原始 body 与 content-type
    const isMultipartRequest = isMultipart && rawBodyArray !== null
    const forwardPayload = isMultipartRequest ? rawBodyArray : JSON.stringify(forwardBody)
    const forwardContentType = isMultipartRequest ? contentType : 'application/json'

    // 记录用量用：识别当前转发 Key（脱敏）
    const authHeader = c.req.header('Authorization') || ''
    const rawToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    const maskedToken = rawToken.length > 8 ? rawToken.slice(0, 8) + '***' : rawToken || 'unknown'

    const providerType = provider.type || 'openai'

    // ===== Azure TTS 内置语音合成(无需 API Key, 参考 one-api-cf azure-tts-proxy) =====
    if (providerType === 'azure-tts' && subPath === 'audio/speech') {
      const { handleAzureTtsSpeech } = await import('./azure-tts')
      const { isAzureVoiceId } = await import('./azure-voices')
      // 音色优先级: 请求体 voice > 模型 id 本身是音色(如 tts/zh-CN-YunxiNeural) > 渠道配置 > 默认
      let voice = (body as any).voice || provider.voice || 'zh-CN-XiaoxiaoNeural'
      if (!(body as any).voice && modelConfig.id && isAzureVoiceId(modelConfig.id)) {
        voice = modelConfig.id
      }
      const ttsBody = {
        ...body,
        voice,
        rate: (body as any).rate || provider.rate || '+0%',
        volume: (body as any).volume || provider.volume || '+0%',
        pitch: (body as any).pitch || provider.pitch || '+0Hz',
      }
      const audioResp = await handleAzureTtsSpeech(ttsBody)
      // 记录用量
      const record: UsageRecord = {
        ts: new Date().toISOString(),
        provider: providerId,
        model: modelSafe,
        token: maskedToken,
        ok: audioResp.ok,
        status: audioResp.status,
        promptTokens: Math.ceil(String(body.input || '').length / 4),
        completionTokens: 0,
        latencyMs: Date.now() - startedAt,
      }
      await addUsageRecord(c.env, record).catch(() => {})
      return audioResp
    }

    // ===== agnes-video 异步视频生成适配(参考 one-api-cf video-proxy) =====
    // 自动分发: 渠道类型为 agnes-video, 或渠道配置了 agnes-video-* 视频模型时,
    // videos/generations 走异步任务适配; 其他端点(chat/images 等)走标准转发
    const hasAgnesVideoModel = provider.models.some(
      (m) => m.enabled && /^agnes-video/i.test(m.id)
    )
    if ((providerType === 'agnes-video' || (providerType === 'openai' && hasAgnesVideoModel)) && subPath === 'videos/generations') {
      const { handleAgnesVideo } = await import('./video-proxy')
      const apiKey = enabledKeys[0]?.key || 'public'
      const videoResp = await handleAgnesVideo(provider.baseUrl, apiKey, forwardBody)
      const record: UsageRecord = {
        ts: new Date().toISOString(),
        provider: providerId,
        model: modelSafe,
        token: maskedToken,
        ok: videoResp.ok,
        status: videoResp.status,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - startedAt,
      }
      await addUsageRecord(c.env, record).catch(() => {})
      return videoResp
    }

    // ===== Antigravity 反代 (type = antigravity) =====
    // Antigravity OAuth 走 cloudcode-pa v1internal，请求/响应与 Gemini 协议互转。
    if (providerType === 'antigravity') {
      const supported = ['chat/completions', 'completions', 'messages', 'responses', '']
      if (!supported.includes(subPath)) {
        return c.json({
          error: { message: `antigravity 渠道暂不支持端点 /v1/${subPath}`, type: 'invalid_request_error' },
        }, 400)
      }
      const { handleAntigravityRequest } = await import('./antigravity')
      return handleAntigravityRequest({
        env: c.env,
        providerId,
        modelId: modelConfig.id,
        requestedModel: modelSafe,
        body: body as Record<string, any>,
        refreshTokens: enabledKeys.map((k) => k.key),
        project: provider.project,
        maskedToken,
        startedAt,
        waitUntil: (promise) => {
          try { c.executionCtx?.waitUntil(promise) } catch { /* 无 executionCtx 的运行时忽略 */ }
        },
      })
    }

    // ===== Vertex AI 反代 (type = vertex) =====
    // 服务账号 JWT 换 token 后走 aiplatform generateContent，请求/响应与 Gemini 协议互转。
    if (providerType === 'vertex') {
      const supported = ['chat/completions', 'completions', 'messages', 'responses', '']
      if (!supported.includes(subPath)) {
        return c.json({
          error: { message: `vertex 渠道暂不支持端点 /v1/${subPath}`, type: 'invalid_request_error' },
        }, 400)
      }
      const { handleVertexRequest } = await import('./vertex')
      return handleVertexRequest({
        env: c.env,
        providerId,
        modelId: modelConfig.id,
        requestedModel: modelSafe,
        body: body as Record<string, any>,
        credentials: enabledKeys.map((k) => k.key),
        location: provider.location,
        maskedToken,
        startedAt,
        waitUntil: (promise) => {
          try { c.executionCtx?.waitUntil(promise) } catch { /* 无 executionCtx 的运行时忽略 */ }
        },
      })
    }

    // ===== Devin 反代 (type = devin) =====
    // Connect-RPC + protobuf 直连 server.codeium.com，逐帧翻译成 OpenAI SSE。
    if (providerType === 'devin') {
      const supported = ['chat/completions', 'completions', 'messages', 'responses', '']
      if (!supported.includes(subPath)) {
        return c.json({
          error: { message: `devin 渠道暂不支持端点 /v1/${subPath}`, type: 'invalid_request_error' },
        }, 400)
      }
      const { handleDevinRequest } = await import('./devin')
      return handleDevinRequest({
        env: c.env,
        providerId,
        modelId: modelConfig.id,
        requestedModel: modelSafe,
        body: body as Record<string, any>,
        credentials: enabledKeys.map((k) => k.key),
        sessionHint: c.req.header('x-session-id') || c.req.header('x-conversation-id') || c.req.header('x-request-id') || '',
        maskedToken,
        startedAt,
        waitUntil: (promise) => {
          try { c.executionCtx?.waitUntil(promise) } catch { /* 无 executionCtx 的运行时忽略 */ }
        },
      })
    }

    // ===== OAuth 反代渠道 (type = claude / codex / kimi / grok / qwen / deepseek，复刻 CLIProxyAPI 等实现) =====
    const OAUTH_TYPES = ['claude', 'codex', 'kimi', 'grok', 'qwen', 'deepseek']
    if (OAUTH_TYPES.includes(providerType)) {
      const supported = providerType === 'claude'
        ? ['chat/completions', 'messages']
        : providerType === 'kimi' || providerType === 'qwen' || providerType === 'deepseek'
          ? ['chat/completions']
          : ['chat/completions', 'responses']
      if (!supported.includes(subPath)) {
        return c.json({
          error: { message: `${providerType} 渠道暂不支持端点 /v1/${subPath}（支持: ${supported.map((s) => `/v1/${s}`).join('、')}）`, type: 'invalid_request_error' },
        }, 400)
      }
      const oauthParams = {
        env: c.env,
        providerId,
        modelId: modelConfig.id,
        requestedModel: modelSafe,
        body: body as Record<string, any>,
        refreshTokens: enabledKeys.map((k) => k.key),
        maskedToken,
        startedAt,
        waitUntil: (promise: Promise<unknown>) => {
          try { c.executionCtx?.waitUntil(promise) } catch { /* 无 executionCtx 的运行时忽略 */ }
        },
      }
      const nativeBody = { ...(body as Record<string, any>), model: modelConfig.id }
      if (providerType === 'claude') {
        const { handleClaudeRequest } = await import('./claude')
        // /v1/messages 原生 Anthropic 协议透传；其余翻译成 Anthropic Messages
        return handleClaudeRequest({ ...oauthParams, body: subPath === 'messages' ? nativeBody : (body as Record<string, any>) }, subPath === 'messages' ? 'messages-passthrough' : 'translate')
      }
      if (providerType === 'codex') {
        const { handleCodexRequest } = await import('./codex')
        // /v1/responses 原生 Responses 协议透传；其余翻译成 Responses
        return handleCodexRequest({ ...oauthParams, body: subPath === 'responses' ? nativeBody : (body as Record<string, any>) }, subPath === 'responses' ? 'responses-passthrough' : 'translate')
      }
      if (providerType === 'kimi') {
        const { handleKimiRequest } = await import('./kimi')
        return handleKimiRequest(oauthParams, provider.baseUrl)
      }
      if (providerType === 'qwen') {
        const { handleQwenRequest } = await import('./qwen')
        return handleQwenRequest(oauthParams)
      }
      if (providerType === 'deepseek') {
        const { handleDeepSeekRequest } = await import('./deepseek')
        return handleDeepSeekRequest(oauthParams, subPath)
      }
      const { handleGrokRequest } = await import('./grok')
      return handleGrokRequest({ ...oauthParams, body: subPath === 'responses' ? nativeBody : (body as Record<string, any>) }, subPath === 'responses' ? 'responses-passthrough' : 'translate')
    }

    if (isOpenCodeProvider(providerId)) {
      const response = await proxyOpenCodeRequest({
        baseUrl: provider.baseUrl,
        apiKeys: enabledKeys,
        method: c.req.method,
        subPath,
        search: url.search,
        body: forwardPayload as string,
        mirrorUrls: resolveProviderMirrorUrls(c.env, provider),
      })
      // 读取 body 提取 usage（opencode 返回 OpenAI 兼容 JSON）
      const { body: responseBody, json } = await readResponseWithUsage(response)
      const { promptTokens, completionTokens } = extractUsage(json)
      const record: UsageRecord = {
        ts: new Date().toISOString(),
        provider: providerId,
        model: modelSafe,
        token: maskedToken,
        ok: response.ok,
        status: response.status,
        promptTokens,
        completionTokens,
        latencyMs: Date.now() - startedAt,
      }
      await addUsageRecord(c.env, record).catch(() => {})
      const headers = new Headers(response.headers)
      headers.set('Cache-Control', 'no-store')
      return new Response(responseBody, { status: response.status, statusText: response.statusText, headers })
    }

    // Z.AI(国际) 预设：同一渠道同时兼容 OpenAI 与 Anthropic 两种协议
    // （编码套餐两个端点不同：OpenAI 走 /api/coding/paas/v4，Anthropic 走 /api/anthropic/v1）
    let upstreamApiType = provider.apiType
    let upstreamBase = provider.baseUrl
    if (providerType === 'zai') {
      if (subPath === 'messages') {
        upstreamApiType = 'anthropic'
        upstreamBase = 'https://api.z.ai/api/anthropic/v1'
      } else {
        upstreamApiType = 'openai'
        upstreamBase = /\/api\/paas\//.test(provider.baseUrl) ? provider.baseUrl : 'https://api.z.ai/api/coding/paas/v4'
      }
    }

    const cleanBase = upstreamBase.replace(/\/$/, '')
    const forwardUrl = `${cleanBase}/${subPath}${url.search}`

    // 无 Key 渠道（免 Key 服务如 kilo.ai）：直接转发，不带 Authorization
    if (enabledKeys.length === 0) {
      const forwardHeaders: Record<string, string> = {
        'Content-Type': forwardContentType,
      }
      if (upstreamApiType === 'anthropic') {
        forwardHeaders['anthropic-version'] = '2023-06-01'
      }
      try {
        const response = await fetch(forwardUrl, {
          method: c.req.method,
          headers: forwardHeaders,
          body: forwardPayload,
          signal: AbortSignal.timeout(60000),
        })
        // 读取 body 提取 usage 并记录
        const { body: responseBody, json } = await readResponseWithUsage(response)
        const { promptTokens, completionTokens } = extractUsage(json)
        const record: UsageRecord = {
          ts: new Date().toISOString(),
          provider: providerId,
          model: modelSafe,
          token: maskedToken,
          ok: response.ok,
          status: response.status,
          promptTokens,
          completionTokens,
          latencyMs: Date.now() - startedAt,
        }
        await addUsageRecord(c.env, record).catch(() => {})
        const responseHeaders: Record<string, string> = {
          'Content-Type': response.headers.get('Content-Type') || 'application/json',
          'Cache-Control': 'no-store',
        }
        return new Response(responseBody, {
          status: response.status,
          headers: responseHeaders,
        })
      } catch (err) {
        const error = err as Error
        return c.json({
          error: { message: error.message || '代理转发内部错误', type: 'proxy_error' },
        }, 502)
      }
    }

    // 按健康状态排序 key：健康→洗牌，不健康→末尾，冷却到期→试用，连续失败3次→降权排除
    const healthData = await readHealth(c.env, providerId)
    const healthy: number[] = []
    const unhealthy: number[] = []
    const probation: number[] = []
    const demoted: number[] = []

    if (enabledKeys.length === 1) {
      // 只有一个 key，跳过健康检查，直接使用
      healthy.push(0)
    } else {
      for (let i = 0; i < enabledKeys.length; i++) {
        const h = healthData[enabledKeys[i].key]
        if (h && h.failures >= KEY_HEALTH_MAX_FAILURES) {
          // 兼容旧数据：无 demotedAt 视为现在刚降权，统一走冷却逻辑
          if (!h.demotedAt) {
            h.demotedAt = Date.now()
          }
          if (Date.now() - h.demotedAt >= KEY_HEALTH_COOLDOWN_MS) {
            probation.push(i)  // 冷却到期，进入试用组
          } else {
            demoted.push(i)    // 仍在冷却，继续保持降权
          }
        } else if (h && h.lastFailed) {
          unhealthy.push(i)
        } else {
          healthy.push(i)
        }
      }
    }

    // Fisher-Yates 洗牌（仅健康 key）
    for (let i = healthy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [healthy[i], healthy[j]] = [healthy[j], healthy[i]]
    }

    const keyOrder = [...healthy, ...unhealthy, ...probation]

    // 所有 key 都在冷却中时，降级尝试 demoted key（修复旧数据缺失 demotedAt 的死循环）
    if (keyOrder.length === 0 && demoted.length > 0) {
      keyOrder.push(...demoted)
      console.log(`[proxy] ${providerId}: all keys demoted, falling back to ${demoted.length} key(s)`)
    }

    if (demoted.length > 0 || probation.length > 0) {
      console.log(`[proxy] ${providerId}: ${demoted.length} key(s) demoted, ${probation.length} key(s) on probation (cooldown expired)`)
    }

    let lastError: Response | null = null
    let healthUpdated = false

    for (const keyIndex of keyOrder) {
      const apiKey = enabledKeys[keyIndex].key
      try {
        const forwardHeaders: Record<string, string> = {
          'Content-Type': forwardContentType,
        }
        if (upstreamApiType === 'anthropic') {
          forwardHeaders['x-api-key'] = apiKey
          forwardHeaders['anthropic-version'] = '2023-06-01'
        } else {
          forwardHeaders['Authorization'] = `Bearer ${apiKey}`
        }

        const response = await fetch(forwardUrl, {
          method: c.req.method,
          headers: forwardHeaders,
          body: forwardPayload,
          signal: AbortSignal.timeout(60000),
        })

        if (response.ok) {
          // 成功：重置健康状态
          if (healthData[apiKey]?.failures > 0) {
            delete healthData[apiKey]
            healthUpdated = true
          }
          if (healthUpdated) await writeHealth(c.env, providerId, healthData)

          // 读取 body 提取 usage 并记录
          const { body: responseBody, json } = await readResponseWithUsage(response)
          const { promptTokens, completionTokens } = extractUsage(json)
          const record: UsageRecord = {
            ts: new Date().toISOString(),
            provider: providerId,
            model: modelSafe,
            token: maskedToken,
            ok: true,
            status: response.status,
            promptTokens,
            completionTokens,
            latencyMs: Date.now() - startedAt,
          }
          await addUsageRecord(c.env, record).catch(() => {})

          const responseHeaders: Record<string, string> = {
            'Content-Type': response.headers.get('Content-Type') || 'application/json',
            'Cache-Control': 'no-store',
          }
          return new Response(responseBody, {
            status: response.status,
            headers: responseHeaders,
          })
        }

        // 429 限流：跳过当前 key，不标记失败
        if (response.status === 429) {
          lastError = response
          continue
        }

        // 401/403/5xx 尝试下一个 key（标记失败）
        if (response.status === 401 || response.status === 403 || response.status >= 500) {
          const h = healthData[apiKey] || { failures: 0, lastFailed: false }
          h.failures++
          h.lastFailed = true
          if (h.failures >= KEY_HEALTH_MAX_FAILURES) {
            h.demotedAt = Date.now()  // 达到降权阈值或试用失败，重置冷却计时
          }
          healthData[apiKey] = h
          healthUpdated = true
          lastError = response
          continue
        }

        // 其他错误（400/404 等）直接返回
        const errorData = await response.json().catch(async () => ({ error: { message: await response.text() } }))
        return c.json(errorData, response.status as Parameters<typeof c.json>[1])
      } catch (err) {
        const error = err as Error
        // 网络错误也标记为失败
        const h = healthData[apiKey] || { failures: 0, lastFailed: false }
        h.failures++
        h.lastFailed = true
        if (h.failures >= KEY_HEALTH_MAX_FAILURES) {
          h.demotedAt = Date.now()  // 达到降权阈值或试用失败，重置冷却计时
        }
        healthData[apiKey] = h
        healthUpdated = true
        lastError = new Response(JSON.stringify({
          error: { message: error.message || '请求失败', type: 'proxy_error' },
        }), { status: 502 })
        continue
      }
    }

    // 写回健康状态
    if (healthUpdated) await writeHealth(c.env, providerId, healthData)

    // 所有 key 均失败
    if (lastError) {
      const errorBody = await lastError.text().catch(() => '所有 API Key 均失败')
      return c.json({
        error: {
          message: `所有 API Key 已用完，最后一次错误: HTTP ${lastError.status}`,
          type: 'key_exhausted',
          detail: errorBody.substring(0, 500),
        },
      }, (lastError.status || 502) as Parameters<typeof c.json>[1])
    }

    return c.json({
      error: { message: '没有可用的 API Key', type: 'configuration_error' },
    }, 500)
  } catch (err) {
    const error = err as Error
    return c.json({
      error: { message: error.message || '代理转发内部错误', type: 'server_error' },
    }, 500)
  }
}

/** 处理 /v1/models — 返回所有已启用的模型（含提供商前缀） */
export async function handleModels(c: Context<{ Bindings: Env }>) {
  const providers = await getProviders(c.env)

  const models: Array<{
    id: string
    provider: string
    provider_name: string
    object: string
    created: number
    owned_by: string
  }> = []

  for (const provider of providers) {
    if (!provider.enabled) continue
    for (const model of provider.models) {
      if (!model.enabled) continue
      models.push({
        id: `${provider.id}/${model.alias || model.id}`,
        provider: provider.id,
        provider_name: provider.name,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: provider.id,
      })
    }
  }

  return c.json({
    object: 'list',
    data: models,
  })
}
