/**
 * 存储适配层：支持 Cloudflare D1 与 PostgreSQL (Supabase / Koyeb)。
 * 
 * 用量统计走 SQL 聚合。
 * KV 兼容接口由 kv_store 表实现。
 */

export interface KVLike {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string; cursor?: string }): Promise<{
    keys: Array<{ name: string }>
    cursor?: string
    list_complete: boolean
  }>
}

/** D1 存储实现（kv_store 表） */
function d1KVImpl(db: D1Database): KVLike {
  return {
    async get(key) {
      const res = await db.prepare('SELECT value, expires_at FROM kv_store WHERE key = ?').bind(key).first<{ value: string; expires_at: number | null }>()
      if (!res) return null
      // 检查是否过期（expires_at 为 Unix 秒，null 表示永不过期）
      if (res.expires_at !== null && res.expires_at < Math.floor(Date.now() / 1000)) {
        await db.prepare('DELETE FROM kv_store WHERE key = ?').bind(key).run().catch(() => {})
        return null
      }
      return res.value
    },
    async put(key, value, options) {
      const expiresAt = options?.expirationTtl
        ? Math.floor(Date.now() / 1000) + options.expirationTtl
        : null
      await db.prepare(
        'INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at'
      ).bind(key, value, expiresAt).run()
    },
    async delete(key) {
      await db.prepare('DELETE FROM kv_store WHERE key = ?').bind(key).run()
    },
    async list(options) {
      const prefix = options?.prefix ?? ''
      const now = Math.floor(Date.now() / 1000)
      const limit = 1000

      let query = 'SELECT key FROM kv_store WHERE key LIKE ? AND (expires_at IS NULL OR expires_at > ?)'
      const binds: any[] = [prefix + '%', now]

      if (options?.cursor) {
        query += ' AND key > ?'
        binds.push(options.cursor)
      }
      
      query += ' ORDER BY key ASC LIMIT ?'
      binds.push(limit)

      const res = await db.prepare(query).bind(...binds).all<{ key: string }>()
      const results = res.results || []

      return {
        keys: results.map((r) => ({ name: r.key })),
        list_complete: results.length < limit,
        cursor: results.length === limit ? results[results.length - 1].key : undefined,
      }
    },
  }
}

/** PostgreSQL (Supabase) 存储实现（kv_store 表） */
function pgKVImpl(sql: any): KVLike {
  return {
    async get(key) {
      const rows = await sql`SELECT value, expires_at FROM kv_store WHERE key = ${key}`
      if (!rows || rows.length === 0) return null
      const res = rows[0]
      const expiresAt = res.expires_at ? Number(res.expires_at) : null
      if (expiresAt !== null && expiresAt < Math.floor(Date.now() / 1000)) {
        await sql`DELETE FROM kv_store WHERE key = ${key}`.catch(() => {})
        return null
      }
      return res.value
    },
    async put(key, value, options) {
      const expiresAt = options?.expirationTtl
        ? Math.floor(Date.now() / 1000) + options.expirationTtl
        : null
      await sql`
        INSERT INTO kv_store (key, value, expires_at)
        VALUES (${key}, ${value}, ${expiresAt})
        ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
      `
    },
    async delete(key) {
      await sql`DELETE FROM kv_store WHERE key = ${key}`
    },
    async list(options) {
      const prefix = options?.prefix ?? ''
      const now = Math.floor(Date.now() / 1000)
      const limit = 1000
      const pattern = prefix + '%'

      let results: any[]
      if (options?.cursor) {
        results = await sql`
          SELECT key FROM kv_store
          WHERE key LIKE ${pattern} AND (expires_at IS NULL OR expires_at > ${now}) AND key > ${options.cursor}
          ORDER BY key ASC LIMIT ${limit}
        `
      } else {
        results = await sql`
          SELECT key FROM kv_store
          WHERE key LIKE ${pattern} AND (expires_at IS NULL OR expires_at > ${now})
          ORDER BY key ASC LIMIT ${limit}
        `
      }

      return {
        keys: (results || []).map((r: any) => ({ name: r.key })),
        list_complete: (results || []).length < limit,
        cursor: (results || []).length === limit ? results[results.length - 1].key : undefined,
      }
    },
  }
}

