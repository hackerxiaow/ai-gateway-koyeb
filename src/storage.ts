import { KV_KEYS } from './config'
import type { Env, Provider, ProxyKey, Session } from './types'
import { getKV, addUsageRecordD1, addUsageRecordPG, getUsageSummaryPG } from './storage-adapter'

// ===== 提供商 CRUD =====

export async function getProviders(env: Env): Promise<Provider[]> {
  const data = await getKV(env).get(KV_KEYS.PROVIDERS)
  return data ? JSON.parse(data) : []
}

export async function getProvider(env: Env, id: string): Promise<Provider | null> {
  const providers = await getProviders(env)
  return providers.find((p) => p.id === id) ?? null
}

export async function setProviders(env: Env, providers: Provider[]): Promise<void> {
  await getKV(env).put(KV_KEYS.PROVIDERS, JSON.stringify(providers))
}

export async function addProvider(env: Env, provider: Provider): Promise<void> {
  const providers = await getProviders(env)
  providers.push(provider)
  await setProviders(env, providers)
}

export async function updateProvider(env: Env, id: string, updates: Partial<Provider>): Promise<Provider | null> {
  const providers = await getProviders(env)
  const index = providers.findIndex((p) => p.id === id)
  if (index === -1) return null
  providers[index] = { ...providers[index], ...updates, updatedAt: new Date().toISOString() }
  await setProviders(env, providers)
  return providers[index]
}

export async function deleteProvider(env: Env, id: string): Promise<boolean> {
  const providers = await getProviders(env)
  const filtered = providers.filter((p) => p.id !== id)
  if (filtered.length === providers.length) return false
  await setProviders(env, filtered)
  return true
}

// ===== 管理员凭据(持久化到存储, 登录时写入; 备份/恢复不含) =====

const ADMIN_CRED_KEY = 'admin:credentials'

export interface AdminCredentials {
  username: string
  /** SHA-256 哈希, 不存明文 */
  passwordHash: string
}

/** 读取管理员凭据(可能来自环境变量初始化或上次登录写入) */
export async function getAdminCredentials(env: Env): Promise<AdminCredentials | null> {
  const data = await getKV(env).get(ADMIN_CRED_KEY)
  if (!data) return null
  try {
    return JSON.parse(data) as AdminCredentials
  } catch {
    return null
  }
}

/** 写入管理员凭据(登录成功后调用, 保证重启后可用) */
export async function setAdminCredentials(env: Env, username: string, passwordHash: string): Promise<void> {
  await getKV(env).put(ADMIN_CRED_KEY, JSON.stringify({ username, passwordHash } satisfies AdminCredentials))
}

/** 强制登出所有会话(导入/恢复后调用) */
export async function deleteAllSessions(env: Env): Promise<void> {
  const store = getKV(env)
  let cursor: string | undefined
  do {
    const page = await store.list({ prefix: KV_KEYS.SESSION_PREFIX, cursor })
    for (const k of page.keys) await store.delete(k.name)
    cursor = page.cursor
  } while (cursor)
}

// ===== Session 管理 =====

export async function createSession(env: Env, username: string, ttlSeconds: number): Promise<string> {
  const sessionId = crypto.randomUUID()
  const session: Session = {
    username,
    expiresAt: Date.now() + ttlSeconds * 1000,
  }
  await getKV(env).put(KV_KEYS.SESSION_PREFIX + sessionId, JSON.stringify(session), {
    expirationTtl: ttlSeconds,
  })
  return sessionId
}

export async function getSession(env: Env, sessionId: string): Promise<Session | null> {
  const data = await getKV(env).get(KV_KEYS.SESSION_PREFIX + sessionId)
  if (!data) return null
  const session: Session = JSON.parse(data)
  if (session.expiresAt < Date.now()) {
    await deleteSession(env, sessionId)
    return null
  }
  return session
}

export async function deleteSession(env: Env, sessionId: string): Promise<void> {
  await getKV(env).delete(KV_KEYS.SESSION_PREFIX + sessionId)
}

// ===== 转发 Key =====

export async function getProxyKeys(env: Env): Promise<ProxyKey[]> {
  const data = await getKV(env).get(KV_KEYS.PROXY_KEYS)
  return data ? JSON.parse(data) : []
}

export async function setProxyKeys(env: Env, keys: ProxyKey[]): Promise<void> {
  await getKV(env).put(KV_KEYS.PROXY_KEYS, JSON.stringify(keys))
}

export async function addProxyKey(env: Env, key: ProxyKey): Promise<void> {
  const keys = await getProxyKeys(env)
  keys.push(key)
  await setProxyKeys(env, keys)
}

export async function deleteProxyKey(env: Env, id: string): Promise<boolean> {
  const keys = await getProxyKeys(env)
  const filtered = keys.filter((k) => k.id !== id)
  if (filtered.length === keys.length) return false
  await setProxyKeys(env, filtered)
  return true
}

