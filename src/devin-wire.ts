/**
 * Devin (Codeium) 上游 Connect-RPC 手工编解码 —— 从 Go 版本逐函数移植。
 *
 * 来源：
 *   - CLIProxyAPI internal/runtime/executor/helps/devin_wire.go   (1233 行)
 *   - CLIProxyAPI internal/runtime/executor/helps/devin_models.go (266 行)
 *
 * 设计约束（Cloudflare Workers，零外部依赖）：
 *   - 不使用 Buffer / Node API；只用 Uint8Array / DataView / TextEncoder / TextDecoder
 *     / Web Crypto / DecompressionStream。
 *   - protobuf 原语（tag、varint、length-delimited、fixed32/fixed64、packed repeated）
 *     全部自己实现，语义对齐 google.golang.org/protobuf/encoding/protowire 的
 *     AppendTag/AppendVarint/AppendString/AppendBytes/ConsumeTag/ConsumeVarint/ConsumeBytes，
 *     包括失败时返回负的 n（errCodeXXX）以及调用方用 `n <= 0` 判错的行为。
 *   - 字段编号、wire type、默认值、边界处理必须与 Go 完全一致：上层依赖字节级精确匹配上游。
 *
 * 与 Go 版本的两处必然差异（已在对应函数注释中标注）：
 *   1. readConnectFrame 不再内部 gzip 解压（同步函数无法 await DecompressionStream），
 *      gzip 解压拆成独立的 gunzipBytes；调用方需在 flag & CONNECT_FLAG_COMPRESSED 时自行解压
 *      （Go 里 ReadConnectFrame 是 io.Reader + 同步 gzip，故可内联）。
 *   2. runtime.GOOS 在 Workers 里不存在，见 DEVIN_DEFAULT_OS_NAME。
 *
 * 日志相关函数（BuildDevinUpstreamLogBody / BuildDevinUpstreamResponseLogBody /
 * formatSignatureForLog）按需求未移植。
 */

// ============================================================================
// 常量（对应 Go 的 const 块）
// ============================================================================

/** Connect-proto 未压缩数据帧的标志位。 */
export const CONNECT_FLAG_DATA = 0x00
/** Connect-proto gzip 压缩帧的标志位。 */
export const CONNECT_FLAG_COMPRESSED = 0x01
/** Connect-proto 结束流（trailer）帧的标志位。 */
export const CONNECT_FLAG_END_STREAM = 0x02

/** Devin/Codeium 默认上游地址。 */
export const DEVIN_DEFAULT_BASE_URL = 'https://server.codeium.com'
/** GetChatMessage 的 Connect-RPC 路径。 */
export const DEVIN_CHAT_PATH = '/exa.api_server_pb.ApiServerService/GetChatMessage'

/** metadata 中声明的 client 名。 */
export const DEVIN_DEFAULT_CLIENT_NAME = 'chisel'
/** metadata 中声明的 client 版本。 */
export const DEVIN_DEFAULT_CLIENT_VERSION = '3000.10.21'
/** metadata #31 必须是 732 个 hex 字符。 */
export const DEVIN_FINGERPRINT_HEX_LEN = 732

/** 兜底的 max completion tokens。 */
export const DEVIN_DEFAULT_MAX_TOKENS = 128000

/** 单个 Connect 帧允许的最大长度（Go: maxConnectFrameSize）。 */
export const MAX_CONNECT_FRAME_SIZE = 16 * 1024 * 1024
/** 解压后单帧允许的最大长度（Go: maxDecompressedFrameSize）。 */
export const MAX_DECOMPRESSED_FRAME_SIZE = 64 * 1024 * 1024

/**
 * Go 里 osName 缺省值取 runtime.GOOS（服务端实际跑在 Linux 上，抓包表现为 "linux"）。
 * Workers 无对应能力，故用常量兜底。
 * TODO: 待核对 —— 若上游对 macOS/Windows 客户端有差异化响应，需要改成可配置项或按 UA 推断。
 */
export const DEVIN_DEFAULT_OS_NAME = 'linux'

/** 会话轮次计数器上限（Go: defaultMaxSessionTurnCounters）。 */
const DEFAULT_MAX_SESSION_TURN_COUNTERS = 5000

// ============================================================================
// protobuf wire 原语（对应 protowire）
// ============================================================================

/** wire type 常量（对应 protowire.Type）。 */
export const WIRE_VARINT = 0
export const WIRE_FIXED64 = 1
export const WIRE_BYTES = 2
export const WIRE_START_GROUP = 3
export const WIRE_END_GROUP = 4
export const WIRE_FIXED32 = 5

// protowire 内部错误码（负值即错误，调用方用 n <= 0 判错）
const ERR_TRUNCATED = -1
const ERR_FIELD_NUMBER = -2
const ERR_OVERFLOW = -3
const ERR_RESERVED = -4
const ERR_END_GROUP = -5

/**
 * 对应 protowire.ParseError：把负的 n 还原成错误对象（Go 里 n >= 0 时返回 nil）。
 * 文案与 Go 一致 —— protowire 用的是 google.golang.org/protobuf/internal/errors，
 * 其 New 会加上 "proto: " 前缀；errCodeTruncated 则直接返回 io.ErrUnexpectedEOF。
 */
export function parseError(n: number): Error | null {
  if (n >= 0) return null
  switch (n) {
    case ERR_TRUNCATED:
      return new Error('unexpected EOF')
    case ERR_FIELD_NUMBER:
      return new Error('proto: invalid field number')
    case ERR_OVERFLOW:
      return new Error('proto: variable length integer overflow')
    case ERR_RESERVED:
      return new Error('proto: cannot parse reserved wire type')
    case ERR_END_GROUP:
      return new Error('proto: mismatching end group marker')
    default:
      // protowire 的 errCodeRecursionDepth 等其余错误码统一落到 errParse
      return new Error('proto: parse error')
  }
}

/** parseError 的文案（与 devin_wire.go 里 `%w` 打印出来的文本一致）。 */
function errText(n: number): string {
  const e = parseError(n)
  return e === null ? '' : e.message
}

/** 对应 protowire.EncodeTag：tag 是 (fieldNumber << 3) | wireType。 */
export function encodeTag(num: number, typ: number): bigint {
  return (BigInt(num) << 3n) | BigInt(typ)
}

/**
 * 对应 protowire.DecodeTag。
 * protowire.Number 是 int32，故这里同样按 int32 回绕（超大 tag 会变成负数 → 字段号校验失败）。
 */
export function decodeTag(x: bigint): [number, number] {
  return [Number(BigInt.asIntN(32, x >> 3n)), Number(x & 7n)]
}

// 全局复用的编解码器（Workers 里可安全复用）
const textEncoder = new TextEncoder()
// ignoreBOM: true = 不剥离前导 BOM（与 Go 的 string(b) 保留原始字节更接近）
const textDecoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true })

/** UTF-8 编码（Go: []byte(s)）。 */
function utf8Encode(s: string): Uint8Array {
  return textEncoder.encode(s)
}

/**
 * UTF-8 解码（Go: string(b)）。
 * 注意：Go 的 string(b) 直接保留原始字节，非 UTF-8 字节会原样留在字符串里；
 * TextDecoder 非 fatal 模式会把非法序列替换成 U+FFFD。上游文本均为合法 UTF-8，此处差异可忽略。
 */
function utf8Decode(b: Uint8Array): string {
  return textDecoder.decode(b)
}

const HEX_TABLE: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

/** hex.EncodeToString。 */
function toHex(b: Uint8Array): string {
  let out = ''
  for (let i = 0; i < b.length; i++) out += HEX_TABLE[b[i]]
  return out
}

/**
 * 可增长的 protobuf 写入器。
 * 方法语义对齐 protowire 的 Append*（Go 是 `b = protowire.AppendTag(b, ...)`，
 * 这里用 writer 上的方法避免每次拷贝整段字节）。
 */
export class ProtoWriter {
  private buf: Uint8Array
  private len = 0
  private scratch = new ArrayBuffer(8)

  constructor(initialCapacity = 256) {
    this.buf = new Uint8Array(initialCapacity > 0 ? initialCapacity : 256)
  }

  private ensure(extra: number): void {
    const need = this.len + extra
    if (need <= this.buf.length) return
    let cap = this.buf.length * 2
    while (cap < need) cap *= 2
    const next = new Uint8Array(cap)
    next.set(this.buf.subarray(0, this.len))
    this.buf = next
  }

  /** protowire.AppendTag */
  appendTag(num: number, typ: number): void {
    this.appendVarint(encodeTag(num, typ))
  }

  /** protowire.AppendVarint（uint64 用 bigint 表达） */
  appendVarint(v: number | bigint): void {
    let x = typeof v === 'bigint' ? v : BigInt(v)
    if (x < 0n) x &= 0xffffffffffffffffn // 与 Go 的 uint64 截断一致
    // 变长编码最多 10 字节
    for (;;) {
      const byte = Number(x & 0x7fn)
      x >>= 7n
      if (x === 0n) {
        this.appendRawByte(byte)
        return
      }
      this.appendRawByte(byte | 0x80)
    }
  }

  /** protowire.AppendBytes */
  appendBytes(v: Uint8Array): void {
    this.appendVarint(v.length)
    this.appendRawBytes(v)
  }

  /** protowire.AppendString */
  appendString(s: string): void {
    this.appendBytes(utf8Encode(s))
  }

  /** protowire.AppendFixed64（这里只用于 double，故直接按 bit pattern 写 double） */
  appendFixed64(v: number): void {
    const dv = new DataView(this.scratch)
    dv.setFloat64(0, v, true)
    this.appendRawBytes(new Uint8Array(this.scratch))
  }

  /** protowire.AppendFixed32 */
  appendFixed32(v: number): void {
    const dv = new DataView(this.scratch)
    dv.setFloat32(0, v, true)
    this.appendRawBytes(new Uint8Array(this.scratch))
  }

