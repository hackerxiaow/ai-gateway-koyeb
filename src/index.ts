import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { Env } from './types'
import { adminAuthMiddleware, proxyKeyAuthMiddleware, handleLogin, handleLogout } from './auth'
import { handleProxy, handleModels } from './proxy'
import {
  handleStatus,
  handleGetProviders,
  handleCreateProvider,
  handleUpdateProvider,
  handleDeleteProvider,
  handleTestModel,
  handleTestKeyNew,
  handleTestModelNew,
  handleSaveDsAccount,
  handleDsLogin,
  handleClearDsAccount,
  handleGetProxyKeys,
  handleCreateProxyKey,
  handleUpdateProxyKey,
  handleDeleteProxyKey,
  handleGetUsage,
  handleTtsPreview,
  handleAntigravityOAuthStart,
  handleAntigravityOAuthComplete,
  handleAntigravityModels,
  handleAntigravityQuotaAll,
  handleAntigravityAccounts,
  handleVertexVerify,
  handleDevinOAuthStart,
  handleDevinOAuthComplete,
  handleDevinVerify,
  handleOAuthStart,
  handleOAuthComplete,
  handleOAuthPoll,
  handleOAuthModels,
  handleCodebuddyStatus,
  handleCodebuddyCheckin,
  handleCronCheckin,
  handleClineQuota,
  handleSyncProviderModels,
  handleSyncAllModels,
  handleCronModels,
} from './admin'
import { renderHomePage, renderLoginPage, renderAdminPage } from './pages'
import { probeDeepSeek, probeDeepSeekLogin } from './deepseek-auth-probe'
import { seedInitialData, getSession } from './storage'
import { ensureD1Tables, ensurePgTables } from './storage-adapter'
import { handleBackupExport, handleBackupImport, handleBackupToR2, handleBackupList, handleBackupRestore, handleBackupDelete, handleTelegramTest, handleTelegramSave, handleBackupToTelegram } from './backup'

const app = new Hono<{ Bindings: Env }>()

// ===== 全局中间件 =====
app.use('*', cors())
app.use('*', logger())

// 首次请求时初始化 D1 表结构并填充初始数据
let seeded = false
app.use('*', async (c, next) => {
  if (c.env.PG) {
    await ensurePgTables(c.env.PG)
  }
  if (c.env.DB) {
    await ensureD1Tables(c.env.DB)
  }
  if (!seeded) {
    await seedInitialData(c.env)
    seeded = true
  }
  return next()
})

// ===== 首页 =====
app.get('/', async (c) => {
  const { getCookie } = await import('hono/cookie')
  const sessionId = getCookie(c, 'session_id')
  let isLoggedIn = false
  if (sessionId) {
const session = await getSession(c.env, sessionId)
    isLoggedIn = session !== null
  }
  return renderHomePage(c, isLoggedIn)
})

// ===== 登录/退出 =====
app.get('/admin/login', async (c) => renderLoginPage(c))
app.post('/admin/login', handleLogin)
app.get('/admin/logout', handleLogout)

// ===== 管理后台（需 Session 验证） =====
app.use('/admin/*', adminAuthMiddleware)

app.get('/admin', async (c) => {
  const res = await renderAdminPage(c)
  // 管理页含内联脚本, 禁止缓存以免浏览器长期使用旧版界面
  res.headers.set('Cache-Control', 'no-store, must-revalidate')
  return res
})

// 系统状态
app.get('/admin/api/status', handleStatus)

// 提供商 CRUD
app.get('/admin/api/providers', handleGetProviders)
app.post('/admin/api/providers', handleCreateProvider)
app.put('/admin/api/providers/:id', handleUpdateProvider)
app.delete('/admin/api/providers/:id', handleDeleteProvider)
app.post('/admin/api/providers/:id/test-model', handleTestModel)
app.post('/admin/api/providers/:id/sync-models', handleSyncProviderModels)
app.post('/admin/api/sync-models', handleSyncAllModels)
// DeepSeek 账号托管（方案 B：网关代登录换 userToken）
app.put('/admin/api/providers/:id/ds-account', handleSaveDsAccount)
app.post('/admin/api/providers/:id/ds-login', handleDsLogin)
app.delete('/admin/api/providers/:id/ds-account', handleClearDsAccount)
app.post('/admin/api/test-key', handleTestKeyNew)
app.post('/admin/api/test-model', handleTestModelNew)

