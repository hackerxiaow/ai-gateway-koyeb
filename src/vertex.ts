/**
 * Vertex AI 反代 (provider.type = 'vertex')
 *
 * 复刻 CLIProxyAPI 的 Gemini Vertex executor：
 *  1. 凭据 = GCP 服务账号 JSON（渠道 apiKeys 每行一个，多账号随机轮换）；
 *     也兼容 Vertex Express 模式的 API Key（AIza... 直接填在 apiKeys）
 *  2. 服务账号私钥签 RS256 JWT -> oauth2.googleapis.com 换 access_token（KV 缓存）
 *  3. OpenAI 请求 -> Gemini 请求（复用 gemini-translate），POST 到
 *     https://{location}-aiplatform.googleapis.com/v1/projects/{p}/locations/{location}/publishers/google/models/{model}:generateContent
 *     （location = global 时走 https://aiplatform.googleapis.com/v1/projects/.../locations/global/...）
 *  4. 响应为 Gemini 原生格式，翻译回 OpenAI，含 SSE 流式
 *
 * 渠道 location 建议：us-central1 / global（留空默认 us-central1）。
 */

import type { Env, UsageRecord } from './types'
import { getKV } from './storage-adapter'
import { addUsageRecord } from './storage'
import { openAIToGeminiRequest, geminiResponseToOpenAI, createOpenAIStream } from './gemini-translate'

const OAUTH_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const VERTEX_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
const VERTEX_API_VERSION = 'v1'
const DEFAULT_LOCATION = 'us-central1'
/** access_token 缓存 key 前缀（按凭据哈希区分） */
const AT_PREFIX = 'vertex:at:'

export interface VertexCredential {
  /** 原始凭据串（服务账号 JSON 或 API Key） */
  raw: string
  /** 服务账号邮箱（API Key 模式为空） */
  clientEmail?: string
  /** 解析出的私钥 PEM（API Key 模式为空） */
  privateKey?: string
  /** 服务账号里的 project_id（API Key 模式为空） */
  projectId?: string
  /** true = Express 模式 API Key */
  apiKeyMode: boolean
}

export interface VertexCallParams {
  env: Env
  providerId: string
  /** 上游真实模型 id（渠道里配置的模型名） */
  modelId: string
  /** 客户端请求的模型名（回填响应） */
  requestedModel: string
  body: Record<string, any>
  /** 渠道 apiKeys（每行一个服务账号 JSON / API Key） */
  credentials: string[]
  /** GCP 区域，留空用 us-central1 */
  location?: string
  maskedToken: string
  startedAt: number
  waitUntil?: (promise: Promise<unknown>) => void
}

interface VertexUsage {
  promptTokens: number
  completionTokens: number
}

// ===== 凭据解析 =====

/** 解析一条凭据：服务账号 JSON 或 Express API Key */
export function parseVertexCredential(raw: string): VertexCredential | null {
  const text = (raw || '').trim()
  if (!text) return null
  if (!text.startsWith('{')) {
    // Express 模式 API Key（AIza... 或其他字符串）
    return { raw: text, apiKeyMode: true }
  }
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    // 粘贴的 JSON 里私钥可能带真实换行（非法 JSON），做一次转义修复
    try { json = JSON.parse(text.replace(/\r?\n/g, '\\n')) } catch { return null }
  }
  const privateKey = String(json.private_key || '').replace(/\\n/g, '\n').trim()
  const clientEmail = String(json.client_email || '').trim()
  const projectId = String(json.project_id || '').trim()
  if (!privateKey || !clientEmail || !projectId) return null
  return { raw: text.replace(/\r?\n/g, '\\n'), clientEmail, privateKey, projectId, apiKeyMode: false }
}

// ===== 服务账号 JWT -> access_token =====

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function base64Url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function importServiceAccountKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
}

