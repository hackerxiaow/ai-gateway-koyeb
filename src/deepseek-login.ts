/**
 * DeepSeek 网页版**代登录**（用账号密码换 userToken）。
 *
 * 参考实现：ds-free-api `ds_core/src/accounts/client.rs`
 *   - login()          : POST {api_base}/users/login  {email|mobile, password, area_code, device_id, os}
 *   - check_device()   : POST {api_base}/users/auth_token/check_device  {device_id, device_model}
 *   - extract_rotate_token() : rotate 形态未知，兼容字符串与 {token:"..."}
 *   - is_waf_challenge()     : status 202 且带 x-amzn-waf-action
 *
 * 设计要点：
 *   1. 复用 `deepseek-auth-probe.ts` 的 device_id 派生与客户端头，保证设备身份与探测一致。
 *   2. 响应统一走 DeepSeek 的**信封**结构：HTTP 200 也可能是业务失败，
 *      必须看 `data.biz_code`（非 0 即失败），不能只看 HTTP 状态。
 *   3. `check_device` 失败**不阻断**（真实客户端亦非关键路径，照搬 pool.rs 的处理）。
 *   4. 全程不落日志明文密码。
 *
 * ⚠️ 本模块**有副作用**：会向 DeepSeek 发起真实登录，可能触发风控计数。
 *    仅应由管理员显式触发的接口调用，不要放进任何自动重试路径。
 */
import { DS_API_BASE, DS_CLIENT_OS, DS_DEVICE_MODEL, clientHeaders, deviceIdFor, isWafChallenge } from './deepseek-auth-probe'

/** DeepSeek 信封：{ code, msg, data: { biz_code, biz_msg, biz_data } } */
interface Envelope<T> {
  code?: number
  msg?: string
  data?: {
    biz_code?: number
    biz_msg?: string
    biz_data?: T
  }
}

/** /users/login 的成功数据 */
export interface LoginData {
  /** 用户信息（含 token） */
  user?: {
    id?: string
    token?: string
    email?: string
    mobile_number?: string
    /** 1/bool = 被禁言 */
    chat?: { is_muted?: number | boolean; mute_until?: number | null } | null
  }
}

export interface LoginResult {
  ok: boolean
  /** HTTP 状态码 */
  status?: number
  /** 被 AWS WAF 挑战（出口 IP 受限） */
  wafChallenge?: boolean
  /** 信封顶层 code（0 = 成功） */
  code?: number
  /** 业务码（非 0 = 业务失败，如密码错、风控） */
  bizCode?: number
  /** 可读错误信息 */
  msg?: string
  /** 拿到的 userToken（仅 ok=true 时存在） */
  userToken?: string
  /** 账号是否被禁言/限制 */
  muted?: boolean
  /** 禁言解除时间戳（Unix 秒） */
  muteUntil?: number | null
  /** 设备校验是否要求轮换令牌（并已轮换成功） */
  rotated?: boolean
  /** 设备校验是否失败（不阻断登录结果，仅记录） */
  checkDeviceFailed?: boolean
  error?: string
}

/** 从 rotate 指令里提取新令牌（照搬 ds-free-api `extract_rotate_token`） */
export function extractRotateToken(rotate: unknown): string | null {
  if (typeof rotate === 'string') return rotate.length > 0 ? rotate : null
  if (rotate && typeof rotate === 'object') {
    const t = (rotate as Record<string, unknown>).token
    return typeof t === 'string' && t.length > 0 ? t : null
  }
  return null
}

/** 把各种形态的 is_muted 归一成布尔（照搬 ds-free-api `de_muted_flag`） */
function isMuted(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  return false
}

/** 一次 HTTP 往返的原始结果，便于测试注入 */
interface RawResponse {
  status: number
  headers: Headers
  text: string
}

/** 可注入的 fetcher（默认全局 fetch；测试里替换即可，无需真实账号） */
export type Fetcher = (url: string, init: RequestInit) => Promise<RawResponse>

