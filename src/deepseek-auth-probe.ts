/**
 * DeepSeek 设备身份与 WAF 可达性探针（诊断用，挂在 /admin/api/ds-probe 下）
 *
 * 目的：判断「网关代登录换取凭据」这条路是否可行。
 * 分两步，都不需要用户凭据：
 *   1) deviceId()   —— 纯本地计算，验证 FNV-1a 派生与 ds-free-api 一致
 *   2) probeWaf()   —— 从 Cloudflare 出口 IP 打一次 DeepSeek，看是否被 AWS WAF 挑战
 *
 * 参考实现：ds-free-api `ds_core/src/accounts/client.rs`
 *   - derive_device_uuid()  : 按 api_base 确定性派生（FNV-1a 双种子 -> RFC4122 v4 UUID）
 *   - client_headers()      : 除 UA 外 7 个 x-* 头，对齐真实客户端
 *   - is_waf_challenge()    : status 202 且带 x-amzn-waf-action 头
 */

// 对齐 ds-free-api 的默认值（src/config.rs）
export const DS_API_BASE = 'https://chat.deepseek.com/api/v0'
export const DS_USER_AGENT = 'DeepSeek/2.5.0 Android/35'
export const DS_CLIENT_VERSION = '2.5.0'
export const DS_CLIENT_PLATFORM = 'android'
export const DS_CLIENT_LOCALE = 'zh_CN'
export const DS_CLIENT_BUNDLE_ID = 'com.deepseek.chat'
export const DS_DEVICE_MODEL = 'Pixel 8'
export const DS_CLIENT_OS = 'android'
export const DS_TIMEZONE_OFFSET = '28800' // 东八区，秒

/** FNV-1a 64 位（拆成两个 32 位避免 BigInt 开销；结果与 Rust u64 wrapping 等价） */
function fnv1a(bytes: Uint8Array, offset: bigint): bigint {
  const PRIME = 0x0000_0100_0000_01b3n
  const MASK = 0xffff_ffff_ffff_ffffn
  let hash = 0xcbf2_9ce4_8422_2325n ^ offset
  for (const b of bytes) {
    hash = (hash ^ BigInt(b)) & MASK
    hash = (hash * PRIME) & MASK
  }
  return hash
}

