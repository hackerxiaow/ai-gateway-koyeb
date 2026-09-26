import type { Context } from 'hono'

/**
 * 获取请求的外部真实 Origin。
 * 在 Koyeb 等容器化反向代理环境下：
 * 容器内部收到的协议通常为 http，真实的协议与域名优先从
 * x-forwarded-proto 与 x-forwarded-host 还原，防止 baseUrl 出现 http:// 协议混杂问题。
 */
export function getExternalOrigin(c: Context): string {
  const fwdProto = c.req.header('x-forwarded-proto')?.split(',')[0].trim().toLowerCase()
  const fwdHost = c.req.header('x-forwarded-host')?.split(',')[0].trim()
  const host = fwdHost || c.req.header('host')

  if (host) {
    const proto = fwdProto || (host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https')
    return `${proto}://${host}`
  }

  try {
    const url = new URL(c.req.url)
    const proto = fwdProto || (url.hostname.includes('localhost') || url.hostname.includes('127.0.0.1') ? 'http' : 'https')
    return `${proto}://${url.host}`
  } catch {
    return 'http://localhost:8000'
  }
}