  private appendRawByte(b: number): void {
    this.ensure(1)
    this.buf[this.len++] = b & 0xff
  }

  private appendRawBytes(v: Uint8Array): void {
    if (v.length === 0) return
    this.ensure(v.length)
    this.buf.set(v, this.len)
    this.len += v.length
  }

  get length(): number {
    return this.len
  }

  /** 取出已写入字节（拷贝，避免暴露内部缓冲区）。 */
  bytes(): Uint8Array {
    return this.buf.slice(0, this.len)
  }
}

/**
 * protowire.ConsumeVarint：解析 varint，返回 [值, n]；n <= 0 表示错误（见 parseError）。
 */
export function consumeVarint(b: Uint8Array, offset = 0): [bigint, number] {
  let v = 0n
  for (let i = 0; i < 10; i++) {
    if (offset + i >= b.length) return [0n, ERR_TRUNCATED]
    const c = b[offset + i]
    if (i === 9 && c > 1) return [0n, ERR_OVERFLOW]
    v |= BigInt(c & 0x7f) << BigInt(7 * i)
    if (c < 0x80) return [v, i + 1]
  }
  return [0n, ERR_OVERFLOW]
}

/**
 * protowire.ConsumeTag：解析 tag，返回 [fieldNumber, wireType, n]；n <= 0 表示错误。
 */
export function consumeTag(b: Uint8Array, offset = 0): [number, number, number] {
  const [v, n] = consumeVarint(b, offset)
  if (n < 0) return [0, 0, n]
  const [num, typ] = decodeTag(v)
  if (num < 1) return [0, 0, ERR_FIELD_NUMBER]
  return [num, typ, n]
}

/**
 * protowire.ConsumeBytes：解析 length-delimited 字段，返回 [内容切片, n]。
 * 返回的是 b 上的视图（与 Go 的子切片语义一致），调用方不要再修改源缓冲区。
 */
export function consumeBytes(b: Uint8Array, offset = 0): [Uint8Array, number] {
  const [m, n] = consumeVarint(b, offset)
  if (n < 0) return [new Uint8Array(0), n]
  const start = offset + n
  const remain = b.length - start
  if (m > BigInt(remain)) return [new Uint8Array(0), ERR_TRUNCATED]
  const size = Number(m)
  return [b.subarray(start, start + size), n + size]
}

/** protowire.ConsumeFixed32 */
export function consumeFixed32(b: Uint8Array, offset = 0): [number, number] {
  if (b.length - offset < 4) return [0, ERR_TRUNCATED]
  const dv = new DataView(b.buffer, b.byteOffset + offset, 4)
  return [dv.getUint32(0, true), 4]
}

/** protowire.ConsumeFixed64（返回原始 64 位 bit pattern） */
export function consumeFixed64(b: Uint8Array, offset = 0): [bigint, number] {
  if (b.length - offset < 8) return [0n, ERR_TRUNCATED]
  const dv = new DataView(b.buffer, b.byteOffset + offset, 8)
  const lo = BigInt(dv.getUint32(0, true))
  const hi = BigInt(dv.getUint32(4, true))
  return [(hi << 32n) | lo, 8]
}

/** 对应 protowire.ConsumeFieldValue：跳过/消费一个字段的值，返回消耗长度。 */
export function consumeFieldValue(num: number, typ: number, b: Uint8Array, offset = 0): number {
  switch (typ) {
    case WIRE_VARINT: {
      const [, n] = consumeVarint(b, offset)
      return n
    }
    case WIRE_FIXED32: {
      const [, n] = consumeFixed32(b, offset)
      return n
    }
    case WIRE_FIXED64: {
      const [, n] = consumeFixed64(b, offset)
      return n
    }
    case WIRE_BYTES: {
      const [, n] = consumeBytes(b, offset)
      return n
    }
    case WIRE_START_GROUP:
      return consumeGroup(num, b, offset)
    case WIRE_END_GROUP:
      return ERR_END_GROUP
    default:
      return ERR_RESERVED
  }
}

/** protowire 内部的 consumeGroup：读到匹配的 end-group 为止。 */
function consumeGroup(num: number, b: Uint8Array, offset: number): number {
  let n = 0
  while (offset + n < b.length) {
    const [fnum, ftyp, fn] = consumeTag(b, offset + n)
    if (fn < 0) return fn
    n += fn
    if (ftyp === WIRE_END_GROUP) {
      return fnum === num ? n : ERR_END_GROUP
    }
    const vn = consumeFieldValue(fnum, ftyp, b, offset + n)
    if (vn < 0) return vn
    n += vn
  }
  return ERR_TRUNCATED
}

/** math.Float64frombits */
export function float64FromBits(bits: bigint): number {
  const buf = new ArrayBuffer(8)
  const dv = new DataView(buf)
  dv.setUint32(0, Number(bits & 0xffffffffn), true)
  dv.setUint32(4, Number((bits >> 32n) & 0xffffffffn), true)
  return dv.getFloat64(0, true)
}

/** math.Float32frombits */
export function float32FromBits(bits: number): number {
  const buf = new ArrayBuffer(4)
  const dv = new DataView(buf)
  dv.setUint32(0, bits >>> 0, true)
  return dv.getFloat32(0, true)
}

/**
 * packed repeated（varint）解码：把 length-delimited 载荷里的连续 varint 全部解出。
 * 手工解码时需要它来处理 `repeated <scalar> [packed=true]` 字段。
 */
export function consumePackedVarints(b: Uint8Array, offset = 0): [bigint[], number] {
  const [val, n] = consumeBytes(b, offset)
  if (n < 0) return [[], n]
  const out: bigint[] = []
  let pos = 0
  while (pos < val.length) {
    const [v, vn] = consumeVarint(val, pos)
    if (vn <= 0) return [out, vn]
    pos += vn
    out.push(v)
  }
  return [out, n]
}

/** packed repeated（fixed32）解码。 */
export function consumePackedFixed32(b: Uint8Array, offset = 0): [number[], number] {
  const [val, n] = consumeBytes(b, offset)
  if (n < 0) return [[], n]
  if (val.length % 4 !== 0) return [[], ERR_TRUNCATED]
  const out: number[] = []
  for (let pos = 0; pos < val.length; pos += 4) {
    const [v] = consumeFixed32(val, pos)
    out.push(v)
  }
  return [out, n]
}

// ============================================================================
// 通用小工具
// ============================================================================

/** strings.EqualFold（ASCII 场景）。 */
function equalFold(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/** bytes.Equal / bytes.TrimSpace 里的 "{}" 判断。 */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** 拼接两段字节（用于 DeltaSignature 的 append 累加）。 */
function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b.slice()
  if (b.length === 0) return a
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

/** crypto/rand 的替代：Go 里 rand.Read 失败会退回 uuid，这里同样兜底。 */
function randomBytes(n: number): Uint8Array | null {
  try {
    const b = new Uint8Array(n)
    crypto.getRandomValues(b)
    return b
  } catch {
    return null
  }
}

/** github.com/google/uuid 的 uuid.New().String() 替代。 */
function newUuid(): string {
  try {
    return crypto.randomUUID()
  } catch {
    const b = new Uint8Array(16)
    for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const h = toHex(b)
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  }
}

// ---- 同步 SHA-256（Web Crypto 的 digest 是异步的，而 Go 侧调用链全同步） ----

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0
}

/** 同步 SHA-256，对应 Go 的 sha256.Sum256。 */
function sha256Bytes(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])

  const len = data.length
  const total = (((len + 8) >> 6) + 1) << 6
  const bytes = new Uint8Array(total)
  bytes.set(data)
  bytes[len] = 0x80
  const dv = new DataView(bytes.buffer)
  const bitLen = BigInt(len) * 8n
  dv.setUint32(total - 8, Number((bitLen >> 32n) & 0xffffffffn))
  dv.setUint32(total - 4, Number(bitLen & 0xffffffffn))

  const w = new Uint32Array(64)
  for (let off = 0; off < total; off += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(off + t * 4)
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15]
      const y = w[t - 2]
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0
    }

    let a = h[0]
    let b = h[1]
    let c = h[2]
    let d = h[3]
    let e = h[4]
    let f = h[5]
    let g = h[6]
    let hh = h[7]

    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + SHA256_K[t] + w[t]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }

    h[0] = (h[0] + a) >>> 0
    h[1] = (h[1] + b) >>> 0
    h[2] = (h[2] + c) >>> 0
    h[3] = (h[3] + d) >>> 0
    h[4] = (h[4] + e) >>> 0
    h[5] = (h[5] + f) >>> 0
    h[6] = (h[6] + g) >>> 0
    h[7] = (h[7] + hh) >>> 0
  }

  const out = new Uint8Array(32)
  const odv = new DataView(out.buffer)
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i])
  return out
}

// ============================================================================
// 设备指纹 / Sentry trace（对应 GenerateDevinDeviceFingerprint / GenerateDevinSentryTrace）
// ============================================================================

/**
 * 生成 732 字符的 hex 设备指纹（对应 GenerateDevinDeviceFingerprint）。
 * - seed 为空：每次请求生成 732 个随机 hex 字符（对齐原生 devin-cli）。
 * - seed 非空：用 sha256("%s-%d") 迭代拼接出确定性的 732 字符指纹。
 */
export function generateDevinDeviceFingerprint(seed: string): string {
  if (seed === '') {
    const b = randomBytes(DEVIN_FINGERPRINT_HEX_LEN / 2)
    if (b !== null) return toHex(b)
    // Go 的兜底：rand.Read 失败时用 uuid 当 seed
    seed = newUuid()
  }
  let out = ''
  let counter = 0
  while (out.length < DEVIN_FINGERPRINT_HEX_LEN) {
    out += toHex(sha256Bytes(utf8Encode(`${seed}-${counter}`)))
    counter++
  }
  // 截断到精确 732 字符（11 个完整 64 字符 sha256 hex 块 + 第 12 块的 28 字符），对齐 Devin CLI
  return out.slice(0, DEVIN_FINGERPRINT_HEX_LEN)
}

