import type { ApiKeyEntry, Env } from './types'
import {
  OPENCODE_COMPAT_HEAD,
  OPENCODE_COMPAT_TAIL,
  OPENCODE_TITLE_MARKER,
  OPENCODE_CLI_MARKER,
  OPENCODE_OFFICIAL_TOOLS,
} from './opencode-compat'

export const OPENCODE_PROVIDER_ID = 'opencode'

const OPENCODE_VERSION = '1.19.0'
// 免费层模型出字慢，流式响应可能持续数分钟；超时过短会在生成中途掐断连接，客户端表现为「重新连接」
const OPENCODE_TIMEOUT_MS = 300000

export const OPENCODE_MODELS_CATALOG_URL = 'https://models.opencode.ai/api.json'

const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * 官方时间戳与递减计数编码（tA 算法）：
 * epoch = 27 << 36 = 1855425871872
 * hex = ((epoch - 1 - unix_millis) << 12 | 0xFFE) 取低 48 位
 * 低 12 位恒等于 0xFFE，高 36 位代表当前真实时间的倒序毫秒数，上游免费层严格反解该时间戳窗口。
 */
function createOpenCodeId(prefix: string): string {
  const bytes = new Uint8Array(14)
  crypto.getRandomValues(bytes)
  let random = ''
  for (let i = 0; i < 14; i++) {
    random += BASE62_CHARS[bytes[i] % 62]
  }

  if (prefix === 'ses') {
    const now = Date.now()
    const epoch = 27n << 36n
    const high36 = (epoch - 1n) - BigInt(now)
    const hex12 = ((high36 << 12n) | 0xffen).toString(16).padStart(12, '0')
    return `ses_${hex12}${random}`
  }

  const hex12 = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  return `${prefix}_${hex12}${random}`
}

