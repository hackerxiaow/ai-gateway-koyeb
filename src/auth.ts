import { Context, Next } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { createSession, getSession, deleteSession, validateProxyKey, getAdminCredentials, setAdminCredentials } from './storage'
import type { AdminCredentials } from './storage'
import { SESSION_TTL } from './config'
import type { Env } from './types'

/** SHA-256 哈希 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 管理后台 Session 验证中间件 */
export async function adminAuthMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const sessionId = getCookie(c, 'session_id')

  if (!sessionId) {
    const url = new URL(c.req.url)
    if (url.pathname === '/admin/login') return next()
    if (url.pathname.startsWith('/admin/api/')) {
      return c.json({ success: false, message: '未登录' }, 401)
    }
    return c.redirect('/admin/login')
  }

  const session = await getSession(c.env, sessionId)
  if (!session) {
    deleteCookie(c, 'session_id')
    const url = new URL(c.req.url)
    if (url.pathname.startsWith('/admin/api/')) {
      return c.json({ success: false, message: 'Session 已过期' }, 401)
    }
    return c.redirect('/admin/login')
  }

  ;(c as any).set('username', session.username)
  return next()
}

/** 管理员登录: 优先环境变量, 其次存储中持久化的凭据; 成功后写入存储(保证备份/恢复后凭据可用) */
export async function handleLogin(c: Context<{ Bindings: Env }>) {
  const { username, password } = await c.req.json()
  const adminUser = c.env.ADMIN_USERNAME
  const adminPass = c.env.ADMIN_PASSWORD

  if (!username || !password) {
    return c.json({ success: false, message: '请输入用户名和密码' }, 400)
  }

  // 凭据来源: 环境变量 > 存储中的持久化凭据
  let cred: AdminCredentials | null = null
  if (adminUser && adminPass) {
    const passwordHash = await hashPassword(adminPass)
    cred = { username: adminUser, passwordHash }
  } else {
    cred = await getAdminCredentials(c.env)
  }

  if (!cred) {
    return c.json({
      success: false,
      message: '未配置管理员账号，请在 Cloudflare 环境变量中设置 ADMIN_USERNAME 和 ADMIN_PASSWORD',
    }, 500)
  }

  if (username !== cred.username) {
    return c.json({ success: false, message: '用户名或密码错误' }, 401)
  }

  const passwordHash = await hashPassword(password)
  if (passwordHash !== cred.passwordHash) {
    return c.json({ success: false, message: '用户名或密码错误' }, 401)
  }

  // 登录成功: 持久化凭据到存储, 保证备份/恢复/重启后可用
  await setAdminCredentials(c.env, cred.username, cred.passwordHash)

  const sessionId = await createSession(c.env, username, SESSION_TTL)
  setCookie(c, 'session_id', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL,
  })

  return c.json({ success: true, message: '登录成功' })
}

/** 退出登录 */
export async function handleLogout(c: Context<{ Bindings: Env }>) {
  const sessionId = getCookie(c, 'session_id')
  if (sessionId) {
    await deleteSession(c.env, sessionId)
    deleteCookie(c, 'session_id')
  }
  return c.redirect('/')
}

/** 转发 API Key 验证中间件 */
export async function proxyKeyAuthMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({
      error: { message: '缺少或无效的 Authorization 头，格式: Bearer sk_cf_*', type: 'authentication_error' },
    }, 401)
  }

  const token = authHeader.slice(7)
  const isValid = await validateProxyKey(c.env, token)
  if (!isValid) {
    return c.json({
      error: { message: 'API Key 无效或已禁用', type: 'authentication_error' },
    }, 401)
  }

  return next()
}
