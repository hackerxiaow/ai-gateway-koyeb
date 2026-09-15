import { Context } from 'hono'
import type { Env, BackupData, ApiResponse } from './types'
import { deleteAllSessions, getAdminCredentials } from './storage'
import { getKV } from './storage-adapter'

const BACKUP_PREFIX = 'backup/'

/** 全量导出: kv_store 配置 + usage_records 用量 (排除会话、管理员凭据、Telegram 配置) */
async function exportBackupData(env: Env): Promise<BackupData> {
  const kv: Array<{ key: string; value: string }> = []
  let usage: any[] = []

  if (env.PG) {
    const kvRows = await env.PG`SELECT key, value FROM kv_store WHERE key NOT LIKE 'admin:session:%' AND key != 'admin:credentials' AND key != 'telegram:backup'`
    for (const r of kvRows || []) kv.push({ key: r.key, value: r.value })
    const usageRows = await env.PG`SELECT ts, provider, model, token, ok, status, prompt_tokens, completion_tokens, latency_ms FROM usage_records ORDER BY id ASC`
    usage = usageRows || []
  } else if (env.DB) {
    const kvRows = await env.DB.prepare("SELECT key, value FROM kv_store WHERE key NOT LIKE 'admin:session:%' AND key != 'admin:credentials' AND key != 'telegram:backup'").all<{ key: string; value: string }>()
    for (const r of kvRows.results || []) kv.push(r)
    const usageRows = await env.DB.prepare(
      'SELECT ts, provider, model, token, ok, status, prompt_tokens, completion_tokens, latency_ms FROM usage_records ORDER BY id ASC'
    ).all<any>()
    usage = usageRows.results || []
  } else {
    throw new Error('Missing DB / PG binding')
  }

  return { version: 1, exportedAt: new Date().toISOString(), kv, usage }
}

/** 全量写入: 清空后写入 kv(配置) + usage(用量); 保留管理员凭据与会话。
 *  导入/恢复后用户需重新登录。 */
async function importBackupData(env: Env, data: BackupData): Promise<{ kv: number; usage: number }> {
  const kv = Array.isArray(data.kv) ? data.kv : []
  const usage = Array.isArray(data.usage) ? data.usage : []

  if (env.PG) {
    await env.PG`DELETE FROM kv_store WHERE key NOT LIKE 'admin:session:%' AND key != 'admin:credentials' AND key != 'telegram:backup'`
    await env.PG`DELETE FROM usage_records`
    for (const r of kv) {
      await env.PG`INSERT INTO kv_store (key, value) VALUES (${r.key}, ${r.value}) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`
    }
    const chunkSize = 500
    for (let i = 0; i < usage.length; i += chunkSize) {
      const chunk = usage.slice(i, i + chunkSize).map((r) => ({
        ts: r.ts,
        provider: r.provider,
        model: r.model,
        token: r.token || '',
        ok: Number(r.ok) || 0,
        status: Number(r.status) || 0,
        prompt_tokens: Number(r.prompt_tokens) || 0,
        completion_tokens: Number(r.completion_tokens) || 0,
        latency_ms: Number(r.latency_ms) || 0,
      }))
      if (chunk.length > 0) {
        await env.PG`INSERT INTO usage_records ${env.PG(chunk, 'ts', 'provider', 'model', 'token', 'ok', 'status', 'prompt_tokens', 'completion_tokens', 'latency_ms')}`
      }
    }
  } else if (env.DB) {
    await env.DB.prepare("DELETE FROM kv_store WHERE key NOT LIKE 'admin:session:%' AND key != 'admin:credentials' AND key != 'telegram:backup'").run()
    await env.DB.prepare('DELETE FROM usage_records').run()
    const kvStmt = env.DB.prepare('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)')
    const kvBatch = kv.map((r) => kvStmt.bind(r.key, r.value))
    if (kvBatch.length > 0) await env.DB.batch(kvBatch)
    const uStmt = env.DB.prepare(
      'INSERT OR REPLACE INTO usage_records (ts, provider, model, token, ok, status, prompt_tokens, completion_tokens, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    const uBatch = usage.map((r) =>
      uStmt.bind(r.ts, r.provider, r.model, r.token || '', Number(r.ok) || 0, Number(r.status) || 0, Number(r.prompt_tokens) || 0, Number(r.completion_tokens) || 0, Number(r.latency_ms) || 0)
    )
    if (uBatch.length > 0) await env.DB.batch(uBatch)
  } else {
    throw new Error('Missing DB / PG binding')
  }

  // 强制登出所有会话: 导入/恢复可能改变数据, 要求重新登录
  await deleteAllSessions(env)

  return { kv: kv.length, usage: usage.length }
}