/** 获取 KV 兼容实例 */
export function getKV(env: any): KVLike {
  if (env.PG) return pgKVImpl(env.PG)
  if (env.DB) return d1KVImpl(env.DB)
  throw new Error('Missing DB / PG binding')
}

/**
 * 返回当前实际生效的存储类型
 */
export function getStorageType(env: any): 'pg' | 'd1' {
  if (env.PG) return 'pg'
  return 'd1'
}

/** 存储类型的中文展示名 */
export function storageTypeLabel(env: any): string {
  if (env.PG) return 'Supabase PostgreSQL'
  return 'D1 数据库'
}

/** 用量记录 D1 直写 */
export async function addUsageRecordD1(db: D1Database, record: {
  ts: string
  provider: string
  model: string
  token: string
  ok: boolean
  status: number
  promptTokens: number
  completionTokens: number
  latencyMs: number
}): Promise<void> {
  await db.prepare(
    'INSERT INTO usage_records (ts, provider, model, token, ok, status, prompt_tokens, completion_tokens, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    record.ts,
    record.provider,
    record.model,
    record.token,
    record.ok ? 1 : 0,
    record.status,
    record.promptTokens || 0,
    record.completionTokens || 0,
    record.latencyMs || 0,
  ).run().catch(() => {})
}

/** 用量记录 PG 直写 */
export async function addUsageRecordPG(sql: any, record: {
  ts: string
  provider: string
  model: string
  token: string
  ok: boolean
  status: number
  promptTokens: number
  completionTokens: number
  latencyMs: number
}): Promise<void> {
  await sql`
    INSERT INTO usage_records (ts, provider, model, token, ok, status, prompt_tokens, completion_tokens, latency_ms)
    VALUES (${record.ts}, ${record.provider}, ${record.model}, ${record.token}, ${record.ok ? 1 : 0}, ${record.status}, ${record.promptTokens || 0}, ${record.completionTokens || 0}, ${record.latencyMs || 0})
  `.catch((err: any) => { console.error('addUsageRecordPG error:', err) })
}

let d1Initialized = false

/** 确保 D1 基础表结构存在 */
export async function ensureD1Tables(db: D1Database): Promise<void> {
  if (d1Initialized) return
  try {
    await db.batch([
      db.prepare('CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT, expires_at INTEGER DEFAULT NULL)'),
      db.prepare(`CREATE TABLE IF NOT EXISTS usage_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        token TEXT,
        ok INTEGER DEFAULT 1,
        status INTEGER DEFAULT 200,
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        latency_ms REAL DEFAULT 0
      )`),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_usage_records_ts ON usage_records(ts)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_usage_records_model ON usage_records(model)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_usage_records_provider ON usage_records(provider)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_kv_store_expires ON kv_store(expires_at) WHERE expires_at IS NOT NULL'),
    ])
  } catch (e) {
    console.error('ensureD1Tables create error:', (e as Error).message)
  }

  try {
    await db.prepare('ALTER TABLE kv_store ADD COLUMN expires_at INTEGER DEFAULT NULL').run()
  } catch (e) { /* ignore */ }

  d1Initialized = true
}

let pgInitialized = false

