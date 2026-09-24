import type { ApiKeyEntry, Env } from './types'

export const OPENCODE_PROVIDER_ID = 'opencode'

const OPENCODE_VERSION = '1.18.31'
// 免费层模型出字慢，流式响应可能持续数分钟；超时过短会在生成中途掐断连接，客户端表现为「重新连接」
const OPENCODE_TIMEOUT_MS = 300000

const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function randomBase62(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let result = ''
  for (let i = 0; i < length; i++) {
    result += BASE62_CHARS[bytes[i] % 62]
  }
  return result
}

let lastTimestamp = 0
let idCounter = 0

function createOpenCodeId(prefix: string): string {
  const currentTimestamp = Date.now()
  if (currentTimestamp !== lastTimestamp) {
    lastTimestamp = currentTimestamp
    idCounter = 0
  }
  idCounter++

  const now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(idCounter)
  let hex = ''
  for (let i = 0; i < 6; i++) {
    const byte = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff))
    hex += byte.toString(16).padStart(2, '0')
  }

  return `${prefix}_${hex}${randomBase62(14)}`
}

const OPENCODE_CORE_TOOL_NAMES = ['read', 'write', 'edit', 'shell', 'glob', 'grep']
// 上游免费层按「工具名」校验，不看描述内容；描述写成劝阻语，避免模型真的去调用这些占位工具。
const OPENCODE_PLACEHOLDER_TOOL_DESCRIPTION =
  'Do not call this tool. It exists only for API compatibility and must never be invoked.'
const OPENCODE_CORE_TOOLS = OPENCODE_CORE_TOOL_NAMES.map((name) => ({
  type: 'function',
  function: {
    name,
    description: OPENCODE_PLACEHOLDER_TOOL_DESCRIPTION,
    parameters: { type: 'object', properties: {} },
  },
}))

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

export function filterOpenCodeModels<T extends { id?: unknown }>(models: T[]): T[] {
  return models.filter((model) => (
    typeof model.id === 'string'
    && /^[A-Za-z0-9._:/-]+$/.test(model.id)
    && (model.id === 'big-pickle' || model.id.endsWith('-free'))
  ))
}

export function resolveOpenCodeUrls(env: Env): string[] {
  const raw = env.OPENCODE_MIRRORS_URL || ''
  // 兼容换行符、逗号、空格分隔；过滤空白；全局去重
  const parts = raw.split('\n').flatMap(s => s.split(',')).map(s => s.trim()).filter(Boolean)
  return [...new Set(parts)]
}

/**
 * 解析提供商生效的 OpenCode 镜像地址：
 * 优先使用后台配置的 provider.mirrorUrls, 为空时回退 OPENCODE_MIRRORS_URL 环境变量。
 */
export function resolveProviderMirrorUrls(env: Env, provider?: { mirrorUrls?: string[] }): string[] {
  if (provider?.mirrorUrls && provider.mirrorUrls.length > 0) {
    return [...new Set(provider.mirrorUrls.map(s => s.trim()).filter(Boolean))]
  }
  return resolveOpenCodeUrls(env)
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
  return `${baseUrl.replace(/\/+$/, '')}/${subPath.replace(/^\/+/, '')}${search}`
}

function createRequestHeaders(apiKey: string, requestId: string, sessionId: string): Headers {
  return new Headers({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'User-Agent': `opencode/${OPENCODE_VERSION} ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.13`,
    'x-opencode-client': 'cli',
    'x-opencode-project': 'global',
    'x-opencode-request': requestId,
    'x-opencode-session': sessionId,
  })
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

export async function proxyOpenCodeRequest(options: OpenCodeRequestOptions): Promise<Response> {
  const fetcher = options.fetcher ?? fetch
  const random = options.random ?? Math.random
  const requestId = createOpenCodeId('msg')
  const sessionId = createOpenCodeId('ses')
  let officialFailure: StoredFailure | null = null
  let mirrorFailure: StoredFailure | null = null
  let lastTransportError: unknown = null

  // 预处理 POST chat/completions 请求体：适配 OpenCode 免费层规则（强制 stream: true，补齐核心工具定义）
  let clientWantsStream = true
  let upstreamBody = options.body
  let requestedModel = ''

  if (options.body && options.method === 'POST' && options.subPath.includes('chat/completions')) {
    try {
      const parsed = JSON.parse(options.body) as Record<string, any>
      if (parsed && typeof parsed === 'object') {
        requestedModel = typeof parsed.model === 'string' ? parsed.model : ''
        clientWantsStream = parsed.stream !== false && parsed.stream !== undefined
        // 强制开启 stream，满足 OpenCode 免费层校验
        parsed.stream = true

        // 注入 / 补齐 OpenCode 核心工具列表，满足 OpenCode 免费层校验
        if (!Array.isArray(parsed.tools) || parsed.tools.length === 0) {
          parsed.tools = OPENCODE_CORE_TOOLS
        } else {
          const existingNames = new Set(
            parsed.tools.map((t: any) => t?.function?.name || t?.name).filter(Boolean)
          )
          const missingTools = OPENCODE_CORE_TOOLS.filter((t) => !existingNames.has(t.function.name))
          parsed.tools = [...parsed.tools, ...missingTools]
        }
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

  for (const mirror of getMirrorOrder(options.mirrorUrls, random)) {
    try {
      const response = await requestUpstream(
        fetcher,
        buildUrl(mirror, options.subPath, options.search),
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

  if (officialFailure) return restoreFailure(officialFailure)
  if (mirrorFailure) return restoreFailure(mirrorFailure)
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
    message: `HTTP ${response.status}: ${body.substring(0, 200)}`,
    statusCode: response.status,
  }
}

export async function fetchOpenCodeModels(
  baseUrl: string,
  apiKeys: ApiKeyEntry[],
  mirrorUrls: string[],
  fetcher?: typeof fetch
): Promise<OpenCodeTestResult> {
  const response = await proxyOpenCodeRequest({
    baseUrl,
    apiKeys,
    mirrorUrls,
    method: 'GET',
    subPath: 'models',
    fetcher,
  })

  if (!response.ok) {
    return {
      success: false,
      message: `HTTP ${response.status}: ${(await response.text()).substring(0, 200)}`,
      statusCode: response.status,
    }
  }

  const data = await response.json() as { data?: Array<{ id?: unknown }> }
  return {
    success: true,
    message: '连接成功',
    statusCode: response.status,
    data: {
      ...data,
      data: Array.isArray(data.data) ? filterOpenCodeModels(data.data) : [],
    },
  }
}