/**
 * 生成 Sentry 分布式追踪头（对应 GenerateDevinSentryTrace），格式：
 * "<32-hex-trace-id>-<16-hex-span-id>-1"
 */
export function generateDevinSentryTrace(): string {
  const b = randomBytes(24)
  if (b === null) {
    // Go 的兜底分支：两个 uuid 拼接
    const u1 = newUuid().replace(/-/g, '')
    const u2 = newUuid().replace(/-/g, '').slice(0, 16)
    return `${u1}-${u2}-1`
  }
  return `${toHex(b.subarray(0, 16))}-${toHex(b.subarray(16, 24))}-1`
}

// ============================================================================
// 会话轮次计数（对应 NextDevinSessionTurnIndex / ResetDevinSessionTurnIndex）
// ============================================================================

// Go 用 cache.NewBoundedLRU[string, *atomic.Uint64](5000)，这里用 Map 模拟（插入序 + 访问刷新 + 超限淘汰）
const sessionTurnCounters = new Map<string, number>()

/**
 * 返回会话内下一个 0 基请求序号（Field 15.2）。
 * 原生 devin-cli 的计数器是进程内按会话维护的：首个请求返回 0（0 在 wire 上被省略），
 * 之后依次返回 1、2、3……
 */
export function nextDevinSessionTurnIndex(sessionId: string): number {
  const cleanId = sessionId.trim()
  if (cleanId === '') return 0

  const current = sessionTurnCounters.get(cleanId) ?? 0
  // 访问即刷新 LRU 顺序（对应 Go BoundedLRU 的 GetOrAdd）
  sessionTurnCounters.delete(cleanId)
  sessionTurnCounters.set(cleanId, current + 1)
  while (sessionTurnCounters.size > DEFAULT_MAX_SESSION_TURN_COUNTERS) {
    const oldest = sessionTurnCounters.keys().next().value
    if (oldest === undefined) break
    sessionTurnCounters.delete(oldest)
  }
  return current
}

/** 清空会话计数（用于测试或显式会话重置）。 */
export function resetDevinSessionTurnIndex(sessionId: string): void {
  sessionTurnCounters.delete(sessionId.trim())
}

// ============================================================================
// Connect 信封（对应 WrapConnectEnvelope(WithFlag) / ReadConnectFrame / gzip）
// ============================================================================

/**
 * 把裸 payload 包成标准 5 字节 Connect 信封：
 * [1 字节 flag: 0x00] + [4 字节大端长度] + [payload]。
 */
export function wrapConnectEnvelope(protoBytes: Uint8Array): Uint8Array {
  return wrapConnectEnvelopeWithFlag(CONNECT_FLAG_DATA, protoBytes)
}

/** 指定 flag 的 Connect 信封封装。 */
export function wrapConnectEnvelopeWithFlag(flag: number, protoBytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + protoBytes.length)
  out[0] = flag & 0xff
  new DataView(out.buffer).setUint32(1, protoBytes.length, false)
  out.set(protoBytes, 5)
  return out
}

/**
 * 从流缓冲区里读一帧（对应 ReadConnectFrame）。
 * 返回 { flag, payload, consumed }；数据不足时返回 null（不抛错，由调用方决定继续读字节）。
 *
 * 与 Go 的差异：Go 的 ReadConnectFrame 会在 flag 含 COMPRESSED 时内部 gzip 解压；
 * 本函数是同步的，故不解压 —— 调用方在 (flag & CONNECT_FLAG_COMPRESSED) !== 0 时必须
 * 自行 await gunzipBytes(payload)。
 *
 * flag 非法或长度超限时抛错（对应 Go 返回 error）。
 */
export function readConnectFrame(
  buffer: Uint8Array,
): { flag: number; payload: Uint8Array; consumed: number } | null {
  if (buffer.length < 5) return null
  const flag = buffer[0]
  if (
    flag !== CONNECT_FLAG_DATA &&
    flag !== CONNECT_FLAG_COMPRESSED &&
    flag !== CONNECT_FLAG_END_STREAM &&
    flag !== (CONNECT_FLAG_COMPRESSED | CONNECT_FLAG_END_STREAM)
  ) {
    throw new Error(`invalid connect frame flag: 0x${flag.toString(16).padStart(2, '0')}`)
  }
  const length = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint32(1, false)
  if (length > MAX_CONNECT_FRAME_SIZE) {
    throw new Error(
      `connect frame length ${length} exceeds maximum limit (${MAX_CONNECT_FRAME_SIZE})`,
    )
  }
  if (buffer.length < 5 + length) return null
  return { flag, payload: buffer.slice(5, 5 + length), consumed: 5 + length }
}

/**
 * gzip 解压（用于 CONNECT_FLAG_COMPRESSED 帧）。
 * 对应 Go ReadConnectFrame 里的 gzip.NewReader + io.LimitReader 逻辑：
 * 解压后超过 MAX_DECOMPRESSED_FRAME_SIZE 即报错。
 */
export async function gunzipBytes(data: Uint8Array): Promise<Uint8Array> {
  let ds: DecompressionStream
  try {
    ds = new DecompressionStream('gzip')
  } catch (e) {
    throw new Error(`decompress gzip connect frame: ${String(e)}`)
  }

  const writer = ds.writable.getWriter()
  const reader = ds.readable.getReader()

  // 并发写：如果先写满再读，部分运行时会死锁
  const pump = (async () => {
    try {
      await writer.write(data)
      await writer.close()
    } catch {
      // 写入侧错误会由读取侧的 reject 呈现
    }
  })()

  const chunks: Uint8Array[] = []
  let total = 0
  let failure: unknown = null
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > MAX_DECOMPRESSED_FRAME_SIZE) {
        // 对应 Go 的 `if decompBuf.Len() > maxDecompressedFrameSize` 检查
        failure = new Error(
          `decompressed frame size exceeds maximum limit (${MAX_DECOMPRESSED_FRAME_SIZE})`,
        )
        await reader.cancel().catch(() => undefined)
        break
      }
      chunks.push(value)
    }
  } catch (e) {
    failure = new Error(`decompress gzip connect frame: ${String(e)}`)
  }
  await pump

  if (failure) throw failure

  const out = new Uint8Array(total)
  let pos = 0
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.length
  }
  return out
}

// ============================================================================
// 请求编码（对应 BuildDevinClientMetadataBytes / BuildDevinGetChatMessageRequest）
// ============================================================================

/**
 * 构造 Field 1（ClientMetadata）的序列化字节（对应 BuildDevinClientMetadataBytes）。
 * 字段：1=client 名 "devin-cli"，2/7=client 版本，3=session token，4="en"，5=os，
 *       12/28=client 名，31=732 字符设备指纹。
 */
export function buildDevinClientMetadataBytes(
  sessionToken: string,
  deviceSeed: string,
  osName: string,
): Uint8Array {
  const os = osName === '' ? DEVIN_DEFAULT_OS_NAME : osName
  const deviceFingerprint = generateDevinDeviceFingerprint(deviceSeed)

  const w = new ProtoWriter(1024)
  w.appendTag(1, WIRE_BYTES)
  w.appendString('devin-cli')

  w.appendTag(2, WIRE_BYTES)
  w.appendString(DEVIN_DEFAULT_CLIENT_VERSION)

  w.appendTag(3, WIRE_BYTES)
  w.appendString(sessionToken)

  w.appendTag(4, WIRE_BYTES)
  w.appendString('en')

  w.appendTag(5, WIRE_BYTES)
  w.appendString(os)

  w.appendTag(7, WIRE_BYTES)
  w.appendString(DEVIN_DEFAULT_CLIENT_VERSION)

  w.appendTag(12, WIRE_BYTES)
  w.appendString(DEVIN_DEFAULT_CLIENT_NAME)

  w.appendTag(28, WIRE_BYTES)
  w.appendString(DEVIN_DEFAULT_CLIENT_NAME)

  w.appendTag(31, WIRE_BYTES)
  w.appendString(deviceFingerprint)

  return w.bytes()
}

/** 工具定义（对应 Go 的 DevinTool）。 */
export interface DevinTool {
  name: string
  description?: string
  /** Field 3 的原始 JSON 字节（对应 Go 的 []byte Parameters）。 */
  parameters?: Uint8Array
  /** 兼容别名：以字符串给出的参数 JSON（UTF-8 编码后等价于 parameters）。 */
  parametersJson?: string
}

/** 工具调用 / 流式工具调用增量（对应 Go 的 DevinToolCall / DevinToolCallDelta）。 */
export interface DevinToolCall {
  id?: string
  name?: string
  arguments?: string
}

/** Field 10（Prompt #10）里的图片附件（对应 Go 的 DevinImage）。 */
export interface DevinImage {
  /** 对应 Go 的 Base64Data（纯 base64，不含 data URL 前缀）。 */
  base64Data?: string
  /** 对应 Go 的 MimeType。 */
  mimeType?: string
  /** 兼容别名：等价于 base64Data。 */
  data?: string
  /** 兼容别名：等价于 mimeType。 */
  mime?: string
}

/** 请求历史中的单轮（对应 Go 的 DevinPrompt，repeated Field 3）。 */
export interface DevinPrompt {
  messageId?: string
  /** 1=user, 2=assistant, 4=tool */
  source?: number
  content?: string
  images?: DevinImage[]
  toolCalls?: DevinToolCall[]
  /** source=4（工具结果）时使用 */
  toolCallId?: string
  thinking?: string
  signature?: Uint8Array
  signatureType?: string
  /** 兼容别名：等价于 content。 */
  text?: string
}