/** 随机生成 40 位 hex 项目 SHA，规避固定 global 触发上游风控 */
function createProjectHash(): string {
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// 免费层内容闸门（2026-10-15 逆向，详见 opencode-compat.ts）：
// - 无 tools 请求：system 必须含官方「标题生成」prompt 片段；
// - 带 tools 请求：system 必须含官方 CLI prompt 片段，且 tools 以官方 11 工具开头。
const OPENCODE_TITLE_BLOCK = `${OPENCODE_COMPAT_HEAD}\n${OPENCODE_TITLE_MARKER}\n${OPENCODE_COMPAT_TAIL}`
const OPENCODE_CLI_BLOCK = `${OPENCODE_COMPAT_HEAD}\n${OPENCODE_CLI_MARKER}\n${OPENCODE_COMPAT_TAIL}`
const OPENCODE_TITLE_PROBE = OPENCODE_TITLE_MARKER.slice(0, 80)
const OPENCODE_CLI_PROBE = OPENCODE_CLI_MARKER.slice(0, 80)

/** 官方工具集比对键：name + parameters（上游校验依据，description 不参与）。 */
function officialToolKey(tool: any): string {
  return `${tool?.function?.name ?? tool?.name}:${JSON.stringify(tool?.function?.parameters)}`
}

/** 幂等地把兼容标记注入 messages（system 文本；缺失 system 时插到最前）。 */
function injectCompatMarker(messages: any[], block: string, probe: string): void {
  const containsProbe = (value: unknown): boolean =>
    typeof value === 'string' && value.includes(probe)

  const already = messages.some((message: any) => {
    if (!message) return false
    if (containsProbe(message.content)) return true
    if (Array.isArray(message.content)) {
      return message.content.some((part: any) => containsProbe(part?.text))
    }
    return false
  })
  if (already) return

  const systemMessage = messages.find((message: any) => message && message.role === 'system')
  if (systemMessage) {
    if (typeof systemMessage.content === 'string') {
      systemMessage.content = `${systemMessage.content}\n\n${block}`
      return
    }
    if (Array.isArray(systemMessage.content)) {
      systemMessage.content.push({ type: 'text', text: block })
      return
    }
  }
  messages.unshift({ role: 'system', content: block })
}

/**
 * 免费层兼容处理：
 * - 请求带 tools：tools 前置官方 11 工具定义（name + parameters 原样，description 为劝阻语），
 *   并剔除客户端与官方重名的工具（上游会对重名工具报 "must not be specified more than once"）；
 *   system 注入官方 CLI prompt 片段。
 * - 请求不带 tools：system 注入官方「标题生成」prompt 片段即可（实测无需注入 tools）。
 * 幂等：重复调用（重试/客户端已注入）不会二次追加。
 */
export function ensureOpenCodeCompat(payload: any): void {
  const messages = Array.isArray(payload?.messages) ? payload.messages : null
  if (!messages || messages.length === 0) return

  const hasTools = Array.isArray(payload.tools) && payload.tools.length > 0

  if (hasTools) {
    const tools = payload.tools as any[]
    const officialNames = new Set(OPENCODE_OFFICIAL_TOOLS.map((tool) => tool.function.name))
    const clientTools = tools.filter((tool) => !officialNames.has(tool?.function?.name ?? tool?.name))
    const alreadyPrepended =
      clientTools.length === tools.length &&
      tools.length >= OPENCODE_OFFICIAL_TOOLS.length &&
      OPENCODE_OFFICIAL_TOOLS.every((official, index) => officialToolKey(tools[index]) === officialToolKey(official))
    if (!alreadyPrepended) {
      payload.tools = [...OPENCODE_OFFICIAL_TOOLS.map((tool) => JSON.parse(JSON.stringify(tool))), ...clientTools]
    }
    injectCompatMarker(messages, OPENCODE_CLI_BLOCK, OPENCODE_CLI_PROBE)
    return
  }

  injectCompatMarker(messages, OPENCODE_TITLE_BLOCK, OPENCODE_TITLE_PROBE)
}

interface OpenCodeRequestOptions {
  baseUrl: string
  apiKeys: ApiKeyEntry[]
  method: string
  subPath: string
  mirrorUrls: string[]
  search?: string
  body?: string
  fetcher?: typeof fetch
  random?: () => number
}

interface StoredFailure {
  status: number
  statusText: string
  headers: Headers
  body: ArrayBuffer
}

export interface OpenCodeTestResult {
  success: boolean
  message: string
  statusCode?: number
  data?: unknown
}

export function isOpenCodeProvider(providerId: string): boolean {
  return providerId === OPENCODE_PROVIDER_ID
}

/**
 * 免费模型识别过滤器：
 * 匹配所有 -free 模型、以及官方声明免费的免 token 模型（big-pickle, grok-code, gpt-5-nano 等）
 */
export function filterOpenCodeModels<T extends { id?: unknown }>(models: T[]): T[] {
  return models.filter((model) => {
    if (typeof model.id !== 'string') return false
    const id = model.id
    if (!/^[A-Za-z0-9._:/-]+$/.test(id)) return false
    return (
      id.endsWith('-free') ||
      id.includes('-free') ||
      id === 'big-pickle' ||
      id === 'grok-code' ||
      id === 'gpt-5-nano' ||
      id === 'cat-jam-free' ||
      id === 'space-bunny-free'
    )
  })
}

export function resolveOpenCodeUrls(env: Env): string[] {
  const raw = env.OPENCODE_MIRRORS_URL || ''
  const parts = raw.split('\n').flatMap(s => s.split(',')).map(s => s.trim()).filter(Boolean)
  return [...new Set(parts)]
}

export const OPENCODE_DEFAULT_MIRRORS = [
  'https://opencode.ai.cmliussss.net/zen/v1',
  'https://opencode.fastly.cmliussss.net/zen/v1',
  'https://opencode.gcore.cmliussss.net/zen/v1',
]

/**
 * 解析提供商生效的 OpenCode 镜像地址：
 * 优先使用后台配置的 provider.mirrorUrls, 为空时回退 OPENCODE_MIRRORS_URL 环境变量，
 * 若仍为空则强兜底到默认三条可用镜像。
 */
export function resolveProviderMirrorUrls(env: Env, provider?: { mirrorUrls?: string[] }): string[] {
  if (provider?.mirrorUrls && provider.mirrorUrls.length > 0) {
    const list = [...new Set(provider.mirrorUrls.map(s => s.trim()).filter(Boolean))]
    if (list.length > 0) return list
  }
  const fromEnv = resolveOpenCodeUrls(env)
  if (fromEnv.length > 0) return fromEnv
  return [...OPENCODE_DEFAULT_MIRRORS]
}

function getMirrorOrder(urls: string[], random: () => number): string[] {
  if (urls.length === 0) return []
  const start = Math.floor(random() * urls.length)
  return [
    ...urls.slice(start),
    ...urls.slice(0, start),
  ]
}

function buildUrl(baseUrl: string, subPath: string, search = ''): string {
  // 2026-10 上游把匿名免费层入口从 /zen/v1 迁到 /inference/v1：旧路径对 Bearer public 一律 403。
  // 配置（后台/环境变量）里仍是旧写法，这里统一改写，避免改配置。
  const normalized = baseUrl.replace(/\/zen\/v1(?=\/|$)/, '/inference/v1')
  return `${normalized.replace(/\/+$/, '')}/${subPath.replace(/^\/+/, '')}${search}`
}

function createRequestHeaders(apiKey: string, requestId: string, sessionId: string): Headers {
  const projectHash = createProjectHash()
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream, application/json',
    'User-Agent': `opencode/${OPENCODE_VERSION} ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14`,
    'x-opencode-client': 'desktop',
    'x-opencode-project': projectHash,
    'x-opencode-request': requestId,
    'x-opencode-request-id': requestId,
    'x-opencode-session': sessionId,
    'x-opencode-session-id': sessionId,
    'x-session-affinity': sessionId,
    'X-Session-Id': sessionId,
  })

  if (apiKey && apiKey !== 'public') {
    headers.set('Authorization', `Bearer ${apiKey}`)
  } else {
    headers.set('Authorization', 'Bearer public')
  }

  return headers
}