// 转发 Key 管理
app.get('/admin/api/proxy-keys', handleGetProxyKeys)
app.post('/admin/api/proxy-keys', handleCreateProxyKey)
app.delete('/admin/api/proxy-keys/:id', handleDeleteProxyKey)
app.patch('/admin/api/proxy-keys/:id', handleUpdateProxyKey)

// Token 用量统计
app.get('/admin/api/usage', handleGetUsage)

// Azure TTS 音色试听(管理员会话, 返回 audio/mpeg)
app.post('/admin/api/tts-preview', handleTtsPreview)

// Antigravity 内置 OAuth 授权 + 可用模型(管理员会话)
app.post('/admin/api/antigravity/oauth/start', handleAntigravityOAuthStart)
app.post('/admin/api/antigravity/oauth/complete', handleAntigravityOAuthComplete)
app.post('/admin/api/antigravity/models', handleAntigravityModels)
app.post('/admin/api/antigravity/quota', handleAntigravityQuotaAll)
app.post('/admin/api/antigravity/accounts', handleAntigravityAccounts)
app.post('/admin/api/vertex/verify', handleVertexVerify)
app.post('/admin/api/devin/oauth/start', handleDevinOAuthStart)
app.post('/admin/api/devin/oauth/complete', handleDevinOAuthComplete)
app.post('/admin/api/devin/verify', handleDevinVerify)

// OAuth 反代渠道内置授权(claude/codex: 授权链接; kimi/grok: 设备码轮询)
app.post('/admin/api/oauth/:provider/start', handleOAuthStart)
app.post('/admin/api/oauth/:provider/complete', handleOAuthComplete)
app.post('/admin/api/oauth/:provider/poll', handleOAuthPoll)
app.post('/admin/api/oauth/:provider/models', handleOAuthModels)

// CodeBuddy 账号状态（积分/套餐余额）
app.post('/admin/api/codebuddy/status', handleCodebuddyStatus)

// Cline 额度页（全部渠道各凭据的余额 + 各模型今日用量/冷却状态）
app.post('/admin/api/cline/quota', handleClineQuota)

// CodeBuddy 每日签到（单账号；body.all=true 时遍历全部 codebuddy 渠道，供定时任务）
app.post('/admin/api/codebuddy/checkin', handleCodebuddyCheckin)

// ===== 定时任务入口（不需要管理员会话）=====
// 用由 ADMIN_PASSWORD 单向派生的专用令牌鉴权（X-Cron-Token 头 或 ?token=），权限最小化：
// 只能触发签到，拿不到任何渠道配置。见 README「每日签到」。
// 同时支持 GET/HEAD：外部存活监控（UptimeRobot / BetterStack 等）通常只能配一个 URL，
// 让它顺手把签到也触发了，就不必额外维护一套定时器。内置当日节流，高频 ping 不会重复打上游。
app.get('/cron/checkin', handleCronCheckin)
app.on('HEAD', '/cron/checkin', handleCronCheckin)
app.post('/cron/checkin', handleCronCheckin)
app.get('/cron/models', handleCronModels)
app.on('HEAD', '/cron/models', handleCronModels)
app.post('/cron/models', handleCronModels)

// ===== 备份/恢复 =====
app.get('/admin/api/backup/export', handleBackupExport)
app.post('/admin/api/backup/import', handleBackupImport)
app.post('/admin/api/backup/to-r2', handleBackupToR2)
app.get('/admin/api/backup/list', handleBackupList)
app.post('/admin/api/backup/restore', handleBackupRestore)
app.post('/admin/api/backup/delete', handleBackupDelete)
// Telegram 备份
app.post('/admin/api/telegram/test', handleTelegramTest)
app.post('/admin/api/telegram/save', handleTelegramSave)

