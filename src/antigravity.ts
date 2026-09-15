/**
 * Antigravity 反代 (provider.type = 'antigravity')
 *
 * Google 已停用 Gemini CLI / Code Assist 的个人免费额度（loadCodeAssist 直接把 free-tier 标记为
 * ineligible，generateContent 返回 403 SUBSCRIPTION_REQUIRED），官方指定迁移到 Antigravity。
 * 本模块复刻 CLIProxyAPI 的 Antigravity executor：
 *
 *  1. Antigravity OAuth（独立客户端/scope，loopback 回调 http://localhost:51121/oauth-callback）换 refresh_token
 *  2. loadCodeAssist(ideType=ANTIGRAVITY) 解析 project；没有则 onboardUser（走 daily 端点轮询）
 *  3. OpenAI 请求 -> Gemini 请求（复用 gemini-cli 的翻译），再套 Antigravity 信封
 *     { model, project, userAgent, requestType, requestId, request:{...} }（并删除 request.safetySettings）
 *  4. 响应（同样是 { response: {...} } 包装）翻译回 OpenAI，含 SSE 流式
 *
 * 渠道 apiKeys 里每行一个 Google 账号的 Antigravity refresh_token。
 */

import type { Env, UsageRecord } from './types'
import { getKV } from './storage-adapter'
import { addUsageRecord } from './storage'
import { openAIToGeminiRequest, geminiResponseToOpenAI, createOpenAIStream } from './gemini-translate'

// ===== Antigravity OAuth 客户端（来自 CLIProxyAPI internal/auth/antigravity） =====
// 凭据不入库: 通过 Worker 密钥注入, 先设置再部署
//   wrangler secret put AG_CLIENT_ID && wrangler secret put AG_CLIENT_SECRET
function agClientCredential(env: Env, key: 'AG_CLIENT_ID' | 'AG_CLIENT_SECRET'): string {
  const value = env[key]
  if (!value) throw new Error(`未配置 ${key}，请先执行 wrangler secret put ${key} 再部署`)
  return value
}
const AG_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
]
const AG_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const OAUTH_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
// Antigravity 是桌面客户端：loopback 回调，端口固定 51121，路径 /oauth-callback（Google 对 loopback 允许任意端口但路径需匹配）
const AG_REDIRECT_URI = 'http://localhost:51121/oauth-callback'

// 请求端点：生成走 daily，loadCodeAssist 走 prod（与 CLIProxyAPI 一致）
const AG_GEN_BASE = 'https://daily-cloudcode-pa.googleapis.com'
const AG_PROD_BASE = 'https://cloudcode-pa.googleapis.com'
const AG_API_VERSION = 'v1internal'
// Cloud Code 会拒绝低于 2.9.0 版本客户端请求较新模型，故 UA 版本不低于此
const AG_UA = 'antigravity/hub/2.9.1 darwin/arm64'
const AG_IDE_VERSION = '2.9.1'
const AG_GOOG_API_CLIENT = 'gl-node/22.21.1'

const AG_AT_PREFIX = 'antigravity:at:'
const AG_PJ_PREFIX = 'antigravity:pj:'
const AG_STATE_PREFIX = 'antigravity:oauth:'

