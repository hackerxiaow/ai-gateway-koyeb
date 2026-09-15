/**
 * OAuth 反代共享工具（claude / codex / kimi / grok 渠道复用）
 *
 * 与 antigravity.ts 相同的模式：
 *  - 渠道 apiKeys 里每行一个 refresh_token（或设备码流程产出的凭据）
 *  - access_token 刷新后缓存在 KV（按 refresh_token 哈希为 key）
 *  - 上游返回 401/403/429/5xx 时轮换下一个凭据重试
 */

import type { Env, UsageRecord } from './types'
import { getKV } from './storage-adapter'
import { addUsageRecord } from './storage'

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomId(): string {
  try { return crypto.randomUUID() } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` }
}

export function randomHex(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** base64url 编码（PKCE 用） */
export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 生成 PKCE code_verifier / code_challenge(S256) */
export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64UrlEncode(new Uint8Array(digest)) }
}

export function oauthErrorResponse(message: string, status: number, type = 'oauth_error'): Response {
  return new Response(JSON.stringify({ error: { message, type } }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export async function readErrorBody(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string; message?: string }
    if (typeof json.error === 'string') return json.error
    return json.error?.message || json.message || text
  } catch { return text }
}

// =====================================================================
// access_token KV 缓存（支持上游轮换 refresh_token 的链式续期）
// =====================================================================

export interface CachedToken {
  accessToken: string
  expiresAt: number
  /** 上游轮换后的最新 refresh_token（apiKeys 里存的旧 token 仍作为入口 key） */
  currentRefreshToken?: string
  /** 附加信息（如 Codex 的 chatgpt_account_id） */
  extra?: Record<string, string>
}

export async function getCachedToken(env: Env, prefix: string, refreshToken: string): Promise<CachedToken | null> {
  const cacheKey = prefix + (await sha256Hex(refreshToken))
  const raw = await getKV(env).get(cacheKey)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as CachedToken
    if (parsed.accessToken && (parsed.expiresAt || 0) - 300_000 > Date.now()) return parsed
  } catch { /* re-refresh */ }
  return null
}

export async function putCachedToken(env: Env, prefix: string, refreshToken: string, value: CachedToken, expiresIn: number): Promise<void> {
  const cacheKey = prefix + (await sha256Hex(refreshToken))
  await getKV(env).put(cacheKey, JSON.stringify(value), {
    expirationTtl: Math.max(60, Math.min(expiresIn - 60, 30 * 24 * 3600)),
  }).catch(() => {})
}

/**
 * 统一的 token 刷新入口：先查缓存，未命中用（缓存的最新）refresh_token 调 refresher，
 * 结果写回 KV。refresher 返回 {accessToken, expiresIn, refreshToken?, extra?}。
 */
export async function resolveAccessToken(
  env: Env,
  prefix: string,
  refreshToken: string,
  refresher: (token: string) => Promise<{ accessToken: string; expiresIn: number; refreshToken?: string; extra?: Record<string, string> }>,
): Promise<CachedToken> {
  const cached = await getCachedToken(env, prefix, refreshToken)
  if (cached) return cached
  const refreshed = await refresher(refreshToken)
  const value: CachedToken = {
    accessToken: refreshed.accessToken,
    expiresAt: Date.now() + refreshed.expiresIn * 1000,
    currentRefreshToken: refreshed.refreshToken,
    extra: refreshed.extra,
  }
  await putCachedToken(env, prefix, refreshToken, value, refreshed.expiresIn)
  return value
}

// =====================================================================
// 多凭据轮换请求 + 用量记录
// =====================================================================

export interface OAuthCallParams {
  env: Env
  providerId: string
  modelId: string
  requestedModel: string
  body: Record<string, any>
  refreshTokens: string[]
  maskedToken: string
  startedAt: number
  waitUntil?: (promise: Promise<unknown>) => void
}

export async function recordOAuthUsage(p: OAuthCallParams, usage: { promptTokens: number; completionTokens: number }, ok: boolean, status: number): Promise<void> {
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

export function defer(p: OAuthCallParams, task: Promise<unknown>): void {
  if (p.waitUntil) {
    try { p.waitUntil(task) } catch { task.catch(() => {}) }
  } else {
    task.catch(() => {})
  }
}