/** buildDevinGetChatMessageRequest 的入参。 */
export interface BuildChatRequestArgs {
  sessionToken: string
  deviceSeed: string
  chatModelUid: string
  systemPrompt: string
  prompts: DevinPrompt[]
  tools: DevinTool[]
  /** 缺省/为 null 时按 1.0 处理（对应 Go 的 *float64 nil 分支）。 */
  temperature?: number | null
  maxTokens: number
  sessionId: string
  cascadeId: string
  /** 敏感词表（对应 Go 的 *SensitiveWordMatcher，为空等价于 Go 的 matcher == nil）。 */
  sensitiveWords?: string[]
  /** 直接传入已构建的 matcher（与 sensitiveWords 二选一，优先用 matcher）。 */
  matcher?: SensitiveWordMatcher | null
  /** 覆盖 metadata Field 5 的 os 名（默认 DEVIN_DEFAULT_OS_NAME）。 */
  osName?: string
}

/**
 * 编码完整的 GetChatMessageRequest protobuf（对应 BuildDevinGetChatMessageRequest）。
 * 字段编号/wire type/默认值/省略条件均与 Go 严格一致：
 *   1  ClientMetadata(bytes)          —— 必发
 *   2  systemPrompt(bytes)            —— 清洗后非空才发
 *   3  repeated prompt(bytes)         —— 每条按 1/2/3/6/7/10/11/12/18 顺序写
 *   7  varint 5                       —— 固定
 *   8  completionConfig(bytes)        —— 1/2/3/5/7/8
 *   10 repeated tool(bytes)           —— 1/2/3
 *   15 threadSessionMetadata(bytes)   —— 1/2(>0 才发)/3/4(用户轮边界条件)
 *   16 cascadeID(bytes)               —— session 级 prompt cache key
 *   20 varint 1                       —— 固定
 *   21 chatModelUID(bytes)            —— 模型 UID
 */
export function buildDevinGetChatMessageRequest(args: BuildChatRequestArgs): Uint8Array {
  let maxTokens = args.maxTokens
  if (maxTokens <= 0) maxTokens = DEVIN_DEFAULT_MAX_TOKENS

  let sessionID = args.sessionId ?? ''
  if (sessionID === '') sessionID = newUuid()

  let cascadeID = args.cascadeId ?? ''
  if (cascadeID === '') cascadeID = sessionID

  const osName = args.osName && args.osName !== '' ? args.osName : DEVIN_DEFAULT_OS_NAME

  const prompts = args.prompts ?? []
  const tools = args.tools ?? []

  const matcher =
    args.matcher ?? (args.sensitiveWords && args.sensitiveWords.length > 0
      ? buildSensitiveWordMatcher(args.sensitiveWords)
      : null)

  // Go 里此处有 estimatedSize 预分配；ProtoWriter 自动扩容，无需预分配
  const w = new ProtoWriter(4096)

  // 1. ClientMetadata (Field 1)
  const f1Bytes = buildDevinClientMetadataBytes(args.sessionToken, args.deviceSeed, osName)
  w.appendTag(1, WIRE_BYTES)
  w.appendBytes(f1Bytes)

  // 2. System prompt (Field 2)
  if (args.systemPrompt !== '') {
    const sanitized = sanitizeDevinSystemPrompt(args.systemPrompt, matcher)
    if (sanitized !== '') {
      w.appendTag(2, WIRE_BYTES)
      w.appendString(sanitized)
    }
  }

  // 3. Repeated History Prompts (Field 3)
  for (const p of prompts) {
    const pw = new ProtoWriter(1024)

    let msgId = p.messageId ?? ''
    if (msgId === '') msgId = newUuid()
    pw.appendTag(1, WIRE_BYTES)
    pw.appendString(msgId)

    let source = p.source ?? 0
    if (source <= 0) source = 1 // 默认 user
    pw.appendTag(2, WIRE_VARINT)
    pw.appendVarint(source)

    pw.appendTag(3, WIRE_BYTES)
    pw.appendString(p.content ?? p.text ?? '')

    for (const tc of p.toolCalls ?? []) {
      const tw = new ProtoWriter(256)
      if (tc.id !== undefined && tc.id !== '') {
        tw.appendTag(1, WIRE_BYTES)
        tw.appendString(tc.id)
      }
      if (tc.name !== undefined && tc.name !== '') {
        tw.appendTag(2, WIRE_BYTES)
        tw.appendString(tc.name)
      }
      if (tc.arguments !== undefined && tc.arguments !== '') {
        tw.appendTag(3, WIRE_BYTES)
        tw.appendString(tc.arguments)
      }
      // 即使三个子字段全为空，Go 也会写出 tag 6 + 长度 0
      pw.appendTag(6, WIRE_BYTES)
      pw.appendBytes(tw.bytes())
    }

    if (p.toolCallId !== undefined && p.toolCallId !== '') {
      pw.appendTag(7, WIRE_BYTES)
      pw.appendString(p.toolCallId)
    }

    for (const img of p.images ?? []) {
      const data = ((img.base64Data ?? img.data) ?? '').trim()
      if (data === '') continue
      const iw = new ProtoWriter(256)
      iw.appendTag(1, WIRE_BYTES)
      iw.appendString(data)

      let mime = ((img.mimeType ?? img.mime) ?? '').trim()
      if (mime === '') mime = 'image/png'
      iw.appendTag(2, WIRE_BYTES)
      iw.appendString(mime)

      pw.appendTag(10, WIRE_BYTES)
      pw.appendBytes(iw.bytes())
    }

    if (p.thinking !== undefined && p.thinking !== '') {
      pw.appendTag(11, WIRE_BYTES)
      pw.appendString(p.thinking)
    }

    if (p.signature !== undefined && p.signature.length > 0) {
      pw.appendTag(12, WIRE_BYTES)
      pw.appendBytes(p.signature)
    }

    if (p.signatureType !== undefined && p.signatureType !== '') {
      pw.appendTag(18, WIRE_BYTES)
      pw.appendString(p.signatureType)
    }

    w.appendTag(3, WIRE_BYTES)
    w.appendBytes(pw.bytes())
  }

  // 4. 固定标志 (Field 7: Varint 5)
  w.appendTag(7, WIRE_VARINT)
  w.appendVarint(5)

  // 5. Completion config (Field 8)
  const f8 = new ProtoWriter(64)
  f8.appendTag(1, WIRE_VARINT)
  f8.appendVarint(1)

  f8.appendTag(2, WIRE_VARINT)
  f8.appendVarint(maxTokens)

  f8.appendTag(3, WIRE_VARINT)
  f8.appendVarint(400)

  const tempVal = args.temperature === undefined || args.temperature === null ? 1.0 : args.temperature
  f8.appendTag(5, WIRE_FIXED64)
  f8.appendFixed64(tempVal)

  f8.appendTag(7, WIRE_VARINT)
  f8.appendVarint(40)

  // Go: math.Float64bits(float64(float32(0.95))) —— 先降到 float32 再按 double 写位
  f8.appendTag(8, WIRE_FIXED64)
  f8.appendFixed64(Math.fround(0.95))

  w.appendTag(8, WIRE_BYTES)
  w.appendBytes(f8.bytes())

  // 6. Repeated Tools (Field 10)
  for (const tool of tools) {
    const tw = new ProtoWriter(512)
    if (tool.name !== '') {
      tw.appendTag(1, WIRE_BYTES)
      tw.appendString(tool.name)
    }
    let desc = tool.description ?? ''
    // Claude Code 的 subagent 工具描述里硬编码了 snake_case 的 "task_id"，
    // 但 Devin 上游的工具执行环境严格要求 camelCase 的 "taskId"，
    // 归一化描述可避免模型生成不兼容的参数名。
    if (desc.includes('Takes a task_id parameter identifying the task')) {
      desc = desc.split('Takes a task_id parameter identifying the task').join('Takes a taskId parameter identifying the task')
    }
    if (desc !== '') {
      tw.appendTag(2, WIRE_BYTES)
      tw.appendString(desc)
    }
    const params = tool.parameters ?? (tool.parametersJson ? utf8Encode(tool.parametersJson) : new Uint8Array(0))
    if (params.length > 0) {
      tw.appendTag(3, WIRE_BYTES)
      tw.appendBytes(params)
    }
    w.appendTag(10, WIRE_BYTES)
    w.appendBytes(tw.bytes())
  }

  // 7. Thread session metadata (Field 15)
  // 原生 devin-cli：
  //   Field 1: sessionID (UUID 字符串)
  //   Field 2: turnIndex（会话内请求序号，为 0 时省略）
  //   Field 3: 4 (varint)
  //   Field 4: 14（仅在用户轮边界写出）
  const turnIndex = nextDevinSessionTurnIndex(sessionID)

  const f15 = new ProtoWriter(128)
  f15.appendTag(1, WIRE_BYTES)
  f15.appendString(sessionID)

  if (turnIndex > 0) {
    f15.appendTag(2, WIRE_VARINT)
    f15.appendVarint(turnIndex)
  }

  f15.appendTag(3, WIRE_VARINT)
  f15.appendVarint(4)

  const lastSource = prompts.length > 0 ? (prompts[prompts.length - 1].source ?? 0) : 0
  if (prompts.length > 0 && lastSource === 1) {
    const prevSource = prompts.length >= 2 ? (prompts[prompts.length - 2].source ?? 0) : 0
    if (turnIndex === 0 || prompts.length < 2 || prevSource !== 1) {
      f15.appendTag(4, WIRE_VARINT)
      f15.appendVarint(14)
    }
  }

  w.appendTag(15, WIRE_BYTES)
  w.appendBytes(f15.bytes())

  // 8. Cascade ID (Field 16: session 级 prompt cache key)
  w.appendTag(16, WIRE_BYTES)
  w.appendString(cascadeID)

  // 9. 固定标志 (Field 20: Varint 1)
  w.appendTag(20, WIRE_VARINT)
  w.appendVarint(1)

  // 10. Model UID (Field 21)
  w.appendTag(21, WIRE_BYTES)
  w.appendString(args.chatModelUid)

  return w.bytes()
}

