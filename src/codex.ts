/**
 * ChatGPT (Codex) OAuth 反代 (provider.type = 'codex')
 *
 * 复刻 CLIProxyAPI 的 Codex OAuth + executor：
 *  1. Codex CLI 客户端 OAuth（PKCE，loopback 回调 http://localhost:1455/auth/callback），
 *     授权/换/刷 token 走 auth.openai.com，form-encoded
 *  2. account_id 从 access_token（JWT）的 chatgpt_account_id claim 解析，
 *     请求头带 Chatgpt-Account-Id + Originator + codex-tui UA
 *  3. OpenAI 请求 -> Responses 请求翻译，发到 chatgpt.com/backend-api/codex/responses，
 *     响应（含 SSE）翻译回 OpenAI；/v1/responses 原生协议同样支持透传
 *
 * 渠道 apiKeys 里每行一个 OpenAI OAuth refresh_token。
 */

import type { Env } from './types'
import { getKV } from './storage-adapter'
import {
  type OAuthCallParams,
  createPkcePair,
  oauthErrorResponse,
  randomHex,
  randomId,
  readErrorBody,
  recordOAuthUsage,
  defer,
  resolveAccessToken,
} from './oauth-common'
import { openAIToResponsesRequest, createOpenAIStreamFromResponses, collectResponsesStreamToOpenAI } from './responses-translate'

// ===== OAuth 客户端（来自 CLIProxyAPI internal/auth/codex） =====
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_AUTH_URL = 'https://auth.openai.com/oauth/authorize'
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CODEX_REDIRECT_URI = 'http://localhost:1455/auth/callback'
const CODEX_SCOPE = 'openid email profile offline_access'

const CODEX_API_BASE = 'https://chatgpt.com/backend-api/codex'
const CODEX_UA = 'codex-tui/0.154.0 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.154.0)'
const CODEX_ORIGINATOR = 'codex-tui'

const AT_PREFIX = 'codex:at:'
const STATE_PREFIX = 'codex:oauth:'

/**
 * 上游中继配置(存于 kv_store 的 codex:upstream):
 *   {"url": "https://<网关>/v1", "key": "sk_cf_..."}
 * 用于本机出口被 chatgpt.com 拦截的部署(如 Cloudflare Workers)，把 Responses 请求
 * 转交给能直连的出网网关，由对端完成鉴权与转发。留空则直连 chatgpt.com。
 */
const UPSTREAM_RELAY_KEY = 'codex:upstream'

/** 凭据刷新/鉴权失败(区别于网络错误)：需要按 401 语义返回 */
class CodexAuthError extends Error {}

interface CodexUpstreamRelay {
  /** 对端网关根地址，如 https://api.example.com */
  url: string
  /** 对端网关的转发 Key(Bearer) */
  key: string
}

async function getCodexUpstreamRelay(env: Env): Promise<CodexUpstreamRelay | null> {
  try {
    const raw = await getKV(env).get(UPSTREAM_RELAY_KEY)
    if (!raw) return null
    const cfg = JSON.parse(raw) as { url?: string; key?: string }
    const url = String(cfg?.url || '').trim().replace(/\/+$/, '')
    const key = String(cfg?.key || '').trim()
    return url && key ? { url, key } : null
  } catch {
    return null
  }
}