/** 用服务账号私钥签 RS256 JWT（Google 的 jwt-bearer 断言） */
export async function signVertexJwt(cred: VertexCredential): Promise<string> {
  if (!cred.clientEmail || !cred.privateKey) throw new Error('服务账号缺少 client_email / private_key')
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64Url(JSON.stringify({
    iss: cred.clientEmail,
    scope: VERTEX_SCOPE,
    aud: OAUTH_TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600,
  }))
  const signingInput = `${header}.${claims}`
  const key = await importServiceAccountKey(cred.privateKey)
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput))
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`
}

/** 取服务账号的 access_token（KV 缓存到过期前 5 分钟） */
async function getVertexAccessToken(env: Env, cred: VertexCredential): Promise<string> {
  const cacheKey = AT_PREFIX + (await sha256Hex(cred.raw))
  const kv = getKV(env)
  const cached = await kv.get(cacheKey)
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as { accessToken?: string; expiresAt?: number }
      if (parsed.accessToken && (parsed.expiresAt || 0) - 300_000 > Date.now()) return parsed.accessToken
    } catch { /* 重新获取 */ }
  }
  const assertion = await signVertexJwt(cred)
  const res = await fetch(OAUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
    signal: AbortSignal.timeout(30000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`换取 access_token 失败: HTTP ${res.status}: ${text.slice(0, 200)}`)
  let json: any
  try { json = JSON.parse(text) } catch { throw new Error(`access_token 响应非 JSON: ${text.slice(0, 200)}`) }
  if (!json.access_token) throw new Error(`access_token 缺失: ${text.slice(0, 200)}`)
  const expiresAt = Date.now() + (Number(json.expires_in) || 3600) * 1000
  await kv.put(cacheKey, JSON.stringify({ accessToken: json.access_token, expiresAt }), { expirationTtl: 3500 }).catch(() => {})
  return json.access_token as string
}

// ===== 请求 URL =====

function normalizeLocation(location?: string): string {
  const loc = (location || '').trim() || DEFAULT_LOCATION
  return loc
}

/** 生成 Vertex generateContent 端点（服务账号走带 project/location 的路径，API Key 走简化路径） */
export function buildVertexUrl(
  model: string,
  location: string | undefined,
  action: 'generateContent' | 'streamGenerateContent',
  apiKeyMode: boolean,
): string {
  const loc = normalizeLocation(location)
  const suffix = action === 'streamGenerateContent' ? ':streamGenerateContent?alt=sse' : ':generateContent'
  if (apiKeyMode) return `https://aiplatform.googleapis.com/${VERTEX_API_VERSION}/publishers/google/models/${model}${suffix}`
  const host = loc === 'global' ? 'https://aiplatform.googleapis.com' : `https://${loc}-aiplatform.googleapis.com`
  return `${host}/${VERTEX_API_VERSION}/publishers/google/models/${model}${suffix}`
}

// ===== 工具函数 =====

