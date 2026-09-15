import type { Provider } from './types'

export const SITE_CONFIG = {
  title: 'AI Gateway',
  subtitle: '统一的 AI 管理平台',
  author: 'QingYun',
  authorUrl: 'https://github.com/yutian81/ai-gateway',
  blogUrl: 'https://blog.notett.com',
  description: 'AI 渠道 API 代理网关 — 统一 /v1 接口转发',
  favicon: 'https://pan.811520.xyz/icon/ai.webp',
  faCdn: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css',
}

export const SESSION_TTL = 7 * 24 * 60 * 60

export const PROXY_KEY_PREFIX = 'sk_cf_'

export const OPENCODE_DEFAULT_URL = 'https://opencode.ai/zen/v1'

// Key 降权后自动恢复的冷却时间 (毫秒)
export const KEY_HEALTH_COOLDOWN_MS = 5 * 60 * 1000

// 连续失败多少次后降权
export const KEY_HEALTH_MAX_FAILURES = 5

export const KV_KEYS = {
  PROVIDERS: 'providers',
  PROXY_KEYS: 'proxy:keys',
  SESSION_PREFIX: 'admin:session:',
  KEY_HEALTH_PREFIX: 'key:health:',
  OPENCODE_MIGRATION: 'migration:opencode-default:v1',
  USAGE_PREFIX: 'usage:req:',
} as const

// 用量记录保留天数（超过自动清理）
export const USAGE_RETENTION_DAYS = 30

// 有效期选项（秒）
export const EXPIRY_OPTIONS: Record<string, number | null> = {
  '30d': 30 * 24 * 60 * 60,
  '90d': 90 * 24 * 60 * 60,
  '180d': 180 * 24 * 60 * 60,
  '1y': 365 * 24 * 60 * 60,
  'forever': null,
}

export const DEFAULT_PROVIDERS: Provider[] = [
  {
    id: 'opencode',
    name: 'OpenCode',
    baseUrl: 'https://opencode.ai/zen/v1',
    apiType: 'openai',
    apiKeys: [],
    mirrorUrls: [
      'https://opencode.ai.cmliussss.net/zen/v1',
      'https://opencode.fastly.cmliussss.net/zen/v1',
      'https://opencode.gcore.cmliussss.net/zen/v1',
    ],
    models: [
      { id: 'deepseek-v4-flash-free', enabled: true },
      { id: 'mimo-v2.5-free', enabled: true },
      { id: 'nemotron-3-ultra-free', enabled: true },
      { id: 'hy3-free', enabled: true },
    ],
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'kilo',
    name: 'Kilo',
    baseUrl: 'https://api.kilo.ai/api/gateway',
    apiType: 'openai',
    apiKeys: [],
    models: [
      { id: 'kilo-auto/frontier', alias: 'kilo-frontier', enabled: true },
      { id: 'kilo-auto/balanced', alias: 'kilo-balanced', enabled: true },
      { id: 'kilo-auto/efficient', alias: 'kilo-efficient', enabled: true },
      { id: 'google/gemma-3-27b-it:free', enabled: true },
      { id: 'stepfun/step-3.7-flash:free', enabled: true },
      { id: 'tencent/hy3:free', enabled: true },
      { id: 'microsoft/mai-ds-r1:free', enabled: true },
      { id: 'z-ai/glm-4.5-air:free', enabled: true },
      { id: 'inception/mercury:free', enabled: true },
      { id: 'inception/mercury-2:free', enabled: true },
    ],
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tts',
    name: 'Azure TTS',
    baseUrl: '',
    type: 'azure-tts',
    apiType: 'openai',
    apiKeys: [],
    voice: 'zh-CN-XiaoxiaoNeural',
    rate: '+0%',
    volume: '+0%',
    pitch: '+0Hz',
    models: [
      { id: 'zh-CN-YunxiNeural', enabled: true },
      { id: 'zh-CN-XiaoxiaoNeural', enabled: true },
      { id: 'en-US-JennyNeural', enabled: true },
      { id: 'ja-JP-NanamiNeural', enabled: true },
    ],
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]
