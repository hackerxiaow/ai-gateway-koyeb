import type { ApiKeyEntry, Env } from './types'
import {
  OPENCODE_COMPAT_HEAD,
  OPENCODE_COMPAT_TAIL,
  OPENCODE_TITLE_MARKER,
  OPENCODE_CLI_MARKER,
  OPENCODE_OFFICIAL_TOOLS,
} from './opencode-compat'

export const OPENCODE_PROVIDER_ID = 'opencode'

// 上游服务端按 OpenCode 客户端指纹校验免费层请求（FreeTierError）。
// 2026-10 上游已切到 2.x 客户端，UA 格式从 `opencode/<version> ai-sdk/...` 改为
// `opencode/<channel>/<version>/<name>`（channel=prod，name=cli），
// 并新增 x-opencode-session-id / x-session-affinity / X-Session-Id 头、移除 x-opencode-request。
const OPENCODE_VERSION = '2.0.29'
const OPENCODE_CHANNEL = 'prod'
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

/**
 * 生成 OpenCode 风格 id（对齐官方 packages/schema/src/identifier.ts）：
 * `ses_` 用**倒序**时间戳（按位取反，高位呈 ecb... 特征，用于会话列表最新置顶），
 * `msg_` 用正序时间戳（高位呈 13x... 特征）。上游按前缀校验格式，倒序/正序写反会被判非法客户端。
 */
function createOpenCodeId(prefix: string, descending = false): string {
  const currentTimestamp = Date.now()
  if (currentTimestamp !== lastTimestamp) {
    lastTimestamp = currentTimestamp
    idCounter = 0
  }
  idCounter++

  const current = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(idCounter)
  const value = descending ? ~current : current
  let hex = ''
  for (let i = 0; i < 6; i++) {
    const byte = Number((value >> BigInt(40 - 8 * i)) & BigInt(0xff))
    hex += byte.toString(16).padStart(2, '0')
  }

  return `${prefix}_${hex}${randomBase62(14)}`
}

// 免费层内容闸门（详见 opencode-compat.ts）：system 必须含官方 prompt 片段，
// 带 tools 的请求还要求 tools 以官方工具集开头。两个 marker 的注入块在此拼好。
const OPENCODE_TITLE_BLOCK = `${OPENCODE_COMPAT_HEAD}\n${OPENCODE_TITLE_MARKER}\n${OPENCODE_COMPAT_TAIL}`
const OPENCODE_CLI_BLOCK = `${OPENCODE_COMPAT_HEAD}\n${OPENCODE_CLI_MARKER}\n${OPENCODE_COMPAT_TAIL}`

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
  // 2026-10 上游把匿名免费层入口从 /zen/v1 迁到 /inference/v1：旧路径对 Bearer public
  // 一律 403 FreeTierError。配置（后台/环境变量）里仍是旧写法，这里统一改写，避免改配置。
  const normalized = baseUrl.replace(/\/zen\/v1(?=\/|$)/, '/inference/v1')
  return `${normalized.replace(/\/+$/, '')}/${subPath.replace(/^\/+/, '')}${search}`
}

// 幂等探测：用 marker 前 80 字符判断请求里是否已含对应标记
const OPENCODE_TITLE_PROBE = OPENCODE_TITLE_MARKER.slice(0, 80)
const OPENCODE_CLI_PROBE = OPENCODE_CLI_MARKER.slice(0, 80)

/** 官方工具集比对键：name + parameters（两者是上游校验依据，description 不参与）。 */
function officialToolKey(tool: any): string {
  return `${tool?.function?.name ?? tool?.name}:${JSON.stringify(tool?.function?.parameters)}`
}

/** 幂等地把免费层兼容标记注入 messages（system 文本；缺失 system 时插到最前）。 */
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
 * 免费层兼容处理（详见 opencode-compat.ts）：
 * - 请求带 tools：system 注入官方 CLI 提示词片段，且 tools 前置官方 11 工具定义
 *   （name + parameters 原样，description 为劝阻语；客户端原工具保留在后）；
 * - 请求不带 tools：system 注入官方「标题生成」提示词片段即可。
 * 幂等：重复调用（重试/客户端已注入）不会二次追加。
 */
export function ensureOpenCodeCompat(payload: any): void {
  const messages = Array.isArray(payload?.messages) ? payload.messages : null
  if (!messages || messages.length === 0) return

  const hasTools = Array.isArray(payload.tools) && payload.tools.length > 0

  if (hasTools) {
    const tools = payload.tools as any[]
    // 客户端工具与官方工具同名时，上游会以 "must not be specified more than once" 400 拒绝，
    // 因此这里剔除客户端的重名项（官方定义必须保留，它是免费层校验依据）。
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

function createRequestHeaders(apiKey: string, sessionId: string): Headers {
  // 2.0 客户端指纹：UA 用 opencode/<channel>/<version>/<name> 四点格式；
  // 会话相关头 x-opencode-session / x-opencode-session-id / x-session-affinity / X-Session-Id 值全部取同一会话 id，
  // 与上游「会话亲和」判定对齐；x-opencode-request 已在 2.x 移除，不能再带。
  return new Headers({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'User-Agent': `opencode/${OPENCODE_CHANNEL}/${OPENCODE_VERSION}/cli`,
    'x-opencode-client': 'cli',
    'x-opencode-project': 'global',
    'x-opencode-session-id': sessionId,
    'x-opencode-session': sessionId,
    'x-session-affinity': sessionId,
    'X-Session-Id': sessionId,
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
  sessionId: string
): Promise<Response> {
  return fetcher(url, {
    method: options.method,
    headers: createRequestHeaders(apiKey, sessionId),
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
  const sessionId = createOpenCodeId('ses', true)
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
        // 强制开启 stream，满足 OpenCode 免费层校验
        parsed.stream = true

        // 免费层内容闸门：system 注入官方 prompt 片段；带 tools 时前置官方工具定义（详见 opencode-compat.ts）
        ensureOpenCodeCompat(parsed)
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
    // 未配置自定义 Key 时：官方源站（带 'public'）本身也是可用节点，优先尝试官方
    try {
      const response = await requestUpstream(
        fetcher,
        officialUrl,
        'public',
        upstreamOptions,
        sessionId
      )
      if (response.ok) {
        if (!clientWantsStream && (response.headers.get('content-type') || '').includes('text/event-stream')) {
          return aggregateOpenCodeStream(response, requestedModel)
        }
        return response
      }
      officialFailure = await storeFailure(response)
    } catch (error) {
      lastTransportError = error
    }
  }

  for (const mirror of getMirrorOrder(options.mirrorUrls, random)) {
    try {
      const response = await requestUpstream(
        fetcher,
        buildUrl(mirror, options.subPath, options.search),
        'public',
        upstreamOptions,
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
    const body = await response.text()
    return {
      success: false,
      message: formatOpenCodeErrorMessage(response.status, body),
      statusCode: response.status,
    }
  }

  try {
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
  } catch (err) {
    return {
      success: false,
      message: `上游返回非 JSON 响应: ${(err as Error).message || '解析失败'}`,
      statusCode: response.status,
    }
  }
}