// ============================================================================
// 系统提示清洗 / 敏感词混淆（对应 SanitizeDevinSystemPrompt + matcher）
// ============================================================================

/** Unicode 零宽空格，用于敏感词混淆。 */
const ZERO_WIDTH_SPACE = '\u200B'

/**
 * 敏感词匹配器。对应 CLIProxyAPI helps.SensitiveWordMatcher
 * （其 Matches/ObfuscateText 实现源自同包 cloak_obfuscate.go 的 obfuscateWord/obfuscateText；
 *  该文件未在本次移植输入中提供，此处按同语义重建：大小写不敏感的整词交替正则，
 *  命中后在首个 rune 之后插入零宽空格）。
 * TODO: 待核对 —— 若上游实现对匹配边界/大小写有额外规则，需要按实际源码校准。
 */
export class SensitiveWordMatcher {
  private regex: RegExp | null

  constructor(words: string[]) {
    this.regex = compileSensitiveRegex(words)
  }

  matches(text: string): boolean {
    if (this.regex === null || text === '') return false
    return this.regex.test(text)
  }

  obfuscateText(text: string): string {
    if (this.regex === null || text === '') return text
    return text.replace(this.regex, obfuscateWord)
  }
}

function compileSensitiveRegex(words: string[]): RegExp | null {
  if (words.length === 0) return null
  // 过滤 + 归一化：去空白、rune 数 >= 2、本身不含零宽空格
  const valid: string[] = []
  for (const raw of words) {
    const word = raw.trim()
    if (Array.from(word).length >= 2 && !word.includes(ZERO_WIDTH_SPACE)) valid.push(word)
  }
  if (valid.length === 0) return null
  // 长的优先，保证长词先匹配
  valid.sort((a, b) => b.length - a.length)
  const pattern = valid.map(escapeRegExp).join('|')
  try {
    return new RegExp(pattern, 'gi')
  } catch {
    return null
  }
}

/** regexp.QuoteMeta 的等价实现。 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 在首个 rune 之后插入零宽空格（对应 obfuscateWord）。 */
function obfuscateWord(word: string): string {
  if (word.includes(ZERO_WIDTH_SPACE)) return word
  const runes = Array.from(word)
  if (runes.length < 2) return word
  return runes[0] + ZERO_WIDTH_SPACE + runes.slice(1).join('')
}

/**
 * 构造敏感词匹配器（对应 helps.BuildSensitiveWordMatcher）。
 * 词表为空/全部无效时返回的对象 regex 为 null（matches 恒 false、obfuscateText 原样返回），
 * 语义等价于 Go 返回 nil 指针。
 */
export function buildSensitiveWordMatcher(words: string[]): SensitiveWordMatcher {
  return new SensitiveWordMatcher(words)
}

/** 对应 util.IsClaudeCodeAttributionSystemText：去除左侧空白后以前缀判断。 */
function isClaudeCodeAttributionSystemText(text: string): boolean {
  return text.replace(/^\s+/, '').startsWith('x-anthropic-billing-header:')
}

/**
 * 清洗系统提示（对应 SanitizeDevinSystemPrompt）：逐行剔除 Claude Code 归因头、
 * CLI 身份声明等，再对配置的敏感词做零宽混淆。
 *
 * 说明：Go 版本的敏感词表来自 Beelzebub/服务端配置（matcher 由 BuildSensitiveWordMatcher 构建），
 * 本模块没有该词表数据源，因此不传 sensitiveWords/matcher 时就等价于 Go 里 matcher == nil
 * 的默认行为（只做上面那几条固定规则的行剔除，不做混淆）。
 */
export function sanitizeDevinSystemPrompt(
  prompt: string,
  matcher?: SensitiveWordMatcher | string[] | null,
): string {
  if (prompt === '') return ''

  let m: SensitiveWordMatcher | null = null
  if (matcher instanceof SensitiveWordMatcher) m = matcher
  else if (Array.isArray(matcher) && matcher.length > 0) m = buildSensitiveWordMatcher(matcher)

  const normalized = prompt.split('\r\n').join('\n')
  const lines = normalized.split('\n')
  const kept: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (isClaudeCodeAttributionSystemText(trimmed)) continue
    if (trimmed.startsWith('You are Claude Code')) continue
    if (trimmed.includes('authorized security testing') || trimmed.includes('destructive techniques, DoS attacks')) continue
    if (trimmed.includes('Claude Code is available as a CLI')) continue
    if (trimmed.includes('Fast mode for Claude Code')) continue
    if (m !== null && m.matches(trimmed)) continue
    kept.push(line)
  }

  let res = kept.join('\n').trim()
  if (m !== null && res !== '') res = m.obfuscateText(res)
  return res
}

// ============================================================================
// 响应解析（对应 ParseDevinFrame 及其子解析函数）
// ============================================================================

/** 流式工具调用增量（对应 Go 的 DevinToolCallDelta）。 */
export interface DevinToolCallDelta extends DevinToolCall {
  id: string
  name: string
  arguments: string
  index: number
}

/** parseDevinToolCallDelta 的返回值：解析失败时附带 error（Go 返回 (部分结果, err)）。 */
export interface DevinToolCallDeltaResult extends DevinToolCallDelta {
  error?: string
}

/** 用量统计（对应 Go 的 DevinUsage，响应 Field 7）。 */
export interface DevinUsage {
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  statusCode: number
  requestId: string
  modelName: string
  headers: Record<string, string> | null
}

/** 单帧解析结果（对应 Go 的 DevinFrameResult）。 */
export interface DevinFrameResult {
  outputId: string
  timestamp: number
  contentText: string
  deltaTokens: number
  stopReason: number
  /** 2/4=stop，10=tool_calls */
  toolCallDeltas: DevinToolCallDelta[]
  thinkingText: string
  deltaSignature: Uint8Array
  deltaSignatureType: string
  latency: number
  messageId: string
  usage: DevinUsage | null
  responseDimensionGroups: Uint8Array[]
  unknownFieldNumbers: number[]
  // ---- 以下为调用方契约里的别名（与上方字段同值） ----
  text?: string
  thinking?: string
  toolCalls?: DevinToolCall[]
  dimensionGroups?: Uint8Array[]
  /** Go 的 ParseDevinFrame 未设置该字段（trailer 由 parseDevinTrailerError 处理），仅为契约保留。 */
  trailer?: Uint8Array
}

/**
 * 解析失败时抛出，附带已解析出的部分结果（对应 Go 的 (res, err) 双返回值，
 * 调用方 errParse != nil 时 continue 跳过该帧）。
 */
export class DevinWireError extends Error {
  readonly partial: DevinFrameResult
  constructor(message: string, partial: DevinFrameResult) {
    super(message)
    this.name = 'DevinWireError'
    this.partial = partial
  }
}

function emptyFrameResult(): DevinFrameResult {
  return {
    outputId: '',
    timestamp: 0,
    contentText: '',
    deltaTokens: 0,
    stopReason: 0,
    toolCallDeltas: [],
    thinkingText: '',
    deltaSignature: new Uint8Array(0),
    deltaSignatureType: '',
    latency: 0,
    messageId: '',
    usage: null,
    responseDimensionGroups: [],
    unknownFieldNumbers: [],
  }
}

/**
 * 从单个响应帧中提取增量文本、工具调用、thinking、签名与用量
 * （对应 ParseDevinFrame）。字段映射：
 *   1=OutputID(字节) 2=Timestamp(varint 或 google.protobuf.Timestamp 字节) 3=文本 4=DeltaTokens
 *   5=StopReason 6=ToolCallDelta 7=Usage 9=thinking 10=DeltaSignature 12=Latency(fixed64)
 *   17=MessageID 21=DeltaSignatureType 28=ResponseDimensionGroups
 * 无法识别的字段编号记入 unknownFieldNumbers；非法 wire type 抛 DevinWireError。
 */
export function parseDevinFrame(payload: Uint8Array): DevinFrameResult {
  const res = emptyFrameResult()
  const textParts: string[] = []
  const thinkingParts: string[] = []

  let pos = 0
  while (pos < payload.length) {
    const [num, typ, n] = consumeTag(payload, pos)
    if (n <= 0) {
      throw new DevinWireError(
        `consume tag error at offset ${pos}: ${errText(n)}`,
        finalizeFrame(res, textParts, thinkingParts),
      )
    }
    pos += n

    switch (typ) {
      case WIRE_VARINT: {
        const [v, vn] = consumeVarint(payload, pos)
        if (vn <= 0) {
          throw new DevinWireError(
            `consume varint error at offset ${pos}: ${errText(vn)}`,
            finalizeFrame(res, textParts, thinkingParts),
          )
        }
        pos += vn
        switch (num) {
          case 2:
            res.timestamp = Number(v)
            break
          case 4:
            res.deltaTokens = Number(v)
            break
          case 5:
            res.stopReason = Number(v)
            break
        }
        break
      }

      case WIRE_FIXED64: {
        const [v, fn] = consumeFixed64(payload, pos)
        if (fn <= 0) {
          throw new DevinWireError(
            `consume fixed64 error at offset ${pos}: ${errText(fn)}`,
            finalizeFrame(res, textParts, thinkingParts),
          )
        }
        pos += fn
        if (num === 12) res.latency = float64FromBits(v)
        break
      }

      case WIRE_FIXED32: {
        const [, fn] = consumeFixed32(payload, pos)
        if (fn <= 0) {
          throw new DevinWireError(
            `consume fixed32 error at offset ${pos}: ${errText(fn)}`,
            finalizeFrame(res, textParts, thinkingParts),
          )
        }
        pos += fn
        break
      }

      case WIRE_BYTES: {
        const [val, bn] = consumeBytes(payload, pos)
        if (bn <= 0) {
          throw new DevinWireError(
            `consume bytes error at offset ${pos}: ${errText(bn)}`,
            finalizeFrame(res, textParts, thinkingParts),
          )
        }
        pos += bn

        switch (num) {
          case 1:
            res.outputId = utf8Decode(val)
            break
          case 2:
            res.timestamp = parseDevinTimestamp(val)
            break
          case 3:
            textParts.push(utf8Decode(val))
            break
          case 6: {
            // 对应 Go: `if tc, err := parseDevinToolCallDelta(val); err == nil`
            const tc = parseDevinToolCallDelta(val)
            if (tc.error === undefined) res.toolCallDeltas.push(tc)
            break
          }
          case 7:
            res.usage = parseDevinUsageField(val)
            break
          case 9:
            thinkingParts.push(utf8Decode(val))
            break
          case 10:
            res.deltaSignature = concatBytes(res.deltaSignature, val)
            break
          case 17:
            res.messageId = utf8Decode(val)
            break
          case 21:
            res.deltaSignatureType = utf8Decode(val)
            break
          case 28:
            res.responseDimensionGroups.push(val)
            break
          default:
            res.unknownFieldNumbers.push(num)
            break
        }
        break
      }

      default:
        throw new DevinWireError(
          `unsupported wire type ${typ} at offset ${pos}`,
          finalizeFrame(res, textParts, thinkingParts),
        )
    }
  }

  return finalizeFrame(res, textParts, thinkingParts)
}