export async function updateProxyKey(env: Env, id: string, updates: Partial<ProxyKey>): Promise<ProxyKey | null> {
  const keys = await getProxyKeys(env)
  const idx = keys.findIndex(k => k.id === id)
  if (idx === -1) return null
  keys[idx] = { ...keys[idx], ...updates }
  await setProxyKeys(env, keys)
  return keys[idx]
}

export async function validateProxyKey(env: Env, key: string): Promise<boolean> {
  const keys = await getProxyKeys(env)
  return keys.some((k) => {
    if (k.key !== key || !k.enabled) return false
    if (k.expiresAt) {
      const now = Date.now()
      const expires = new Date(k.expiresAt).getTime()
      if (now >= expires) return false
    }
    return true
  })
}

// ===== 初始数据填充 =====

import { DEFAULT_PROVIDERS, PROXY_KEY_PREFIX } from './config'
import { USAGE_RETENTION_DAYS } from './config'
import type { UsageRecord, UsageSummary } from './types'

export async function seedInitialData(env: Env): Promise<void> {
  const providers = await getProviders(env)
  const migrationCompleted = await getKV(env).get(KV_KEYS.OPENCODE_MIGRATION)
  const opencode = DEFAULT_PROVIDERS.find((provider) => provider.id === 'opencode')

  if (!migrationCompleted) {
    if (opencode && !providers.some((provider) => provider.id === opencode.id)) {
      await setProviders(env, [
        ...providers,
        {
          ...opencode,
          apiKeys: opencode.apiKeys.map((key) => ({ ...key })),
          models: opencode.models.map((model) => ({ ...model })),
        },
      ])
    }
    await getKV(env).put(KV_KEYS.OPENCODE_MIGRATION, '1')
  }

  // 仅首次运行时创建测试转发 Key
  if (providers.length === 0 && !migrationCompleted) {
    const keys = await getProxyKeys(env)
    if (keys.length === 0) {
      const testKey = {
        id: crypto.randomUUID(),
        key: `${PROXY_KEY_PREFIX}${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`,
        name: '测试 Key',
        enabled: true,
        createdAt: new Date().toISOString(),
      }
      await addProxyKey(env, testKey)
    }
  }
}

// ===== Token 用量统计 =====

/** 写入一条用量记录 */
export async function addUsageRecord(env: Env, record: UsageRecord): Promise<void> {
  if (env.PG) {
    await addUsageRecordPG(env.PG, record)
    return
  }
  if (env.DB) {
    await addUsageRecordD1(env.DB, record)
    return
  }
  const date = record.ts.slice(0, 10)
  const key = `${KV_KEYS.USAGE_PREFIX}${date}:${crypto.randomUUID()}`
  await getKV(env).put(key, JSON.stringify(record), {
    expirationTtl: USAGE_RETENTION_DAYS * 24 * 60 * 60,
  }).catch(() => {})
}

/** 按前缀分页读取所有用量记录 */
async function listUsageRecords(env: Env, prefix: string): Promise<UsageRecord[]> {
  const records: UsageRecord[] = []
  let cursor: string | undefined
  for (let i = 0; i < 50; i++) {
    const page = await getKV(env).list({ prefix, cursor })
    for (const k of page.keys) {
      const raw = await getKV(env).get(k.name).catch(() => null)
      if (!raw) continue
      try {
        records.push(JSON.parse(raw) as UsageRecord)
      } catch { /* skip corrupt */ }
    }
    if (page.list_complete) break
    cursor = (page as { cursor?: string }).cursor
  }
  return records
}