interface AgUsage {
  promptTokens: number
  completionTokens: number
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randomId(): string {
  try { return crypto.randomUUID() } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` }
}

function randomHex(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }

function errorResponse(message: string, status: number, type = 'antigravity_error'): Response {
  return new Response(JSON.stringify({ error: { message, type } }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function agHeaders(accessToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    Accept: '*/*',
    'User-Agent': AG_UA,
    'X-Goog-Api-Client': AG_GOOG_API_CLIENT,
  }
}

// =====================================================================
// 内置 OAuth 授权（Antigravity 客户端，无 PKCE，loopback 回调）
// =====================================================================

/** 生成授权链接。登录后浏览器会尝试打开 localhost:51121（打不开是正常的），从地址栏复制 code。 */
export async function buildAntigravityAuthUrl(env: Env): Promise<{ url: string; state: string }> {
  const state = randomHex(32)
  await getKV(env).put(AG_STATE_PREFIX + state, '1', { expirationTtl: 600 })
  const params = new URLSearchParams({
    access_type: 'offline',
    client_id: agClientCredential(env, 'AG_CLIENT_ID'),
    prompt: 'consent',
    redirect_uri: AG_REDIRECT_URI,
    response_type: 'code',
    scope: AG_SCOPES.join(' '),
    state,
  })
  return { url: `${AG_AUTH_ENDPOINT}?${params.toString()}`, state }
}

/** 从用户粘贴的内容里取 code：既接受纯 code，也接受整段回调 URL */
function extractCode(input: string): string {
  const text = (input || '').trim()
  const match = text.match(/[?&]code=([^&\s]+)/)
  if (match) return decodeURIComponent(match[1])
  return text
}

export async function exchangeAntigravityCode(env: Env, codeOrUrl: string, state: string): Promise<{ refreshToken: string }> {
  const kv = getKV(env)
  const marker = await kv.get(AG_STATE_PREFIX + state)
  if (!marker) {
    throw new Error('授权会话不存在或已过期（10 分钟），请重新点击「用 Google 账号授权」')
  }
  const code = extractCode(codeOrUrl)
  if (!code) throw new Error('未识别到 code，请粘贴 Google 返回的 code 或整段回调地址')
  const form = new URLSearchParams({
    code,
    client_id: agClientCredential(env, 'AG_CLIENT_ID'),
    client_secret: agClientCredential(env, 'AG_CLIENT_SECRET'),
    redirect_uri: AG_REDIRECT_URI,
    grant_type: 'authorization_code',
  })
  const res = await fetch(OAUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    signal: AbortSignal.timeout(30000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`换取 token 失败 HTTP ${res.status}: ${text.slice(0, 300)}`)
  let json: { refresh_token?: string }
  try { json = JSON.parse(text) } catch { throw new Error(`换取 token 返回非 JSON: ${text.slice(0, 200)}`) }
  if (!json.refresh_token) throw new Error('Google 未返回 refresh_token，请重新授权并在同意页确认')
  await kv.delete(AG_STATE_PREFIX + state).catch(() => {})
  return { refreshToken: json.refresh_token }
}

// =====================================================================
// access_token 刷新（KV 缓存）
// =====================================================================

async function getAccessToken(env: Env, refreshToken: string): Promise<string> {
  const cacheKey = AG_AT_PREFIX + (await sha256Hex(refreshToken))
  const kv = getKV(env)
  const cached = await kv.get(cacheKey)
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as { accessToken?: string; expiresAt?: number }
      if (parsed.accessToken && (parsed.expiresAt || 0) - 300_000 > Date.now()) return parsed.accessToken
    } catch { /* re-refresh */ }
  }
  const form = new URLSearchParams({
    client_id: agClientCredential(env, 'AG_CLIENT_ID'),
    client_secret: agClientCredential(env, 'AG_CLIENT_SECRET'),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  const res = await fetch(OAUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    signal: AbortSignal.timeout(30000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Antigravity OAuth 刷新失败 HTTP ${res.status}: ${text.slice(0, 300)}`)
  let json: { access_token?: string; expires_in?: number }
  try { json = JSON.parse(text) } catch { throw new Error(`OAuth 刷新返回非 JSON: ${text.slice(0, 200)}`) }
  if (!json.access_token) throw new Error(`OAuth 刷新未返回 access_token: ${text.slice(0, 200)}`)
  const expiresIn = Number(json.expires_in) || 3600
  await kv.put(cacheKey, JSON.stringify({ accessToken: json.access_token, expiresAt: Date.now() + expiresIn * 1000 }), {
    expirationTtl: Math.max(60, expiresIn - 60),
  }).catch(() => {})
  return json.access_token
}

// =====================================================================
// 项目解析：loadCodeAssist(prod) -> 无则 onboardUser(daily)
// =====================================================================

function extractProject(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object') {
    const id = (value as Record<string, unknown>).id
    if (typeof id === 'string' && id.trim()) return id.trim()
  }
  return ''
}

function extractProjectFromLoad(load: any): string {
  for (const key of ['cloudaicompanionProject', 'projectId', 'project']) {
    const found = extractProject(load?.[key])
    if (found) return found
  }
  return ''
}