/** 收尾：拼接文本片段并填充兼容别名。 */
function finalizeFrame(res: DevinFrameResult, textParts: string[], thinkingParts: string[]): DevinFrameResult {
  if (textParts.length > 0) res.contentText = textParts.join('')
  if (thinkingParts.length > 0) res.thinkingText = thinkingParts.join('')
  // 调用方契约里的别名（同值引用）
  res.text = res.contentText
  res.thinking = res.thinkingText
  res.toolCalls = res.toolCallDeltas
  res.dimensionGroups = res.responseDimensionGroups
  return res
}

/**
 * 解析 Field 6 的工具调用增量（对应 parseDevinToolCallDelta）。
 * 字段：1=ID 2=Name 3=Arguments 4=Index(varint)；其它类型走 ConsumeFieldValue 跳过。
 * 解析失败时返回已解析部分并带上 error（Go 返回 (tc, err)）。
 */
export function parseDevinToolCallDelta(data: Uint8Array): DevinToolCallDeltaResult {
  const tc: DevinToolCallDeltaResult = { id: '', name: '', arguments: '', index: 0 }
  let pos = 0
  while (pos < data.length) {
    const [num, typ, n] = consumeTag(data, pos)
    if (n <= 0) {
      tc.error = errText(n)
      return tc
    }
    pos += n

    switch (typ) {
      case WIRE_VARINT: {
        const [v, vn] = consumeVarint(data, pos)
        if (vn <= 0) {
          tc.error = errText(vn)
          return tc
        }
        pos += vn
        if (num === 4) tc.index = Number(v)
        break
      }
      case WIRE_BYTES: {
        const [val, bn] = consumeBytes(data, pos)
        if (bn <= 0) {
          tc.error = errText(bn)
          return tc
        }
        pos += bn
        switch (num) {
          case 1:
            tc.id = utf8Decode(val)
            break
          case 2:
            tc.name = utf8Decode(val)
            break
          case 3:
            tc.arguments = utf8Decode(val)
            break
        }
        break
      }
      default: {
        const nSkip = consumeFieldValue(num, typ, data, pos)
        if (nSkip <= 0) {
          tc.error = errText(nSkip)
          return tc
        }
        pos += nSkip
        break
      }
    }
  }
  return tc
}

/**
 * 解析内嵌的 google.protobuf.Timestamp，取 Field 1 的秒数
 * （对应 parseDevinTimestamp；遇非 varint 类型或解析失败即中断）。
 */
function parseDevinTimestamp(data: Uint8Array): number {
  let pos = 0
  let secs = 0
  while (pos < data.length) {
    const [num, typ, n] = consumeTag(data, pos)
    if (n <= 0) break
    pos += n
    if (typ === WIRE_VARINT) {
      const [v, vn] = consumeVarint(data, pos)
      if (vn <= 0) break
      pos += vn
      if (num === 1) secs = Number(v)
    } else {
      break
    }
  }
  return secs
}

/**
 * 解析 Field 7 子字段 8 的上游响应头（对应 parseDevinHeaderField）：
 * Tag 1 (string)：header 名（如 "x-request-id" / "Request-Id" / "openai-processing-ms"）
 * Tag 2 (string)：header 值（如 "req_011Cf1..." / "chatcmpl-..."）
 */
function parseDevinHeaderField(data: Uint8Array): { key: string; val: string } {
  let key = ''
  let val = ''
  let pos = 0
  while (pos < data.length) {
    const [num, typ, n] = consumeTag(data, pos)
    if (n <= 0) break
    pos += n
    switch (typ) {
      case WIRE_BYTES: {
        const [b, bn] = consumeBytes(data, pos)
        if (bn <= 0) return { key, val }
        pos += bn
        if (num === 1) key = utf8Decode(b)
        else if (num === 2) val = utf8Decode(b)
        break
      }
      default: {
        const nSkip = consumeFieldValue(num, typ, data, pos)
        if (nSkip <= 0) return { key, val }
        pos += nSkip
        break
      }
    }
  }
  return { key, val }
}

/**
 * 解析响应 Field 7 的用量（对应 parseDevinUsageField）。
 * 2/4 累加到 promptTokens（4 是 OpenAI 系模型的额外上下文 token），3=completionTokens，
 * 5=cachedTokens，6=statusCode；8=header 子消息，9=modelName。
 */
export function parseDevinUsageField(data: Uint8Array): DevinUsage {
  const u: DevinUsage = {
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    statusCode: 0,
    requestId: '',
    modelName: '',
    headers: null,
  }
  let pos = 0
  while (pos < data.length) {
    const [num, typ, n] = consumeTag(data, pos)
    if (n <= 0) break
    pos += n

    switch (typ) {
      case WIRE_VARINT: {
        const [v, vn] = consumeVarint(data, pos)
        if (vn <= 0) return u
        pos += vn
        switch (num) {
          case 2: // Prompt tokens（turn message 里未命中的输入部分）
            u.promptTokens += Number(v)
            break
          case 3: // Output tokens
            u.completionTokens = Number(v)
            break
          case 4: // OpenAI 系模型的额外 context/system prompt tokens（总 prompt = 2 + 4）
            u.promptTokens += Number(v)
            break
          case 5: // Cache read tokens
            u.cachedTokens = Number(v)
            break
          case 6: // Status code
            u.statusCode = Number(v)
            break
        }
        break
      }
      case WIRE_BYTES: {
        const [val, bn] = consumeBytes(data, pos)
        if (bn <= 0) return u
        pos += bn
        if (num === 8) {
          const { key, val: headerVal } = parseDevinHeaderField(val)
          if (key !== '') {
            if (u.headers === null) u.headers = {}
            u.headers[key] = headerVal
            if ((equalFold(key, 'x-request-id') || equalFold(key, 'request-id')) && headerVal !== '') {
              u.requestId = headerVal
            }
          } else if (val.length > 0 && isPrintableASCII(val) && u.requestId === '') {
            u.requestId = utf8Decode(val)
          }
        } else if (num === 9) {
          u.modelName = utf8Decode(val)
        }
        break
      }
      case WIRE_FIXED64: {
        const [, fn] = consumeFixed64(data, pos)
        if (fn <= 0) return u
        pos += fn
        break
      }
      case WIRE_FIXED32: {
        const [, fn] = consumeFixed32(data, pos)
        if (fn <= 0) return u
        pos += fn
        break
      }
      default: {
        const nSkip = consumeFieldValue(num, typ, data, pos)
        if (nSkip <= 0) return u
        pos += nSkip
        break
      }
    }
  }
  return u
}

/** 是否全部为可打印 ASCII（对应 isPrintableASCII；Go 里也用于日志，这里只服务用量解析）。 */
function isPrintableASCII(b: Uint8Array): boolean {
  for (let i = 0; i < b.length; i++) {
    const c = b[i]
    if (c < 32 || c > 126) return false
  }
  return true
}

/**
 * 解析 Field 28（ResponseDimensionGroups）里的 Token Usage 指标
 * （对应 ParseDevinResponseDimensionGroups）：input_tokens / output_tokens / cached_input_tokens。
 * 支持直接传各组载荷，或传一个外层仍带 Tag 28 的信封。
 *
 * TODO: 待核对 —— 嵌套子字段编号（外层 1=title/2=metric，metric 4=value/5=key，value 2=fixed32）
 *       在 Go 侧无注释，按现有字节流推断，若上游改版需复核。
 */
