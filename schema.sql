-- D1 数据库结构定义 (ai-gateway)

-- 1. 键值存储表 (存放配置、凭据、提供商、ProxyKey 等数据)
--    expires_at: Unix 秒时间戳，NULL 表示永不过期（参照 KV expirationTtl 语义）
CREATE TABLE IF NOT EXISTS kv_store (
  key TEXT PRIMARY KEY,
  value TEXT,
  expires_at INTEGER DEFAULT NULL
);

-- 2. 用量统计记录表
CREATE TABLE IF NOT EXISTS usage_records (
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
);

-- 3. 索引优化
CREATE INDEX IF NOT EXISTS idx_usage_records_ts ON usage_records(ts);
CREATE INDEX IF NOT EXISTS idx_usage_records_model ON usage_records(model);
CREATE INDEX IF NOT EXISTS idx_usage_records_provider ON usage_records(provider);
-- 过期数据清理查询优化
CREATE INDEX IF NOT EXISTS idx_kv_store_expires ON kv_store(expires_at) WHERE expires_at IS NOT NULL;
