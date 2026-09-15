/**
 * Z.AI (智谱 GLM 国际站, z.ai) 预设渠道 (provider.type = 'zai')
 *
 * Z.AI 没有 OAuth（官方只有 API Key），因此本渠道是"预设"而非反代：
 *  - 编码套餐 OpenAI 兼容端点: https://api.z.ai/api/coding/paas/v4  -> /chat/completions
 *  - 编码套餐 Anthropic 兼容端点: https://api.z.ai/api/anthropic/v1 -> /messages
 *    （网关对 type=zai 按请求路径自动选择协议：/v1/messages 走 Anthropic，其余走 OpenAI）
 *  - 鉴权: Authorization: Bearer <key>（Anthropic 端点同时接受 x-api-key）
 *
 * 通用 API（按量付费）端点: https://api.z.ai/api/paas/v4
 * 中国大陆平台: https://open.bigmodel.cn/api/paas/v4
 */

/** 编码套餐常见模型（模型名以 z.ai 控制台/文档为准，可自行编辑） */
export const ZAI_DEFAULT_MODELS = [
  'glm-5.3',
  'glm-5.3-flash',
  'glm-4.7',
  'glm-4.7-flash',
  'glm-4.6',
  'glm-4.5-air',
]

/**
 * 上游 /models 需要有效 Key 才可读；这里提供内置清单作为兜底，
 * 也用于「获取模型」按钮在无 Key 时的展示。
 */
export function fetchZaiModels(): { success: boolean; models: string[] } {
  return { success: true, models: [...ZAI_DEFAULT_MODELS] }
}