async function storeFailure(response: Response): Promise<StoredFailure> {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
    body: await response.arrayBuffer(),
  }
}

function restoreFailure(failure: StoredFailure): Response {
  return new Response(failure.body, {
    status: failure.status,
    statusText: failure.statusText,
    headers: failure.headers,
  })
}

function transportErrorResponse(error: unknown): Response {
  const message = error instanceof Error && error.message ? error.message : 'OpenCode 上游请求失败'
  return new Response(JSON.stringify({
    error: { message, type: 'proxy_error' },
  }), {
    status: 502,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

async function requestUpstream(
  fetcher: typeof fetch,
  url: string,
  apiKey: string,
  options: OpenCodeRequestOptions,
  requestId: string,
  sessionId: string
): Promise<Response> {
  return fetcher(url, {
    method: options.method,
    headers: createRequestHeaders(apiKey, requestId, sessionId),
    body: options.method === 'GET' || options.method === 'HEAD' ? undefined : options.body,
    signal: AbortSignal.timeout(OPENCODE_TIMEOUT_MS),
  })
}

async function aggregateOpenCodeStream(response: Response, modelId: string): Promise<Response> {
  const rawText = await response.text()
  let content = ''
  let reasoning = ''
  let id = ''
  let finishReason = 'stop'
  let promptTokens = 0
  let completionTokens = 0
  const toolCallsMap = new Map<number, any>()

  for (const rawLine of rawText.split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith('data:')) continue
    const dataStr = line.slice(5).trim()
    if (!dataStr || dataStr === '[DONE]') continue
    try {
      const chunk = JSON.parse(dataStr)
      if (chunk.id) id = chunk.id
      const choice = chunk.choices?.[0]
      const delta = choice?.delta
      if (delta?.content) content += delta.content
      if (delta?.reasoning_content) reasoning += delta.reasoning_content
      if (choice?.finish_reason) finishReason = choice.finish_reason

      if (Array.isArray(delta?.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = typeof tc.index === 'number' ? tc.index : 0
          if (!toolCallsMap.has(idx)) {
            toolCallsMap.set(idx, {
              id: tc.id || `call_${idx}`,
              type: tc.type || 'function',
              function: {
                name: tc.function?.name || '',
                arguments: tc.function?.arguments || '',
              },
            })
          } else {
            const existing = toolCallsMap.get(idx)
            if (tc.id) existing.id = tc.id
            if (tc.function?.name) existing.function.name += tc.function.name
            if (tc.function?.arguments) existing.function.arguments += tc.function.arguments
          }
        }
      }

      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens || promptTokens
        completionTokens = chunk.usage.completion_tokens || completionTokens
      }
    } catch {}
  }

  const toolCalls = Array.from(toolCallsMap.values())

  const jsonResp = {
    id: id || `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: content || null,
          ...(reasoning ? { reasoning_content: reasoning } : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls.length > 0 ? 'tool_calls' : finishReason,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  }

  return new Response(JSON.stringify(jsonResp), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

function sanitizeFailureResponse(failure: StoredFailure): Response {
  const contentType = failure.headers.get('content-type') || ''
  const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml+xml')

  if (isHtml || failure.status === 404) {
    try {
      const text = new TextDecoder().decode(failure.body).trim()
      if (
        text.startsWith('<!DOCTYPE html>') ||
        text.startsWith('<html') ||
        text.includes('<html') ||
        text.includes('og:image') ||
        text.includes('<title>')
      ) {
        const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i)
        const title = titleMatch ? titleMatch[1].trim() : '页面未找到'
        const friendlyMessage = `OpenCode 上游返回 HTML 页面（HTTP ${failure.status}: ${title}），官方/镜像源站可能暂时抖动或未开放该路径`
        return new Response(JSON.stringify({
          error: {
            message: friendlyMessage,
            type: 'upstream_error',
            status: failure.status,
          },
        }), {
          status: failure.status === 404 ? 502 : failure.status,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        })
      }
    } catch {}
  }

  return restoreFailure(failure)
}

function formatOpenCodeErrorMessage(status: number, rawBody: string): string {
  const text = (rawBody || '').trim()
  if (!text) return `HTTP ${status}: 空响应`

  if (
    text.startsWith('<!DOCTYPE html>') ||
    text.startsWith('<html') ||
    text.includes('<html') ||
    text.includes('og:image') ||
    text.includes('<title>')
  ) {
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = titleMatch ? titleMatch[1].trim() : '页面未找到'
    return `HTTP ${status}: 上游返回 HTML 页面（${title}），疑似官方或镜像源站服务抖动`
  }

  try {
    const parsed = JSON.parse(text)
    if (parsed.error?.message) return `HTTP ${status}: ${parsed.error.message}`
    if (parsed.message) return `HTTP ${status}: ${parsed.message}`
  } catch {}

  return `HTTP ${status}: ${text.substring(0, 200)}`
}

export async function proxyOpenCodeRequest(options: OpenCodeRequestOptions): Promise<Response> {
  const fetcher = options.fetcher ?? fetch
  const random = options.random ?? Math.random
  const requestId = createOpenCodeId('msg')
  const sessionId = createOpenCodeId('ses')
  let officialFailure: StoredFailure | null = null
  let mirrorFailure: StoredFailure | null = null
  let lastTransportError: unknown = null

  // 预处理 POST chat/completions 请求体：适配 OpenCode 免费层规则（强制 stream + 内容指纹注入）
  let clientWantsStream = true
  let upstreamBody = options.body
  let requestedModel = ''

  if (options.body && options.method === 'POST' && options.subPath.includes('chat/completions')) {
    try {
      const parsed = JSON.parse(options.body) as Record<string, any>
      if (parsed && typeof parsed === 'object') {
        requestedModel = typeof parsed.model === 'string' ? parsed.model : ''
        clientWantsStream = parsed.stream !== false && parsed.stream !== undefined
        parsed.stream = true

        // 免费层内容闸门：system 注入官方 prompt 片段；带 tools 时前置官方工具定义（详见 opencode-compat.ts）
        ensureOpenCodeCompat(parsed)
        parsed.store = false
        upstreamBody = JSON.stringify(parsed)
      }
    } catch {
      // 保持原样
    }
  }

  const upstreamOptions: OpenCodeRequestOptions = {
    ...options,
    body: upstreamBody,
  }

  const enabledKeys = options.apiKeys.filter((entry) => entry.enabled && entry.key)
  const officialUrl = buildUrl(options.baseUrl, options.subPath, options.search)

  if (enabledKeys.length > 0) {
    for (const entry of enabledKeys) {
      try {
        const response = await requestUpstream(
          fetcher,
          officialUrl,
          entry.key,
          upstreamOptions,
          requestId,
          sessionId
        )
        if (response.ok) {
          if (!clientWantsStream && (response.headers.get('content-type') || '').includes('text/event-stream')) {
            return aggregateOpenCodeStream(response, requestedModel)
          }
          return response
        }

        officialFailure = await storeFailure(response)
        if (response.status !== 401 && response.status !== 403 && response.status !== 429) break
      } catch (error) {
        lastTransportError = error
        break
      }
    }
  } else {
    // 未配置自定义 Key 时：官方 /inference/v1（免费层新入口，2026-10-15 实测直连可用）优先，
    // 镜像节点作为兜底；旧 /zen/v1 已对匿名请求全量 403，由 buildUrl 统一改写为 /inference/v1。
    const candidateBases = [
      options.baseUrl,
      'https://opencode.ai/inference/v1',
      ...getMirrorOrder(options.mirrorUrls, random),
    ]
    const uniqueBases = [...new Set(candidateBases)]

    for (const base of uniqueBases) {
      try {
        const response = await requestUpstream(
          fetcher,
          buildUrl(base, options.subPath, options.search),
          'public',
          upstreamOptions,
          requestId,
          sessionId
        )
        if (response.ok) {
          if (!clientWantsStream && (response.headers.get('content-type') || '').includes('text/event-stream')) {
            return aggregateOpenCodeStream(response, requestedModel)
          }
          return response
        }
        mirrorFailure = await storeFailure(response)
      } catch (error) {
        lastTransportError = error
      }
    }
  }

  const finalFailure = mirrorFailure || officialFailure
  if (finalFailure) return sanitizeFailureResponse(finalFailure)
  return transportErrorResponse(lastTransportError)
}

export async function testOpenCodeModel(
  baseUrl: string,
  apiKeys: ApiKeyEntry[],
  modelId: string,
  mirrorUrls: string[],
  fetcher?: typeof fetch
): Promise<OpenCodeTestResult> {
  const response = await proxyOpenCodeRequest({
    baseUrl,
    apiKeys,
    mirrorUrls,
    method: 'POST',
    subPath: 'chat/completions',
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
    }),
    fetcher,
  })

  if (response.ok) {
    return { success: true, message: '连接成功', statusCode: response.status }
  }

  const body = await response.text()
  return {
    success: false,
    message: formatOpenCodeErrorMessage(response.status, body),
    statusCode: response.status,
  }
}

/**
 * 获取 OpenCode 官方与镜像模型列表：
 * 1. 优先请求官方最新模型全量元数据源 https://models.opencode.ai/api.json，同步所有最新模型与免费模型。
 * 2. 若失败则回退到通过 proxyOpenCodeRequest 请求 /models 端点。
 */
export async function fetchOpenCodeModels(
  baseUrl: string,
  apiKeys: ApiKeyEntry[],
  mirrorUrls: string[],
  fetcher?: typeof fetch
): Promise<OpenCodeTestResult> {
  const f = fetcher ?? fetch
  const hasKey = apiKeys.some((k) => k.enabled && k.key)

  // 1. 优先尝试从官方最新模型元数据仓库获取
  try {
    const catalogRes = await f(OPENCODE_MODELS_CATALOG_URL, {
      headers: {
        'User-Agent': `opencode/latest/${OPENCODE_VERSION}/cli`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (catalogRes.ok) {
      const catalogData = (await catalogRes.json()) as Record<string, any>
      const opencodeModels = catalogData?.opencode?.models || {}
      const entries = Object.entries(opencodeModels)

      if (entries.length > 0) {
        const modelsList = entries.map(([id, m]: [string, any]) => {
          const isFree = Boolean(
            (m.cost && m.cost.input === 0 && m.cost.output === 0) ||
            id.endsWith('-free') ||
            id.includes('-free') ||
            id === 'big-pickle' ||
            id === 'grok-code' ||
            id === 'gpt-5-nano'
          )
          return {
            id,
            object: 'model',
            created: m.release_date ? Math.floor(new Date(m.release_date).getTime() / 1000) : 1791986000,
            owned_by: 'opencode',
            name: m.name || id,
            description: m.description,
            free: isFree,
          }
        })

        // 若无有效 Key，则默认筛选出所有官方最新免费模型（共 40 款左右）；若有 Key 则展示全量
        const filtered = hasKey ? modelsList : modelsList.filter((m) => m.free)

        return {
          success: true,
          message: '连接成功（已同步官方最新 2.0 模型目录）',
          statusCode: 200,
          data: {
            object: 'list',
            data: filtered,
          },
        }
      }
    }
  } catch {
    // 回退到 /models 接口
  }

  // 2. 回退：通过镜像/直连获取 /models
  const response = await proxyOpenCodeRequest({
    baseUrl,
    apiKeys,
    mirrorUrls,
    method: 'GET',
    subPath: 'models',
    fetcher: f,
  })

  if (!response.ok) {
    const body = await response.text()
    return {
      success: false,
      message: formatOpenCodeErrorMessage(response.status, body),
      statusCode: response.status,
    }
  }

  try {
    const data = await response.json() as { data?: Array<{ id?: unknown }> }
    const rawList = Array.isArray(data.data) ? data.data : []
    const list = hasKey ? rawList : filterOpenCodeModels(rawList)
    return {
      success: true,
      message: '连接成功',
      statusCode: response.status,
      data: {
        ...data,
        data: list,
      },
    }
  } catch (err) {
    return {
      success: false,
      message: `上游返回非 JSON 响应: ${(err as Error).message || '解析失败'}`,
      statusCode: response.status,
    }
  }
}
