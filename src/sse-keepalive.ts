/**
 * SSE keep-alive 包装。
 *
 * 作用：在流静默期间向客户端插入 `: ping` 注释帧，防止 客户端 ↔ 网关 之间的
 * NAT/中间代理把长时间无数据的连接判死（模型 thinking 阶段可能出现数十秒静默）。
 *
 * 安全前提（重要）：
 * - SSE 事件可能被 TCP 任意切块，直接在 chunk 之间插字节会截断半个事件。因此这里按
 *   事件边界（空行 `\n\n` / `\r\n\r\n`）重组字节流，只在边界处注入注释帧；
 * - 若上游长时间不发事件分隔符（非标准流），立即退回纯透传模式，字节原样直出、不再注入，
 *   保证最坏情况下输出与输入完全一致。
 *
 * 注意：注释帧不能解决平台侧 120 秒总时长上限，只能兜住静默断连这一类问题。
 */

const PING_INTERVAL_MS = 15000
// 单个事件缓冲超过该阈值仍未见事件分隔符：判定为非标准流，退回纯透传
const FRAME_BYPASS_BYTES = 128 * 1024

export function withSseKeepAlive(response: Response): Response {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream') || !response.body) return response

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()

  let pending = ''
  let bypass = false
  let finished = false
  let lastDataAt = Date.now()
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null

  const finish = () => {
    finished = true
    clearInterval(timer)
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller
    },
    async pull(controller) {
      if (bypass) {
        try {
          const { done, value } = await reader.read()
          if (done) {
            finish()
            controller.close()
            return
          }
          controller.enqueue(value)
        } catch (error) {
          finish()
          controller.error(error)
        }
        return
      }

      // 注意：pull 不吐出任何数据就返回时，运行时不会再次调度 pull，整个流会永久挂起。
      // 因此这里必须循环读到「至少一个完整事件」为止（SSE 事件被 TCP 切开是常态）。
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            const tail = decoder.decode()
            if (tail) pending += tail
            if (pending) controller.enqueue(encoder.encode(pending))
            finish()
            controller.close()
            return
          }

          lastDataAt = Date.now()
          pending += decoder.decode(value, { stream: true })

          // 切出完整事件（含分隔符）逐个下发，未闭合的事件留在缓冲里等后续 chunk
          let match: RegExpExecArray | null
          let emitted = false
          while ((match = /\r?\n\r?\n/.exec(pending))) {
            const end = match.index + match[0].length
            controller.enqueue(encoder.encode(pending.slice(0, end)))
            pending = pending.slice(end)
            emitted = true
          }
          if (emitted) return

          if (pending.length > FRAME_BYPASS_BYTES) {
            // 上游不是「空行分隔事件」的标准 SSE：退出包装，原样透传
            bypass = true
            if (pending) {
              controller.enqueue(encoder.encode(pending))
              pending = ''
            }
            return
          }
          // 否则继续读下一个 chunk，直到凑出完整事件
        }
      } catch (error) {
        finish()
        try { await reader.cancel(error) } catch {}
        controller.error(error)
      }
    },
    cancel(reason) {
      finish()
      try { reader.cancel(reason) } catch {}
    },
  })

  const timer = setInterval(() => {
    if (finished || bypass || !controllerRef) return
    if (pending !== '') return // 事件中途绝不注入
    if (Date.now() - lastDataAt < PING_INTERVAL_MS) return
    try {
      controllerRef.enqueue(encoder.encode(': ping\n\n'))
    } catch {
      // 流已关闭/被取消：忽略
    }
  }, PING_INTERVAL_MS)

  const headers = new Headers(response.headers)
  // 注入字节后长度必然变化；同时清掉可能存在的分块相关头，交给运行时重新计算
  headers.delete('content-length')
  headers.delete('content-encoding')
  headers.delete('transfer-encoding')

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