function defaultTierId(load: any): string {
  const tiers: any[] = Array.isArray(load?.allowedTiers) ? load.allowedTiers : []
  const preferred = tiers.find((t) => t?.isDefault) || tiers[0]
  if (preferred?.id) return String(preferred.id)
  if (load?.currentTier?.id) return String(load.currentTier.id)
  return 'free-tier'
}

async function resolveProjectId(env: Env, accessToken: string, tokenHash: string, hint?: string): Promise<string> {
  if (hint) return hint
  const kv = getKV(env)
  const cacheKey = AG_PJ_PREFIX + tokenHash
  const cached = await kv.get(cacheKey)
  if (cached) return cached

  const loadRes = await fetch(`${AG_PROD_BASE}/${AG_API_VERSION}:loadCodeAssist`, {
    method: 'POST',
    headers: agHeaders(accessToken),
    body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
    signal: AbortSignal.timeout(30000),
  })
  const loadText = await loadRes.text()
  if (!loadRes.ok) throw new Error(`loadCodeAssist 失败 HTTP ${loadRes.status}: ${loadText.slice(0, 200)}`)
  let load: any
  try { load = JSON.parse(loadText) } catch { throw new Error(`loadCodeAssist 返回非 JSON: ${loadText.slice(0, 200)}`) }

  let projectId = extractProjectFromLoad(load)
  if (!projectId) {
    const tierId = defaultTierId(load)
    let op: any = await fetch(`${AG_GEN_BASE}/${AG_API_VERSION}:onboardUser`, {
      method: 'POST',
      headers: agHeaders(accessToken),
      body: JSON.stringify({ tier_id: tierId, metadata: { ide_type: 'ANTIGRAVITY', ide_version: AG_IDE_VERSION, ide_name: 'antigravity' } }),
      signal: AbortSignal.timeout(30000),
    }).then((r) => r.json()).catch(() => null)
    for (let i = 0; i < 5 && op && op.done !== true; i++) {
      await sleep(800)
      // 轮询用同一端点重试
      op = await fetch(`${AG_GEN_BASE}/${AG_API_VERSION}:onboardUser`, {
        method: 'POST',
        headers: agHeaders(accessToken),
        body: JSON.stringify({ tier_id: tierId, metadata: { ide_type: 'ANTIGRAVITY', ide_version: AG_IDE_VERSION, ide_name: 'antigravity' } }),
        signal: AbortSignal.timeout(30000),
      }).then((r) => r.json()).catch(() => null)
    }
    projectId = extractProject(op?.response?.cloudaicompanionProject)
  }
  if (!projectId) throw new Error('未能解析 Antigravity 项目 ID（可在渠道配置里手动填写 project）')
  await kv.put(cacheKey, projectId, { expirationTtl: 86400 }).catch(() => {})
  return projectId
}

// =====================================================================
// 请求信封
// =====================================================================

function firstUserText(request: Record<string, any>): string {
  const contents: any[] = Array.isArray(request?.contents) ? request.contents : []
  for (const c of contents) {
    if (c?.role === 'user' && Array.isArray(c.parts)) {
      for (const p of c.parts) if (typeof p?.text === 'string' && p.text) return p.text
    }
  }
  return ''
}

/** 把 Gemini 请求套进 Antigravity 信封（删除 safetySettings，补 userAgent / requestType / requestId / sessionId） */
function buildEnvelope(modelId: string, projectId: string, geminiRequest: Record<string, any>): Record<string, unknown> {
  const request: Record<string, any> = { ...geminiRequest }
  delete request.safetySettings
  const isImage = /image/i.test(modelId)
  // sessionId：Stable 派生自首条用户文本（利于上游会话缓存）
  request.sessionId = isImage ? undefined : `-${randomHex(8)}`
  if (request.sessionId === undefined) delete request.sessionId
  return {
    model: modelId,
    project: projectId,
    userAgent: 'antigravity',
    requestType: isImage ? 'image_gen' : 'agent',
    requestId: isImage ? `image_gen/${Date.now()}/${randomId()}/12` : `agent-${randomId()}`,
    request,
  }
}

// =====================================================================
// 对外入口
// =====================================================================