/** 由种子确定性派生设备 UUID（RFC 4122 v4 格式），与 ds-free-api `derive_device_uuid` 等价 */
export function deriveDeviceUuid(seed: string): string {
  const bytes = new TextEncoder().encode(seed)
  const hi = fnv1a(bytes, 0n)
  const lo = fnv1a(bytes, 0x9e37_79b9_7f4a_7c15n)
  const b = new Uint8Array(16)
  for (let i = 0; i < 8; i++) b[i] = Number((hi >> BigInt((7 - i) * 8)) & 0xffn)
  for (let i = 0; i < 8; i++) b[8 + i] = Number((lo >> BigInt((7 - i) * 8)) & 0xffn)
  b[6] = (b[6] & 0x0f) | 0x40 // version 4
  b[8] = (b[8] & 0x3f) | 0x80 // variant 10xx
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'))
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`
}

/** 按 api_base 派生设备 id（与 ds-free-api 空 client_device_id 分支一致） */
export function deviceIdFor(apiBase = DS_API_BASE): string {
  return deriveDeviceUuid(apiBase)
}

/** 客户端通用头（登录与鉴权共用），对齐真实客户端 2026-09 抓包 */
export function clientHeaders(deviceId: string): Record<string, string> {
  return {
    'User-Agent': DS_USER_AGENT,
    'X-Client-Version': DS_CLIENT_VERSION,
    'X-Client-Platform': DS_CLIENT_PLATFORM,
    'X-Client-Locale': DS_CLIENT_LOCALE,
    'X-Client-Bundle-Id': DS_CLIENT_BUNDLE_ID,
    'X-Device-Id': deviceId,
    'X-Device-Model': DS_DEVICE_MODEL,
    'X-Client-Timezone-Offset': DS_TIMEZONE_OFFSET,
  }
}

/** WAF 挑战判定：202 + x-amzn-waf-action（照搬 ds-free-api `is_waf_challenge`） */
export function isWafChallenge(status: number, headers: Headers): boolean {
  return status === 202 && headers.get('x-amzn-waf-action') !== null
}

export interface ProbeResult {
  /** 本地派生（不联网） */
  device: {
    deviceId: string
    apiBase: string
    /** 自检：同一 seed 两次派生必须一致，且格式为 v4 UUID */
    deterministic: boolean
    wellFormed: boolean
  }
  /** 联网探测结果 */
  network: Array<{
    /** 探测目标说明 */
    name: string
    url: string
    method: string
    ok: boolean
    status?: number
    /** WAF 挑战？ */
    wafChallenge?: boolean
    /** 响应头里有价值的部分 */
    headers?: Record<string, string>
    /** 响应体片段 */
    bodySnippet?: string
    ms?: number
    error?: string
  }>
  /** 结论与下一步建议 */
  verdict: string
  suggestions: string[]
}

/**
 * 探测 DeepSeek 从 Cloudflare 出口 IP 的可达性。
 * 全部为**只读 / 无副作用**请求：不提交任何凭据、不创建会话。
 */
export async function probeDeepSeek(): Promise<ProbeResult> {
  const deviceId = deviceIdFor()
  const deterministic = deviceIdFor() === deviceId
  const wellFormed = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(deviceId)

  const targets: Array<{ name: string; url: string; method: string; body?: string }> = [
    // 1) 首页：最轻量，用来判断 CloudFront/WAF 是否直接拦 Cloudflare 出口
    { name: 'DeepSeek 站点首页', url: 'https://chat.deepseek.com/', method: 'GET' },
    // 2) 无凭据的受保护接口：应返回业务错误码而非 WAF 挑战
    { name: 'users/current（无凭据）', url: `${DS_API_BASE}/users/current`, method: 'GET' },
    // 3) PoW challenge 端点：真实调用链的第一步，且不需要凭据即可试探
    {
      name: 'create_pow_challenge',
      url: `${DS_API_BASE}/chat/create_pow_challenge`,
      method: 'POST',
      body: JSON.stringify({ target_path: '/api/v0/chat/completion' }),
    },
  ]

  const network: ProbeResult['network'] = []
  for (const t of targets) {
    const started = Date.now()
    try {
      const res = await fetch(t.url, {
        method: t.method,
        headers: {
          ...clientHeaders(deviceId),
          ...(t.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: t.body,
        signal: AbortSignal.timeout(20000),
      })
      const text = await res.text().catch(() => '')
      const pick: Record<string, string> = {}
      for (const k of ['server', 'x-amzn-waf-action', 'x-amzn-requestid', 'cf-ray', 'content-type']) {
        const v = res.headers.get(k)
        if (v) pick[k] = v
      }
      network.push({
        name: t.name,
        url: t.url,
        method: t.method,
        ok: res.ok,
        status: res.status,
        wafChallenge: isWafChallenge(res.status, res.headers),
        headers: pick,
        bodySnippet: text.slice(0, 300),
        ms: Date.now() - started,
      })
    } catch (err) {
      network.push({
        name: t.name,
        url: t.url,
        method: t.method,
        ok: false,
        error: (err as Error).message || '请求失败',
        ms: Date.now() - started,
      })
    }
  }

  const anyWaf = network.some((n) => n.wafChallenge)
  const homeOk = network[0]?.ok && !network[0]?.wafChallenge
  const apiResponded = network.slice(1).some((n) => (n.status ?? 0) > 0 && !n.wafChallenge)

  let verdict: string
  const suggestions: string[] = []
  if (anyWaf) {
    verdict = '出口 IP 被 AWS WAF 挑战 —— 网关代登录这条路当前不可行。'
    suggestions.push('弹窗只提供「粘贴 userToken」单选项；代登录按钮先不上。')
    suggestions.push('如仍要代登录，需换用**非美国出口**的外部刷新节点（共享账号池方案）。')
  } else if (homeOk && apiResponded) {
    verdict = 'Cloudflare 出口 IP 未被 WAF 拦截 —— 网关代登录具备技术可行性。'
    suggestions.push('下一步：用一对测试账号实测 POST /users/login（需凭据）。')
    suggestions.push('登录成功后要接 check_device 与 token 轮换（ds-free-api 的 check_device 逻辑）。')
    suggestions.push('注意：即便连通，共享/多账号仍可能触发 biz_code 风控，需保留降级到粘贴的出口。')
  } else {
    verdict = '结果不明确：部分目标无响应，需看下方明细逐条判断。'
    suggestions.push('检查是否网络不通、DNS 受限，或目标接口已变更。')
  }

  return { device: { deviceId, apiBase: DS_API_BASE, deterministic, wellFormed }, network, verdict, suggestions }
}

/** 用真实凭据实测登录（**有副作用**：会发起一次真实登录，可能被风控记数） */
export async function probeDeepSeekLogin(
  account: { email?: string; mobile?: string; password: string; areaCode?: string },
): Promise<{ ok: boolean; status?: number; wafChallenge?: boolean; code?: number; bizCode?: number; msg?: string; gotToken?: boolean; raw?: string; error?: string }> {
  const deviceId = deviceIdFor()
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

  try {
    const res = await fetch(`${DS_API_BASE}/users/login`, {
      method: 'POST',
      headers: { ...clientHeaders(deviceId), 'Content-Type': 'application/json', Referer: 'https://chat.deepseek.com/sign_in' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    })
    const text = await res.text().catch(() => '')
    if (isWafChallenge(res.status, res.headers)) {
      return { ok: false, status: res.status, wafChallenge: true, msg: '被 AWS WAF 挑战', raw: text.slice(0, 300) }
    }
    let j: any = null
    try { j = JSON.parse(text) } catch { /* 非 JSON */ }
    const biz = j?.data?.biz_data
    return {
      ok: res.ok && j?.code === 0,
      status: res.status,
      code: j?.code,
      bizCode: biz?.biz_code ?? j?.biz_code,
      msg: biz?.biz_msg || j?.msg || '',
      gotToken: !!(biz?.user?.token || biz?.token),
      raw: j ? undefined : text.slice(0, 300),
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message || '登录请求失败' }
  }
}
