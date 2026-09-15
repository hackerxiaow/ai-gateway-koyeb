import { serve } from '@hono/node-server'
import postgres from 'postgres'
import app from './index'

const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:yxy.@990524gdg@db.pusivmawucsmkspnoqrf.supabase.co:5432/postgres'

const sql = postgres(dbUrl, {
  prepare: false, // 禁用 prepared statements，兼容 Supabase Transaction/Session Pooler
  max: 20,
  idle_timeout: 30,
  connect_timeout: 10,
})

const port = Number(process.env.PORT) || 8000

console.log(`AI Gateway Node.js 适配服务启动中，监听端口: ${port}`)

serve({
  fetch: (req, env, executionCtx) => {
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
  },
  port,
})