export interface AntigravityCallParams {
  env: Env
  providerId: string
  modelId: string
  requestedModel: string
  body: Record<string, any>
  refreshTokens: string[]
  project?: string
  maskedToken: string
  startedAt: number
  waitUntil?: (promise: Promise<unknown>) => void
}

async function readErrorBody(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    const json = JSON.parse(text) as { error?: { message?: string }; message?: string }
    return json.error?.message || json.message || text
  } catch { return text }
}

async function recordUsage(p: AntigravityCallParams, usage: AgUsage, ok: boolean, status: number): Promise<void> {
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

/** 随机打散账号顺序(负载均衡): 每个请求先用随机账号, 失败再依次尝试其余账号。
 *  避免所有请求都压在第一个账号上, 让多账号的免费额度均匀消耗。
 *  返回的 index 是账号在渠道配置里的原始序号(1 起), 用于 x-ag-account 观测头。 */
function shuffleAccounts(list: string[]): Array<{ token: string; index: number }> {
  const arr = list.map((token, i) => ({ token: token.trim(), index: i + 1 }))
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

export async function handleAntigravityRequest(p: AntigravityCallParams): Promise<Response> {
  const accounts = shuffleAccounts((p.refreshTokens || []).filter((t) => t && t.trim()))
  if (accounts.length === 0) {
    return errorResponse('该 antigravity 渠道未配置凭据：请在「API Key」里每行填入一个 Google 账号的 Antigravity refresh_token（可点「用 Google 账号授权」获取）', 400, 'configuration_error')
  }
  const wantStream = p.body?.stream === true
  const translateOpts = { modelId: p.modelId }
  const { request: geminiRequest, nameMap } = openAIToGeminiRequest(p.body, translateOpts)
  let lastError = ''
  let lastStatus = 502

  for (let i = 0; i < accounts.length; i++) {
    const { token: refreshToken, index: accountIndex } = accounts[i]
    try {
      const hash = await sha256Hex(refreshToken)
      const accessToken = await getAccessToken(p.env, refreshToken)
      const projectId = await resolveProjectId(p.env, accessToken, hash, p.project)
      const envelope = buildEnvelope(p.modelId, projectId, geminiRequest)
      const url = `${AG_GEN_BASE}/${AG_API_VERSION}:${wantStream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`
      const upstream = await fetch(url, {
        method: 'POST',
        headers: agHeaders(accessToken),
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(300000),
      })

      if (!upstream.ok) {
        lastStatus = upstream.status
        lastError = `HTTP ${upstream.status}: ${(await readErrorBody(upstream)).slice(0, 300)}`
        if ([401, 403, 429].includes(upstream.status) || upstream.status >= 500) continue
        return errorResponse(lastError, upstream.status, 'upstream_error')
      }

      if (wantStream && upstream.body) {
        const stream = createOpenAIStream(upstream.body, p.requestedModel, nameMap, () => {}, (finalUsage) => {
          const task = recordUsage(p, finalUsage as AgUsage, true, 200)
          if (p.waitUntil) { try { p.waitUntil(task) } catch { task.catch(() => {}) } } else { task.catch(() => {}) }
        }, translateOpts)
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'x-ag-account': String(accountIndex) },
        })
      }

      const rawText = await upstream.text()
      let json: unknown
      try { json = JSON.parse(rawText) } catch { return errorResponse(`上游返回非 JSON: ${rawText.slice(0, 200)}`, 502, 'upstream_error') }
      const openai = geminiResponseToOpenAI(json, p.requestedModel, nameMap, translateOpts)
      const usage = extractUsage(json)
      await recordUsage(p, usage, true, 200)
      return new Response(JSON.stringify(openai), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'x-ag-account': String(accountIndex) },
      })
    } catch (err) {
      lastError = (err as Error).message || '未知错误'
      lastStatus = 502
      continue
    }
  }
  return errorResponse(`所有 Antigravity 账号均失败，最后一次错误: ${lastError || '未知'}`, lastStatus, 'key_exhausted')
}

