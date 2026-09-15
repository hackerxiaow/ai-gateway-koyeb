/**
 * Devin 反代 (provider.type = 'devin')
 *
 * 复刻 CLIProxyAPI 的 Devin executor + OAuth：
 *
 *  1. OAuth（PKCE，无回调的「手动复制 code」模式，适合部署在 Cloudflare Worker 上）：
 *     授权页 https://app.devin.ai/auth/cli/continue?state=..&prompt=select_account
 *            &code_challenge=..&code_challenge_method=S256&cli_pkce_marker=1
 *     用户在页面拿到 code → POST https://api.devin.ai/auth/cli/token {code, code_verifier}
 *     → session token（补 `devin-session-token$` 前缀）→ GET https://api.devin.ai/v3/self 取用户信息
 *
 *  2. 调用：POST https://server.codeium.com/exa.api_server_pb.ApiServerService/GetChatMessage
 *     Connect-RPC（Content-Type: application/connect+proto，protobuf 载荷由 devin-wire 编解码），
 *     响应是 Connect 帧流，逐帧解析出思考/正文/工具调用/用量，再翻译成 OpenAI SSE。
 *
 *  3. 渠道 apiKeys 每行一个 session token（也兼容 Devin API Key，同样按 Basic 鉴权发送）。
 *     多凭据随机打散做负载均衡，失败自动切换。
 */

import type { Env, UsageRecord } from './types'
import { getKV } from './storage-adapter'
import { addUsageRecord } from './storage'
import {
  DEVIN_CHAT_PATH,
  DEVIN_DEFAULT_BASE_URL,
  CONNECT_FLAG_COMPRESSED,
  CONNECT_FLAG_END_STREAM,
  Utf8SplitBuffer,
  buildDevinGetChatMessageRequest,
  generateDevinDeviceFingerprint,
  gunzipBytes,
  parseDevinFrame,
  parseDevinResponseDimensionGroups,
  parseDevinTrailerError,
  readConnectFrame,
  resolveDevinChatModelUid,
  setDevinModelCatalog,
  wrapConnectEnvelope,
  type DevinPrompt,
  type DevinTool,
  type DevinUsage,
} from './devin-wire'

const DEVIN_APP_BASE = 'https://app.devin.ai'
const DEVIN_API_BASE = 'https://api.devin.ai'
/** session token 前缀（Devin CLI 约定，缺失时上游会拒绝） */
const DEVIN_TOKEN_PREFIX = 'devin-session-token$'
/** PKCE 暂存 key 前缀（state -> code_verifier） */
const PKCE_PREFIX = 'devin:pkce:'
/** 模型目录缓存 key */
const CATALOG_KEY = 'devin:models-catalog'
/** 模型目录来源（与 CLIProxyAPI 一致，3 小时过期） */
const CATALOG_URLS = [
  'https://models.router-for.me/devin_models.json',
  'https://raw.githubusercontent.com/router-for-me/models/refs/heads/main/devin_models.json',
]
const CATALOG_TTL_SECONDS = 3 * 3600

export interface DevinCallParams {
  env: Env
  providerId: string
  /** 上游模型名（渠道里配置的模型 id） */
  modelId: string
  /** 客户端请求的模型名（回填响应） */
  requestedModel: string
  body: Record<string, any>
  /** 渠道 apiKeys（每行一个 session token / API Key） */
  credentials: string[]
  /** 会话标识（用于 Devin 的 session/cascade id，来自请求头） */
  sessionHint?: string
  maskedToken: string
  startedAt: number
  waitUntil?: (promise: Promise<unknown>) => void
}

// ===== 通用工具 =====

