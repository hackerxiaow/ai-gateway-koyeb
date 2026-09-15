// 视频生成代理(video-proxy) — 移植自 one-api-cf
//  - openai-video   : 标准 OpenAI 视频端点 POST /v1/videos/generations, 原样透传
//  - agnes-video    : agnes-ai 异步任务模式
//      1) POST /videos  提交任务 → { task_id, status }
//      2) GET /videos/{task_id} 轮询 → status 变 completed, 视频 URL 在 metadata.url
//      统一包装成 OpenAI 兼容响应 { id, object, status, data:[{url}] }

// 轮询参数: 最长等待时间与轮询间隔(毫秒)
const AGNES_MAX_WAIT_MS = 120 * 1000
const AGNES_POLL_INTERVAL_MS = 4000

/** 提交 agnes 异步视频任务并轮询至完成/失败 */
export async function handleAgnesVideo(
  baseUrl: string,
  apiKey: string,
  requestBody: any,
): Promise<Response> {
  const cleanBase = baseUrl.replace(/\/+$/, '')
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  }

  // duration 需为 int(agnes 要求)
  const submitBody: Record<string, unknown> = {
    model: requestBody.model,
    prompt: requestBody.prompt || requestBody.input || '',
  }
  if (requestBody.duration !== undefined) {
    submitBody.duration = typeof requestBody.duration === 'number'
      ? Math.round(requestBody.duration)
      : parseInt(String(requestBody.duration), 10)
  }

  // 1) 提交任务到 POST /videos
  let submitResp: Response
  try {
    submitResp = await fetch(`${cleanBase}/videos`, {
      method: 'POST',
      headers,
      body: JSON.stringify(submitBody),
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'video submit failed'
    return new Response(JSON.stringify({ error: { message: msg, type: 'proxy_error' } }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!submitResp.ok) {
    const errText = await submitResp.text()
    return new Response(errText, { status: submitResp.status, headers: { 'content-type': submitResp.headers.get('content-type') || 'application/json' } })
  }

  let taskData: any
  try {
    taskData = await submitResp.json()
  } catch {
    return new Response(JSON.stringify({ error: { message: 'Invalid task submit response', type: 'proxy_error' } }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const taskId = taskData.task_id || taskData.video_id || taskData.id
  if (!taskId) {
    return new Response(JSON.stringify({ error: { message: 'No task_id in upstream response', type: 'proxy_error' } }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // 2) 轮询 GET /videos/{task_id}
  const deadline = Date.now() + AGNES_MAX_WAIT_MS
  let status = taskData.status || 'queued'
  let latest: any = taskData

  while (Date.now() < deadline) {
    if (status === 'completed' || status === 'succeeded' || status === 'saved') break
    if (status === 'failed' || status === 'error' || status === 'cancelled') break

    await new Promise((r) => setTimeout(r, AGNES_POLL_INTERVAL_MS))

    try {
      const pollResp = await fetch(`${cleanBase}/videos/${taskId}`, { headers })
      if (pollResp.ok) {
        latest = await pollResp.json()
        status = latest.status || status
      }
    } catch {
      // 单次轮询失败继续尝试
    }
  }

  // 3) 归一化为 OpenAI 兼容响应
  const videoUrl = latest?.metadata?.url || latest?.url || latest?.video_url || ''

  const responsePayload: Record<string, unknown> = {
    id: taskId,
    object: 'video',
    model: latest?.model || requestBody.model,
    status,
    progress: latest?.progress ?? (status === 'completed' ? 100 : 0),
    created_at: latest?.created_at,
    completed_at: latest?.completed_at,
  }

  if (status === 'completed' || status === 'succeeded') {
    responsePayload.data = [{ url: videoUrl }]
  } else {
    // 未完成: 返回 task 状态, 让客户端可继续轮询
    responsePayload.task_id = taskId
    if (latest?.error) responsePayload.error = latest.error
  }

  return new Response(JSON.stringify(responsePayload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 查询 agnes 视频任务状态(供 GET /v1/videos/status 回查) */
export async function queryAgnesVideoStatus(
  baseUrl: string,
  apiKey: string,
  taskId: string,
): Promise<Response> {
  const cleanBase = baseUrl.replace(/\/+$/, '')
  try {
    const pollResp = await fetch(`${cleanBase}/videos/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!pollResp.ok) {
      const errText = await pollResp.text()
      return new Response(errText, { status: pollResp.status, headers: { 'content-type': 'application/json' } })
    }

    const latest: any = await pollResp.json()
    const status = latest?.status || 'unknown'
    const videoUrl = latest?.metadata?.url || latest?.url || latest?.video_url || ''

    const payload: Record<string, unknown> = {
      id: taskId,
      object: 'video',
      model: latest?.model,
      status,
      progress: latest?.progress ?? (status === 'completed' ? 100 : 0),
      created_at: latest?.created_at,
      completed_at: latest?.completed_at,
    }

    if (status === 'completed' || status === 'succeeded') {
      payload.data = [{ url: videoUrl }]
    } else {
      payload.task_id = taskId
      if (latest?.error) payload.error = latest.error
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'video status query failed'
    return new Response(JSON.stringify({ error: { message: msg, type: 'proxy_error' } }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
