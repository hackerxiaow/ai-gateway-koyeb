import { Context } from 'hono'
import { getProviders } from './storage'
import { SITE_CONFIG } from './config'
import type { Env } from './types'
import { CSS_CONTENT } from './pages.css'
import { getExternalOrigin } from './request-utils'
import { icon, renderSiteFooter, CLIENT_ICONS } from './shared.js'

function getPlatformLabel(_env: any, _host?: string): string {
  return 'Koyeb · PostgreSQL'
}

const escapePageHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const H = (title: string) => `
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#f8fafc">
  <title>${title} — ${SITE_CONFIG.title}</title>
  <link rel="icon" href="${SITE_CONFIG.favicon}">
  <link rel="stylesheet" href="${SITE_CONFIG.faCdn}">
  <style>${CSS_CONTENT}</style>
</head>`

export async function renderHomePage(c: Context<{ Bindings: Env }>, isLoggedIn: boolean) {
  const providers = await getProviders(c.env)
  const apiBase = `${getExternalOrigin(c)}/v1`
  const enabledProviders = providers.filter((p) => p.enabled)
  const allModelsCount = providers.reduce((total, p) => total + p.models.length, 0)
  const enabledModelsCount = enabledProviders.reduce((total, p) => total + p.models.filter((m) => m.enabled).length, 0)

  const sampleProvider = enabledProviders.find((p) => p.models.some((m) => m.enabled))
  const sampleModel = sampleProvider
    ? `${sampleProvider.id}/${sampleProvider.models.find((m) => m.enabled)?.alias || sampleProvider.models.find((m) => m.enabled)?.id || 'model'}`
    : 'provider/model'

  return c.html(`<!DOCTYPE html><html lang="zh-CN">
${H('首页')}
<body class="site-page home-page">
<header class="topbar">
  <div class="shell topbar__inner">
    <a class="brand" href="/" aria-label="AI GATEWAY 首页">
      <span class="brand__mark">${icon('cloud', '', 18)}</span>
      <span class="brand__name">AI GATEWAY</span>
    </a>
    <nav class="topbar__actions" aria-label="主导航">
      ${isLoggedIn
        ? `<a href="/admin" class="btn btn-p">${icon('overview', '', 14)}管理控制台</a><a href="/admin/logout" class="btn btn-gh">${icon('signOut', '', 14)}退出</a>`
        : `<a href="/admin/login" class="btn btn-p">${icon('signIn', '', 14)}管理员登录</a>`
      }
    </nav>
  </div>
</header>

<main>
  <section class="shell home-hero" aria-labelledby="home-title">
    <div class="home-hero__copy">
      <p class="eyebrow">${icon('cloud', '', 12)}UNIFIED MODEL ROUTER</p>
      <h1 id="home-title">统一接口规范，调度已配置的所有大模型。</h1>
      <p class="home-hero__lede">统一的 OpenAI / Anthropic 兼容端点。聚合多渠道上游、故障转移、账号轮询与用量跟踪，让大模型调用如同基础设施般稳定简单。</p>
      
      <div class="endpoint-box endpoint-box--url" aria-label="API 接入地址">
        <span class="endpoint-box__label">API BASE URL</span>
        <code>${escapePageHtml(apiBase)}</code>
        <button class="btn btn-s copy-control" type="button" data-copy="${escapePageHtml(apiBase)}" aria-label="复制 API 地址">
          ${icon('copy', '', 14)}<span class="copy-label">复制地址</span>
        </button>
      </div>
    </div>

    <figure class="request-panel" aria-labelledby="request-caption">
      <figcaption id="request-caption">
        <span>POST /chat/completions</span>
        <span class="protocol-state">OPENAI COMPATIBLE</span>
      </figcaption>
      <pre><code><span class="syntax-command">curl</span> ${escapePageHtml(apiBase)}/chat/completions \\
  <span class="syntax-key">-H</span> <span class="syntax-string">"Authorization: Bearer sk-***"</span> \\
  <span class="syntax-key">-H</span> <span class="syntax-string">"Content-Type: application/json"</span> \\
  <span class="syntax-key">-d</span> <span class="syntax-string">'{
    "model": "${escapePageHtml(sampleModel)}",
    "messages": [{ "role": "user", "content": "Hello" }]
  }'</span></code></pre>
      <div class="request-panel__foot">
        <span>调用格式规范</span>
        <code>provider/model</code>
      </div>
    </figure>
  </section>

  <section class="shell endpoints-strip" aria-label="支持的 API 端点">
    <div class="endpoint-box endpoint-box--list">
      <div class="endpoint-box__header">
        <span class="endpoint-box__label">ENDPOINTS · 完整协议端点一览</span>
        <span class="endpoint-box__hint">统一网关自动进行协议映射与故障重试，支持标准流式与非流式调用</span>
      </div>
      <div class="endpoint-list">
        <div class="ep-item"><code><span class="endpoint-method">POST</span> /v1/chat/completions</code><small>对话补全</small></div>
        <div class="ep-item"><code><span class="endpoint-method">POST</span> /v1/completions</code><small>文本补全</small></div>
        <div class="ep-item"><code><span class="endpoint-method">POST</span> /v1/embeddings</code><small>向量嵌入</small></div>
        <div class="ep-item"><code><span class="endpoint-method">POST</span> /v1/audio/speech</code><small>语音合成</small></div>
        <div class="ep-item"><code><span class="endpoint-method">POST</span> /v1/audio/transcriptions</code><small>语音转文字</small></div>
        <div class="ep-item"><code><span class="endpoint-method">POST</span> /v1/audio/translations</code><small>语音翻译</small></div>
        <div class="ep-item"><code><span class="endpoint-method">POST</span> /v1/images/generations</code><small>文生图</small></div>
        <div class="ep-item"><code><span class="endpoint-method">POST</span> /v1/images/edits</code><small>图片编辑</small></div>
        <div class="ep-item"><code><span class="endpoint-method">POST</span> /v1/images/variations</code><small>图片变体</small></div>
        <div class="ep-item"><code><span class="endpoint-method">POST</span> /v1/videos/generations</code><small>文生视频</small></div>
        <div class="ep-item"><code><span class="endpoint-method">POST</span> /v1/video/generations</code><small>视频(别名)</small></div>
        <div class="ep-item"><code><span class="endpoint-method">GET</span> /v1/videos/status</code><small>任务状态</small></div>
        <div class="ep-item"><code><span class="endpoint-method">POST</span> /v1/messages</code><small>Anthropic 消息</small></div>
        <div class="ep-item"><code><span class="endpoint-method">POST</span> /v1/responses</code><small>响应流</small></div>
        <div class="ep-item"><code><span class="endpoint-method">POST</span> /v1/moderations</code><small>内容审核</small></div>
        <div class="ep-item"><code><span class="endpoint-method">GET</span> /v1/models</code><small>模型列表</small></div>
      </div>
    </div>
  </section>

  <section class="shell metrics-strip" aria-label="网关配置概览">
    <div class="metric"><span class="metric__value">${providers.length}</span><span class="metric__label">渠道总计</span></div>
    <div class="metric"><span class="metric__value">${enabledProviders.length}</span><span class="metric__label">已启用渠道</span></div>
    <div class="metric"><span class="metric__value">${allModelsCount}</span><span class="metric__label">模型总计</span></div>
    <div class="metric"><span class="metric__value">${enabledModelsCount}</span><span class="metric__label">当前可用模型</span></div>
  </section>

  <section class="shell directory" aria-labelledby="directory-title">
    <div class="section-heading">
      <div>
        <h2 id="directory-title">已就绪的模型目录</h2>
        <p>点击模型 ID 即可一键复制；仅展示已启用且可正常调用的模型。</p>
      </div>
      <label class="search-field" for="model-search">
        ${icon('search', '', 15)}
        <input id="model-search" type="search" placeholder="搜索渠道或模型名称..." autocomplete="off">
      </label>
    </div>

    <div class="provider-index" id="provider-index">
      ${enabledProviders.length ? enabledProviders.map((provider) => {
        const models = provider.models.filter((model) => model.enabled)
        return `<article class="provider-row" data-search="${escapePageHtml(`${provider.name} ${provider.id} ${models.map((model) => model.id).join(' ')}`.toLowerCase())}">
          <div class="provider-row__identity">
            <span class="provider-row__mark" aria-hidden="true">${escapePageHtml(provider.name.charAt(0).toUpperCase() || 'A')}</span>
            <div>
              <h3>${escapePageHtml(provider.name)}</h3>
              <p><span>${(provider.apiType || 'openai') === 'anthropic' ? 'Anthropic' : 'OpenAI'} 兼容</span></p>
            </div>
          </div>
          <div class="provider-row__models">
            ${models.length ? models.map((model) => {
              const fullModel = `${provider.id}/${model.alias || model.id}`
              return `<button class="model-token copy-control" type="button" data-copy="${escapePageHtml(fullModel)}" title="点击复制"><code>${escapePageHtml(fullModel)}</code>${icon('copy', '', 12)}</button>`
            }).join('') : '<span class="empty-inline">暂无启用模型</span>'}
          </div>
          <span class="status-badge status-badge--on">已就绪</span>
        </article>`
      }).join('') : `<div class="empty-state">${icon('cube', '', 36)}<h3>尚无可用模型</h3><p>管理员启用渠道和模型后，会自动在此展示。</p>${isLoggedIn ? '<a class="btn btn-p" href="/admin" style="margin-top:12px">前往控制台</a>' : ''}</div>`}
    </div>
    <div id="search-empty" class="empty-state hd">${icon('search', '', 36)}<h3>没有匹配到结果</h3><p>请尝试搜索其他渠道名称或模型 ID。</p></div>
  </section>
</main>

${renderSiteFooter(SITE_CONFIG.title, getPlatformLabel(c.env, c.req.header('host')))}

<script>
window.SVG_ICONS = ${CLIENT_ICONS};
(function () {
  document.querySelectorAll('.copy-control').forEach(function (button) {
    var label = button.querySelector('.copy-label')
    var originalLabel = label ? label.textContent : ''
    button.addEventListener('click', async function () {
      var text = button.getAttribute('data-copy') || ''
      var iconWrap = button.querySelector('.svg-icon')
      try {
        await navigator.clipboard.writeText(text)
        button.setAttribute('data-state', 'success')
        if (iconWrap && window.SVG_ICONS && window.SVG_ICONS.check) {
          iconWrap.innerHTML = window.SVG_ICONS.check
        }
        if (label) label.textContent = '已复制'
        setTimeout(function () {
          button.removeAttribute('data-state')
          if (iconWrap && window.SVG_ICONS && window.SVG_ICONS.copy) {
            iconWrap.innerHTML = window.SVG_ICONS.copy
          }
          if (label) label.textContent = originalLabel
        }, 1800)
      } catch (error) {
        button.setAttribute('data-state', 'error')
      }
    })
  })

  // API 地址盒：网址占满中间可用空间（超长显示省略号），仅当空间过窄时才隐藏
  function fitEndpointUrl() {
    document.querySelectorAll('.endpoint-box--url code').forEach(function (el) {
      el.style.display = ''
      if (el.clientWidth < 80) el.style.display = 'none'
    })
  }
  window.addEventListener('resize', function () {
    clearTimeout(window.__fitEndpointUrlTimer)
    window.__fitEndpointUrlTimer = setTimeout(fitEndpointUrl, 150)
  })
  fitEndpointUrl()

  var search = document.getElementById('model-search')
  var rows = Array.from(document.querySelectorAll('.provider-row'))
  var empty = document.getElementById('search-empty')
  if (search) search.addEventListener('input', function () {
    var query = search.value.trim().toLowerCase()
    var visible = 0
    rows.forEach(function (row) {
      var matched = !query || (row.getAttribute('data-search') || '').includes(query)
      row.classList.toggle('hd', !matched)
      if (matched) visible++
    })
    if (empty) empty.classList.toggle('hd', visible > 0 || !query)
  })
})()
</script>
</body></html>`)
}