function errorResponse(message: string, status: number, type = 'devin_error'): Response {
  return new Response(JSON.stringify({ error: { message, type } }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function randomId(): string {
  try { return crypto.randomUUID() } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` }
}

function base64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 随机字节（PKCE verifier 用） */
function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length)
  crypto.getRandomValues(out)
  return out
}

/** 规范化 session token（补前缀；已是前缀则原样） */
export function formatDevinSessionToken(raw: string): string {
  const t = (raw || '').trim()
  if (!t) return ''
  return t.startsWith(DEVIN_TOKEN_PREFIX) ? t : DEVIN_TOKEN_PREFIX + t
}

/** 非 UUID 的会话串按 RFC4122 v5(SHA-1) 映射成稳定 UUID；空则随机 */
async function normalizeDevinUuid(raw?: string): Promise<string> {
  const text = (raw || '').trim()
  if (!text) return randomId()
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return text.toLowerCase()
  // UUID v5：命名空间 OID + 名称做 SHA-1，取前 16 字节并打上版本/变体位
  const ns = new Uint8Array([0x6b, 0xa7, 0xb8, 0x11, 0x9d, 0xad, 0x11, 0xd1, 0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8])
  const nameBytes = new TextEncoder().encode(text)
  const buf = new Uint8Array(ns.length + nameBytes.length)
  buf.set(ns, 0)
  buf.set(nameBytes, ns.length)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', buf))
  const h = new Uint8Array(digest.slice(0, 16))
  h[6] = (h[6] & 0x0f) | 0x50
  h[8] = (h[8] & 0x3f) | 0x80
  const hex = [...h].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** 随机打散凭据顺序做负载均衡 */
function shuffleCredentials(list: string[]): Array<{ cred: string; index: number }> {
  const arr = list.map((cred, i) => ({ cred, index: i + 1 }))
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

// ===== OAuth（PKCE，手动复制 code） =====

export interface DevinOAuthStart {
  url: string
  state: string
}

/** 生成授权链接：不传 redirect_uri，走 Devin CLI 的 cli_pkce_marker 模式（页面直接给 code） */
export async function startDevinOAuth(env: Env): Promise<DevinOAuthStart> {
  const verifier = base64Url(randomBytes(48))
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  const state = randomId()
  await getKV(env).put(PKCE_PREFIX + state, JSON.stringify({ verifier }), { expirationTtl: 900 })
  const query = [
    `state=${encodeURIComponent(state)}`,
    'prompt=select_account',
    `code_challenge=${encodeURIComponent(challenge)}`,
    'code_challenge_method=S256',
    'cli_pkce_marker=1',
  ].join('&')
  return { url: `${DEVIN_APP_BASE}/auth/cli/continue?${query}`, state }
}

export interface DevinOAuthResult {
  sessionToken: string
  userName?: string
  userId?: string
  orgId?: string
}

/** 用页面拿到的 code 换 session token 并拉取用户信息 */
export async function completeDevinOAuth(env: Env, code: string, state: string): Promise<DevinOAuthResult> {
  const trimmedCode = (code || '').trim()
  if (!trimmedCode) throw new Error('请填写从授权页复制的 code')
  const kv = getKV(env)
  let verifier = ''
  if (state) {
    const cached = await kv.get(PKCE_PREFIX + state)
    if (cached) {
      try { verifier = String((JSON.parse(cached) as { verifier?: string }).verifier || '') } catch { /* 忽略 */ }
      await kv.delete(PKCE_PREFIX + state).catch(() => {})
    }
  }
  if (!verifier) throw new Error('授权会话已过期，请重新点击「用 Devin 账号授权」')

  const res = await fetch(`${DEVIN_API_BASE}/auth/cli/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code: trimmedCode, code_verifier: verifier }),
    signal: AbortSignal.timeout(30000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`换取 session token 失败: HTTP ${res.status}: ${text.slice(0, 200)}`)
  let token = ''
  try { token = String((JSON.parse(text) as { token?: string }).token || '').trim() } catch { /* 下面统一报错 */ }
  if (!token) throw new Error(`响应里没有 token: ${text.slice(0, 200)}`)

  const sessionToken = formatDevinSessionToken(token)
  const profile = await fetchDevinProfile(sessionToken)
  return { sessionToken, userName: profile.userName, userId: profile.userId, orgId: profile.orgId }
}

/** GET /v3/self —— 用户信息（best-effort，失败不影响凭据可用） */
async function fetchDevinProfile(sessionToken: string): Promise<{ userName?: string; userId?: string; orgId?: string }> {
  try {
    const res = await fetch(`${DEVIN_API_BASE}/v3/self`, {
      headers: { Authorization: `Bearer ${sessionToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return {}
    const json = (await res.json()) as Record<string, unknown>
    return {
      userName: typeof json.user_name === 'string' ? json.user_name : undefined,
      userId: typeof json.user_id === 'string' ? json.user_id : undefined,
      orgId: typeof json.org_id === 'string' ? json.org_id : undefined,
    }
  } catch { return {} }
}

// ===== 模型目录（运行时拉取 + KV 缓存） =====

interface CatalogModel {
  id?: string
  max_completion_tokens?: number
  thinking?: { levels?: string[] } | null
}

/** 拉取并注入 Devin 模型目录（供模型 UID 解析用），KV 缓存 3 小时 */
export async function loadDevinCatalog(env: Env): Promise<void> {
  const kv = getKV(env)
  const cached = await kv.get(CATALOG_KEY)
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as { catalog?: Record<string, unknown> }
      if (parsed?.catalog) { setDevinModelCatalog(parsed.catalog as Record<string, { thinking?: { levels: string[] } | null }>); return }
    } catch { /* 重新拉取 */ }
  }
  for (const url of CATALOG_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) continue
      const json = (await res.json()) as { devin?: CatalogModel[] }
      const list = Array.isArray(json?.devin) ? json.devin : []
      if (list.length === 0) continue
      const catalog: Record<string, { thinking?: { levels: string[] } | null }> = {}
      for (const m of list) {
        const id = (m.id || '').trim()
        if (!id) continue
        catalog[id] = { thinking: m.thinking?.levels ? { levels: m.thinking.levels } : null }
      }
      setDevinModelCatalog(catalog)
      await kv.put(CATALOG_KEY, JSON.stringify({ catalog }), { expirationTtl: CATALOG_TTL_SECONDS }).catch(() => {})
      return
    } catch { /* 换下一个源 */ }
  }
}

// ===== 请求体翻译（OpenAI chat completions -> Devin 载荷） =====

function textFromContent(content: unknown): { text: string; images: Array<{ mimeType: string; base64Data: string }> } {
  if (typeof content === 'string') return { text: content, images: [] }
  if (!Array.isArray(content)) return { text: '', images: [] }
  let text = ''
  const images: Array<{ mimeType: string; base64Data: string }> = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const p = part as Record<string, any>
    if (p.type === 'text' && typeof p.text === 'string') text += p.text
    else if (p.type === 'image_url') {
      const url = String(p.image_url?.url || p.image_url || '')
      const m = /^data:([^;,]+);base64,(.*)$/s.exec(url)
      if (m) images.push({ mimeType: m[1], base64Data: m[2] })
    }
  }
  return { text, images }
}

/** 把 OpenAI 消息拆成 system prompt 与 Devin 的历史轮次（source: 1=用户 2=助手 4=工具结果） */
export function toDevinPrompts(messages: unknown): { systemPrompt: string; prompts: DevinPrompt[] } {
  const list = Array.isArray(messages) ? messages : []
  const systems: string[] = []
  const prompts: DevinPrompt[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const m = raw as Record<string, any>
    const role = String(m.role || '')
    if (role === 'system' || role === 'developer') {
      const { text } = textFromContent(m.content)
      if (text) systems.push(text)
      continue
    }
    if (role === 'user') {
      const { text, images } = textFromContent(m.content)
      prompts.push({ source: 1, content: text, images: images.length ? images : undefined })
      continue
    }
    if (role === 'assistant') {
      const { text, images } = textFromContent(m.content)
      const toolCalls = Array.isArray(m.tool_calls)
        ? m.tool_calls.map((tc: any) => ({
            id: String(tc?.id || ''),
            name: String(tc?.function?.name || ''),
            arguments: typeof tc?.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc?.function?.arguments ?? {}),
          })).filter((tc: { name: string }) => tc.name)
        : undefined
      prompts.push({
        source: 2,
        content: text || undefined,
        images: images.length ? images : undefined,
        toolCalls: toolCalls && toolCalls.length ? toolCalls : undefined,
        thinking: typeof m.reasoning_content === 'string' && m.reasoning_content ? m.reasoning_content : undefined,
      })
      continue
    }
    if (role === 'tool') {
      const { text } = textFromContent(m.content)
      prompts.push({ source: 4, content: text || '{}', toolCallId: String(m.tool_call_id || '') })
      continue
    }
  }
  return { systemPrompt: systems.join('\n\n'), prompts }
}

/** OpenAI tools -> Devin tools */
export function toDevinTools(tools: unknown): DevinTool[] {
  const list = Array.isArray(tools) ? tools : []
  const out: DevinTool[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const t = raw as Record<string, any>
    const fn = t.type === 'function' ? t.function : t
    const name = String(fn?.name || '')
    if (!name) continue
    out.push({
      name,
      description: typeof fn?.description === 'string' ? fn.description : undefined,
      parametersJson: JSON.stringify(fn?.parameters ?? { type: 'object', properties: {} }),
    })
  }
  return out
}

// ===== 上游请求 =====

function devinHeaders(sessionToken: string): Record<string, string> {
  return {
    // Codeium/Devin 的 Connect-RPC 上游用 Basic <token>-<token> 作为线认证头
    Authorization: `Basic ${sessionToken}-${sessionToken}`,
    'Content-Type': 'application/connect+proto',
    'Connect-Protocol-Version': '1',
    Accept: '*/*',
    'Sentry-Trace': randomId().replace(/-/g, ''),
  }
}

async function readErrorBody(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    const json = JSON.parse(text) as Record<string, any>
    return String(json.message || json.error?.message || json.error || text).slice(0, 300)
  } catch { return text.slice(0, 300) }
}

interface DevinChunk {
  type: 'thinking' | 'content' | 'tool'
  text?: string
  toolIndex?: number
  toolId?: string
  toolName?: string
  toolArguments?: string
}

interface DevinStreamResult {
  chunks: DevinChunk[]
  usage: DevinUsage | null
  finishReason: string
}

/** 上游在 trailer 里返回的错误（鉴权失败等），调用方可据此切换到下一个凭据 */
class DevinUpstreamError extends Error {
  statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'DevinUpstreamError'
    this.statusCode = statusCode
  }
}

/** 把 Connect 帧流拆成 {flag, payload}（自动处理 gzip 帧） */
async function* connectFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<{ flag: number; payload: Uint8Array }> {
  const reader = body.getReader()
  let pending = new Uint8Array(0)
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value || value.length === 0) continue
    const merged = new Uint8Array(pending.length + value.length)
    merged.set(pending, 0)
    merged.set(value, pending.length)
    pending = merged
    for (;;) {
      const frame = readConnectFrame(pending)
      if (!frame) break
      pending = pending.slice(frame.consumed)
      const payload = frame.flag & CONNECT_FLAG_COMPRESSED ? await gunzipBytes(frame.payload) : frame.payload
      yield { flag: frame.flag, payload }
    }
  }
}

/** 处理一帧：解析思考/正文/工具调用/用量；返回 false 表示终止（trailer 正常结束） */
function handleDevinFrame(
  frame: { flag: number; payload: Uint8Array },
  state: {
    usage: DevinUsage | null
    dimensionGroups: Uint8Array[]
    toolSlots: Map<number, { id: string; name: string }>
    thinkingBuf: Utf8SplitBuffer
    contentBuf: Utf8SplitBuffer
    sawToolCall: boolean
  },
  emit: (chunk: DevinChunk) => void,
): boolean {
  if (frame.flag & CONNECT_FLAG_END_STREAM) {
    const trailer = parseDevinTrailerError(frame.payload)
    if (trailer?.statusCode) {
      throw new DevinUpstreamError(trailer.statusCode, trailer.message || '上游返回 trailer 错误')
    }
    return false
  }
  let parsed
  try { parsed = parseDevinFrame(frame.payload) } catch { return true }
  if (parsed.usage) {
    state.usage = state.usage ? {
      ...state.usage,
      promptTokens: parsed.usage.promptTokens || state.usage.promptTokens,
      completionTokens: parsed.usage.completionTokens || state.usage.completionTokens,
      cachedTokens: parsed.usage.cachedTokens || state.usage.cachedTokens,
    } : parsed.usage
  }
  if (parsed.responseDimensionGroups?.length) state.dimensionGroups.push(...parsed.responseDimensionGroups)
  if (parsed.thinkingText) {
    const text = state.thinkingBuf.feed(new TextEncoder().encode(parsed.thinkingText))
    if (text) emit({ type: 'thinking', text })
  }
  if (parsed.contentText) {
    const text = state.contentBuf.feed(new TextEncoder().encode(parsed.contentText))
    if (text) emit({ type: 'content', text })
  }
  for (const tc of parsed.toolCallDeltas || []) {
    state.sawToolCall = true
    const idx = Number.isFinite(tc.index) ? tc.index : 0
    const slot = state.toolSlots.get(idx) || { id: '', name: '' }
    if (tc.id) slot.id = tc.id
    if (tc.name) slot.name = tc.name
    state.toolSlots.set(idx, slot)
    emit({ type: 'tool', toolIndex: idx, toolId: tc.id || slot.id, toolName: tc.name || slot.name, toolArguments: tc.arguments || undefined })
  }
  return true
}

/** 消费帧流：pre 是已经窥视过的首帧（可能为空）；trailer 错误会抛出 DevinUpstreamError */
async function consumeDevinFrames(
  frames: AsyncGenerator<{ flag: number; payload: Uint8Array }>,
  pre: { flag: number; payload: Uint8Array } | null,
  onChunk?: (chunk: DevinChunk) => void,
): Promise<DevinStreamResult> {
  const chunks: DevinChunk[] = []
  const state = {
    usage: null as DevinUsage | null,
    dimensionGroups: [] as Uint8Array[],
    toolSlots: new Map<number, { id: string; name: string }>(),
    thinkingBuf: new Utf8SplitBuffer(),
    contentBuf: new Utf8SplitBuffer(),
    sawToolCall: false,
  }
  const emit = (chunk: DevinChunk) => {
    chunks.push(chunk)
    if (onChunk) onChunk(chunk)
  }
  if (pre && !handleDevinFrame(pre, state, emit)) {
    return { chunks, usage: state.usage, finishReason: state.sawToolCall ? 'tool_calls' : 'stop' }
  }
  for await (const frame of frames) {
    if (!handleDevinFrame(frame, state, emit)) break
  }
  // 用量兜底：部分帧只给 dimension groups
  if (state.dimensionGroups.length > 0 && (!state.usage || !state.usage.promptTokens || !state.usage.completionTokens)) {
    const dims = parseDevinResponseDimensionGroups(state.dimensionGroups)
    if (dims.found) {
      state.usage = {
        ...(state.usage || {}),
        promptTokens: state.usage?.promptTokens || Number(dims.promptTokens) || 0,
        completionTokens: state.usage?.completionTokens || Number(dims.completionTokens) || 0,
        cachedTokens: state.usage?.cachedTokens || Number(dims.cachedTokens) || 0,
      } as DevinUsage
    }
  }
  return { chunks, usage: state.usage, finishReason: state.sawToolCall ? 'tool_calls' : 'stop' }
}

// ===== 用量记录 =====

async function recordUsage(
  p: DevinCallParams,
  usage: { promptTokens: number; completionTokens: number },
  ok: boolean,
  status: number,
): Promise<void> {
  const record: UsageRecord = {
    ts: new Date().toISOString(),
    provider: p.providerId,
    model: p.requestedModel,
    token: p.maskedToken,
    ok,
    status,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    latencyMs: Date.now() - p.startedAt,
  }
  await addUsageRecord(p.env, record).catch(() => {})
}

// ===== 主处理 =====

export async function handleDevinRequest(p: DevinCallParams): Promise<Response> {
  const accounts = shuffleCredentials((p.credentials || []).map((c) => (c || '').trim()).filter(Boolean))
  if (accounts.length === 0) {
    return errorResponse('该 devin 渠道未配置凭据：请在「API Keys」里填入 Devin session token（可点「用 Devin 账号授权」获取），每行一个', 400, 'configuration_error')
  }

  await loadDevinCatalog(p.env).catch(() => {})
  const wantStream = p.body?.stream === true
  const includeUsage = !!p.body?.stream_options?.include_usage
  const { systemPrompt, prompts } = toDevinPrompts(p.body?.messages)
  const tools = toDevinTools(p.body?.tools)
  const temperature = typeof p.body?.temperature === 'number' ? p.body.temperature : null
  const maxTokens = Number(p.body?.max_tokens || p.body?.max_completion_tokens || 0) || 128000
  const thinkingLevel = typeof p.body?.reasoning_effort === 'string' ? p.body.reasoning_effort : ''
  const chatModelUid = resolveDevinChatModelUid(p.modelId, thinkingLevel || undefined, 0)
  const sessionId = await normalizeDevinUuid(p.sessionHint)
  const cascadeId = sessionId
  const responseId = `chatcmpl-${randomId().replace(/-/g, '').slice(0, 24)}`
  const created = Math.floor(Date.now() / 1000)

  let lastError = ''
  let lastStatus = 502

  for (let i = 0; i < accounts.length; i++) {
    const { cred, index: accountIndex } = accounts[i]
    const sessionToken = formatDevinSessionToken(cred)
    try {
      const payload = buildDevinGetChatMessageRequest({
        sessionToken,
        deviceSeed: sessionToken.slice(0, 64),
        chatModelUid,
        systemPrompt,
        prompts,
        tools,
        temperature,
        maxTokens,
        sessionId,
        cascadeId,
      })
      const upstream = await fetch(`${DEVIN_DEFAULT_BASE_URL}${DEVIN_CHAT_PATH}`, {
        method: 'POST',
        headers: devinHeaders(sessionToken),
        body: wrapConnectEnvelope(payload),
        signal: AbortSignal.timeout(300000),
      })

      if (!upstream.ok || !upstream.body) {
        lastStatus = upstream.status || 502
        lastError = `HTTP ${lastStatus}: ${await readErrorBody(upstream)}`
        await recordUsage(p, { promptTokens: 0, completionTokens: 0 }, false, lastStatus)
        if ([401, 403, 404, 429].includes(lastStatus) || lastStatus >= 500) continue
        return errorResponse(lastError, lastStatus, 'upstream_error')
      }

      // 窥视首帧：若首帧就是 trailer 错误（鉴权失败/限流），抛出以便切换到下一个凭据
      const frames = connectFrames(upstream.body as ReadableStream<Uint8Array>)
      const firstRead = await frames.next()
      const firstFrame = firstRead.done ? null : firstRead.value
      if (firstFrame && (firstFrame.flag & CONNECT_FLAG_END_STREAM)) {
        const trailer = parseDevinTrailerError(firstFrame.payload)
        if (trailer?.statusCode) throw new DevinUpstreamError(trailer.statusCode, trailer.message || '上游返回 trailer 错误')
      }

      // 流式：边读边推 OpenAI SSE
      if (wantStream) {
        const encoder = new TextEncoder()
        const model = p.requestedModel
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
            const deltaChunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
              id: responseId,
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [{ index: 0, delta, finish_reason: finish }],
            })
            send(deltaChunk({ role: 'assistant', content: '' }))
            let usage: DevinUsage | null = null
            let finishReason = 'stop'
            try {
              const result = await consumeDevinFrames(frames, firstFrame, (chunk) => {
                if (chunk.type === 'thinking') send(deltaChunk({ reasoning_content: chunk.text }))
                else if (chunk.type === 'content') send(deltaChunk({ content: chunk.text }))
                else {
                  send(deltaChunk({
                    tool_calls: [{
                      index: chunk.toolIndex ?? 0,
                      id: chunk.toolId || `call_${randomId().replace(/-/g, '').slice(0, 24)}`,
                      type: 'function',
                      function: { name: chunk.toolName || '', arguments: chunk.toolArguments || '' },
                    }],
                  }))
                }
              })
              usage = result.usage
              finishReason = result.finishReason
            } catch (err) {
              send({ error: { message: (err as Error).message || '上游流中断', type: 'upstream_error' } })
            }
            send(deltaChunk({}, finishReason))
            if (includeUsage) {
              send({
                id: responseId,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [],
                usage: {
                  prompt_tokens: usage?.promptTokens || 0,
                  completion_tokens: usage?.completionTokens || 0,
                  total_tokens: (usage?.promptTokens || 0) + (usage?.completionTokens || 0),
                  ...(usage?.cachedTokens ? { prompt_tokens_details: { cached_tokens: usage.cachedTokens } } : {}),
                },
              })
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
            const task = recordUsage(p, { promptTokens: usage?.promptTokens || 0, completionTokens: usage?.completionTokens || 0 }, true, 200)
            if (p.waitUntil) { try { p.waitUntil(task) } catch { task.catch(() => {}) } } else { task.catch(() => {}) }
          },
        })
        return new Response(stream, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-store',
            Connection: 'keep-alive',
            'x-devin-account': String(accountIndex),
          },
        })
      }

      // 非流式：读完整个帧流再一次性返回
      const result = await consumeDevinFrames(frames, firstFrame)
      const content = result.chunks.filter((c) => c.type === 'content').map((c) => c.text || '').join('')
      const reasoning = result.chunks.filter((c) => c.type === 'thinking').map((c) => c.text || '').join('')
      const toolCalls = result.chunks
        .filter((c) => c.type === 'tool')
        .map((c) => ({
          id: c.toolId || `call_${randomId().replace(/-/g, '').slice(0, 24)}`,
          type: 'function' as const,
          function: { name: c.toolName || '', arguments: c.toolArguments || '' },
        }))
      const message: Record<string, unknown> = { role: 'assistant', content: content || (toolCalls.length ? null : '') }
      if (reasoning) message.reasoning_content = reasoning
      if (toolCalls.length) message.tool_calls = toolCalls
      await recordUsage(p, { promptTokens: result.usage?.promptTokens || 0, completionTokens: result.usage?.completionTokens || 0 }, true, 200)
      return new Response(JSON.stringify({
        id: responseId,
        object: 'chat.completion',
        created,
        model: p.requestedModel,
        choices: [{ index: 0, message, finish_reason: result.finishReason }],
        usage: {
          prompt_tokens: result.usage?.promptTokens || 0,
          completion_tokens: result.usage?.completionTokens || 0,
          total_tokens: (result.usage?.promptTokens || 0) + (result.usage?.completionTokens || 0),
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'x-devin-account': String(accountIndex) },
      })
    } catch (err) {
      lastError = (err as Error).message || '未知错误'
      if (err instanceof DevinUpstreamError) {
        lastStatus = err.statusCode
        // 鉴权/限流类错误换下一个凭据；其余（如 400 参数错误）直接回给客户端
        if (![401, 403, 404, 429].includes(err.statusCode) && err.statusCode < 500) {
          await recordUsage(p, { promptTokens: 0, completionTokens: 0 }, false, err.statusCode)
          return errorResponse(`HTTP ${err.statusCode}: ${err.message}`, err.statusCode, 'upstream_error')
        }
        continue
      }
      lastStatus = 502
      continue
    }
  }
  return errorResponse(`所有 Devin 凭据均失败，最后一次错误: ${lastError || '未知'}`, lastStatus, 'key_exhausted')
}

// ===== 后台：凭据校验 =====

/** 校验 Devin 凭据（GET /v3/self） */
export async function testDevin(
  env: Env,
  credential: string,
  model?: string,
): Promise<{ success: boolean; message: string; statusCode?: number }> {
  const sessionToken = formatDevinSessionToken(credential)
  if (!sessionToken) return { success: false, message: '请填写 Devin session token', statusCode: 0 }
  try {
    const res = await fetch(`${DEVIN_API_BASE}/v3/self`, {
      headers: { Authorization: `Bearer ${sessionToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return { success: false, message: `HTTP ${res.status}: ${await readErrorBody(res)}`, statusCode: res.status }
    const json = (await res.json()) as Record<string, unknown>
    const who = [json.user_name, json.email].filter((v) => typeof v === 'string' && v).join(' · ') || '凭据有效'
    const modelHint = model ? `（模型 ${model} 请在对话中实测）` : ''
    return { success: true, message: `凭据有效：${who}${modelHint}`, statusCode: 200 }
  } catch (err) {
    return { success: false, message: (err as Error).message || '校验失败' }
  }
}
