import crypto from 'node:crypto'

// Polyfill global crypto for Node.js environment
if (!globalThis.crypto) {
  // @ts-ignore
  globalThis.crypto = crypto
} else {
  if (!globalThis.crypto.randomUUID && crypto.randomUUID) {
    globalThis.crypto.randomUUID = crypto.randomUUID.bind(crypto)
  }
  if (!globalThis.crypto.subtle && crypto.webcrypto) {
    // @ts-ignore
    globalThis.crypto.subtle = crypto.webcrypto.subtle
  }
}

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import postgres from 'postgres'
import app from './index'
import { ensurePgTables } from './storage-adapter'
import { seedInitialData, getProviders } from './storage'

const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:yxy.%40990524gdg@db.pusivmawucsmkspnoqrf.supabase.co:5432/postgres'

const sql = postgres(dbUrl, {
  prepare: false, // 禁用 prepared statements，兼容 Supabase Transaction/Session Pooler
  max: 20,
  idle_timeout: 30,
  connect_timeout: 10,
})

const port = Number(process.env.PORT) || 8000

// ===== 静态资源：/assets/* 由 Node 直接读 dist/assets 提供 =====
// 文件名带内容哈希（构建时生成），可放心 immutable 一年期强缓存；
// HTML 不再内联 CSS/JS，重复访问后台时这部分传输量为零。
const ASSETS_DIR = fileURLToPath(new URL('./assets/', import.meta.url))
const ASSET_MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
}

async function serveStaticAsset(pathname: string): Promise<Response | null> {
  if (!pathname.startsWith('/assets/')) return null
  const name = pathname.slice('/assets/'.length)
  // 只放行「文件名.哈希.扩展名」形态，杜绝目录穿越
  if (!/^[\w.-]+$/.test(name) || name.includes('..')) {
    return new Response('Not found', { status: 404 })
  }
  const ext = name.slice(name.lastIndexOf('.'))
  try {
    const body = await readFile(ASSETS_DIR + name)
    return new Response(new Uint8Array(body), {
      headers: {
        'Content-Type': ASSET_MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

// ===== 启动预热：建表 + 种子数据 + 渠道缓存 =====
// providers JSON 可达 MB 级，冷实例的第一个请求若同步触发初始化 + 全量读取，
// TTFB 会飙到数秒；开机即后台拉热，用户请求尽量命中热缓存。
const warmEnv = {
  PG: sql,
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'yxy.@990524gdg',
} as any
;(async () => {
  try {
    await ensurePgTables(sql)
    await seedInitialData(warmEnv)
    await getProviders(warmEnv)
    console.log('[warmup] PG 表结构 / 种子数据 / 渠道缓存 已就绪')
  } catch (e: any) {
    console.warn('[warmup] 预热失败（首个请求会重试）:', e?.message)
  }
})()

// ===== 实例保温 =====
// Koyeb 实例长时间无流量会缩容到零，冷启动 + 缓存重建要数秒。
// 每 4 分钟自打一次公开 ping 让平台认为实例活跃；置 KOYEB_KEEPALIVE_URL='' 可关闭。
const keepAliveUrl = process.env.KOYEB_KEEPALIVE_URL === ''
  ? ''
  : (process.env.KOYEB_KEEPALIVE_URL || 'https://api-hackerxiaow-830602d5.koyeb.app/api/ping')
if (keepAliveUrl) {
  const ping = () => fetch(keepAliveUrl, { signal: AbortSignal.timeout(10_000) })
    .then((r) => console.log('[keepalive] ping ->', r.status))
    .catch(() => {})
  setTimeout(ping, 30_000)
  setInterval(ping, 4 * 60_000)
}

console.log(`AI Gateway Node.js 适配服务启动中，监听端口: ${port}`)

serve({
  fetch: (req, env, executionCtx) => {
    const { pathname } = new URL(req.url)
    return serveStaticAsset(pathname).then((staticRes) => {
      if (staticRes) return staticRes
      const customEnv = {
        PG: sql,
        ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
        ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'yxy.@990524gdg',
        OPENCODE_MIRRORS_URL: process.env.OPENCODE_MIRRORS_URL,
        AG_CLIENT_ID: process.env.AG_CLIENT_ID,
        AG_CLIENT_SECRET: process.env.AG_CLIENT_SECRET,
        ...env,
      }
      return app.fetch(req, customEnv, executionCtx)
    })
  },
  port,
})