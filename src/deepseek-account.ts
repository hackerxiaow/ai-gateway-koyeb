/**
 * DeepSeek 账号密码的**可逆加密**存储。
 *
 * 为什么不用 HMAC（那是 codebuddyCronToken 的做法）：
 * 派生令牌只需「验证」，单向哈希就够；而代登录必须**取回明文**去 POST /users/login，
 * 所以必须可逆 —— 用 AES-GCM（WebCrypto 原生，Workers 里可用）。
 *
 * 密钥来源：`ADMIN_PASSWORD` + 一个固定 label，经 HKDF 派生出 256 位 AES 密钥。
 * 这样**不需要新增 Cloudflare 环境变量**（改 env_vars 会覆盖掉不可读的既有 secret）。
 *
 * ⚠️ 副作用（与 codebuddyCronToken 相同的取舍）：**改管理员密码会使已存密码无法解密**。
 *    解密失败时返回 null，调用方必须**失败关闭**（要求用户重新填写），不要静默降级。
 * ⚠️ 未配置 `ADMIN_PASSWORD` 时 encrypt 返回 null、decrypt 返回 null —— 一律失败关闭。
 */
import type { Env } from './types'

const HKDF_LABEL = 'deepseek-account-password-v1'
const IV_BYTES = 12 // AES-GCM 推荐 96 位 IV

/** 从 ADMIN_PASSWORD 派生 AES-GCM 密钥（无 ADMIN_PASSWORD 时返回 null） */
async function deriveKey(env: Env): Promise<CryptoKey | null> {
  const secret = env.ADMIN_PASSWORD || ''
  if (!secret) return null
  const enc = new TextEncoder()
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(HKDF_LABEL), info: enc.encode('aes-gcm-256') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * 加密明文密码。返回 `v1.<iv_b64>.<cipher_b64>`；无密钥或失败时返回 null。
 * 前缀 `v1.` 便于将来换算法时区分。
 */
export async function encryptSecret(env: Env, plain: string): Promise<string | null> {
  if (!plain) return null
  try {
    const key = await deriveKey(env)
    if (!key) return null
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain))
    return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(ct))}`
  } catch {
    return null
  }
}

/**
 * 解密。**任何异常都返回 null**（密文被篡改、换了 ADMIN_PASSWORD、格式不对），
 * 调用方必须失败关闭。
 */
export async function decryptSecret(env: Env, blob: string): Promise<string | null> {
  if (!blob || !blob.startsWith('v1.')) return null
  const parts = blob.split('.')
  if (parts.length !== 3) return null
  try {
    const key = await deriveKey(env)
    if (!key) return null
    const iv = fromBase64(parts[1])
    const ct = fromBase64(parts[2])
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
    return new TextDecoder().decode(pt)
  } catch {
    return null
  }
}

/** 判断一个字符串是否是本模块产出的密文格式（用于 UI 显示「已保存」而非回显明文） */
export function isEncryptedBlob(s: string | undefined | null): boolean {
  if (!s) return false
  const parts = s.split('.')
  return parts.length === 3 && parts[0] === 'v1' && parts[1].length > 0 && parts[2].length > 0
}

/**
 * 掩码显示：用于 UI 上告诉用户「已存密码，长度 N」，但绝不回显明文或密文本身。
 * 例：`••••••••`（固定 8 个点，不泄漏真实长度信息以外的任何内容）
 */
export function maskSecret(): string {
  return '••••••••'
}