/** 中继请求头: 鉴权交给对端网关，本机不参与 OAuth */
function relayHeaders(relay: CodexUpstreamRelay, stream: boolean): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${relay.key}`,
    'Accept': stream ? 'text/event-stream' : 'application/json',
  }
}

/** 中继按 providerId/modelId 路由，故需带上渠道前缀 */
function relayModelId(p: OAuthCallParams): string {
  return `${p.providerId}/${p.modelId}`
}

// =====================================================================
// JWT 解析（取 chatgpt_account_id）
// =====================================================================

function base64UrlDecode(data: string): string {
  const pad = data.length % 4 === 0 ? '' : '='.repeat(4 - (data.length % 4))
  return atob(data.replace(/-/g, '+').replace(/_/g, '/') + pad)
}

function parseJwtClaim(token: string, claim: string): string {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return ''
    const payload = JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>
    const value = payload?.[claim]
    return typeof value === 'string' ? value : ''
  } catch { return '' }
}

// =====================================================================
// 内置 OAuth 授权（PKCE，loopback 回调）
// =====================================================================

/** 生成授权链接。登录后浏览器会跳到 localhost:1455（打不开是正常的），从地址栏复制 code。 */
export async function buildCodexAuthUrl(env: Env): Promise<{ url: string; state: string }> {
  const state = randomHex(16)
  const { verifier, challenge } = await createPkcePair()
  await getKV(env).put(STATE_PREFIX + state, JSON.stringify({ verifier }), { expirationTtl: 600 }).catch(() => {})
  const params = new URLSearchParams({
    client_id: CODEX_CLIENT_ID,
    response_type: 'code',
    redirect_uri: CODEX_REDIRECT_URI,
    scope: CODEX_SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'login',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
  })
  return { url: `${CODEX_AUTH_URL}?${params.toString()}`, state }
}

function extractCode(input: string): string {
  const text = (input || '').trim()
  const match = text.match(/[?&]code=([^&\s]+)/)
  return match ? decodeURIComponent(match[1]) : text
}

export async function exchangeCodexCode(env: Env, codeOrUrl: string, state: string): Promise<{ refreshToken: string; accessToken: string; expiresIn: number; accountId: string }> {
  const raw = await getKV(env).get(STATE_PREFIX + state)
  if (!raw) throw new Error('授权会话不存在或已过期（10 分钟），请重新点击「用 ChatGPT 账号授权」')
  await getKV(env).delete(STATE_PREFIX + state).catch(() => {})
  const { verifier } = JSON.parse(raw) as { verifier: string }
  const code = extractCode(codeOrUrl)
  if (!code) throw new Error('未识别到 code，请粘贴 OpenAI 返回的 code 或整段回调地址')
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CODEX_CLIENT_ID,
    code,
    redirect_uri: CODEX_REDIRECT_URI,
    code_verifier: verifier,
  })
  const res = await fetch(CODEX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString(),
    signal: AbortSignal.timeout(30000),
  })
  const text = await res.text()
  let json: any
  try { json = JSON.parse(text) } catch { throw new Error(`换取 token 返回非 JSON: ${text.slice(0, 200)}`) }
  if (!res.ok || !json.access_token) throw new Error(`换取 token 失败 HTTP ${res.status}: ${text.slice(0, 300)}`)
  if (!json.refresh_token) throw new Error('OpenAI 未返回 refresh_token，请重新授权')
  const accessToken = json.access_token as string
  const accountId = parseJwtClaim(accessToken, 'chatgpt_account_id')
  return { refreshToken: json.refresh_token, accessToken, expiresIn: Number(json.expires_in) || 3600, accountId }
}

// =====================================================================
// access_token 刷新（KV 缓存）
// =====================================================================

async function refreshCodexToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number; refreshToken?: string; extra?: Record<string, string> }> {
  const form = new URLSearchParams({
    client_id: CODEX_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: CODEX_SCOPE,
  })
  const res = await fetch(CODEX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString(),
    signal: AbortSignal.timeout(30000),
  })
  const text = await res.text()
  let json: any
  try { json = JSON.parse(text) } catch { throw new CodexAuthError(`Codex OAuth 刷新返回非 JSON: ${text.slice(0, 200)}`) }
  if (!res.ok || !json.access_token) throw new CodexAuthError(`Codex OAuth 刷新失败 HTTP ${res.status}: ${text.slice(0, 300)}`)
  const accountId = parseJwtClaim(json.access_token, 'chatgpt_account_id')
  return {
    accessToken: json.access_token,
    expiresIn: Number(json.expires_in) || 3600,
    refreshToken: json.refresh_token || undefined,
    extra: accountId ? { accountId } : undefined,
  }
}

async function getAccessToken(env: Env, refreshToken: string): Promise<{ token: string; accountId: string }> {
  const cached = await resolveAccessToken(env, AT_PREFIX, refreshToken, refreshCodexToken)
  const accountId = cached.extra?.accountId || ''
  return { token: cached.accessToken, accountId }
}

// =====================================================================
// 上游请求头
// =====================================================================

function apiHeaders(accessToken: string, accountId: string, stream: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
    'Accept': stream ? 'text/event-stream' : 'application/json',
    'User-Agent': CODEX_UA,
    'Originator': CODEX_ORIGINATOR,
    'Version': '0.154.0',
    'Session_id': randomId(),
  }
  if (accountId) headers['Chatgpt-Account-Id'] = accountId
  return headers
}

// =====================================================================
// 对外入口
// =====================================================================

export async function handleCodexRequest(p: OAuthCallParams, subPath: string): Promise<Response> {
  const relay = await getCodexUpstreamRelay(p.env)
  const tokens = (p.refreshTokens || []).filter((t) => t && t.trim())
  // 走中继时凭据由对端网关持有，本渠道无需配置 refresh_token
  if (tokens.length === 0 && !relay) {
    return oauthErrorResponse('该 codex 渠道未配置凭据：请在「API Key」里每行填入一个 OpenAI OAuth refresh_token（可点「用 ChatGPT 账号授权」获取）', 400, 'configuration_error')
  }
  const wantStream = p.body?.stream === true

  // 原生 Responses 协议透传（/v1/responses）
  if (subPath === 'responses-passthrough') {
    return forwardResponsesNative(p, tokens[0]?.trim() || '', wantStream, relay)
  }

  // 直连时上游只认裸模型 ID(带 providerId/ 前缀会被 Codex 后端拒绝)；走中继则靠前缀路由
  const { request } = openAIToResponsesRequest({ ...p.body, model: relay ? relayModelId(p) : p.modelId })
  // Codex 后端不接受 max_output_tokens(传了直接 400: Unsupported parameter)
  delete request.max_output_tokens
  // Codex 后端强制 stream=true：客户端要非流式时先取 SSE，再本地聚合
  request.stream = true
  let lastError = ''
  let lastStatus = 502

  // 走中继时凭据轮换由对端负责，本机只发一次
  const attempts: string[] = relay ? [''] : tokens
  for (const refreshToken of attempts) {
    try {
      let endpoint = `${CODEX_API_BASE}/responses`
      let headers: Record<string, string>
      if (relay) {
        endpoint = `${relay.url}/v1/responses`
        headers = relayHeaders(relay, true)
      } else {
        const { token, accountId } = await getAccessToken(p.env, refreshToken)
        headers = apiHeaders(token, accountId, true)
      }
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(600000),
      })
      if (!upstream.ok) {
        lastStatus = upstream.status
        lastError = `HTTP ${upstream.status}: ${(await readErrorBody(upstream)).slice(0, 300)}`
        if ([401, 403, 429].includes(upstream.status) || upstream.status >= 500) continue
        return oauthErrorResponse(lastError, upstream.status, 'upstream_error')
      }

      if (wantStream && upstream.body) {
        const stream = createOpenAIStreamFromResponses(upstream.body, p.requestedModel, (usage) => {
          defer(p, recordOAuthUsage(p, usage, true, 200))
        })
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' },
        })
      }

      // 非流式：上游给的是 SSE，本地聚合成 OpenAI JSON
      if (!upstream.body) return oauthErrorResponse('上游未返回响应体', 502, 'upstream_error')
      let openai: Record<string, any>
      try {
        openai = await collectResponsesStreamToOpenAI(upstream.body, p.requestedModel)
      } catch (err) {
        return oauthErrorResponse((err as Error).message || '上游流解析失败', 502, 'upstream_error')
      }
      defer(p, recordOAuthUsage(p, {
        promptTokens: Number(openai.usage?.prompt_tokens) || 0,
        completionTokens: Number(openai.usage?.completion_tokens) || 0,
      }, true, 200))
      return new Response(JSON.stringify(openai), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      })
    } catch (err) {
      lastError = (err as Error).message || '未知错误'
      // 凭据失效按 401 返回：Cloudflare 边缘会吞掉 5xx 的响应体，用 4xx 才能把原因透给调用方
      lastStatus = err instanceof CodexAuthError ? 401 : 502
      continue
    }
  }
  return oauthErrorResponse(`所有 Codex 账号均失败，最后一次错误: ${lastError || '未知'}`, lastStatus, lastStatus === 401 ? 'authentication_error' : 'key_exhausted')
}

/** /v1/responses 原生协议透传：请求体已是 Responses 格式，仅替换鉴权头并强制 store=false */
async function forwardResponsesNative(p: OAuthCallParams, refreshToken: string, wantStream: boolean, relay: CodexUpstreamRelay | null): Promise<Response> {
  try {
    const body = { ...(p.body as Record<string, any>) }
    if (body.store === undefined) body.store = false
    let endpoint = `${CODEX_API_BASE}/responses`
    let headers: Record<string, string>
    if (relay) {
      endpoint = `${relay.url}/v1/responses`
      headers = relayHeaders(relay, wantStream)
      body.model = relayModelId(p)
    } else {
      const { token, accountId } = await getAccessToken(p.env, refreshToken)
      headers = apiHeaders(token, accountId, wantStream)
    }
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600000),
    })
    if (!upstream.ok) {
      return oauthErrorResponse(`HTTP ${upstream.status}: ${(await readErrorBody(upstream)).slice(0, 300)}`, upstream.status, 'upstream_error')
    }
    const responseHeaders: Record<string, string> = {
      'Content-Type': upstream.headers.get('Content-Type') || (wantStream ? 'text/event-stream' : 'application/json'),
      'Cache-Control': 'no-store',
    }
    return new Response(upstream.body, { status: 200, headers: responseHeaders })
  } catch (err) {
    // 凭据失效按 401 返回，避免 Cloudflare 边缘吞掉 5xx 响应体
    const authFailed = err instanceof CodexAuthError
    return oauthErrorResponse((err as Error).message || '透传失败', authFailed ? 401 : 502, authFailed ? 'authentication_error' : 'proxy_error')
  }
}

// =====================================================================
// 后台：连通性测试
// =====================================================================

export async function testCodex(env: Env, refreshToken: string, modelId: string, providerId?: string): Promise<{ success: boolean; message: string; statusCode?: number }> {
  const relay = await getCodexUpstreamRelay(env)
  // 走中继时本渠道不需要 refresh_token，凭据在中继侧
  if (relay) {
    if (!providerId) return { success: false, message: '未确定渠道 ID，无法经中继测试', statusCode: 0 }
    try {
      const res = await fetch(`${relay.url}/v1/responses`, {
        method: 'POST',
        headers: relayHeaders(relay, true),
        body: JSON.stringify({
          model: `${providerId}/${modelId}`,
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
          instructions: '',
          store: false,
          stream: true,
        }),
        signal: AbortSignal.timeout(30000),
      })
      if (res.ok) return { success: true, message: '连接成功（经中继）', statusCode: 200 }
      return { success: false, message: `HTTP ${res.status}: ${(await readErrorBody(res)).slice(0, 200)}`, statusCode: res.status }
    } catch (err) {
      return { success: false, message: (err as Error).message || '中继连接失败' }
    }
  }

  if (!refreshToken) return { success: false, message: '未填写 refresh_token', statusCode: 0 }
  try {
    const { token, accountId } = await getAccessToken(env, refreshToken)
    const { request } = openAIToResponsesRequest({ model: modelId, messages: [{ role: 'user', content: 'hi' }], stream: true })
    request.stream = true
    let res = await fetch(`${CODEX_API_BASE}/responses`, {
      method: 'POST',
      headers: apiHeaders(token, accountId, true),
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      const altRequest = { ...request }
      delete altRequest.stream
      const altRes = await fetch(`${CODEX_API_BASE}/responses`, {
        method: 'POST',
        headers: apiHeaders(token, accountId, false),
        body: JSON.stringify(altRequest),
        signal: AbortSignal.timeout(30000),
      }).catch(() => null)
      if (altRes && altRes.ok) res = altRes
    }
    if (res.ok) return { success: true, message: '连接成功', statusCode: 200 }
    return { success: false, message: `HTTP ${res.status}: ${(await readErrorBody(res)).slice(0, 200)}`, statusCode: res.status }
  } catch (err) {
    return { success: false, message: (err as Error).message || '连接失败' }
  }
}