function errorResponse(message: string, status: number, type = 'vertex_error'): Response {
  return new Response(JSON.stringify({ error: { message, type } }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function readErrorBody(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    const json = JSON.parse(text) as { error?: { message?: string }; message?: string }
    return json.error?.message || json.message || text
  } catch { return text }
}

function extractUsage(json: unknown): VertexUsage {
  const meta = ((json as any)?.usageMetadata || {}) as Record<string, unknown>
  const n = (v: unknown) => Number(v) || 0
  return { promptTokens: n(meta.promptTokenCount), completionTokens: n(meta.candidatesTokenCount) }
}

/** 随机打散账号顺序(负载均衡): 先用随机凭据, 失败再依次尝试其余 */
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

async function recordUsage(p: VertexCallParams, usage: VertexUsage, ok: boolean, status: number): Promise<void> {
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

export async function handleVertexRequest(p: VertexCallParams): Promise<Response> {
  const accounts = shuffleCredentials((p.credentials || []).map((c) => (c || '').trim()).filter(Boolean))
  if (accounts.length === 0) {
    return errorResponse('该 vertex 渠道未配置凭据：请在「API Keys」里填入 GCP 服务账号 JSON（每行一个，可轮换），或 Vertex Express 模式的 API Key', 400, 'configuration_error')
  }
  const wantStream = p.body?.stream === true
  const translateOpts = { modelId: p.modelId }
  const { request: geminiRequest, nameMap } = openAIToGeminiRequest(p.body, translateOpts)
  let lastError = ''
  let lastStatus = 502

  for (let i = 0; i < accounts.length; i++) {
    const { cred: raw, index: accountIndex } = accounts[i]
    try {
      const cred = parseVertexCredential(raw)
      if (!cred) throw new Error('凭据格式错误：既不是服务账号 JSON，也不是有效的 API Key')

      const action = wantStream ? 'streamGenerateContent' : 'generateContent'
      const url = buildVertexUrl(p.modelId, p.location, action, cred.apiKeyMode)
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: '*/*' }
      if (cred.apiKeyMode) {
        headers['x-goog-api-key'] = cred.raw
      } else {
        headers.Authorization = `Bearer ${await getVertexAccessToken(p.env, cred)}`
      }

      const upstream = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(geminiRequest),
        signal: AbortSignal.timeout(300000),
      })

      if (!upstream.ok) {
        lastStatus = upstream.status
        lastError = `HTTP ${upstream.status}: ${(await readErrorBody(upstream)).slice(0, 300)}`
        if ([401, 403, 429].includes(upstream.status) || upstream.status >= 500) continue
        await recordUsage(p, { promptTokens: 0, completionTokens: 0 }, false, upstream.status)
        return errorResponse(lastError, upstream.status, 'upstream_error')
      }

      if (wantStream && upstream.body) {
        const stream = createOpenAIStream(upstream.body, p.requestedModel, nameMap, () => {}, (finalUsage) => {
          const usage = finalUsage as { promptTokens?: number; completionTokens?: number }
          const task = recordUsage(p, { promptTokens: Number(usage?.promptTokens) || 0, completionTokens: Number(usage?.completionTokens) || 0 }, true, 200)
          if (p.waitUntil) { try { p.waitUntil(task) } catch { task.catch(() => {}) } } else { task.catch(() => {}) }
        }, translateOpts)
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'x-vertex-account': String(accountIndex) },
        })
      }

      const rawText = await upstream.text()
      let json: unknown
      try { json = JSON.parse(rawText) } catch { return errorResponse(`上游返回非 JSON: ${rawText.slice(0, 200)}`, 502, 'upstream_error') }
      const openai = geminiResponseToOpenAI(json, p.requestedModel, nameMap, translateOpts)
      await recordUsage(p, extractUsage(json), true, 200)
      return new Response(JSON.stringify(openai), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'x-vertex-account': String(accountIndex) },
      })
    } catch (err) {
      lastError = (err as Error).message || '未知错误'
      lastStatus = 502
      continue
    }
  }
  return errorResponse(`所有 Vertex 凭据均失败，最后一次错误: ${lastError || '未知'}`, lastStatus, 'key_exhausted')
}

// ===== 后台：凭据校验 =====

/** 校验 Vertex 凭据（换 token，可选跑一次最小请求） */
export async function testVertex(
  env: Env,
  raw: string,
  model?: string,
  location?: string,
): Promise<{ success: boolean; message: string; statusCode?: number }> {
  const cred = parseVertexCredential(raw)
  if (!cred) return { success: false, message: '凭据格式错误：需要服务账号 JSON（含 project_id / client_email / private_key）或 API Key', statusCode: 0 }
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    let who = ''
    if (cred.apiKeyMode) {
      headers['x-goog-api-key'] = cred.raw
      who = 'Express API Key'
    } else {
      const token = await getVertexAccessToken(env, cred)
      headers.Authorization = `Bearer ${token}`
      who = `${cred.clientEmail} (project ${cred.projectId})`
    }
    if (!model) return { success: true, message: `凭据有效：${who}`, statusCode: 200 }
    const url = buildVertexUrl(model, location, 'generateContent', cred.apiKeyMode)
    const body = openAIToGeminiRequest({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }).request
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) })
    if (res.ok) return { success: true, message: `连接成功：${who} · 模型 ${model}`, statusCode: 200 }
    return { success: false, message: `HTTP ${res.status}: ${(await readErrorBody(res)).slice(0, 200)}`, statusCode: res.status }
  } catch (err) {
    return { success: false, message: (err as Error).message || '校验失败' }
  }
}