// ===== DeepSeek 设备身份 / WAF 可达性探针（诊断用，判断「代登录」是否可行） =====
// GET  只做本地派生 + 无副作用联网探测（不提交任何凭据）
// POST 传 { email|mobile, password } 才会真实打一次 /users/login（有副作用，慎用）
app.get('/admin/api/ds-probe', async (c) => {
  try {
    return c.json(await probeDeepSeek())
  } catch (err) {
    return c.json({ error: { message: (err as Error).message || '探针失败' } }, 500)
  }
})
app.post('/admin/api/ds-probe/login', async (c) => {
  const body: any = await c.req.json().catch(() => null)
  if (!body?.password) {
    return c.json({ error: { message: '需要 password；可选 email 或 mobile(+area_code)' } }, 400)
  }
  try {
    return c.json(await probeDeepSeekLogin({
      email: body.email,
      mobile: body.mobile,
      password: body.password,
      areaCode: body.area_code,
    }))
  } catch (err) {
    return c.json({ error: { message: (err as Error).message || '登录探测失败' } }, 500)
  }
})
app.post('/admin/api/backup/to-telegram', handleBackupToTelegram)

// ===== API 转发路由（需转发 Key 验证） =====
app.use('/v1/*', proxyKeyAuthMiddleware)
app.get('/v1/models', handleModels)

// OpenAI 兼容代理端点（全部透传转发，参考 one-api-cf 端点清单）
app.post('/v1/chat/completions', handleProxy)
app.post('/v1/completions', handleProxy)
app.post('/v1/edits', handleProxy)
app.post('/v1/moderations', handleProxy)
app.post('/v1/messages', handleProxy)
app.post('/v1/responses', handleProxy)
app.post('/v1/audio/speech', handleProxy)
app.post('/v1/audio/transcriptions', handleProxy)
app.post('/v1/audio/translations', handleProxy)
app.post('/v1/images/generations', handleProxy)
app.post('/v1/images/edits', handleProxy)
app.post('/v1/images/variations', handleProxy)
app.post('/v1/embeddings', handleProxy)
app.post('/v1/engines/:model/embeddings', handleProxy)
app.post('/v1/videos/generations', handleProxy)
app.post('/v1/video/generations', handleProxy)
app.get('/v1/videos/status', handleProxy)

// 未实现端点（files / fine-tuning / assistants / threads 等, 返回标准 501）
const notImplemented = (c: Context) => c.json({
  error: { message: 'API not implemented', type: 'one_api_error', param: '', code: 'api_not_implemented' },
}, 501)
// files
app.get('/v1/files', notImplemented)
app.post('/v1/files', notImplemented)
app.delete('/v1/files/:id', notImplemented)
app.get('/v1/files/:id', notImplemented)
app.get('/v1/files/:id/content', notImplemented)
// fine-tuning
app.post('/v1/fine_tuning/jobs', notImplemented)
app.get('/v1/fine_tuning/jobs', notImplemented)
app.get('/v1/fine_tuning/jobs/:id', notImplemented)
app.post('/v1/fine_tuning/jobs/:id/cancel', notImplemented)
app.get('/v1/fine_tuning/jobs/:id/events', notImplemented)
// assistants
app.post('/v1/assistants', notImplemented)
app.get('/v1/assistants/:id', notImplemented)
app.post('/v1/assistants/:id', notImplemented)
app.delete('/v1/assistants/:id', notImplemented)
app.get('/v1/assistants', notImplemented)
// threads
app.post('/v1/threads', notImplemented)
app.get('/v1/threads/:id', notImplemented)
app.post('/v1/threads/:id', notImplemented)
app.delete('/v1/threads/:id', notImplemented)

// 兜底: 其余 /v1/* 走代理
app.all('/v1/*', handleProxy)

// ===== 404 处理 =====
app.notFound((c) => {
  return c.json({ error: { message: '接口不存在', type: 'not_found' } }, 404)
})

// ===== 错误处理 =====
app.onError((err, c) => {
  console.error('App error:', err.stack || err.message || err)
  return c.json({ error: { message: err.message || '服务器内部错误', type: 'server_error' } }, 500)
})

export default app