/** 确保 PostgreSQL 基础表结构存在 */
export async function ensurePgTables(sql: any): Promise<void> {
  if (pgInitialized) return
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS kv_store (
        key VARCHAR PRIMARY KEY,
        value TEXT,
        expires_at BIGINT DEFAULT NULL
      )
    `
    await sql`
      CREATE TABLE IF NOT EXISTS usage_records (
        id BIGSERIAL PRIMARY KEY,
        ts VARCHAR NOT NULL,
        provider VARCHAR,
        model VARCHAR,
        token VARCHAR,
        ok INT DEFAULT 1,
        status INT DEFAULT 200,
        prompt_tokens INT DEFAULT 0,
        completion_tokens INT DEFAULT 0,
        latency_ms DOUBLE PRECISION DEFAULT 0
      )
    `
    await sql`CREATE INDEX IF NOT EXISTS idx_usage_records_ts ON usage_records(ts)`
    await sql`CREATE INDEX IF NOT EXISTS idx_usage_records_model ON usage_records(model)`
    await sql`CREATE INDEX IF NOT EXISTS idx_usage_records_provider ON usage_records(provider)`
    await sql`CREATE INDEX IF NOT EXISTS idx_kv_store_expires ON kv_store(expires_at) WHERE expires_at IS NOT NULL`
    pgInitialized = true
  } catch (e) {
    console.error('ensurePgTables create error:', (e as Error).message)
  }
}

/** PostgreSQL 版用量聚合 */
export async function getUsageSummaryPG(sql: any, days: number): Promise<any> {
  const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10) + 'T00:00:00.000Z'

  const totals = await sql`
    SELECT COUNT(*) AS cnt, SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS ok_cnt, COALESCE(SUM(prompt_tokens), 0) AS pt, COALESCE(SUM(completion_tokens), 0) AS ct, COALESCE(AVG(latency_ms), 0) AS lat
    FROM usage_records WHERE ts >= ${since}
  `
  const total = totals[0] || {}

  const byModelRows = await sql`
    SELECT CASE WHEN model LIKE '%-free' OR model LIKE '%:free' OR model LIKE '%/free' THEN substring(model from 1 for length(model) - 5) ELSE model END AS model, COUNT(*) AS cnt, COALESCE(SUM(prompt_tokens), 0) AS pt, COALESCE(SUM(completion_tokens), 0) AS ct
    FROM usage_records WHERE ts >= ${since}
    GROUP BY CASE WHEN model LIKE '%-free' OR model LIKE '%:free' OR model LIKE '%/free' THEN substring(model from 1 for length(model) - 5) ELSE model END
    ORDER BY cnt DESC LIMIT 50
  `

  const byProviderRows = await sql`
    SELECT provider, COUNT(*) AS cnt, COALESCE(SUM(prompt_tokens), 0) AS pt, COALESCE(SUM(completion_tokens), 0) AS ct
    FROM usage_records WHERE ts >= ${since}
    GROUP BY provider ORDER BY cnt DESC LIMIT 50
  `

  const dailyRows = await sql`
    SELECT substring(ts from 1 for 10) AS date, COUNT(*) AS cnt, COALESCE(SUM(prompt_tokens), 0) AS pt, COALESCE(SUM(completion_tokens), 0) AS ct
    FROM usage_records WHERE ts >= ${since}
    GROUP BY substring(ts from 1 for 10) ORDER BY date
  `

  const totalRequests = Number(total.cnt || 0)
  const successRequests = Number(total.ok_cnt || 0)
  return {
    days,
    totalRequests,
    successRequests,
    totalPromptTokens: Number(total.pt || 0),
    totalCompletionTokens: Number(total.ct || 0),
    avgLatencyMs: totalRequests > 0 ? Math.round(Number(total.lat || 0)) : 0,
    byModel: (byModelRows || []).map((r: any) => ({
      model: r.model,
      requests: Number(r.cnt),
      promptTokens: Number(r.pt),
      completionTokens: Number(r.ct),
    })),
    byProvider: (byProviderRows || []).map((r: any) => ({
      provider: r.provider,
      requests: Number(r.cnt),
      promptTokens: Number(r.pt),
      completionTokens: Number(r.ct),
    })),
    daily: (dailyRows || []).map((r: any) => ({
      date: r.date,
      requests: Number(r.cnt),
      promptTokens: Number(r.pt),
      completionTokens: Number(r.ct),
    })),
  }
}