const defaultFetcher: Fetcher = async (url, init) => {
  const res = await fetch(url, init)
  return { status: res.status, headers: res.headers, text: await res.text().catch(() => '') }
}

/** 解析信封；非 JSON 或结构缺失时返回 null */
function parseEnvelope<T>(text: string): Envelope<T> | null {
  try {
    const j = JSON.parse(text)
    return j && typeof j === 'object' ? (j as Envelope<T>) : null
  } catch {
    return null
  }
}

/** 把信封里的错误信息拼成人话 */
function envelopeError(env: Envelope<unknown> | null, fallback: string): string {
  if (!env) return fallback
  const bizMsg = env.data?.biz_msg
  if (bizMsg) return bizMsg
  if (env.msg) return env.msg
  const bc = env.data?.biz_code
  if (typeof bc === 'number') return `业务码 ${bc}`
  return fallback
}

/**
 * 用账号密码登录，成功时返回 userToken。
 *
 * @param account email 或 mobile 至少一个；密码不落日志
 * @param opts.apiBase 覆盖默认 api_base（便于指向测试桩）
 * @param opts.fetcher 注入 fetcher（测试用）
 */
export async function loginWithPassword(
  account: { email?: string; mobile?: string; password: string; areaCode?: string },
  opts: { apiBase?: string; fetcher?: Fetcher; checkDevice?: boolean } = {},
): Promise<LoginResult> {
  const apiBase = opts.apiBase || DS_API_BASE
  const fetcher = opts.fetcher || defaultFetcher
  const deviceId = deviceIdFor(apiBase)

  if (!account.email && !account.mobile) {
    return { ok: false, error: '需要 email 或 mobile 之一' }
  }
  if (!account.password) return { ok: false, error: '需要 password' }

  const payload: Record<string, string> = {
    password: account.password,
    device_id: deviceId,
    os: DS_CLIENT_OS,
  }
  if (account.email) payload.email = account.email
  if (account.mobile) {
    payload.mobile = account.mobile
    payload.area_code = account.areaCode || '+86'
  }

  let raw: RawResponse
  try {
    raw = await fetcher(`${apiBase}/users/login`, {
      method: 'POST',
      headers: {
        ...clientHeaders(deviceId),
        'Content-Type': 'application/json',
        Referer: 'https://chat.deepseek.com/sign_in',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    })
  } catch (err) {
    return { ok: false, error: (err as Error).message || '登录请求失败' }
  }

  if (isWafChallenge(raw.status, raw.headers)) {
    return {
      ok: false,
      status: raw.status,
      wafChallenge: true,
      msg: '出口 IP 被 AWS WAF 挑战，无法完成代登录（需换非美国出口的节点）',
    }
  }

  const env = parseEnvelope<LoginData>(raw.text)
  const bizCode = env?.data?.biz_code
  const topCode = env?.code
  // 成功判定：信封 code=0（若缺省则退回看 HTTP 2xx）且 biz_code=0（若缺省则视为通过）
  const httpOk = raw.status >= 200 && raw.status < 300
  const codeOk = typeof topCode === 'number' ? topCode === 0 : httpOk
  const bizOk = typeof bizCode === 'number' ? bizCode === 0 : true
  if (!codeOk || !bizOk) {
    return {
      ok: false,
      status: raw.status,
      code: topCode,
      bizCode,
      msg: envelopeError(env, `登录失败（HTTP ${raw.status}）`),
    }
  }

  const user = env?.data?.biz_data?.user
  const userToken = user?.token
  if (!userToken) {
    return {
      ok: false,
      status: raw.status,
      code: topCode,
      bizCode,
      msg: '登录返回成功但未拿到 token（接口形态可能已变更）',
    }
  }

  const muted = isMuted(user?.chat?.is_muted)
  const muteUntil = user?.chat?.mute_until ?? null

  // 真实客户端登录成功后立即做设备校验；本处默认开启，失败不阻断
  let token = userToken
  let rotated = false
  let checkDeviceFailed = false
  if (opts.checkDevice !== false) {
    const cd = await checkDevice(token, { apiBase, fetcher })
    if (cd.ok) {
      if (cd.rotate !== undefined && cd.rotate !== null) {
        const next = extractRotateToken(cd.rotate)
        if (next) {
          token = next
          rotated = true
        }
      }
    } else {
      checkDeviceFailed = true
    }
  }

  return {
    ok: true,
    status: raw.status,
    code: topCode,
    bizCode,
    userToken: token,
    muted,
    muteUntil,
    rotated,
    checkDeviceFailed,
  }
}

/**
 * 设备校验 / 令牌轮换检查。
 *
 * 与 ds-free-api 一致：**失败不阻断**登录（真实客户端亦非关键路径）。
 * 返回 `{ok, rotate}`，`rotate` 为原始 JSON 值（调用方用 extractRotateToken 解析）。
 */
export async function checkDevice(
  token: string,
  opts: { apiBase?: string; fetcher?: Fetcher } = {},
): Promise<{ ok: boolean; rotate?: unknown; error?: string }> {
  const apiBase = opts.apiBase || DS_API_BASE
  const fetcher = opts.fetcher || defaultFetcher
  const deviceId = deviceIdFor(apiBase)
  try {
    const raw = await fetcher(`${apiBase}/users/auth_token/check_device`, {
      method: 'POST',
      headers: {
        ...clientHeaders(deviceId),
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ device_id: deviceId, device_model: DS_DEVICE_MODEL }),
      signal: AbortSignal.timeout(20000),
    })
    if (isWafChallenge(raw.status, raw.headers)) {
      return { ok: false, error: 'WAF 挑战' }
    }
    const env = parseEnvelope<{ rotate?: unknown }>(raw.text)
    if (!env || (typeof env.code === 'number' && env.code !== 0)) {
      return { ok: false, error: envelopeError(env, `check_device 失败（HTTP ${raw.status}）`) }
    }
    return { ok: true, rotate: env?.data?.biz_data?.rotate }
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'check_device 请求失败' }
  }
}