export function parseDevinResponseDimensionGroups(groups: Uint8Array[]): {
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  found: boolean
} {
  let promptTokens = 0
  let completionTokens = 0
  let cachedTokens = 0
  let found = false

  for (let gBytes of groups) {
    if (gBytes.length === 0) continue
    // 若外层信封带 Tag 28（BytesType），先解包取出内层 group 字节
    const [envelopeNum, envelopeTyp, envelopeN] = consumeTag(gBytes, 0)
    if (envelopeN > 0 && envelopeNum === 28 && envelopeTyp === WIRE_BYTES) {
      const [inner, bn] = consumeBytes(gBytes, envelopeN)
      if (bn > 0) gBytes = inner
    }

    let gPos = 0
    let title = ''
    const metrics: Array<{ key: string; val: number }> = []

    while (gPos < gBytes.length) {
      const [gNum, gTyp, gn] = consumeTag(gBytes, gPos)
      if (gn <= 0) break
      gPos += gn
      if (gTyp !== WIRE_BYTES) {
        const gSkip = consumeFieldValue(gNum, gTyp, gBytes, gPos)
        if (gSkip <= 0) break
        gPos += gSkip
        continue
      }
      const [gb, gbn] = consumeBytes(gBytes, gPos)
      if (gbn <= 0) break
      gPos += gbn

      if (gNum === 1) {
        title = utf8Decode(gb)
      } else if (gNum === 2) {
        let mPos = 0
        let mKey = ''
        let mVal = 0
        while (mPos < gb.length) {
          const [mNum, mTyp, mn] = consumeTag(gb, mPos)
          if (mn <= 0) break
          mPos += mn
          if (mTyp !== WIRE_BYTES) {
            const mSkip = consumeFieldValue(mNum, mTyp, gb, mPos)
            if (mSkip <= 0) break
            mPos += mSkip
            continue
          }
          const [mb, mbn] = consumeBytes(gb, mPos)
          if (mbn <= 0) break
          mPos += mbn

          if (mNum === 5) {
            mKey = utf8Decode(mb)
          } else if (mNum === 4) {
            let dPos = 0
            while (dPos < mb.length) {
              const [dNum, dTyp, dn] = consumeTag(mb, dPos)
              if (dn <= 0) break
              dPos += dn
              if (dTyp === WIRE_FIXED32) {
                const [dv, dfn] = consumeFixed32(mb, dPos)
                if (dfn <= 0) break
                dPos += dfn
                if (dNum === 2) mVal = float32FromBits(dv)
              } else {
                const dSkip = consumeFieldValue(dNum, dTyp, mb, dPos)
                if (dSkip <= 0) break
                dPos += dSkip
              }
            }
          }
        }
        if (mKey !== '') metrics.push({ key: mKey, val: mVal })
      }
    }

    if (equalFold(title, 'Token Usage')) {
      for (const m of metrics) {
        switch (m.key) {
          case 'input_tokens':
            promptTokens = Math.trunc(m.val) // int64(float32)
            found = true
            break
          case 'output_tokens':
            completionTokens = Math.trunc(m.val)
            found = true
            break
          case 'cached_input_tokens':
            cachedTokens = Math.trunc(m.val)
            found = true
            break
        }
      }
      if (found) return { promptTokens, completionTokens, cachedTokens, found: true }
    }
  }

  return { promptTokens, completionTokens, cachedTokens, found }
}

/**
 * 解析 Connect-RPC EOS trailer 帧里的错误（对应 ParseDevinTrailerError）。
 * statusCode === 0 表示无错误（对应 Go 的 err == nil）；有错误时 message 为
 * `devin upstream error (<code>): <message>`。
 */
export function parseDevinTrailerError(payload: Uint8Array): {
  statusCode: number
  message?: string
  code?: string
} {
  const trimmed = trimBytes(payload)
  if (trimmed.length === 0 || bytesEqual(trimmed, utf8Encode('{}'))) return { statusCode: 0 }

  let parsed: unknown
  try {
    parsed = JSON.parse(utf8Decode(trimmed))
  } catch {
    return { statusCode: 0 }
  }
  if (typeof parsed !== 'object' || parsed === null) return { statusCode: 0 }

  const errField = (parsed as Record<string, unknown>).error
  if (typeof errField !== 'object' || errField === null) return { statusCode: 0 }

  const errObj = errField as Record<string, unknown>
  const codeRaw = errObj.code
  const msgRaw = errObj.message
  // Go 的 json.Unmarshal 遇到非字符串会整体失败 → (0, nil)
  if ((codeRaw !== undefined && typeof codeRaw !== 'string') || (msgRaw !== undefined && typeof msgRaw !== 'string')) {
    return { statusCode: 0 }
  }
  const code = typeof codeRaw === 'string' ? codeRaw : ''
  const message = typeof msgRaw === 'string' ? msgRaw : ''

  const codeStr = code.toLowerCase()
  const msgLower = message.toLowerCase()

  let httpCode = 502 // 默认 http.StatusBadGateway
  switch (codeStr) {
    case 'invalid_argument':
      httpCode = msgLower.includes('internal error') ? 502 : 400
      break
    case 'internal':
      httpCode = 502
      break
    case 'unauthenticated':
      httpCode = 401
      break
    case 'permission_denied':
      httpCode = 403
      break
    case 'resource_exhausted':
      httpCode = 429
      break
    case 'unavailable':
      httpCode = 503
      break
    case 'canceled':
      httpCode = 499
      break
    case 'deadline_exceeded':
      httpCode = 504
      break
    case 'failed_precondition':
      httpCode =
        msgLower.includes('quota') ||
        msgLower.includes('credit') ||
        msgLower.includes('acu') ||
        msgLower.includes('exhausted') ||
        msgLower.includes('limit')
          ? 429
          : 400
      break
  }

  return {
    statusCode: httpCode,
    message: `devin upstream error (${code}): ${message}`,
    code,
  }
}

/** bytes.TrimSpace 的等价实现（覆盖 Go 的 asciiSpace 集合）。 */
function trimBytes(b: Uint8Array): Uint8Array {
  let start = 0
  let end = b.length
  while (start < end && isBytesSpace(b[start])) start++
  while (end > start && isBytesSpace(b[end - 1])) end--
  return b.subarray(start, end)
}

function isBytesSpace(c: number): boolean {
  return c === 0x20 || (c >= 0x09 && c <= 0x0d) || c === 0x85 || c === 0xa0
}

// ============================================================================
// 流式 UTF-8 边界安全切分（对应 UTF8SplitBuffer）
// ============================================================================

const RUNE_ERROR = 0xfffd

/**
 * 解码一个 UTF-8 rune（对应 utf8.DecodeRune 的宽容语义）：
 * - size === 0：字节不足以判定，需要更多数据（等价于 Go 的 !utf8.FullRune）
 * - 非法编码：返回 (RuneError, 1)
 */
function decodeRunePartial(b: Uint8Array, offset: number): { rune: number; size: number } {
  if (offset >= b.length) return { rune: RUNE_ERROR, size: 0 }
  const b0 = b[offset]
  if (b0 < 0x80) return { rune: b0, size: 1 }

  let n: number
  let lo = 0x80
  let hi = 0xbf
  if (b0 >= 0xc2 && b0 <= 0xdf) {
    n = 2
  } else if (b0 === 0xe0) {
    n = 3
    lo = 0xa0
  } else if (b0 >= 0xe1 && b0 <= 0xec) {
    n = 3
  } else if (b0 === 0xed) {
    n = 3
    hi = 0x9f
  } else if (b0 >= 0xee && b0 <= 0xef) {
    n = 3
  } else if (b0 === 0xf0) {
    n = 4
    lo = 0x90
  } else if (b0 >= 0xf1 && b0 <= 0xf3) {
    n = 4
  } else if (b0 === 0xf4) {
    n = 4
    hi = 0x8f
  } else {
    // 非法首字节：宽度 1 的错误 rune
    return { rune: RUNE_ERROR, size: 1 }
  }

  for (let i = 1; i < n; i++) {
    if (offset + i >= b.length) return { rune: RUNE_ERROR, size: 0 } // 不完整，等待更多字节
    const c = b[offset + i]
    const l = i === 1 ? lo : 0x80
    const h = i === 1 ? hi : 0xbf
    if (c < l || c > h) return { rune: RUNE_ERROR, size: 1 }
  }

  let r = b0 & (0xff >> (n + 1))
  for (let i = 1; i < n; i++) r = (r << 6) | (b[offset + i] & 0x3f)
  return { rune: r, size: n }
}

/**
 * 跨 chunk 缓存不完整 UTF-8 字节序列（对应 UTF8SplitBuffer）。
 * feed(chunk) 返回本次可安全输出的完整字符串，残余字节留到下一次 feed。
 *
 * 切分边界与 Go 完全一致（已与 Go 逐字节比对：完整的非法序列同样按宽度 1 跳过，
 * 截断的多字节序列同样留到下一次）。
 * 唯一差异：Go 的 string(bytes) 会把非法字节原样保留在字符串里，而 JS 字符串是 UTF-16，
 * 非法字节只能渲染成 U+FFFD —— 边界一致，仅非法字节的呈现不同（上游流式文本都是合法
 * UTF-8，实际不会触发）。
 */
export class Utf8SplitBuffer {
  private remainder: Uint8Array = new Uint8Array(0)

  /** 对应 (*UTF8SplitBuffer).Feed。 */
  feed(chunk: Uint8Array): string {
    const combined = new Uint8Array(this.remainder.length + chunk.length)
    combined.set(this.remainder, 0)
    combined.set(chunk, this.remainder.length)
    this.remainder = new Uint8Array(0)

    if (combined.length === 0) return ''

    let validUntil = 0
    while (validUntil < combined.length) {
      const { rune, size } = decodeRunePartial(combined, validUntil)
      if (size === 0) {
        // Go: trailingLen < utf8.UTFMax && !utf8.FullRune(...) → 等待更多字节
        break
      }
      if (rune === RUNE_ERROR && size === 1) {
        // 非法字节：跳过一个字节继续（Go 里的 validUntil++）
        validUntil++
        continue
      }
      validUntil += size
    }

    const validBytes = combined.subarray(0, validUntil)
    // 残余不完整序列最多 3 字节（Go 的 utf8.FullRune 保证了这一点）
    this.remainder = combined.slice(validUntil)
    return utf8Decode(validBytes)
  }
}

// ============================================================================
// 模型 UID 解析（对应 devin_models.go）
// ============================================================================

/** 已识别的模型 uid 后缀。 */
export const KNOWN_DEVIN_SUFFIXES: string[] = [
  '-none',
  '-low',
  '-medium',
  '-high',
  '-xhigh',
  '-max',
  '-fast',
  '-priority',
  '-low-priority',
  '-medium-priority',
  '-high-priority',
  '-xhigh-priority',
  '-max-priority',
]