/** 导出(JSON 下载) — 需管理员密码验证 */
export async function handleBackupExport(c: Context<{ Bindings: Env }>) {
  const providedHash = c.req.header('X-Admin-Auth')
  if (!providedHash) return c.json({ success: false, message: '无权限' }, 401)
  const cred = await getAdminCredentials(c.env)
  if (!cred || cred.passwordHash !== providedHash) return c.json({ success: false, message: '权限不足' }, 401)

  const data = await exportBackupData(c.env)
  const filename = `ai-gateway-backup-${data.exportedAt.replace(/[:.]/g, '-')}.json`
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

/** 导入(上传 JSON) — 需管理员密码验证 */
export async function handleBackupImport(c: Context<{ Bindings: Env }>) {
  const providedHash = c.req.header('X-Admin-Auth')
  if (!providedHash) return c.json({ success: false, message: '无权限' }, 401)
  const cred = await getAdminCredentials(c.env)
  if (!cred || cred.passwordHash !== providedHash) return c.json({ success: false, message: '权限不足' }, 401)

  try {
    const data = await c.req.json<BackupData>()
    if (!data.version || !data.kv) {
      return c.json<ApiResponse>({ success: false, message: '文件格式错误' }, 400)
    }
    const counts = await importBackupData(c.env, data)
    return c.json<ApiResponse>({ success: true, message: `导入成功: 恢复了 ${counts.kv} 项配置与 ${counts.usage} 条用量记录` })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json<ApiResponse>({ success: false, message: `解析或导入失败: ${message}` }, 400)
  }
}

/** 发起 R2 备份任务 */
export async function handleBackupToR2(c: Context<{ Bindings: Env }>) {
  const bucket = c.env.ai_gateway_backup
  if (!bucket) return c.json<ApiResponse>({ success: false, message: 'R2 未配置(binding: ai_gateway_backup)' }, 400)
  try {
    const data = await exportBackupData(c.env)
    const key = `${BACKUP_PREFIX}${data.exportedAt.replace(/[:.]/g, '-')}.json`
    await bucket.put(key, JSON.stringify(data), {
      httpMetadata: { contentType: 'application/json' },
    })
    // 清理: 只保留最新 30 份
    const all = await bucket.list({ prefix: BACKUP_PREFIX })
    if (all.objects.length > 30) {
      const sorted = all.objects.sort((a, b) => (a.uploaded > b.uploaded ? -1 : 1))
      for (const old of sorted.slice(30)) await bucket.delete(old.key)
    }
    return c.json<ApiResponse>({ success: true, message: `已备份到 R2: ${key}` })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json<ApiResponse>({ success: false, message: `备份失败: ${message}` }, 500)
  }
}

/** 列出 R2 中的备份快照 */
export async function handleBackupList(c: Context<{ Bindings: Env }>) {
  const bucket = c.env.ai_gateway_backup
  if (!bucket) return c.json<ApiResponse>({ success: false, message: 'R2 未配置' }, 400)
  try {
    const all = await bucket.list({ prefix: BACKUP_PREFIX })
    const sorted = all.objects.sort((a, b) => (a.uploaded > b.uploaded ? -1 : 1))
    return c.json<ApiResponse>({ success: true, data: sorted })
  } catch (error) {
    return c.json<ApiResponse>({ success: false, message: '获取列表失败' }, 500)
  }
}

/** 从 R2 恢复指定的快照 — 需管理员密码验证 */
export async function handleBackupRestore(c: Context<{ Bindings: Env }>) {
  const providedHash = c.req.header('X-Admin-Auth')
  if (!providedHash) return c.json({ success: false, message: '无权限' }, 401)
  const cred = await getAdminCredentials(c.env)
  if (!cred || cred.passwordHash !== providedHash) return c.json({ success: false, message: '权限不足' }, 401)

  const bucket = c.env.ai_gateway_backup
  if (!bucket) return c.json<ApiResponse>({ success: false, message: 'R2 未配置' }, 400)
  const body = await c.req.json<{ key: string }>()
  if (!body.key) return c.json<ApiResponse>({ success: false, message: '未指定 key' }, 400)
  try {
    const obj = await bucket.get(body.key)
    if (!obj) return c.json<ApiResponse>({ success: false, message: '找不到指定的快照' }, 404)
    const json = await obj.json<BackupData>()
    const counts = await importBackupData(c.env, json)
    return c.json<ApiResponse>({ success: true, message: `已恢复 ${counts.kv} 项配置与 ${counts.usage} 条用量记录` })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json<ApiResponse>({ success: false, message: `恢复失败: ${message}` }, 500)
  }
}

/** 删除 R2 快照 — 需管理员密码验证 */
export async function handleBackupDelete(c: Context<{ Bindings: Env }>) {
  const providedHash = c.req.header('X-Admin-Auth')
  if (!providedHash) return c.json({ success: false, message: '无权限' }, 401)
  const cred = await getAdminCredentials(c.env)
  if (!cred || cred.passwordHash !== providedHash) return c.json({ success: false, message: '权限不足' }, 401)

  const bucket = c.env.ai_gateway_backup
  if (!bucket) return c.json<ApiResponse>({ success: false, message: 'R2 未配置' }, 400)
  const body = await c.req.json<{ key: string }>()
  if (!body.key) return c.json<ApiResponse>({ success: false, message: '未指定 key' }, 400)
  try {
    await bucket.delete(body.key)
    return c.json<ApiResponse>({ success: true, message: '已删除快照' })
  } catch (error) {
    return c.json<ApiResponse>({ success: false, message: '删除失败' }, 500)
  }
}

// ===== Telegram 备份通知 (存储于 kv_store: telegram:backup) =====
export interface TelegramConfig {
  botToken: string
  chatId: string
}

async function getTgConfig(env: Env): Promise<TelegramConfig | null> {
  const res = await getKV(env).get('telegram:backup')
  if (!res) return null
  try { return JSON.parse(res) as TelegramConfig } catch { return null }
}

async function saveTgConfig(env: Env, botToken: string, chatId: string): Promise<void> {
  await getKV(env).put('telegram:backup', JSON.stringify({ botToken, chatId }))
}

export async function handleTelegramTest(c: Context<{ Bindings: Env }>) {
  const { botToken, chatId } = await c.req.json<TelegramConfig>()
  if (!botToken || !chatId) return c.json<ApiResponse>({ success: false, message: '缺少参数' }, 400)
  try {
    const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: 'AI Gateway: 这是一个测试消息，配置成功！' }),
    })
    const d = await r.json() as any
    if (d.ok) {
      await saveTgConfig(c.env, botToken, chatId)
      return c.json<ApiResponse>({ success: true, message: '消息发送成功，配置已保存' })
    }
    return c.json<ApiResponse>({ success: false, message: d.description || '发送失败' }, 400)
  } catch (e) { return c.json<ApiResponse>({ success: false, message: '请求失败' }, 500) }
}

export async function handleBackupToTelegram(c: Context<{ Bindings: Env }>) {
  const { botToken, chatId } = await c.req.json<TelegramConfig>()
  if (!botToken || !chatId) return c.json<ApiResponse>({ success: false, message: '缺少参数' }, 400)
  try {
    const data = await exportBackupData(c.env)
    const jsonStr = JSON.stringify(data)
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const filename = `ai-gateway-backup-${data.exportedAt.replace(/[:.]/g, '-')}.json`
    const fd = new FormData()
    fd.append('chat_id', chatId)
    fd.append('caption', `AI Gateway 手动快照\n时间：${data.exportedAt}\n渠道与配置：${data.kv.length} 项\n用量记录：${data.usage.length} 条`)
    fd.append('document', blob, filename)

    const r = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, { method: 'POST', body: fd })
    const d = await r.json() as any
    if (d.ok) {
      await saveTgConfig(c.env, botToken, chatId)
      return c.json<ApiResponse>({ success: true, message: '已发送至 Telegram' })
    }
    return c.json<ApiResponse>({ success: false, message: d.description || '发送失败' }, 400)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return c.json<ApiResponse>({ success: false, message: `备份失败: ${message}` }, 500)
  }
}