function extractUsage(body: unknown): AgUsage {
  const data = (body && typeof body === 'object' && 'response' in (body as Record<string, unknown>))
    ? (body as { response: Record<string, unknown> }).response
    : (body as Record<string, unknown>)
  const meta = (data?.usageMetadata || {}) as Record<string, unknown>
  const n = (v: unknown) => Number(v) || 0
  return { promptTokens: n(meta.promptTokenCount), completionTokens: n(meta.candidatesTokenCount) }
}

// =====================================================================
// 后台：连通性测试 / 可用模型
// =====================================================================

export async function testAntigravity(
  env: Env,
  refreshToken: string,
  modelId: string,
  project?: string,
): Promise<{ success: boolean; message: string; statusCode?: number }> {
  if (!refreshToken) return { success: false, message: '未填写 refresh_token', statusCode: 0 }
  try {
    const hash = await sha256Hex(refreshToken)
    const accessToken = await getAccessToken(env, refreshToken)
    const projectId = await resolveProjectId(env, accessToken, hash, project)
    const { request: geminiRequest } = openAIToGeminiRequest({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 })
    const envelope = buildEnvelope(modelId, projectId, geminiRequest)
    const res = await fetch(`${AG_GEN_BASE}/${AG_API_VERSION}:generateContent`, {
      method: 'POST',
      headers: agHeaders(accessToken),
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(30000),
    })
    if (res.ok) return { success: true, message: `连接成功（project: ${projectId}）`, statusCode: 200 }
    return { success: false, message: `HTTP ${res.status}: ${(await readErrorBody(res)).slice(0, 200)}`, statusCode: res.status }
  } catch (err) {
    return { success: false, message: (err as Error).message || '连接失败' }
  }
}

export async function testAntigravityRotating(
  env: Env,
  refreshTokens: string[],
  modelId: string,
  project?: string,
): Promise<{ success: boolean; message: string; statusCode?: number; keyIndex?: number }> {
  const list = (refreshTokens || []).filter((t) => t && t.trim())
  if (list.length === 0) return { success: false, message: '该渠道未配置任何 refresh_token', statusCode: 0 }
  let last: { success: boolean; message: string; statusCode?: number } = { success: false, message: '连接失败', statusCode: 0 }
  for (let i = 0; i < list.length; i++) {
    const r = await testAntigravity(env, list[i].trim(), modelId, project)
    if (r.success) {
      return { ...r, keyIndex: i, message: list.length > 1 ? `${r.message} (账号 #${i + 1}/${list.length})` : r.message }
    }
    last = r
    const st = r.statusCode || 0
    if (st === 429 || st === 401 || st === 403 || st >= 500) continue
    break
  }
  return last
}

/** 拉取 Antigravity 可用模型（fetchAvailableModels），尽力从多种响应结构里提取模型名 */
export async function fetchAntigravityModels(
  env: Env,
  refreshToken: string,
): Promise<{ success: boolean; models: string[]; message?: string; raw?: unknown }> {
  try {
    const accessToken = await getAccessToken(env, refreshToken)
    const res = await fetch(`${AG_GEN_BASE}/${AG_API_VERSION}:fetchAvailableModels`, {
      method: 'POST',
      headers: agHeaders(accessToken),
      body: '{}',
      signal: AbortSignal.timeout(30000),
    })
    const text = await res.text()
    if (!res.ok) return { success: false, models: [], message: `HTTP ${res.status}: ${text.slice(0, 200)}` }
    let json: any
    try { json = JSON.parse(text) } catch { return { success: false, models: [], message: '返回非 JSON' } }
    const ids = new Set<string>()
    // 主结构: { "models": { "<modelId>": { displayName, quotaInfo, ... } } } —— 模型名是对象的 key
    const modelsObj = json?.models
    if (modelsObj && typeof modelsObj === 'object' && !Array.isArray(modelsObj)) {
      for (const key of Object.keys(modelsObj)) {
        if (/^(chat_|tab_)/i.test(key)) continue
        if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key)) ids.add(key)
      }
    }
    // 兜底：递归查找 id/name/model 等字段（兼容其他结构）
    if (ids.size === 0) {
      const visit = (node: any, depth = 0) => {
        if (depth > 6 || node == null) return
        if (Array.isArray(node)) { for (const v of node) visit(v, depth + 1); return }
        if (typeof node === 'object') {
          for (const [k, v] of Object.entries(node)) {
            if (typeof v === 'string' && /^(id|name|model|modelId|model_id)$/.test(k) && /^[a-z0-9][a-z0-9._-]*$/i.test(v) && /gemini|claude|gpt|image|flash|pro/i.test(v)) {
              ids.add(v)
            } else {
              visit(v, depth + 1)
            }
          }
        }
      }
      visit(json)
    }
    return { success: true, models: [...ids].sort(), raw: ids.size === 0 ? json : undefined }
  } catch (err) {
    return { success: false, models: [], message: (err as Error).message || '拉取失败' }
  }
}

