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
} from './admin'
import { renderHomePage, renderLoginPage, renderAdminPage } from './pages'
import { seedInitialData, getSession } from './storage'
import { ensureD1Tables, ensurePgTables } from './storage-adapter'
import { handleBackupExport, handleBackupImport, handleBackupToR2, handleBackupList, handleBackupRestore, handleBackupDelete, handleTelegramTest, handleBackupToTelegram } from './backup'

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

// ===== 备份/恢复 =====
app.get('/admin/api/backup/export', handleBackupExport)
app.post('/admin/api/backup/import', handleBackupImport)
app.post('/admin/api/backup/to-r2', handleBackupToR2)
app.get('/admin/api/backup/list', handleBackupList)
app.post('/admin/api/backup/restore', handleBackupRestore)
app.post('/admin/api/backup/delete', handleBackupDelete)
// Telegram 备份
app.post('/admin/api/telegram/test', handleTelegramTest)
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
  console.error('未捕获的错误:', err)
  return c.json({ error: { message: '服务器内部错误', type: 'server_error' } }, 500)
})

export default app