/** 聚合最近 N 天的用量（含当天） */
export async function getUsageSummary(env: Env, days: number): Promise<UsageSummary> {
  if (env.PG) {
    return await getUsageSummaryPG(env.PG, days)
  }
  if (env.DB) {
    return await getUsageSummaryD1(env.DB, days)
  }
  // 旧版 KV 回退已废弃 实现：按前缀聚合（KV 记录带 TTL 自动过期）
  const prefixes: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000)
    prefixes.push(`${KV_KEYS.USAGE_PREFIX}${d.toISOString().slice(0, 10)}:`)
  }

  const records: UsageRecord[] = []
  for (const p of prefixes) {
    records.push(...(await listUsageRecords(env, p)))
  }

  const byModel = new Map<string, UsageRecord[]>()
  const byProvider = new Map<string, UsageRecord[]>()
  const daily = new Map<string, UsageRecord[]>()

  for (const r of records) {
    const date = r.ts.slice(0, 10)
    // 显示用模型名: 去掉 :free / /free / -free 后缀(与 alias 规则一致)
    const displayModel = (r.model || '').replace(/[:\/\-]free$/i, '') || r.model || 'unknown'
    if (!byModel.has(displayModel)) byModel.set(displayModel, [])
    byModel.get(displayModel)!.push(r)
    if (!byProvider.has(r.provider)) byProvider.set(r.provider, [])
    byProvider.get(r.provider)!.push(r)
    if (!daily.has(date)) daily.set(date, [])
    daily.get(date)!.push(r)
  }

  const agg = (list: UsageRecord[]) => ({
    requests: list.length,
    promptTokens: list.reduce((s, r) => s + (r.promptTokens || 0), 0),
    completionTokens: list.reduce((s, r) => s + (r.completionTokens || 0), 0),
  })

  const byModelArr = Array.from(byModel.entries())
    .map(([model, list]) => ({ model, ...agg(list) }))
    .sort((a, b) => b.requests - a.requests)
  const byProviderArr = Array.from(byProvider.entries())
    .map(([provider, list]) => ({ provider, ...agg(list) }))
    .sort((a, b) => b.requests - a.requests)
  const dailyArr = Array.from(daily.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, list]) => ({ date, ...agg(list) }))

  const totalRequests = records.length
  const successRequests = records.filter((r) => r.ok).length
  const latencies = records.map((r) => r.latencyMs || 0)
  const avgLatencyMs = totalRequests > 0
    ? Math.round(latencies.reduce((s, v) => s + v, 0) / totalRequests)
    : 0

  return {
    days,
    totalRequests,
    successRequests,
    totalPromptTokens: records.reduce((s, r) => s + (r.promptTokens || 0), 0),
    totalCompletionTokens: records.reduce((s, r) => s + (r.completionTokens || 0), 0),
    avgLatencyMs,
    byModel: byModelArr,
    byProvider: byProviderArr,
    daily: dailyArr,
  }
}

/** D1 版用量聚合：SQL 一次查出全部聚合结果 */
async function getUsageSummaryD1(db: D1Database, days: number): Promise<UsageSummary> {
  const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10) + 'T00:00:00.000Z'

  const total = await db.prepare(
    'SELECT COUNT(*) AS cnt, SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS okCnt, COALESCE(SUM(prompt_tokens), 0) AS pt, COALESCE(SUM(completion_tokens), 0) AS ct, COALESCE(AVG(latency_ms), 0) AS lat FROM usage_records WHERE ts >= ?'
  ).bind(since).first<{ cnt: number; okCnt: number; pt: number; ct: number; lat: number }>()

  const byModel = await db.prepare(
    `SELECT CASE WHEN model LIKE '%-free' OR model LIKE '%:free' OR model LIKE '%/free' THEN substr(model, 1, length(model) - 5) ELSE model END AS model, COUNT(*) AS cnt, COALESCE(SUM(prompt_tokens), 0) AS pt, COALESCE(SUM(completion_tokens), 0) AS ct FROM usage_records WHERE ts >= ? GROUP BY CASE WHEN model LIKE '%-free' OR model LIKE '%:free' OR model LIKE '%/free' THEN substr(model, 1, length(model) - 5) ELSE model END ORDER BY cnt DESC LIMIT 50`
  ).bind(since).all<{ model: string; cnt: number; pt: number; ct: number }>()

  const byProvider = await db.prepare(
    'SELECT provider, COUNT(*) AS cnt, COALESCE(SUM(prompt_tokens), 0) AS pt, COALESCE(SUM(completion_tokens), 0) AS ct FROM usage_records WHERE ts >= ? GROUP BY provider ORDER BY cnt DESC LIMIT 50'
  ).bind(since).all<{ provider: string; cnt: number; pt: number; ct: number }>()

  const daily = await db.prepare(
    "SELECT substr(ts, 1, 10) AS date, COUNT(*) AS cnt, COALESCE(SUM(prompt_tokens), 0) AS pt, COALESCE(SUM(completion_tokens), 0) AS ct FROM usage_records WHERE ts >= ? GROUP BY substr(ts, 1, 10) ORDER BY date"
  ).bind(since).all<{ date: string; cnt: number; pt: number; ct: number }>()

  const totalRequests = Number(total?.cnt || 0)
  const successRequests = Number(total?.okCnt || 0)
  return {
    days,
    totalRequests,
    successRequests,
    totalPromptTokens: Number(total?.pt || 0),
    totalCompletionTokens: Number(total?.ct || 0),
    avgLatencyMs: totalRequests > 0 ? Math.round(Number(total?.lat || 0)) : 0,
    byModel: (byModel.results || []).map((r) => ({
      model: r.model,
      requests: Number(r.cnt),
      promptTokens: Number(r.pt),
      completionTokens: Number(r.ct),
    })),
    byProvider: (byProvider.results || []).map((r) => ({
      provider: r.provider,
      requests: Number(r.cnt),
      promptTokens: Number(r.pt),
      completionTokens: Number(r.ct),
    })),
    daily: (daily.results || []).map((r) => ({
      date: r.date,
      requests: Number(r.cnt),
      promptTokens: Number(r.pt),
      completionTokens: Number(r.ct),
    })),
  }
}