/** 无法动态推导的私有 Devin 上游别名。 */
export const SPECIAL_DEVIN_ALIASES: Record<string, string> = {
  'claude-haiku-4-5': 'MODEL_PRIVATE_11',
  'gpt-4-1': 'MODEL_CHAT_GPT_4_1_2025_04_14',
}

/** devin 标准 effort 顺序（对应 devinStandardLevelOrder）。 */
const DEVIN_STANDARD_LEVEL_ORDER: string[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * devin_models.json 目录的表项（对应 registry.LookupDevinModel 的返回结构，
 * 只用到 Thinking.Levels）。
 */
export interface DevinModelCatalogEntry {
  thinking?: { levels: string[] } | null
}

/** 模型目录：baseModel -> 元数据。 */
export type DevinModelCatalog = Readonly<Record<string, DevinModelCatalogEntry>>

/**
 * 模型目录（对应 registry.LookupDevinModel）。
 * TODO: 待核对 —— devin_models.json 未包含在本次移植输入里，默认目录为空。
 * 为空时行为等价于 Go 里 modelInfo == nil：没有 thinking levels 的模型按裸名返回。
 * 上层可在启动时用 setDevinModelCatalog 注入完整目录。
 */
let devinModelCatalog: DevinModelCatalog = {}

/** 注入模型目录（等价于把 devin_models.json 载入 registry）。 */
export function setDevinModelCatalog(catalog: DevinModelCatalog): void {
  devinModelCatalog = catalog ?? {}
}

function lookupDevinModel(baseModel: string, catalog: DevinModelCatalog = devinModelCatalog): DevinModelCatalogEntry | null {
  return catalog[baseModel] ?? null
}

/** 模型名是否已经带 Devin effort 后缀（对应 HasDevinEffortSuffix）。 */
export function hasDevinEffortSuffix(model: string): boolean {
  const lower = model.trim().toLowerCase()
  return KNOWN_DEVIN_SUFFIXES.some((s) => lower.endsWith(s))
}

/** 把数字预算或宽松的 effort 字符串归一化成 Devin 规范 effort（对应 NormalizeThinkingLevel）。 */
export function normalizeThinkingLevel(level: string, budgetTokens: number): string {
  const normalized = level.trim().toLowerCase()
  switch (normalized) {
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
    case 'fast':
      return normalized
    case 'none':
    case 'off':
    case 'disabled':
      return 'none'
    case 'auto':
    case 'adaptive':
      return 'high'
  }

  if (budgetTokens > 0) {
    if (budgetTokens <= 4096) return 'low'
    if (budgetTokens <= 16384) return 'medium'
    if (budgetTokens <= 32768) return 'high'
    return 'max'
  }

  return ''
}

/** thinking.ParseSuffix 的结果。 */
interface SuffixResult {
  modelName: string
  hasSuffix: boolean
  rawSuffix: string
}

/** 对应 internal/thinking.ParseSuffix：解析形如 "model(high)" 的后缀。 */
function parseSuffix(model: string): SuffixResult {
  const lastOpen = model.lastIndexOf('(')
  if (lastOpen === -1) return { modelName: model, hasSuffix: false, rawSuffix: '' }
  if (!model.endsWith(')')) return { modelName: model, hasSuffix: false, rawSuffix: '' }
  return {
    modelName: model.slice(0, lastOpen),
    hasSuffix: true,
    rawSuffix: model.slice(lastOpen + 1, model.length - 1),
  }
}

/** 对应 selectDefaultDevinEffort。 */
function selectDefaultDevinEffort(baseModel: string, levels: string[]): string {
  if (baseModel.includes('swe-2')) return 'high'

  let hasNone = false
  let hasLow = false
  let hasMedium = false
  let hasHigh = false
  for (const l of levels) {
    switch (l) {
      case 'none':
        hasNone = true
        break
      case 'low':
        hasLow = true
        break
      case 'medium':
        hasMedium = true
        break
      case 'high':
        hasHigh = true
        break
    }
  }

  // Devin CLI 里的 OpenAI GPT-5.x 家族（支持 none 和 low）默认取 low
  if (hasNone && hasLow && baseModel.startsWith('gpt-5')) return 'low'
  // 带 high thinking 的模型（deepseek/gemini/grok/glm/kimi/nemotron）优先 high
  if (
    hasHigh &&
    (baseModel.includes('gemini') ||
      baseModel.includes('grok') ||
      baseModel.includes('glm') ||
      baseModel.includes('deepseek') ||
      baseModel.includes('kimi') ||
      baseModel.includes('nemotron'))
  ) {
    return 'high'
  }
  if (hasMedium) return 'medium'
  if (hasHigh) return 'high'
  if (hasLow) return 'low'
  return levels[0]
}

/** 对应 devinLevelIndex。 */
function devinLevelIndex(level: string): number {
  const lower = level.trim().toLowerCase()
  return DEVIN_STANDARD_LEVEL_ORDER.indexOf(lower)
}

/** 对应 clampEffort：把请求的 effort 夹到允许集合里（平票取更高的 effort）。 */
function clampEffort(requested: string, allowed: string[], defaultEffort: string): string {
  if (requested === '') return defaultEffort
  const reqLower = requested.trim().toLowerCase()
  for (const a of allowed) {
    if (reqLower === a.trim().toLowerCase()) return a
  }
  if (reqLower === 'none') return defaultEffort

  const reqIdx = devinLevelIndex(reqLower)
  if (reqIdx === -1) return defaultEffort

  let bestMatch = defaultEffort
  let bestDist = 999
  let bestIdx = -1
  for (const a of allowed) {
    const aIdx = devinLevelIndex(a)
    if (aIdx === -1) continue
    let dist = reqIdx - aIdx
    if (dist < 0) dist = -dist
    if (dist < bestDist) {
      bestDist = dist
      bestMatch = a
      bestIdx = aIdx
    } else if (dist === bestDist && aIdx > bestIdx) {
      // 平票优先更高 effort（例如 glm-5-3 的 medium→high；swe-2 的 xhigh→max）
      bestMatch = a
      bestIdx = aIdx
    }
  }

  return bestMatch
}

/**
 * 把模型标识解析为合法的上游 Devin chat_model_uid（对应 ResolveDevinChatModelUID）。
 * 优先用 devin_models.json 的动态目录元数据，自动把请求的 effort 夹到支持的档位，
 * 对 thinking 模型套用合理的默认 effort，并保证裸的 non-thinking 模型保持裸名。
 *
 * 与 Go 的差异：第 6 步的目录查询走本模块的 devinModelCatalog（默认空），
 * 详见 setDevinModelCatalog 的 TODO。
 */
export function resolveDevinChatModelUid(
  rawModel: string,
  thinkingLevel = '',
  budgetTokens = 0,
  catalog: DevinModelCatalog = devinModelCatalog,
): string {
  const model = rawModel.trim()
  if (model === '') return 'swe-2-high'

  // 1. 去掉 devin/ 前缀（大小写不敏感）
  let cleanModel = model
  if (cleanModel.toLowerCase().startsWith('devin/')) cleanModel = cleanModel.slice(6)

  // 2. 已经带精确的 Devin effort 后缀就直接用
  if (hasDevinEffortSuffix(cleanModel)) return cleanModel

  // 3. 去掉 CPA 的冒号或括号后缀（按 CPA 约定，后缀覆盖主体）
  const parsedSuffix = parseSuffix(cleanModel)
  let baseModel = parsedSuffix.modelName.trim()
  let level = thinkingLevel
  if (parsedSuffix.hasSuffix) {
    level = parsedSuffix.rawSuffix
  } else {
    const colonIdx = cleanModel.lastIndexOf(':')
    if (colonIdx !== -1) {
      baseModel = cleanModel.slice(0, colonIdx).trim()
      level = cleanModel.slice(colonIdx + 1).trim()
    }
  }

  // 4. 归一化请求的 effort
  const effort = normalizeThinkingLevel(level, budgetTokens)
  const lowerBase = baseModel.toLowerCase()
  let canonicalBase = lowerBase.split('.').join('-')

  // 5. 检查私有上游别名
  const alias = SPECIAL_DEVIN_ALIASES[canonicalBase]
  if (alias !== undefined) return alias
  if (canonicalBase === 'claude-sonnet-4-5' || canonicalBase.includes('sonnet-4-5')) {
    if (effort !== '' && effort !== 'none') return 'MODEL_PRIVATE_3'
    return 'MODEL_PRIVATE_2'
  }
  if (canonicalBase === 'gemini-3-flash') canonicalBase = 'gemini-3-8-flash'

  // 6. 查询 Devin 目录（devin_models.json）的动态模型元数据
  let modelInfo = lookupDevinModel(canonicalBase, catalog)
  if (modelInfo === null && canonicalBase !== lowerBase) modelInfo = lookupDevinModel(lowerBase, catalog)

  let allowedLevels: string[] = []
  if (modelInfo !== null && modelInfo.thinking != null && modelInfo.thinking.levels.length > 0) {
    allowedLevels = modelInfo.thinking.levels
  }

  // 7. 特殊基础模型：除非显式请求特定变体，否则默认裸名
  switch (canonicalBase) {
    case 'swe-1-7':
      if (effort === 'medium') return 'swe-1-7-medium'
      return 'swe-1-7'
    case 'swe-1-6':
      if (effort === 'fast') return 'swe-1-6-fast'
      return 'swe-1-6'
    case 'glm-5-2':
      if (effort === 'none') return 'glm-5-2-none'
      if (effort === 'max') return 'glm-5-2-max'
      return 'glm-5-2'
  }

  // 8. 目录里没有定义 thinking levels → 按裸模型处理
  if (allowedLevels.length === 0) return canonicalBase

  // 9. 有 thinking levels：确定默认 effort 并夹取
  const defaultEffort = selectDefaultDevinEffort(canonicalBase, allowedLevels)
  const clamped = clampEffort(effort, allowedLevels, defaultEffort)
  return `${canonicalBase}-${clamped}`
}