// =====================================================================
// 额度查看（参照 CLIProxyAPI 的 quota 视图）
//   - loadCodeAssist 取层级与项目
//   - fetchAvailableModels 取每个模型的 quotaInfo.remainingFraction / resetTime
// =====================================================================

export interface AgQuotaModel {
  id: string
  name?: string
  /** 剩余配额比例 0~1，null 表示上游未提供 */
  remaining: number | null
  resetTime?: string
  recommended?: boolean
  supportsThinking?: boolean
}

export interface AgQuotaAccount {
  index: number
  ok: boolean
  error?: string
  /** 账号层级，如 "Gemini Code Assist" / "free-tier" */
  tier?: string
  tierId?: string
  project?: string
  models: AgQuotaModel[]
}

/** 查询渠道各账号的额度使用情况（多账号逐个查询，最多 5 个） */
export async function fetchAntigravityQuota(
  env: Env,
  refreshTokens: string[],
  project?: string,
): Promise<AgQuotaAccount[]> {
  const list = (refreshTokens || []).filter((t) => t && t.trim()).slice(0, 5)
  const out: AgQuotaAccount[] = []
  for (let i = 0; i < list.length; i++) {
    const account: AgQuotaAccount = { index: i, ok: false, models: [] }
    try {
      const token = list[i].trim()
      const accessToken = await getAccessToken(env, token)
      const hash = await sha256Hex(token)

      // 层级信息（best-effort，失败不影响配额查询）
      try {
        const loadRes = await fetch(`${AG_PROD_BASE}/${AG_API_VERSION}:loadCodeAssist`, {
          method: 'POST',
          headers: agHeaders(accessToken),
          body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
          signal: AbortSignal.timeout(30000),
        })
        if (loadRes.ok) {
          const load: any = await loadRes.json().catch(() => null)
          account.tier = load?.currentTier?.name || (Array.isArray(load?.allowedTiers) ? load.allowedTiers[0]?.name : undefined)
          account.tierId = load?.currentTier?.id || (Array.isArray(load?.allowedTiers) ? load.allowedTiers[0]?.id : undefined)
        }
      } catch { /* 忽略 */ }

      account.project = await resolveProjectId(env, accessToken, hash, project).catch(() => undefined)

      const res = await fetch(`${AG_GEN_BASE}/${AG_API_VERSION}:fetchAvailableModels`, {
        method: 'POST',
        headers: agHeaders(accessToken),
        body: '{}',
        signal: AbortSignal.timeout(30000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 150)}`)
      const json: any = JSON.parse(await res.text())
      const modelsObj = json?.models
      if (modelsObj && typeof modelsObj === 'object' && !Array.isArray(modelsObj)) {
        for (const [id, m] of Object.entries<any>(modelsObj)) {
          if (/^(chat_|tab_)/i.test(id)) continue
          const qi = m?.quotaInfo || {}
          account.models.push({
            id,
            name: typeof m?.displayName === 'string' ? m.displayName : undefined,
            remaining: typeof qi.remainingFraction === 'number' ? qi.remainingFraction : null,
            resetTime: typeof qi.resetTime === 'string' ? qi.resetTime : undefined,
            recommended: !!m?.recommended,
            supportsThinking: !!m?.supportsThinking,
          })
        }
        account.models.sort((a, b) => a.id.localeCompare(b.id))
      }
      account.ok = true
    } catch (err) {
      account.error = (err as Error).message || '查询失败'
    }
    out.push(account)
  }
  return out
}