/**
 * 校验一个已有 userToken 是否仍有效（只读，无副作用）。
 * 用于「代登录后立即确认真的能用」以及「粘贴的 token 是否过期」的判断。
 */
export async function verifyUserToken(
  token: string,
  opts: { apiBase?: string; fetcher?: Fetcher } = {},
): Promise<{ ok: boolean; status?: number; wafChallenge?: boolean; email?: string; mobile?: string; error?: string }> {
  const apiBase = opts.apiBase || DS_API_BASE
  const fetcher = opts.fetcher || defaultFetcher
  const deviceId = deviceIdFor(apiBase)
  try {
    const raw = await fetcher(`${apiBase}/users/current`, {
      method: 'GET',
      headers: { ...clientHeaders(deviceId), Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    })
    if (isWafChallenge(raw.status, raw.headers)) {
      return { ok: false, status: raw.status, wafChallenge: true, error: 'WAF 挑战' }
    }
    const env = parseEnvelope<{ id?: string; email?: string; mobile_number?: string }>(raw.text)
    const httpOk = raw.status >= 200 && raw.status < 300
    const topCode = env?.code
    const bizCode = env?.data?.biz_code
    // 与 login 同一套判定：顶层 code 与 biz_code 都必须为 0（缺省时退回 HTTP 状态）
    const codeOk = typeof topCode === 'number' ? topCode === 0 : httpOk
    const bizOk = typeof bizCode === 'number' ? bizCode === 0 : true
    if (!codeOk || !bizOk) {
      return { ok: false, status: raw.status, error: envelopeError(env, `token 无效（HTTP ${raw.status}）`) }
    }
    return { ok: true, status: raw.status, email: env?.data?.biz_data?.email, mobile: env?.data?.biz_data?.mobile_number }
  } catch (err) {
    return { ok: false, error: (err as Error).message || '/users/current 请求失败' }
  }
}
