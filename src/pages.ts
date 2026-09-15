import { Context } from 'hono'
import { getProviders, getProxyKeys } from './storage'
import { SITE_CONFIG, OPENCODE_DEFAULT_URL } from './config'
import type { Env } from './types'
import { CSS_CONTENT } from './pages.css'
import { SHARED_JS, renderSiteFooter } from './shared.js'

// 检测运行平台 + 存储类型, 返回如 "Pages · D1"
function getPlatformLabel(env: any, host?: string): string {
  // 运行平台: 当前项目已适配 Cloudflare Pages 架构，除非明确来自 workers.dev 域名，否则均标识为 Pages
  const isWorker = typeof host === 'string' && host.includes('workers.dev')
  const platform = isWorker ? 'Workers' : 'Pages'
  const storage = env?.DB ? 'D1' : env?.KV ? 'KV' : 'Memory'
  return `${platform} · ${storage}`
}
import { storageTypeLabel } from './storage-adapter'
import { AZURE_TTS_VOICES, voiceGroup } from './azure-voices'

// Azure TTS 音色下拉选项 HTML(按语言分组, 中文标注)
const AZURE_VOICE_OPTIONS = (() => {
  const groups = new Map<string, string[]>()
  for (const v of AZURE_TTS_VOICES) {
    const g = v.group || voiceGroup(v.id)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(`<option value="${v.id}">${v.label} (${v.id})</option>`)
  }
  return Array.from(groups.entries()).map(([g, opts]) => `<optgroup label="${g}">${opts.join('')}</optgroup>`).join('')
})()
// 带选中项的版本
const azureVoiceOptions = (selected: string) => {
  const groups = new Map<string, string[]>()
  for (const v of AZURE_TTS_VOICES) {
    const g = v.group || voiceGroup(v.id)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(`<option value="${v.id}" ${v.id === selected ? 'selected' : ''}>${v.label} (${v.id})</option>`)
  }
  return Array.from(groups.entries()).map(([g, opts]) => `<optgroup label="${g}">${opts.join('')}</optgroup>`).join('')
}

// 前端页面模板：仅重构视觉与交互，保持后端路由、KV 结构和 API 契约不变。
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
  <meta name="theme-color" content="oklch(98.5% 0.004 250)">
  <title>${title} — ${SITE_CONFIG.title}</title>
  <link rel="icon" href="${SITE_CONFIG.favicon}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&amp;family=JetBrains+Mono:wght@400;500;600&amp;family=Space+Grotesk:wght@500;600&amp;display=swap" rel="stylesheet">
  <link rel="stylesheet" href="${SITE_CONFIG.faCdn}">
  <style>${CSS_CONTENT}</style>
</head>`

// ===== 首页 =====

export async function renderHomePage(c: Context<{ Bindings: Env }>, isLoggedIn: boolean) {
  const providers = await getProviders(c.env)
  const host = c.req.header('host') || 'localhost:8787'
  const apiBase = `https://${host}/v1`
  const enabledProviders = providers.filter((provider) => provider.enabled)
  const allModelsCount = providers.reduce((total, provider) => total + provider.models.length, 0)
  const enabledModelsCount = enabledProviders.reduce((total, provider) => total + provider.models.filter((model) => model.enabled).length, 0)
  // 首页调用示例: 取第一个启用模型的对外名(alias 优先, 隐藏 -free 后缀)
  const sampleProvider = enabledProviders.find((p) => p.models.some((m) => m.enabled))
  const sampleModel = sampleProvider
    ? `${sampleProvider.id}/${sampleProvider.models.find((m) => m.enabled)?.alias || sampleProvider.models.find((m) => m.enabled)?.id || 'model'}`
    : 'provider/model'

  return c.html(`<!DOCTYPE html><html lang="zh-CN">
${H('首页')}
<body class="site-page home-page">
<header class="topbar">
  <div class="shell topbar__inner">
    <a class="brand" href="/" aria-label="AI Gateway 首页">
      <span class="brand__mark" aria-hidden="true"><i class="fas fa-cloud"></i></span>
      <span class="brand__name">${SITE_CONFIG.title}</span>
      <span class="brand__descriptor">API CONTROL PANEL</span>
    </a>
    <nav class="topbar__actions" aria-label="主导航">
      ${isLoggedIn
        ? `<a href="/admin" class="btn btn-p"><i class="fas fa-sliders-h" aria-hidden="true"></i>管理控制台</a><a href="/admin/logout" class="btn btn-gh"><i class="fas fa-sign-out-alt" aria-hidden="true"></i>退出</a>`
        : `<a href="/admin/login" class="btn btn-p"><i class="fas fa-sign-in-alt" aria-hidden="true"></i>管理员登录</a>`
      }
    </nav>
  </div>
</header>

<main>
  <section class="shell home-hero" aria-labelledby="home-title">
    <div class="home-hero__copy">
      <p class="eyebrow"><span aria-hidden="true"></span>UNIFIED AI GATEWAY</p>
      <h1 id="home-title">一个 API，调用已配置的所有模型。</h1>
      <p class="home-hero__lede">统一的 OpenAI / Anthropic 兼容入口。模型按渠道归档，令牌、启用状态和故障转移集中管理。</p>
      <div class="endpoint-box" aria-label="API 接入地址">
        <span class="endpoint-box__label">BASE URL</span>
        <code>${escapePageHtml(apiBase)}</code>
        <button class="icon-btn copy-control" type="button" data-copy="${escapePageHtml(apiBase)}" aria-label="复制 API 地址">
          <i class="far fa-copy" aria-hidden="true"></i><span>复制</span>
        </button>
      </div>
    </div>

    <figure class="request-panel" aria-labelledby="request-caption">
      <figcaption id="request-caption">
        <span>POST /chat/completions</span>
        <span class="protocol-state"><i aria-hidden="true"></i>OPENAI COMPATIBLE</span>
      </figcaption>
      <pre><code><span class="syntax-command">curl</span> ${escapePageHtml(apiBase)}/chat/completions \\
  <span class="syntax-key">-H</span> <span class="syntax-string">"Authorization: Bearer ***"</span> \\
  <span class="syntax-key">-H</span> <span class="syntax-string">"Content-Type: application/json"</span> \\
  <span class="syntax-key">-d</span> <span class="syntax-string">'{
    "model": "${escapePageHtml(sampleModel)}",
    "messages": [{ "role": "user", "content": "Hello" }]
  }'</span></code></pre>
      <div class="request-panel__foot">
        <span>模型格式</span>
        <code>provider/model</code>
      </div>
    </figure>

    <div class="endpoint-box endpoint-box--list" aria-label="支持的 API 端点">
      <span class="endpoint-box__label">ENDPOINTS · 支持以下接口</span>
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
        <div class="ep-item"><code><span class="endpoint-method">POST</span> /v1/video/generations</code><small>文生视频(别名)</small></div>
        <div class="ep-item"><code><span class="endpoint-method">GET</span> /v1/videos/status</code><small>视频任务状态</small></div>
        <div class="ep-item"><code><span class="endpoint-method">POST</span> /v1/messages</code><small>Anthropic 消息</small></div>
        <div class="ep-item"><code><span class="endpoint-method">POST</span> /v1/responses</code><small>响应接口</small></div>
        <div class="ep-item"><code><span class="endpoint-method">POST</span> /v1/moderations</code><small>内容审核</small></div>
        <div class="ep-item"><code><span class="endpoint-method">GET</span> /v1/models</code><small>模型列表</small></div>
      </div>
    </div>
  </section>

  <section class="shell metrics-strip" aria-label="网关配置概览">
    <div class="metric"><span class="metric__value">${providers.length}</span><span class="metric__label">渠道总计</span></div>
    <div class="metric"><span class="metric__value">${enabledProviders.length}</span><span class="metric__label">已启用渠道</span></div>
    <div class="metric"><span class="metric__value">${allModelsCount}</span><span class="metric__label">模型总计</span></div>
    <div class="metric"><span class="metric__value">${enabledModelsCount}</span><span class="metric__label">可用模型</span></div>
  </section>

  <section class="shell directory" aria-labelledby="directory-title">
    <div class="section-heading">
      <div>
        <h2 id="directory-title">模型列表</h2>
        <p>点击模型 ID 即可复制；这里只展示已启用的渠道与模型。</p>
      </div>
      <label class="search-field" for="model-search">
        <i class="fas fa-search" aria-hidden="true"></i>
        <span class="sr-only">搜索渠道或模型</span>
        <input id="model-search" type="search" placeholder="搜索渠道或模型" autocomplete="off">
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
              return `<button class="model-token copy-control" type="button" data-copy="${escapePageHtml(fullModel)}"><code>${escapePageHtml(fullModel)}</code><i class="far fa-copy" aria-hidden="true"></i></button>`
            }).join('') : '<span class="empty-inline">暂无启用模型</span>'}
          </div>
          <span class="status-badge status-badge--on"><i aria-hidden="true"></i>已启用</span>
        </article>`
      }).join('') : `<div class="empty-state"><i class="fas fa-cubes" aria-hidden="true"></i><h3>尚无可用模型</h3><p>管理员启用渠道和模型后，它们会出现在这里。</p>${isLoggedIn ? '<a class="btn btn-p" href="/admin">前往管理控制台</a>' : ''}</div>`}
    </div>
    <div id="search-empty" class="empty-state hd"><i class="fas fa-search" aria-hidden="true"></i><h3>没有匹配结果</h3><p>请尝试输入渠道名称、ID 或模型名称。</p></div>
  </section>
</main>

${renderSiteFooter(SITE_CONFIG.title, getPlatformLabel(c.env, c.req.header('host')))}

<script>
(function () {
  var status = document.getElementById('copy-status')
  document.querySelectorAll('.copy-control').forEach(function (button) {
    button.addEventListener('click', async function () {
      var text = button.getAttribute('data-copy') || ''
      var icon = button.querySelector('i')
      var label = button.querySelector('span')
      try {
        await navigator.clipboard.writeText(text)
        button.setAttribute('data-state', 'success')
        if (icon) icon.className = 'fas fa-check c-s'
        if (label) label.textContent = '已复制'
        if (status) status.textContent = '已复制 ' + text
        window.setTimeout(function () {
          button.removeAttribute('data-state')
          if (icon) icon.className = 'far fa-copy'
          if (label) label.textContent = '复制'
        }, 1800)
      } catch (error) {
        button.setAttribute('data-state', 'error')
        if (status) status.textContent = '复制失败，请手动选择文本。'
      }
    })
  })

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

// ===== 登录页 =====

export async function renderLoginPage(c: Context<{ Bindings: Env }>) {
  return c.html(`<!DOCTYPE html><html lang="zh-CN">
${H('登录')}
<body class="site-page auth-page">
<header class="topbar topbar--auth">
  <div class="shell topbar__inner">
    <a class="brand" href="/" aria-label="AI Gateway 首页">
      <span class="brand__mark" aria-hidden="true"><i class="fas fa-cloud"></i></span>
      <span class="brand__name">${SITE_CONFIG.title}</span>
    </a>
    <a href="/" class="btn btn-gh"><i class="fas fa-arrow-left" aria-hidden="true"></i>返回首页</a>
  </div>
</header>

<main class="auth-shell">
  <section class="auth-context" aria-labelledby="auth-context-title">
    <p class="eyebrow"><span aria-hidden="true"></span>CONTROL PANEL ACCESS</p>
    <h1 id="auth-context-title">管理渠道、模型和令牌。</h1>
  </section>

  <section class="auth-form-wrap" aria-labelledby="login-title">
    <form class="auth-form" id="login-form" novalidate>
      <div class="auth-form__heading">
        <span class="auth-form__icon" aria-hidden="true"><i class="fas fa-lock"></i></span>
        <div><h2 id="login-title">管理员登录</h2><p>使用部署时配置的账号继续。</p></div>
      </div>

      <div id="er" class="al al-e hd" role="alert" aria-live="assertive">
        <i class="fas fa-exclamation-circle" aria-hidden="true"></i><span id="em"></span>
      </div>

      <div class="fg">
        <label for="u">用户名</label>
        <div class="input-wrap"><i class="far fa-user" aria-hidden="true"></i><input type="text" id="u" name="username" placeholder="admin" autocomplete="username" aria-required="true" aria-describedby="login-helper"></div>
      </div>
      <div class="fg">
        <label for="p">密码</label>
        <div class="input-wrap"><i class="fas fa-key" aria-hidden="true"></i><input type="password" id="p" name="password" placeholder="部署环境变量中的密码" autocomplete="current-password" aria-required="true" aria-describedby="login-helper"><button class="password-toggle" id="password-toggle" type="button" aria-label="显示密码"><i class="far fa-eye" aria-hidden="true"></i></button></div>
      </div>
      <p id="login-helper" class="form-helper">登录成功后将进入管理控制台。</p>
      <button class="btn btn-p btn-submit" id="login-button" type="submit"><span class="button-label"><i class="fas fa-sign-in-alt" aria-hidden="true"></i>登录管理控制台</span><span class="button-loading"><i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i>正在验证</span></button>
    </form>
  </section>
</main>

<script>
(function () {
  var form = document.getElementById('login-form')
  var username = document.getElementById('u')
  var password = document.getElementById('p')
  var errorBox = document.getElementById('er')
  var errorMessage = document.getElementById('em')
  var submit = document.getElementById('login-button')
  var toggle = document.getElementById('password-toggle')

  function showError(message) {
    errorMessage.textContent = message
    errorBox.classList.remove('hd')
    username.setAttribute('aria-invalid', 'true')
    password.setAttribute('aria-invalid', 'true')
  }
  function clearError() {
    errorBox.classList.add('hd')
    username.removeAttribute('aria-invalid')
    password.removeAttribute('aria-invalid')
  }

  toggle.addEventListener('click', function () {
    var show = password.type === 'password'
    password.type = show ? 'text' : 'password'
    toggle.setAttribute('aria-label', show ? '隐藏密码' : '显示密码')
    toggle.querySelector('i').className = show ? 'far fa-eye-slash' : 'far fa-eye'
    password.focus({ preventScroll: true })
  })

  form.addEventListener('submit', async function (event) {
    event.preventDefault()
    clearError()
    var u = username.value.trim()
    var p = password.value
    if (!u || !p) {
      showError('请填写用户名和密码后再登录。')
      ;(!u ? username : password).focus()
      return
    }
    submit.disabled = true
    submit.setAttribute('data-state', 'loading')
    try {
      var response = await fetch('/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p })
      })
      var data = await response.json()
      if (data.success) {
        submit.setAttribute('data-state', 'success')
        window.location.href = '/admin'
        return
      }
      showError(data.message || '登录失败，请检查账号配置。')
    } catch (error) {
      showError('无法连接服务，请检查网络后重试。')
    }
    submit.disabled = false
    submit.removeAttribute('data-state')
  })
})()
</script>
</body></html>`)
}

// ===== 管理后台 =====

export async function renderAdminPage(c: Context<{ Bindings: Env }>) {
  const providers = await getProviders(c.env)
  const proxyKeys = await getProxyKeys(c.env)
  const enabledProvidersCount = providers.filter((provider) => provider.enabled).length
  const modelsCount = providers.reduce((total, provider) => total + provider.models.length, 0)
  const enabledModelsCount = providers.reduce((total, provider) => total + provider.models.filter((model) => model.enabled).length, 0)
  const enabledProxyKeysCount = proxyKeys.filter((key) => key.enabled).length
  // Antigravity 渠道与账号数（用于侧边栏角标，以及额度页默认先列出账号）
  const agChannels = providers
    .filter((provider) => (provider.type || '') === 'antigravity' && provider.enabled)
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      accountCount: provider.apiKeys.filter((key) => key.enabled && key.key && key.key.trim()).length,
    }))
  const agAccountCount = agChannels.reduce((total, ch) => total + ch.accountCount, 0)
  // 动态识别当前实际存储（D1 → KV → Blob → 内存）
  const storageLabel = storageTypeLabel(c.env)

  return c.html(`<!DOCTYPE html><html lang="zh-CN">
${H('管理')}
<body class="site-page admin-page">
<div class="admin-shell">
  <aside class="admin-rail" aria-label="控制台导航">
    <div class="admin-rail__head">
      <a class="brand admin-rail__brand" href="/">
        <span class="brand__mark" aria-hidden="true"><i class="fas fa-cloud"></i></span>
        <span><strong>${SITE_CONFIG.title}</strong><small>CONTROL PANEL</small></span>
      </a>
    </div>
    <nav class="admin-nav">
      <a class="admin-nav__link is-active" href="#overview"><i class="fas fa-chart-pie" aria-hidden="true"></i><span>概览</span></a>
      <a class="admin-nav__link" href="#providers"><i class="fas fa-server" aria-hidden="true"></i><span>渠道</span><b>${providers.length}</b></a>
      <a class="admin-nav__link" href="#quota"><i class="fas fa-gauge-high" aria-hidden="true"></i><span>额度</span><b>${agAccountCount}</b></a>
      <a class="admin-nav__link" href="#proxy-keys"><i class="fas fa-key" aria-hidden="true"></i><span>令牌</span><b>${proxyKeys.length}</b></a>
      <a class="admin-nav__link" href="#usage"><i class="fas fa-chart-line" aria-hidden="true"></i><span>用量</span></a>
      <a class="admin-nav__link" href="#backup"><i class="fas fa-database" aria-hidden="true"></i><span>备份</span></a>
    </nav>
    <div class="admin-rail__foot">
      <button class="admin-nav__link rail-toggle" type="button" onclick="toggleRail()" title="收缩侧边栏" aria-label="收缩/展开侧边栏"><i class="fas fa-angles-left" aria-hidden="true"></i><span>收缩侧边栏</span></button>
      <a href="/" class="admin-nav__link"><i class="fas fa-arrow-left" aria-hidden="true"></i><span>返回首页</span></a>
      <a href="/admin/logout" class="admin-nav__link"><i class="fas fa-sign-out-alt" aria-hidden="true"></i><span>退出登录</span></a>
    </div>
  </aside>

  <div class="admin-main">
    <header class="admin-topbar">
      <a class="brand" href="/"><span class="brand__mark" aria-hidden="true"><i class="fas fa-cloud"></i></span><span class="brand__name">${SITE_CONFIG.title}</span></a>
      <nav aria-label="移动端控制台导航"><a href="#overview">概览</a><a href="#providers">渠道</a><a href="#quota">额度</a><a href="#proxy-keys">令牌</a><a href="#usage">用量</a><a href="#backup">备份</a></nav>
      <a class="icon-btn" href="/admin/logout" aria-label="退出登录"><i class="fas fa-sign-out-alt" aria-hidden="true"></i></a>
    </header>

    <main class="admin-content">
      <div id="toast" class="hd toast" role="status" aria-live="polite"></div>

      <section id="overview" class="admin-overview" aria-labelledby="admin-title">
        <div class="admin-heading">
          <div><p class="eyebrow"><span aria-hidden="true"></span>GATEWAY STATUS</p><h1 id="admin-title">管理控制台</h1><p>配置渠道、模型与客户端访问凭据。变更将写入 ${storageLabel}。</p></div>
          <div class="admin-heading__actions"><a href="/" class="btn btn-s"><i class="fas fa-external-link-alt" aria-hidden="true"></i>查看模型列表</a></div>
        </div>
        <div class="admin-metrics" aria-label="配置统计">
          <div onclick="location.hash='#providers'" style="cursor:pointer" title="点击管理渠道"><span>${providers.length}</span><p>渠道</p><small>${enabledProvidersCount} 个已启用</small></div>
          <div onclick="location.hash='#providers'" style="cursor:pointer" title="点击管理模型"><span>${modelsCount}</span><p>模型</p><small>${enabledModelsCount} 个可用</small></div>
          <div onclick="location.hash='#proxy-keys'" style="cursor:pointer" title="点击管理令牌"><span>${proxyKeys.length}</span><p>令牌</p><small>${enabledProxyKeysCount} 个可用</small></div>
          <div onclick="location.hash='#usage'" style="cursor:pointer" title="点击查看用量"><span class="status-dot status-dot--online"><i aria-hidden="true"></i>已配置</span><p>存储</p><small>${storageLabel}</small></div>
        </div>
      </section>

      <section id="providers" class="workspace-section" aria-labelledby="providers-title">
        <div class="section-heading section-heading--admin">
          <div><h2 id="providers-title">渠道</h2><p>管理上游地址、协议、API Key 和模型。</p></div>
          <button class="btn btn-p" onclick="showAdd()"><i class="fas fa-plus" aria-hidden="true"></i>添加渠道</button>
        </div>

        <div class="af-w">
          <div id="af" class="hd add-form-panel">
            <div class="panel-heading"><div><span class="panel-heading__mark"><i class="fas fa-plus" aria-hidden="true"></i></span><div><h3>添加新渠道</h3><p>先配置基本信息，再测试 Key 与模型连接。</p></div></div><button class="icon-btn" type="button" onclick="hideAdd()" aria-label="关闭添加表单"><i class="fas fa-times" aria-hidden="true"></i></button></div>
            <div class="fr">
              <div class="fg"><label for="anm">名称</label><input type="text" id="anm" placeholder="DeepSeek"></div>
              <div class="fg"><label for="aid">渠道 ID</label><input type="text" id="aid" placeholder="deepseek"><span class="form-helper">用于模型前缀，创建后不可修改。</span></div>
            </div>
            <div class="fg"><label for="aurl">API 地址</label><input type="url" id="aurl" placeholder="https://api.deepseek.com"></div>
            <div class="fg" data-hide-ag><label for="amirror">镜像地址</label><textarea id="amirror" rows="3" placeholder="https://opencode.ai.cmliussss.net/zen/v1&#10;每行一个, 留空使用 OPENCODE_MIRRORS_URL 环境变量"></textarea><span class="form-helper">官方地址失败后自动故障转移到的镜像地址，每行一个 URL。</span></div>
            <div class="fg"><label for="apt">渠道类型</label><select id="apt" class="select-sm" onchange="onTypeChange(this, 'new')"><option value="openai">OpenAI 兼容</option><option value="anthropic">Anthropic 兼容</option><option value="openai-video">OpenAI 视频</option><option value="agnes-video">Agnes 异步视频</option><option value="azure-tts">Azure TTS 语音</option><option value="antigravity">Antigravity 反代</option><option value="claude">Claude OAuth 反代</option><option value="codex">ChatGPT (Codex) 反代</option><option value="kimi">Kimi OAuth 反代</option><option value="grok">Grok OAuth 反代</option><option value="qwen">Qwen OAuth 反代</option><option value="deepseek">DeepSeek 反代</option><option value="vertex">Vertex AI 反代</option><option value="devin">Devin 反代</option><option value="zai">Z.AI (GLM 国际)</option></select><span class="form-helper" id="apt-hint-new">Agnes 等聚合平台建议选 OpenAI 兼容, 视频模型自动走异步适配。</span></div>
            <div class="ag-config" id="ag-new" style="display:none"><div class="fg"><label>获取 refresh_token</label><button class="btn btn-s" type="button" onclick="antigravityOAuth('new')"><i class="fas fa-key" aria-hidden="true"></i>用 Google 账号授权</button><span class="form-helper">点开授权：Google 登录并同意后浏览器会跳到 localhost:51121 提示「无法访问」（正常），把地址栏 code= 后面那段粘回弹窗，网关自动换取 refresh_token 并填入下方 API Keys。</span></div><div class="fg"><label>可用模型</label><button class="btn btn-s" type="button" onclick="fetchAgModels('new')"><i class="fas fa-download" aria-hidden="true"></i>获取模型列表</button><span class="form-helper">用 refresh_token 拉取 Antigravity 可用模型名，追加到下方模型列表。</span></div>
            <div class="ag-config" id="ds-new" style="display:none"><div class="fg"><label>获取 userToken</label><span class="form-helper">两种凭据：① <b>官方 API Key</b>（<code>sk-</code> 开头）→ 直连 api.deepseek.com，免费版可用；② <b>网页 userToken</b>（登录 chat.deepseek.com → F12 → Application → Local Storage → <code>userToken</code>，JWT 约 24h）→ 网页反代，需 Workers Paid（PoW 约 0.3~0.7s CPU，免费版 10ms 上限会失败）。填入下方 API Keys。</span></div><div class="fg"><label>校验凭据</label><button class="btn btn-s" type="button" onclick="verifyDeepseek('new')"><i class="fas fa-plug" aria-hidden="true"></i>验证 userToken</button></div></div>
            <div class="ag-config" id="oa-new" style="display:none"><div class="fg"><label>获取凭据</label><button class="btn btn-s" type="button" onclick="oauthChannel('new')"><i class="fas fa-key" aria-hidden="true"></i>授权登录获取 refresh_token</button><span class="form-helper">Claude/ChatGPT 跳转官方授权页（回调到 localhost 属正常，复制地址栏 code）；Kimi/Grok 弹出设备码验证页并自动等待授权。</span></div><div class="fg"><label>可用模型</label><button class="btn btn-s" type="button" onclick="fetchOAuthModels('new')"><i class="fas fa-download" aria-hidden="true"></i>获取模型列表</button><span class="form-helper">Claude/Kimi 支持自动拉取模型；Codex/Grok 请手动填写（如 gpt-5.5、grok-4.6）。</span></div></div>
            <div class="tts-config" id="tts-new" style="display:none"><fieldset class="form-group"><legend>Azure TTS 音色配置（请求体可临时覆盖）</legend><div class="fr"><div class="fg"><label>音色 Voice</label><div class="tts-voice-row"><select id="av" class="select-sm"><option value="">自定义…</option>${AZURE_VOICE_OPTIONS}</select><button class="btn btn-s" type="button" onclick="previewTts('new')" title="试听当前音色"><i class="fas fa-play" aria-hidden="true"></i>试听</button></div></div><div class="fg"><label>语速 Rate</label><input type="text" id="ar" value="+0%" placeholder="+0%"></div></div><div class="fr"><div class="fg"><label>音量 Volume</label><input type="text" id="avol" value="+0%" placeholder="+0%"></div><div class="fg"><label>音调 Pitch</label><input type="text" id="ap" value="+0Hz" placeholder="+0Hz"></div></div><div class="tts-preview" id="ttp-new"></div><button class="btn btn-s" type="button" onclick="addAllTtsModels('new')"><i class="fas fa-microphone" aria-hidden="true"></i>添加全部音色为模型</button></fieldset></div>
            <fieldset class="form-group"><legend>上游 API Keys</legend><div id="akeys"><div class="fc mb-4 field-row"><input type="text" placeholder="sk-xxx" class="fx1 aki" aria-label="上游 API Key"><label class="tg" title="启用 Key"><input type="checkbox" checked class="ake" aria-label="启用 Key"><span class="sl"></span></label><button class="icon-btn" onclick="copyRowVal(this)" title="复制 Key" aria-label="复制 Key"><i class="far fa-copy" aria-hidden="true"></i></button><button class="icon-btn" onclick="testNewAKey(this)" title="测试 Key" aria-label="测试 Key"><i class="fas fa-plug" aria-hidden="true"></i></button><button class="icon-btn" onclick="this.parentElement.remove()" title="移除 Key" aria-label="移除 Key"><i class="fas fa-times" aria-hidden="true"></i></button></div></div><div class="fc" style="gap:8px;flex-wrap:wrap"><button class="btn btn-s" onclick="addAKeyRow()"><i class="fas fa-plus" aria-hidden="true"></i>添加 Key</button><button class="btn btn-s" onclick="batchAddKeys()"><i class="fas fa-list" aria-hidden="true"></i>批量添加</button><button class="btn btn-s" onclick="batchTestKeys()"><i class="fas fa-plug" aria-hidden="true"></i>批量测试</button></div></fieldset>
            <aside id="amc" class="hd mdl-list-panel"><div class="panel-heading"><div><span class="panel-heading__mark"><i class="fas fa-cube" aria-hidden="true"></i></span><div><h3>可用模型</h3><p>点击“+”添加到配置。</p></div></div><button class="icon-btn" type="button" onclick="hideMdlPanel('amc')" title="关闭可用模型" aria-label="关闭可用模型"><i class="fas fa-times" aria-hidden="true"></i></button></div><div id="amcl"></div></aside>
            <div class="fc" data-hide-ag style="gap:8px;margin-block-end:var(--space-sm)"><button class="btn btn-s" type="button" onclick="fetchNewModels(true)"><i class="fas fa-gift" aria-hidden="true"></i>获取免费模型</button><button class="btn btn-s" type="button" onclick="fetchNewModels(false)"><i class="fas fa-download" aria-hidden="true"></i>获取全部模型</button></div>
            <fieldset class="form-group"><legend>模型 ID</legend><div id="amodels"><div class="fc mb-4 field-row"><input type="text" placeholder="deepseek-chat" class="fx1 ami" aria-label="模型 ID"><input type="text" placeholder="对外名(可选)" class="fx1 amal" aria-label="对外名" title="对外显示名, 留空自动去:free后缀"><label class="tg" title="启用模型"><input type="checkbox" checked class="ame" aria-label="启用模型"><span class="sl"></span></label><button class="icon-btn" onclick="copyRowVal(this)" title="复制模型 ID" aria-label="复制模型 ID"><i class="far fa-copy" aria-hidden="true"></i></button><button class="icon-btn" onclick="testNewMdl(this)" title="测试模型" aria-label="测试模型"><i class="fas fa-plug" aria-hidden="true"></i></button><button class="icon-btn" onclick="this.parentElement.remove()" title="移除模型" aria-label="移除模型"><i class="fas fa-times" aria-hidden="true"></i></button></div></div><button class="btn btn-s" onclick="addMdlRow()"><i class="fas fa-plus" aria-hidden="true"></i>添加模型</button></fieldset>
            <div class="panel-actions"><label class="switch-label"><span>创建后立即启用</span><span class="tg"><input type="checkbox" checked id="aen"><span class="sl"></span></span></label><div><button class="btn btn-s" onclick="hideAdd()">取消</button><button class="btn btn-p" onclick="createProv()"><i class="fas fa-check" aria-hidden="true"></i>创建渠道</button></div></div>
            <div id="atestR" class="mt-1" aria-live="polite"></div>
          </div><div class="vx-config" id="vx-new" style="display:none"><div class="fg"><label>服务账号 JSON</label><textarea id="vxs" rows="4" class="fx1" placeholder='{"type":"service_account","project_id":"my-project","private_key":"-----BEGIN PRIVATE KEY-----\n...","client_email":"svc@my-project.iam.gserviceaccount.com"}'></textarea><span class="form-helper">GCP 控制台 → IAM 与管理 → 服务账号 → 密钥 → 新建 JSON 密钥，整段粘贴（回车换行没问题）；多个账号之间空一行即轮流使用。Express 模式的 API Key 在通用端点会被 Google 拒绝，建议用服务账号。</span></div><div class="fr"><div class="fg"><label>区域 Location</label><input type="text" id="vxl" placeholder="us-central1"></div><div class="fg"><label>校验凭据</label><button class="btn btn-s" type="button" onclick="verifyVertex('new')"><i class="fas fa-plug" aria-hidden="true"></i>验证</button></div></div></div><div class="dv-config" id="dv-new" style="display:none"><div class="fg"><label>凭据</label><button class="btn btn-s" type="button" onclick="devinOAuth('new')"><i class="fas fa-key" aria-hidden="true"></i>用 Devin 账号授权</button><span class="form-helper">点开授权页后用 Devin 账号登录，页面会直接给出授权码，复制回来粘贴即可自动填入下方凭据；也可手动填已有的 session token（每行一个，多个凭据轮流使用）。</span></div><div class="fg"><label>Session Token</label><textarea id="dvt" rows="3" class="fx1" placeholder="devin-session-token$...（每行一个，可多账号轮换）"></textarea><span class="form-helper">保存时以本框内容作为渠道凭据；多个之间换行分隔。</span></div><div class="fg"><label>校验凭据</label><button class="btn btn-s" type="button" onclick="verifyDevin('new')"><i class="fas fa-plug" aria-hidden="true"></i>验证</button></div></div>
            
            
        </div>

        <div class="gp provider-list" id="plist">
          ${providers.length ? providers.map(p=>`
          <article class="pi" data-id="${escapePageHtml(p.id)}">
            <div class="ps" onclick="tog('${p.id}')" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();tog('${p.id}')}" aria-controls="dt-${escapePageHtml(p.id)}">
              <div class="l"><i class="fas fa-chevron-right provider-chevron" aria-hidden="true" id="ch-${escapePageHtml(p.id)}"></i><span class="provider-avatar" aria-hidden="true">${escapePageHtml(p.name.charAt(0).toUpperCase() || 'A')}</span><div><h3>${escapePageHtml(p.name)}</h3><div class="pu"><code>${escapePageHtml(p.id)}</code><span>${p.type==='antigravity'?'Antigravity':p.type==='claude'?'Claude':p.type==='codex'?'Codex':p.type==='kimi'?'Kimi':p.type==='grok'?'Grok':p.type==='qwen'?'Qwen':p.type==='deepseek'?'DeepSeek':p.type==='vertex'?'Vertex':p.type==='devin'?'Devin':p.type==='zai'?'Z.AI':(p.apiType||'openai')==='anthropic'?'Anthropic':'OpenAI'}</span><span>${p.apiKeys.length} Keys</span><span>${p.models.length} 模型</span></div></div></div>
              <div class="fc fx-s0" onclick="event.stopPropagation()"><label class="tg"><input type="checkbox" ${p.enabled?'checked':''} id="en-${escapePageHtml(p.id)}" onchange="togglePb('${p.id}',this.checked)" aria-label="启用 ${escapePageHtml(p.name)}"><span class="sl"></span></label><span class="bd ${p.enabled?'bd-on':'bd-off'}">${p.enabled?'已启用':'未启用'}</span></div>
            </div>
            <div class="pd" id="dt-${escapePageHtml(p.id)}">
              <div class="detail-heading"><div><h3>编辑 ${escapePageHtml(p.name)}</h3><p>保存后，新配置会用于后续转发请求。</p></div><span class="protocol-chip">${p.type==='antigravity'?'ANTIGRAVITY':p.type==='claude'?'CLAUDE':p.type==='codex'?'CODEX':p.type==='kimi'?'KIMI':p.type==='grok'?'GROK':p.type==='qwen'?'QWEN':p.type==='deepseek'?'DEEPSEEK':p.type==='vertex'?'VERTEX':p.type==='devin'?'DEVIN':p.type==='zai'?'Z.AI':(p.apiType||'openai')==='anthropic'?'ANTHROPIC':'OPENAI'}</span></div>
              <div class="fr"><div class="fg"><label>名称</label><input type="text" id="nm-${escapePageHtml(p.id)}" value="${escapePageHtml(p.name)}"></div><div class="fg"><label>ID</label><input type="text" id="pid-${escapePageHtml(p.id)}" value="${escapePageHtml(p.id)}" title="渠道唯一标识, 修改后旧 ID 失效"></div></div>
              <div class="fg"><label>API 地址</label><input type="url" id="url-${escapePageHtml(p.id)}" value="${escapePageHtml(p.baseUrl)}" ${(p.type||'openai')==='azure-tts'?'disabled placeholder="Azure TTS 为内置服务，无需 API 地址"':''}></div>
              <div class="fr"><div class="fg"><label>渠道类型</label><select id="pt-${escapePageHtml(p.id)}" class="select-sm" onchange="onTypeChange(this, '${escapePageHtml(p.id)}')"><option value="openai" ${(p.type||'openai')==='openai'?'selected':''}>OpenAI 兼容</option><option value="anthropic" ${p.type==='anthropic'?'selected':''}>Anthropic 兼容</option><option value="openai-video" ${p.type==='openai-video'?'selected':''}>OpenAI 视频</option><option value="agnes-video" ${p.type==='agnes-video'?'selected':''}>Agnes 异步视频</option><option value="azure-tts" ${p.type==='azure-tts'?'selected':''}>Azure TTS 语音</option><option value="antigravity" ${p.type==='antigravity'?'selected':''}>Antigravity 反代</option><option value="claude" ${p.type==='claude'?'selected':''}>Claude OAuth 反代</option><option value="codex" ${p.type==='codex'?'selected':''}>ChatGPT (Codex) 反代</option><option value="kimi" ${p.type==='kimi'?'selected':''}>Kimi OAuth 反代</option><option value="grok" ${p.type==='grok'?'selected':''}>Grok OAuth 反代</option><option value="qwen" ${p.type==='qwen'?'selected':''}>Qwen OAuth 反代</option><option value="deepseek" ${p.type==='deepseek'?'selected':''}>DeepSeek 反代</option><option value="vertex" ${p.type==='vertex'?'selected':''}>Vertex AI 反代</option><option value="devin" ${p.type==='devin'?'selected':''}>Devin 反代</option><option value="zai" ${p.type==='zai'?'selected':''}>Z.AI (GLM 国际)</option></select></div></div>
              <div class="ag-config" id="ag-${escapePageHtml(p.id)}" ${p.type==='antigravity'?'':'style="display:none"'}><div class="fg"><label>获取 refresh_token</label><button class="btn btn-s" type="button" onclick="antigravityOAuth('${escapePageHtml(p.id)}')"><i class="fas fa-key" aria-hidden="true"></i>用 Google 账号授权</button><span class="form-helper">授权后浏览器跳转 localhost:51121 显示「无法访问」属正常，复制地址栏 code= 后面那一段回来，refresh_token 会自动追加到下方 API Keys。</span></div><div class="fg"><label>可用模型</label><button class="btn btn-s" type="button" onclick="fetchAgModels('${escapePageHtml(p.id)}')"><i class="fas fa-download" aria-hidden="true"></i>获取模型列表</button></div></div><div class="vx-config" id="vx-${escapePageHtml(p.id)}" style="display:none"><div class="fg"><label>服务账号 JSON</label><textarea id="vxs-${escapePageHtml(p.id)}" rows="4" class="fx1">${escapePageHtml((p.apiKeys||[]).map(k=>k.key).join('\n\n'))}</textarea><span class="form-helper">保存时以本框内容为准（多个账号空行分隔）；也可填 Express API Key。</span></div><div class="fr"><div class="fg"><label>区域 Location</label><input type="text" id="vxl-${escapePageHtml(p.id)}" value="${escapePageHtml(p.location||'')}" placeholder="us-central1"></div><div class="fg"><label>校验凭据</label><button class="btn btn-s" type="button" onclick="verifyVertex('${escapePageHtml(p.id)}')"><i class="fas fa-plug" aria-hidden="true"></i>验证</button></div></div></div><div class="dv-config" id="dv-${escapePageHtml(p.id)}" style="display:none"><div class="fg"><label>凭据</label><button class="btn btn-s" type="button" onclick="devinOAuth('${escapePageHtml(p.id)}')"><i class="fas fa-key" aria-hidden="true"></i>用 Devin 账号授权</button><span class="form-helper">授权成功会自动把 session token 追加到下方凭据框。</span></div><div class="fg"><label>Session Token</label><textarea id="dvt-${escapePageHtml(p.id)}" rows="3" class="fx1">${escapePageHtml((p.apiKeys||[]).map(k=>k.key).join('\n'))}</textarea><span class="form-helper">保存时以本框内容为准（每行一个 session token）。</span></div><div class="fg"><label>校验凭据</label><button class="btn btn-s" type="button" onclick="verifyDevin('${escapePageHtml(p.id)}')"><i class="fas fa-plug" aria-hidden="true"></i>验证</button></div></div>
            
            
              <div class="ag-config" id="ds-${escapePageHtml(p.id)}" ${p.type==='deepseek'?'':'style="display:none"'}><div class="fg"><label>获取 userToken</label><span class="form-helper">两种凭据：① <b>官方 API Key</b>（<code>sk-</code> 开头）→ 直连 api.deepseek.com，免费版可用；② <b>网页 userToken</b>（chat.deepseek.com 的 localStorage.userToken，JWT 约 24h）→ 网页反代，需 Workers Paid（PoW 约 0.3~0.7s CPU）。填入下方 API Keys。</span></div><div class="fg"><label>校验凭据</label><button class="btn btn-s" type="button" onclick="verifyDeepseek('${escapePageHtml(p.id)}')"><i class="fas fa-plug" aria-hidden="true"></i>验证 userToken</button></div></div>
              <div class="ag-config" id="oa-${escapePageHtml(p.id)}" ${['claude','codex','kimi','grok','qwen'].includes(p.type||'')?'':'style="display:none"'}><div class="fg"><label>获取凭据</label><button class="btn btn-s" type="button" onclick="oauthChannel('${escapePageHtml(p.id)}')"><i class="fas fa-key" aria-hidden="true"></i>授权登录获取 refresh_token</button><span class="form-helper">Claude/ChatGPT 跳转官方授权页（回调到 localhost 属正常，复制地址栏 code）；Kimi/Grok 弹出设备码验证页并自动等待授权。refresh_token 会追加到下方 API Keys。</span></div><div class="fg"><label>可用模型</label><button class="btn btn-s" type="button" onclick="fetchOAuthModels('${escapePageHtml(p.id)}')"><i class="fas fa-download" aria-hidden="true"></i>获取模型列表</button></div></div>
              <div class="tts-config" id="tts-${escapePageHtml(p.id)}" ${(p.type||'openai')==='azure-tts'?'':'style="display:none"'}><fieldset class="form-group"><legend>Azure TTS 音色配置（请求体可临时覆盖）</legend><div class="fr"><div class="fg"><label>音色 Voice</label><div class="tts-voice-row"><select id="pv-${escapePageHtml(p.id)}" class="select-sm"><option value="">自定义…</option>${azureVoiceOptions(p.voice||'zh-CN-XiaoxiaoNeural')}</select><button class="btn btn-s" type="button" onclick="previewTts('${escapePageHtml(p.id)}')" title="试听当前音色"><i class="fas fa-play" aria-hidden="true"></i>试听</button></div></div><div class="fg"><label>语速 Rate</label><input type="text" id="pr-${escapePageHtml(p.id)}" value="${escapePageHtml(p.rate||'+0%')}" placeholder="+0%"></div></div><div class="fr"><div class="fg"><label>音量 Volume</label><input type="text" id="pvol-${escapePageHtml(p.id)}" value="${escapePageHtml(p.volume||'+0%')}" placeholder="+0%"></div><div class="fg"><label>音调 Pitch</label><input type="text" id="pp-${escapePageHtml(p.id)}" value="${escapePageHtml(p.pitch||'+0Hz')}" placeholder="+0Hz"></div></div><div class="tts-preview" id="ttp-${escapePageHtml(p.id)}"></div><div class="fc" style="gap:8px;flex-wrap:wrap"><button class="btn btn-s" type="button" onclick="addTtsModel('${escapePageHtml(p.id)}')" title="把当前选中的音色添加到模型列表"><i class="fas fa-plus" aria-hidden="true"></i>添加模型</button><button class="btn btn-s" type="button" onclick="addAllTtsModels('${escapePageHtml(p.id)}')"><i class="fas fa-microphone" aria-hidden="true"></i>添加全部音色为模型</button></div></fieldset></div>
              <div class="fg" data-hide-ag ${p.type==='antigravity'?'style="display:none"':''}><label>镜像地址</label><textarea id="mir-${escapePageHtml(p.id)}" rows="3" placeholder="每行一个, 留空使用 OPENCODE_MIRRORS_URL 环境变量">${(p.mirrorUrls||[]).map(escapePageHtml).join('\n')}</textarea><span class="form-helper">官方地址失败后自动故障转移到的镜像地址，每行一个 URL。</span></div>
              <fieldset class="form-group"><legend>上游 API Keys</legend><div id="keys-${escapePageHtml(p.id)}">${p.apiKeys.map((k, ki)=>`<div class="fc mb-3 field-row" data-kidx="${ki}"><input type="text" value="${escapePageHtml(k.key)}" class="fx1" id="k-${escapePageHtml(p.id)}-${ki}" placeholder="API Key" aria-label="API Key"><label class="tg"><input type="checkbox" ${k.enabled?'checked':''} id="ken-${escapePageHtml(p.id)}-${ki}" aria-label="启用 Key"><span class="sl"></span></label><button class="icon-btn" onclick="copyRowVal(this)" title="复制 Key" aria-label="复制 Key"><i class="far fa-copy" aria-hidden="true"></i></button><button class="icon-btn" onclick="testKeyRow('${p.id}',${ki})" title="测试 Key" aria-label="测试 Key"><i class="fas fa-plug" aria-hidden="true"></i></button><button class="icon-btn" onclick="rmKeyRow('${p.id}',${ki})" title="移除 Key" aria-label="移除 Key"><i class="fas fa-times" aria-hidden="true"></i></button></div>`).join('')}</div><div class="fc mt-1 field-row"><input type="text" id="nk-${escapePageHtml(p.id)}" placeholder="新的 API Key" class="fx1"><button class="btn btn-s" onclick="addKeyRow('${p.id}')"><i class="fas fa-plus" aria-hidden="true"></i>添加</button></div></fieldset>
              <fieldset class="form-group"><legend>模型</legend><div id="ml-${escapePageHtml(p.id)}">${p.models.map((m,mi)=>`<div class="fc mb-3 field-row" data-idx="${mi}"><input type="text" value="${escapePageHtml(m.id)}" class="fx1" id="mid-${escapePageHtml(p.id)}-${mi}" placeholder="模型 ID" title="上游真实模型 ID"><input type="text" value="${escapePageHtml(m.alias || '')}" class="fx1" id="mal-${escapePageHtml(p.id)}-${mi}" placeholder="对外名(可选)" title="对外显示名, 留空自动去:free后缀"><label class="tg"><input type="checkbox" ${m.enabled?'checked':''} id="men-${escapePageHtml(p.id)}-${mi}" aria-label="启用模型"><span class="sl"></span></label><button class="icon-btn" onclick="copyRowVal(this)" title="复制模型 ID" aria-label="复制模型 ID"><i class="far fa-copy" aria-hidden="true"></i></button><button class="icon-btn" onclick="testMdl('${p.id}','${m.id}',${mi})" title="测试模型" aria-label="测试模型"><i class="fas fa-plug" aria-hidden="true"></i></button><button class="icon-btn" onclick="rmMdl('${p.id}',${mi})" title="移除模型" aria-label="移除模型"><i class="fas fa-times" aria-hidden="true"></i></button></div>`).join('')}</div><div class="fc mt-1 field-row"><input type="text" id="nmid-${escapePageHtml(p.id)}" placeholder="新的模型 ID" class="fx1"><input type="text" id="nmal-${escapePageHtml(p.id)}" placeholder="对外名(可选)" class="fx1"><button class="btn btn-s" onclick="addMdl('${p.id}')"><i class="fas fa-plus" aria-hidden="true"></i>添加</button></div></fieldset>
              <div class="detail-actions"><div id="tr-${escapePageHtml(p.id)}" aria-live="polite"></div><div><button class="btn btn-s" data-hide-ag ${p.type==='antigravity'?'style="display:none"':''} onclick="fetchEditModels('${p.id}', false)"><i class="fas fa-download" aria-hidden="true"></i>获取模型</button><button class="btn btn-s" data-hide-ag ${p.type==='antigravity'?'style="display:none"':''} onclick="fetchEditModels('${p.id}', true)"><i class="fas fa-gift" aria-hidden="true"></i>获取免费模型</button><button class="btn btn-d" onclick="del('${p.id}')"><i class="fas fa-trash" aria-hidden="true"></i>删除</button><button class="btn btn-p" onclick="save('${p.id}')"><i class="fas fa-save" aria-hidden="true"></i>保存更改</button></div></div>
            </div>
          </article>`).join('') : `<div class="empty-state"><i class="fas fa-server" aria-hidden="true"></i><h3>还没有渠道</h3><p>添加第一个上游渠道，配置 API 地址、Key 和模型。</p><button class="btn btn-p" onclick="showAdd()">添加渠道</button></div>`}
        </div>
      </section>

      <section id="quota" class="workspace-section" aria-labelledby="quota-title">
        <div class="section-heading section-heading--admin"><div><h2 id="quota-title">额度</h2><p>Antigravity 各账号的模型剩余额度与重置时间，共 ${agAccountCount} 个账号。</p></div><button class="btn btn-p" onclick="refreshAgAccounts()"><i class="fas fa-sync-alt" aria-hidden="true"></i>刷新账号</button></div>
        <div id="quotaBody" class="quota-grid"><div class="form-helper" style="padding:12px 0;grid-column:1/-1">点右上角「刷新账号」重新读取账号；点账号右侧「查询」获取该账号额度。</div></div>
      </section>

      <section id="proxy-keys" class="workspace-section" aria-labelledby="proxy-keys-title">
        <div class="section-heading section-heading--admin"><div><h2 id="proxy-keys-title">令牌</h2><p>客户端使用这些 Key 访问统一的 <code>/v1</code> 接口。</p></div><button class="btn btn-p" onclick="genKey()"><i class="fas fa-plus" aria-hidden="true"></i>生成令牌</button></div>
        <div class="key-list">
          ${proxyKeys.length===0?'<div class="empty-state"><i class="fas fa-key" aria-hidden="true"></i><h3>暂无令牌</h3><p>生成一个 Key 后，客户端才能访问网关。</p><button class="btn btn-p" onclick="genKey()">生成令牌</button></div>':''}
          ${proxyKeys.map(k=>`<article class="ki" data-id="${escapePageHtml(k.id)}"><div class="key-main"><span class="key-icon" aria-hidden="true"><i class="fas fa-key"></i></span><div><div class="kv"><span id="kv-${escapePageHtml(k.id)}" data-full="${escapePageHtml(k.key)}" data-vis="0">${escapePageHtml(k.key.length>12?k.key.substring(0,8)+'*****'+k.key.substring(k.key.length-4):k.key)}</span><button class="icon-btn" onclick="toggleKeyVis('${k.id}')" title="显示或隐藏" aria-label="显示或隐藏 Key"><i class="far fa-eye" aria-hidden="true"></i></button><button class="icon-btn" onclick='copyText("${escapePageHtml(k.key)}",this)' title="复制" aria-label="复制 Key"><i class="far fa-copy" aria-hidden="true"></i></button><button class="icon-btn" onclick="regenerateKey('${k.id}')" title="重新生成" aria-label="重新生成 Key"><i class="fas fa-sync-alt" aria-hidden="true"></i></button></div><div class="key-meta"><h3>${escapePageHtml(k.name)}</h3><span class="key-meta__sep" aria-hidden="true">-</span><p>创建于 ${new Date(k.createdAt).toLocaleDateString()} · ${k.expiresAt?'有效至 '+new Date(k.expiresAt).toLocaleDateString():'永久有效'}</p></div></div></div><div class="key-actions"><label class="tg"><input type="checkbox" ${k.enabled?'checked':''} onchange="toggleProxyKey('${k.id}',this.checked)" aria-label="启用 ${escapePageHtml(k.name)}"><span class="sl"></span></label><span class="bd ${k.enabled?'bd-on':'bd-off'}">${k.enabled?'已启用':'已禁用'}</span><button class="bd bd-del" onclick="rmKey('${k.id}')"><i class="fas fa-trash" aria-hidden="true"></i>删除</button></div></article>`).join('')}
        </div>
      </section>

      <section id="usage" class="workspace-section" aria-labelledby="usage-title">
        <div class="section-heading section-heading--admin">
          <div><h2 id="usage-title">用量统计</h2><p>聚合统计 Token 消耗与请求分布，数据保留 30 天。</p></div>
          <select id="usage-days" class="select-sm" onchange="loadUsage()" aria-label="时间范围">
            <option value="1" selected>今天</option>
            <option value="7">近 7 天</option>
            <option value="14">近 14 天</option>
            <option value="30">近 30 天</option>
          </select>
        </div>
        <div class="admin-metrics metrics-4" aria-label="用量统计">
          <div><span id="u-req">-</span><p>请求总数</p><small id="u-ok">- 成功</small></div>
          <div><span id="u-in">-</span><p>输入 Tokens</p><small>提示词消耗</small></div>
          <div><span id="u-out">-</span><p>输出 Tokens</p><small>生成消耗</small></div>
          <div><span id="u-lat">-</span><p>平均耗时</p><small>毫秒</small></div>
        </div>
        <div id="u-trend-wrap" class="hd add-form-panel" style="margin-top:16px">
          <div class="panel-heading"><div><span class="panel-heading__mark"><i class="fas fa-chart-bar" aria-hidden="true"></i></span><div><h3>每日请求趋势</h3></div></div></div>
          <div id="u-trend" style="padding:16px"></div>
        </div>
        <div class="rank-grid" style="margin-top:16px">
          <div class="rank-card">
            <div class="panel-heading" style="border:none;padding:0;margin-bottom:10px"><div><span class="panel-heading__mark"><i class="fas fa-cube" aria-hidden="true"></i></span><div><h3>模型排行</h3></div></div></div>
            <div id="u-models"></div>
          </div>
          <div class="rank-card">
            <div class="panel-heading" style="border:none;padding:0;margin-bottom:10px"><div><span class="panel-heading__mark"><i class="fas fa-server" aria-hidden="true"></i></span><div><h3>渠道排行</h3></div></div></div>
            <div id="u-providers"></div>
          </div>
        </div>
      </section>

      <section id="backup" class="workspace-section" aria-labelledby="backup-title">
        <div class="section-heading section-heading--admin">
          <div><h2 id="backup-title">备份与恢复</h2><p>导出/导入全量数据，或备份到 R2 云端快照。覆盖渠道配置、令牌与用量统计。</p></div>
        </div>
        <div class="rank-grid">
          <div class="rank-card" style="display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center">
            <div class="panel-heading" style="border:none;padding:0;margin-bottom:10px;justify-content:center"><div style="flex-direction:column;align-items:center"><span class="panel-heading__mark"><i class="fas fa-download" aria-hidden="true"></i></span><div><h3>导出 / 导入</h3><p>导出完整数据为 JSON 文件，或从文件恢复。</p></div></div></div>
            <div class="fc" style="gap:8px;flex-wrap:wrap;justify-content:center">
              <button class="btn btn-p" onclick="backupExport()"><i class="fas fa-download" aria-hidden="true"></i>导出数据库</button>
              <button class="btn btn-s" onclick="backupImportPick()"><i class="fas fa-upload" aria-hidden="true"></i>导入数据库</button>
            </div>
            <div id="bk-io-result" class="mt-1" aria-live="polite"></div>
          </div>
          <div class="rank-card" style="display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center">
            <div class="panel-heading" style="border:none;padding:0;margin-bottom:10px;justify-content:center"><div style="flex-direction:column;align-items:center"><span class="panel-heading__mark"><i class="fas fa-cloud-upload-alt" aria-hidden="true"></i></span><div><h3>R2 云端备份</h3><p>快照存入 R2 桶(自动保留最新 30 份)。</p></div></div></div>
            <div class="fc" style="gap:8px;flex-wrap:wrap;justify-content:center">
              <button class="btn btn-p" onclick="backupToR2()"><i class="fas fa-cloud-upload-alt" aria-hidden="true"></i>备份到 R2</button>
              <button class="btn btn-s" onclick="backupList()"><i class="fas fa-sync-alt" aria-hidden="true"></i>刷新列表</button>
            </div>
            <div id="bk-r2-result" class="mt-1" aria-live="polite"></div>
          </div>
          <div class="rank-card" >
            <div class="panel-heading" style="border:none;padding:0;margin-bottom:10px"><div><span class="panel-heading__mark"><i class="fas fa-paper-plane" aria-hidden="true"></i></span><div><h3>Telegram 备份</h3><p>通过 Bot 发送备份文件到自己的 Telegram。需先测试通道。</p></div></div></div>
            <div class="fg"><label>Telegram Bot Token</label><input type="password" id="tgToken" class="fx1" placeholder="123456:ABC-DEF..." autocomplete="off"></div>
            <div class="fg"><label>Telegram USER ID</label><input type="text" id="tgChat" class="fx1" placeholder="123456789"></div>
            <div class="fc" style="gap:8px;flex-wrap:wrap;margin-top:8px">
              <button class="btn btn-s" onclick="telegramTest()"><i class="fas fa-paper-plane" aria-hidden="true"></i>测试通道</button>
              <button class="btn btn-p" onclick="backupToTelegram()"><i class="fas fa-arrow-circle-up" aria-hidden="true"></i>备份到 Telegram</button>
            </div>
            <div id="bk-tg-result" class="mt-1" aria-live="polite"></div>
          </div>
        </div>
      </section>
    </main>

    ${renderSiteFooter(SITE_CONFIG.title, getPlatformLabel(c.env, c.req.header('host')))}
  </div>
</div>

<div id="modal" class="modal-o hd" role="presentation" onclick="if(event.target===this)closeM()"><div class="modal" id="mc" role="dialog" aria-modal="true" aria-live="polite"></div></div>

<script>${SHARED_JS}
// copy
function copyText(t, el) {
  const i = el.tagName === 'I' ? el : (el.querySelector('i') || el.parentElement?.querySelector('i'))
  if (!i) { navigator.clipboard.writeText(t).catch(() => {}); return }
  const oc = i.className
  navigator.clipboard.writeText(t).then(() => {
    i.className = 'fas fa-check c-s'
    el.setAttribute('data-state', 'success')
    setTimeout(() => {
      i.className = oc
      el.removeAttribute('data-state')
    }, 1800)
  }).catch(() => {
    el.setAttribute('data-state', 'error')
  })
}

// 从当前行读取实时输入值并复制（Key 行与模型 ID 行共用）
function copyRowVal(btn) {
  const inp = btn.parentElement.querySelector('input[type=text]')
  if (inp) copyText(inp.value, btn)
}

// modal
function showM(h) { document.getElementById('mc').innerHTML = h; document.getElementById('modal').classList.remove('hd') }
function closeM() { document.getElementById('modal').classList.add('hd') }
function cM(msg) {
  return new Promise(r => {
    showM('<h3><i class="fas fa-question-circle c-p"></i> 确认</h3><p>' + msg + '</p><div class="fa"><button class="btn btn-s" onclick="closeM();r(false)">取消</button><button class="btn btn-p" onclick="closeM();r(true)">确定</button></div>')
    window.r = r
  })
}
function pM(msg, def) {
  return new Promise(r => {
    showM('<h3><i class="fas fa-pen c-p"></i> ' + msg + '</h3><div class="fg"><input type="text" id="pv" value="' + (def || '') + '" placeholder="请输入"></div><div class="fa"><button class="btn btn-s" id="pMc">取消</button><button class="btn btn-p" id="pMo">确定</button></div>')
    window.r = r
    const inp = document.getElementById('pv')
    if (inp) {
      inp.focus()
      inp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { closeM(); r(inp.value.trim()) }
      })
    }
    document.getElementById('pMc').addEventListener('click', function() { closeM(); r(null) })
    document.getElementById('pMo').addEventListener('click', function() { closeM(); r(inp.value.trim()) })
  })
}
function aM(msg, t) {
  const i = t === 'success' ? 'fa-check-circle c-s' : 'fa-exclamation-circle c-d'
  showM('<h3><i class="fas ' + i + '"></i> ' + (t === 'success' ? '成功' : '提示') + '</h3><p>' + msg + '</p><div class="fa"><button class="btn btn-p" onclick="closeM()">确定</button></div>')
}

function toast(msg, t) {
  const el = document.getElementById('toast')
  const i = t === 'success' ? 'fa-check-circle' : 'fa-times-circle'
  const cls = t === 'success' ? 'al-s' : 'al-e'
  el.innerHTML = '<div class="al ' + cls + '"><i class="fas ' + i + '"></i> ' + escapeHtml(msg) + '</div>'
  el.classList.remove('hd')
  setTimeout(() => el.classList.add('hd'), 3000)
}

// providers
function tog(id) {
  const d = document.getElementById('dt-' + id), c = document.getElementById('ch-' + id)
  d.classList.toggle('open')
  c.style.transform = d.classList.contains('open') ? 'rotate(90deg)' : ''
}

function showAdd() { document.getElementById('af').classList.remove('hd') }
function hideAdd() { document.getElementById('af').classList.add('hd'); document.getElementById('amc').classList.add('hd') }

// OAuth 反代渠道的默认 API 地址（网关不实际使用该地址转发，仅作展示/兜底）
const OAUTH_DEFAULT_URLS = { claude: 'https://api.anthropic.com', codex: 'https://chatgpt.com/backend-api/codex', kimi: 'https://api.kimi.ai/coding', grok: 'https://cli-chat-proxy.grok.com/v1', qwen: 'https://portal.qwen.ai/v1', deepseek: 'https://chat.deepseek.com', zai: 'https://api.z.ai/api/coding/paas/v4' }
function isOauthType(t) { return ['claude', 'codex', 'kimi', 'grok', 'qwen'].indexOf(t) !== -1 }
function isDeepseekType(t) { return t === 'deepseek' }
function isZaiType(t) { return t === 'zai' }

// 渠道类型切换: azure-tts 显示音色配置, antigravity/OAuth 反代显示授权区; 这些类型都忽略 API 地址
function onTypeChange(sel, id) {
  const isTts = sel.value === 'azure-tts'
  const isAg = sel.value === 'antigravity'
  const isOa = isOauthType(sel.value)
  const ttsBox = document.getElementById('tts-' + id)
  if (ttsBox) ttsBox.style.display = isTts ? '' : 'none'
  const agBox = document.getElementById('ag-' + id)
  if (agBox) agBox.style.display = isAg ? '' : 'none'
  const oaBox = document.getElementById('oa-' + id)
  if (oaBox) oaBox.style.display = isOa ? '' : 'none'
  const isDs = isDeepseekType(sel.value)
  const dsBox = document.getElementById('ds-' + id)
  if (dsBox) dsBox.style.display = isDs ? '' : 'none'
  const vxBox = document.getElementById('vx-' + id)
  if (vxBox) vxBox.style.display = sel.value === 'vertex' ? '' : 'none'
  const dvBox = document.getElementById('dv-' + id)
  if (dvBox) dvBox.style.display = sel.value === 'devin' ? '' : 'none'
  const isZai = isZaiType(sel.value)
  const hint = document.getElementById('apt-hint-' + id)
  if (hint) {
    hint.textContent = sel.value === 'anthropic' ? 'Anthropic 消息协议, 兼容 /v1/messages。'
      : sel.value === 'agnes-video' ? 'Agnes 异步视频任务模式(仅视频端点, 对话/图片请另建 OpenAI 兼容渠道)。'
      : sel.value === 'openai-video' ? '标准 OpenAI 视频端点, 原样透传。'
      : sel.value === 'azure-tts' ? '内置免费语音合成, 无需 API Key。'
      : sel.value === 'antigravity' ? 'Antigravity 反代: 点「用 Google 账号授权」获取 refresh_token, 请求自动翻译成 Gemini 协议。'
      : sel.value === 'claude' ? 'Claude OAuth 反代: 授权登录获取 refresh_token, 请求自动翻译成 Anthropic Messages 协议, 同时兼容 /v1/messages 直连。'
      : sel.value === 'codex' ? 'ChatGPT (Codex) 反代: 授权登录获取 refresh_token, 请求自动翻译成 Responses 协议。'
      : sel.value === 'kimi' ? 'Kimi 反代: 设备码授权获取 refresh_token, OpenAI 兼容直通 (kimi-for-coding)。'
      : sel.value === 'grok' ? 'Grok (xAI) 反代: 设备码授权获取 refresh_token, 请求自动翻译成 Responses 协议。'
      : sel.value === 'qwen' ? 'Qwen 反代: 设备码授权获取 refresh_token, OpenAI 兼容直通 (portal.qwen.ai)。'
      : sel.value === 'deepseek' ? 'DeepSeek 反代: 填官方 API Key(sk-, 直连 api.deepseek.com) 或网页 userToken(PoW, 需 Workers Paid)。'
      : sel.value === 'zai' ? 'Z.AI 预设: 填 z.ai 的 API Key(编码套餐)。/v1/messages 自动走 Anthropic 端点, 其余走 OpenAI 端点。'
      : 'Agnes 等聚合平台建议选 OpenAI 兼容, 视频模型自动走异步适配。'
  }
  // Antigravity / OAuth 反代: 隐藏仅对普通渠道有意义的字段/按钮（镜像地址、OpenAI 式获取模型）
  const hideForOAuth = isAg || isOa || isDs
  const scope = id === 'new' ? document.getElementById('af') : document.getElementById('dt-' + id)
  if (scope) {
    scope.querySelectorAll('[data-hide-ag]').forEach(function (el) { el.style.display = hideForOAuth ? 'none' : '' })
  }
  if (id === 'new') {
    const url = document.getElementById('aurl')
    if (url) {
      url.disabled = isTts || isAg || isOa || isDs
      if (isTts) url.value = ''
      else if (isAg) url.value = 'https://daily-cloudcode-pa.googleapis.com'
      else if (isOa || isDs) url.value = OAUTH_DEFAULT_URLS[sel.value] || 'https://'
      else if (isZai) url.value = OAUTH_DEFAULT_URLS.zai
      else if (!url.value) url.value = 'https://'
    }
  } else {
    const url = document.getElementById('url-' + id)
    if (url) {
      url.disabled = isTts || isAg || isOa || isDs
      if (isAg && !url.value) url.value = 'https://daily-cloudcode-pa.googleapis.com'
      if ((isOa || isDs) && !url.value) url.value = OAUTH_DEFAULT_URLS[sel.value] || 'https://'
      if (isZai && !url.value) url.value = OAUTH_DEFAULT_URLS.zai
      if (isTts && !url.dataset.orig) url.dataset.orig = url.value
    }
  }
}

// 读取当前渠道类型 / 项目 ID（新增态 id='new'，编辑态为渠道 id）
function provType(id) { const el = document.getElementById(id === 'new' ? 'apt' : 'pt-' + id); return el ? el.value : 'openai' }
// 项目 ID 表单已不暴露，保留读取以兼容旧数据（留空则网关自动解析）
function provProject(id) {
  const el = document.getElementById(id === 'new' ? 'agpj' : 'agpj-' + id)
  return el ? el.value.trim() : ''
}
// Vertex 凭据（服务账号 JSON 或 Express API Key，多个之间空行分隔）
function provVertexKeys(id) {
  const el = document.getElementById(id === 'new' ? 'vxs' : 'vxs-' + id)
  if (!el) return null
  const txt = (el.value || '').trim()
  if (!txt) return null
  return txt.split(new RegExp('\\n\\s*\\n')).map(function (s) { return s.trim() }).filter(Boolean)
}
function provVertexLocation(id) {
  const el = document.getElementById(id === 'new' ? 'vxl' : 'vxl-' + id)
  return el ? el.value.trim() : ''
}
// Devin 凭据（session token，每行一个）
function provDevinKeys(id) {
  const el = document.getElementById(id === 'new' ? 'dvt' : 'dvt-' + id)
  if (!el) return null
  const txt = (el.value || '').trim()
  if (!txt) return null
  return txt.split(new RegExp('\\n+')).map(function (s) { return s.trim() }).filter(Boolean)
}
// 校验 Devin 凭据（GET /v3/self）
async function verifyDevin(id) {
  const keys = provDevinKeys(id)
  if (!keys || !keys.length) { toast('请先填写 session token 或完成授权', 'error'); return }
  toast('校验中…', 'success')
  try {
    const r = await fetch('/admin/api/devin/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: keys[0] }) })
    const d = await r.json()
    toast(d.success ? ((d.data && d.data.message) || '凭据有效') : (d.message || '校验失败'), d.success ? 'success' : 'error')
  } catch (e) { toast('校验请求失败', 'error') }
}
// Devin 授权（PKCE 无回调：授权页直接给 code）
async function devinOAuth(id) {
  const w = window.open('', '_blank')
  try {
    const r = await fetch('/admin/api/devin/oauth/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const d = await r.json()
    if (!d.success || !d.data) { if (w) w.close(); toast(d.message || '生成授权链接失败', 'error'); return }
    if (w) w.location.href = d.data.url; else window.open(d.data.url, '_blank')
    showM('<h3><i class="fas fa-key c-p"></i> Devin 授权</h3><p class="form-helper" style="margin-bottom:8px">在打开的 Devin 页面登录并确认授权，页面会直接显示一段授权码（code），复制到下面。</p><div class="fg"><label>授权码 code</label><textarea id="dvcode" rows="3" class="fx1" placeholder="粘贴页面给出的 code"></textarea></div><div class="fa"><button class="btn btn-s" onclick="closeM()">取消</button><button class="btn btn-p" id="dvok">完成授权</button></div>')
    const ok = document.getElementById('dvok')
    ok.onclick = async function () {
      const code = (document.getElementById('dvcode').value || '').trim()
      if (!code) { toast('请粘贴授权码', 'error'); return }
      ok.disabled = true
      try {
        const rr = await fetch('/admin/api/devin/oauth/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code, state: d.data.state }) })
        const dd = await rr.json()
        if (dd.success && dd.data && dd.data.session_token) {
          const el = document.getElementById(id === 'new' ? 'dvt' : 'dvt-' + id)
          if (el) { el.value = (el.value ? el.value.replace(new RegExp('\\\\s*$'), '\\n') : '') + dd.data.session_token }
          closeM()
          toast('授权成功（' + (dd.data.user_name || dd.data.user_id || 'Devin') + '），凭据已填入，保存渠道后生效', 'success')
        } else { ok.disabled = false; toast(dd.message || '授权失败', 'error') }
      } catch (e) { ok.disabled = false; toast('授权请求失败', 'error') }
    }
  } catch (e) { if (w) w.close(); toast('生成授权链接失败', 'error') }
}

// 校验 Vertex 凭据：换 token，并用渠道里的第一个模型试跑一次
async function verifyVertex(id) {
  const keys = provVertexKeys(id)
  if (!keys || !keys.length) { toast('请先填写服务账号 JSON 或 API Key', 'error'); return }
  let model = ''
  const ml = document.getElementById(id === 'new' ? 'amodels' : 'ml-' + id)
  if (ml) {
    const inp = ml.querySelector('.ami') || ml.querySelector('[data-idx] input')
    if (inp) model = inp.value.trim()
  }
  toast('校验中…', 'success')
  try {
    const r = await fetch('/admin/api/vertex/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: keys[0], model: model || undefined, location: provVertexLocation(id) || undefined }) })
    const d = await r.json()
    toast(d.success ? ((d.data && d.data.message) || '凭据有效') : (d.message || '校验失败'), d.success ? 'success' : 'error')
  } catch (e) { toast('校验请求失败', 'error') }
}

// 把授权得到的 refresh_token 追加到「上游 API Keys」列表
function addKeyValue(id, value) {
  if (!value) return
  if (id === 'new') { addAKeyRow(value); return }
  const inp = document.getElementById('nk-' + id)
  if (inp) { inp.value = value; addKeyRow(id) } else { addAKeyRow(value) }
}

// Antigravity 内置 OAuth 授权（loopback 回调，打不开页面属正常，复制地址栏 code）
async function antigravityOAuth(id) {
  const tr = document.getElementById(id === 'new' ? 'atestR' : 'tr-' + id)
  const w = window.open('', '_blank')
  if (tr) showSpinner(tr)
  try {
    const r = await fetch('/admin/api/antigravity/oauth/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const d = await r.json()
    if (!d.success || !d.data) { if (w) w.close(); if (tr) showResult(tr, false, d.message || '生成授权链接失败'); return }
    if (w) w.location.href = d.data.url
    else window.open(d.data.url, '_blank')
    showM('<h3><i class="fas fa-key c-p"></i> Antigravity 授权</h3><p class="form-helper" style="margin-bottom:8px">在打开的 Google 页面登录并同意授权。授权后浏览器会跳转到 <code>localhost:51121</code> 并提示「无法访问」—— 这是正常的，把地址栏 <code>code=</code> 后面那段（或整段地址）复制到下面。</p><div class="fg"><label>code 或回调地址</label><textarea id="agcode" rows="3" class="fx1" placeholder="4/0A... 或 http://localhost:51121/oauth-callback?code=..."></textarea></div><div class="fa"><button class="btn btn-s" onclick="closeM()">取消</button><button class="btn btn-p" id="agok">完成授权</button></div>')
    const agok = document.getElementById('agok')
    agok.onclick = async function () {
      const code = document.getElementById('agcode').value.trim()
      if (!code) { toast('请粘贴 code', 'error'); return }
      agok.disabled = true
      try {
        const rr = await fetch('/admin/api/antigravity/oauth/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code, state: d.data.state }) })
        const dd = await rr.json()
        if (dd.success && dd.data && dd.data.refresh_token) {
          closeM()
          addKeyValue(id, dd.data.refresh_token)
          toast('授权成功，refresh_token 已填入 API Keys，保存渠道后生效', 'success')
          if (tr) showResult(tr, true, '')
        } else {
          toast(dd.message || '换取 token 失败', 'error')
          agok.disabled = false
        }
      } catch (e) { toast('请求失败', 'error'); agok.disabled = false }
    }
  } catch (e) {
    if (w) w.close()
    if (tr) showResult(tr, false, '请求失败')
  }
}

// 拉取 Antigravity 可用模型并追加到模型列表
async function fetchAgModels(id) {
  const tr = document.getElementById(id === 'new' ? 'atestR' : 'tr-' + id)
  let key = ''
  if (id === 'new') {
    const first = document.querySelector('#akeys .aki')
    key = first ? first.value.trim() : ''
  } else {
    const keys = getKeys(id)
    key = keys.length > 0 ? keys[0].key : ''
  }
  if (!key) { toast('请先填写或授权获取 refresh_token', 'error'); return }
  if (tr) showSpinner(tr)
  try {
    const r = await fetch('/admin/api/antigravity/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: key }) })
    const d = await r.json()
    if (!d.success) { if (tr) showResult(tr, false, d.message || '获取失败'); return }
    const models = (d.data && d.data.models) || []
    if (models.length === 0) { if (tr) showResult(tr, false, '未解析到模型名，可手动填写'); return }
    // 去重：已存在的模型不重复添加
    const existing = {}
    const sel = id === 'new' ? '#amodels .ami' : '#ml-' + id + ' [data-idx] input'
    document.querySelectorAll(sel).forEach(function (inp) { if (inp.value.trim()) existing[inp.value.trim()] = 1 })
    const toAdd = models.filter(function (m) { return !existing[m] })
    toAdd.forEach(function (m) { if (id === 'new') addMdlToForm(m); else addMdlToEdit(id, m) })
    toast('已添加 ' + toAdd.length + ' 个模型' + (toAdd.length < models.length ? '（跳过 ' + (models.length - toAdd.length) + ' 个已存在）' : ''), 'success')
    if (tr) showResult(tr, true, '')
  } catch (e) { if (tr) showResult(tr, false, '请求失败') }
}

// =====================================================================
// OAuth 反代渠道授权（claude/codex: 授权链接 + 粘贴 code; kimi/grok: 设备码轮询）
// =====================================================================
async function oauthChannel(id) {
  const provider = provType(id)
  if (!isOauthType(provider)) { toast('当前渠道类型不支持 OAuth 授权', 'error'); return }
  const tr = document.getElementById(id === 'new' ? 'atestR' : 'tr-' + id)
  if (tr) showSpinner(tr)
  try {
    const baseEl = document.getElementById(id === 'new' ? 'aurl' : 'url-' + id)
    const baseUrl = baseEl ? baseEl.value.trim() : ''
    const r = await fetch('/admin/api/oauth/' + provider + '/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: baseUrl }) })
    const d = await r.json()
    if (!d.success || !d.data) { if (tr) showResult(tr, false, d.message || '发起授权失败'); return }
    if (d.data.mode === 'redirect') {
      // claude / codex: 打开官方授权页，回调到 localhost（无法访问属正常），粘贴 code 换 token
      const w = window.open('', '_blank')
      if (w) { try { w.location.href = d.data.url } catch (e) { /* 弹窗被拦截时忽略 */ } }
      else window.open(d.data.url, '_blank')
      const loopback = provider === 'claude' ? 'localhost:54545' : 'localhost:1455'
      const pname = provider === 'claude' ? 'Claude' : 'ChatGPT'
      showM('<h3><i class="fas fa-key c-p"></i> ' + pname + ' 授权</h3><p class="form-helper" style="margin-bottom:8px">在打开的官方页面登录并同意授权。授权后浏览器会跳转到 <code>' + loopback + '</code> 并提示「无法访问」—— 这是正常的，把地址栏 <code>code=</code> 后面那段（或整段地址）复制到下面。</p><div class="fg"><label>code 或回调地址</label><textarea id="oacode" rows="3" class="fx1" placeholder="' + (provider === 'claude' ? 'e2ec2f0a...' : 'eyJ... 或 http://localhost:1455/auth/callback?code=...') + '"></textarea></div><div class="fa"><button class="btn btn-s" onclick="closeM()">取消</button><button class="btn btn-p" id="oaok">完成授权</button></div>')
      const oaok = document.getElementById('oaok')
      oaok.onclick = async function () {
        const code = document.getElementById('oacode').value.trim()
        if (!code) { toast('请粘贴 code', 'error'); return }
        oaok.disabled = true
        try {
          const rr = await fetch('/admin/api/oauth/' + provider + '/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code, state: d.data.state }) })
          const dd = await rr.json()
          if (dd.success && dd.data && dd.data.refresh_token) {
            closeM()
            addKeyValue(id, dd.data.refresh_token)
            toast('授权成功，refresh_token 已填入 API Keys，保存渠道后生效', 'success')
            if (tr) showResult(tr, true, '')
          } else {
            toast(dd.message || '换取 token 失败', 'error')
            oaok.disabled = false
          }
        } catch (e) { toast('请求失败', 'error'); oaok.disabled = false }
      }
    } else {
      // 设备码流程：打开带 user_code 的完整授权链接（缺 user_code 参数时页面会报错），并自动轮询
      const complete = d.data.verification_uri_complete
        || (d.data.verification_uri ? d.data.verification_uri + '?user_code=' + encodeURIComponent(d.data.user_code || '') : '')
      window.open(complete, '_blank')
      const pname = provider === 'kimi' ? 'Kimi' : provider === 'qwen' ? 'Qwen' : 'Grok'
      showM('<h3><i class="fas fa-key c-p"></i> ' + pname + ' 设备码授权</h3>'
        + '<p class="form-helper" style="margin-bottom:8px">已尝试在新窗口打开授权页面（链接已自动带上验证码）。若浏览器拦截了弹窗，请点击下面的按钮打开——<b>必须使用带 user_code 的完整链接</b>，直接打开验证地址会提示「缺少 user_code 参数」。</p>'
        + '<p style="margin:8px 0"><a class="btn btn-p" href="' + escapeHtml(complete) + '" target="_blank" rel="noreferrer"><i class="fas fa-external-link-alt" aria-hidden="true"></i> 打开授权页面</a></p>'
        + '<div class="fg"><label>验证码 User Code（页面要求手动输入时使用）</label><input type="text" class="fx1" value="' + escapeHtml(d.data.user_code || '') + '" readonly onclick="this.select()"></div>'
        + '<div class="fg"><label>完整授权链接（打不开时复制到浏览器）</label><input type="text" class="fx1" value="' + escapeHtml(complete) + '" readonly onclick="this.select()"></div>'
        + '<div id="oadev" class="mu"><i class="fas fa-spinner fa-spin"></i> 等待授权确认...</div>'
        + '<div class="fa"><button class="btn btn-s" onclick="closeM()">取消</button></div>')
      pollDeviceFlow(provider, d.data.state, id, tr, document.getElementById('oadev'))
    }
  } catch (e) {
    if (tr) showResult(tr, false, '请求失败')
  }
}

// 设备码授权轮询（弹窗关闭后自动停止）
async function pollDeviceFlow(provider, state, id, tr, boxEl) {
  const intervalMs = 5000
  // 绑定本次弹窗节点: 若该节点已被新弹窗替换(再次点击授权), 旧流程立即退出, 避免把过期错误写进新弹窗
  const box = boxEl || document.getElementById('oadev')
  for (;;) {
    await new Promise(function (res) { setTimeout(res, intervalMs) })
    if (!box || !document.body.contains(box)) return
    try {
      const r = await fetch('/admin/api/oauth/' + provider + '/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: state }) })
      const d = await r.json()
      if (!d.success || !d.data) {
        box.innerHTML = '<span class="c-e">' + escapeHtml(d.message || '轮询失败') + '</span>'
        return
      }
      if (d.data.status === 'ok') {
        var tok = d.data.refresh_token || d.data.refreshToken
        if (!tok) { box.innerHTML = '<span class="c-e">授权成功但未返回令牌，请重试</span>'; return }
        addKeyValue(id, tok)
        closeM()
        toast('授权成功，refresh_token 已填入 API Keys，保存渠道后生效', 'success')
        if (tr) showResult(tr, true, '')
        return
      }
      if (d.data.status === 'error') {
        box.innerHTML = '<span class="c-e">' + escapeHtml(d.data.message || '授权失败') + '</span>'
        return
      }
    } catch (e) {
    }
  }
}

// DeepSeek: 用当前填写的 userToken 校验凭据有效性（/users/current）
async function verifyDeepseek(id) {
  const tr = document.getElementById(id === 'new' ? 'atestR' : 'tr-' + id)
  let key = ''
  if (id === 'new') {
    const first = document.querySelector('#akeys .aki')
    key = first ? first.value.trim() : ''
  } else {
    const keys = getKeys(id)
    key = keys.length > 0 ? keys[0].key : ''
  }
  if (!key) { toast('请先填写 userToken', 'error'); return }
  if (tr) showSpinner(tr)
  try {
    const r = await testKeyConnection(OAUTH_DEFAULT_URLS.deepseek, 'openai', key, id, '', false, 'deepseek', '')
    if (tr) showResult(tr, r.success, r.success ? '' : (r.message || '凭据无效'))
    if (!r.success) toast(r.message || '凭据校验失败', 'error')
  } catch (e) { if (tr) showResult(tr, false, '请求失败') }
}

// 拉取 OAuth 渠道可用模型（claude / kimi）并追加到模型列表
async function fetchOAuthModels(id) {
  const provider = provType(id)
  if (!isOauthType(provider) && !isDeepseekType(provider)) { toast('当前渠道类型不支持', 'error'); return }
  const tr = document.getElementById(id === 'new' ? 'atestR' : 'tr-' + id)
  let key = ''
  if (id === 'new') {
    const first = document.querySelector('#akeys .aki')
    key = first ? first.value.trim() : ''
  } else {
    const keys = getKeys(id)
    key = keys.length > 0 ? keys[0].key : ''
  }
  if (!key) { toast('请先填写或授权获取 refresh_token', 'error'); return }
  if (tr) showSpinner(tr)
  try {
    const baseEl2 = document.getElementById(id === 'new' ? 'aurl' : 'url-' + id)
    const netBase = baseEl2 ? baseEl2.value.trim() : ''
    const r = await fetch('/admin/api/oauth/' + provider + '/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: key, baseUrl: netBase }) })
    const d = await r.json()
    if (!d.success || !d.data || !d.data.models || d.data.models.length === 0) {
      if (tr) showResult(tr, false, (d.data && d.data.message) || d.message || '未获取到模型，请手动填写')
      return
    }
    const models = d.data.models
    const existing = {}
    const sel = id === 'new' ? '#amodels .ami' : '#ml-' + id + ' [data-idx] input'
    document.querySelectorAll(sel).forEach(function (inp) { if (inp.value.trim()) existing[inp.value.trim()] = 1 })
    const toAdd = models.filter(function (m) { return !existing[m] })
    toAdd.forEach(function (m) { if (id === 'new') addMdlToForm(m); else addMdlToEdit(id, m) })
    toast('已添加 ' + toAdd.length + ' 个模型' + (toAdd.length < models.length ? '（跳过 ' + (models.length - toAdd.length) + ' 个已存在）' : ''), 'success')
    if (tr) showResult(tr, true, '')
  } catch (e) { if (tr) showResult(tr, false, '请求失败') }
}
// 服务端注入的 Antigravity 渠道/账号清单（不含凭据），用于进入额度页时先列出账号
let AG_CHANNELS = ${JSON.stringify(agChannels).replace(/</g, '\\u003c')}
let quotaReady = false

// 顶部「刷新账号」：重读渠道/账号清单并重新列出账号（不查询额度）
async function refreshAgAccounts() {
  try {
    const r = await fetch('/admin/api/antigravity/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const d = await r.json()
    if (d.success && d.data && Array.isArray(d.data.channels)) {
      AG_CHANNELS = d.data.channels
      const badge = document.querySelector('.admin-nav__link[href="#quota"] b')
      if (badge) badge.textContent = String(AG_CHANNELS.reduce(function (n, c) { return n + (c.accountCount || 0) }, 0))
    }
  } catch (e) { /* 保留现有清单 */ }
  quotaReady = false
  renderQuotaSkeleton()
  toast('账号列表已刷新', 'success')
}

// 进入额度页时（尚未查询过）先列出账号骨架，每条带「查询」按钮
function renderQuotaSkeleton() {
  const box = document.getElementById('quotaBody')
  if (!box) return
  if (!AG_CHANNELS.length) {
    box.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-gauge-high" aria-hidden="true"></i><h3>暂无 Antigravity 渠道</h3><p>添加一个 Antigravity 反代渠道后即可查看额度。</p></div>'
    return
  }
  box.innerHTML = AG_CHANNELS.map(function (ch) {
    const head = '<div class="fc" style="justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h3 style="margin:0">' + escapeHtml(ch.name) + ' <code style="font-size:11px;font-weight:400">' + escapeHtml(ch.id) + '</code></h3></div>'
    let accts = ''
    if (ch.accountCount > 0) {
      for (let i = 0; i < ch.accountCount; i++) {
        accts += '<div class="ag-acct" id="agacct-' + ch.id + '-' + i + '">' + renderAgQuota({ index: i, ok: false, models: [] }, ch.id) + '</div>'
      }
    } else {
      accts = '<div class="form-helper" style="padding:8px 0">该渠道未配置凭据</div>'
    }
    return '<article class="quota-card">' + head + accts + '</article>'
  }).join('')
}

// 额度重置时间格式化：相对「多久后重置」+ 具体本地时间
function fmtResetIn(iso) {
  const t = Date.parse(iso)
  if (isNaN(t)) return ''
  const ms = t - Date.now()
  if (ms <= 0) return '已重置'
  const mins = Math.round(ms / 60000)
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d > 0) return d + '天' + h + '小时后重置'
  if (h > 0) return h + '小时' + m + '分后重置'
  return Math.max(1, m) + '分钟后重置'
}
function fmtResetLocal(iso) {
  const t = Date.parse(iso)
  return isNaN(t) ? '' : new Date(t).toLocaleString()
}

function renderAgQuota(a, chId) {
  const info = '<span class="fc" style="gap:8px;align-items:center;flex-wrap:wrap"><strong>账号 #' + (a.index + 1) + '</strong><span class="form-helper">' + escapeHtml(a.tier || a.tierId || '') + (a.project ? ' · ' + escapeHtml(a.project) : '') + '</span></span>'
  const btn = (chId === undefined || chId === null) ? '' : '<button class="btn btn-s" type="button" data-agq="' + chId + '" data-agi="' + a.index + '"><i class="fas fa-magnifying-glass" aria-hidden="true"></i>查询</button>'
  const head = '<div class="fc" style="justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' + info + btn + '</div>'
  if (!a.ok) {
    const isErr = !!a.error
    const bg = isErr ? 'rgba(220,38,38,.08)' : 'rgba(127,127,127,.08)'
    const msg = isErr
      ? '<div class="al al-e" style="margin-top:4px">' + escapeHtml(a.error) + '</div>'
      : '<div class="form-helper" style="margin-top:4px">未查询，点右侧「查询」获取该账号额度。</div>'
    return '<div style="margin-top:8px;padding:8px 10px;border-radius:8px;background:' + bg + '">' + head + msg + '</div>'
  }
  const rows = (a.models || []).map(function (m) {
    const pct = (m.remaining === null || m.remaining === undefined) ? null : Math.round(m.remaining * 100)
    const color = pct === null ? '#9ca3af' : pct > 50 ? '#16a34a' : pct > 10 ? '#d97706' : '#dc2626'
    const bar = pct === null ? '' : '<span style="display:inline-block;width:80px;height:6px;border-radius:3px;background:rgba(127,127,127,.2);overflow:hidden;vertical-align:middle"><span style="display:block;height:100%;width:' + pct + '%;background:' + color + '"></span></span>'
    const reset = m.resetTime ? '<span class="form-helper" style="font-size:11px;white-space:nowrap" title="' + escapeHtml(fmtResetLocal(m.resetTime)) + '">' + escapeHtml(fmtResetIn(m.resetTime)) + '</span>' : ''
    return '<div class="fc" style="justify-content:space-between;gap:8px;padding:2px 0;font-size:12px"><code style="font-size:11px">' + escapeHtml(m.id) + '</code><span class="fc" style="gap:6px;align-items:center">' + reset + bar + '<span style="min-width:38px;text-align:right">' + (pct === null ? '—' : pct + '%') + '</span></span></div>'
  }).join('')
  return '<div style="margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(127,127,127,.08)">' + head + '<div class="quota-models">' + rows + '</div></div>'
}

// 账号级「查询」：只刷新该渠道该账号的额度
async function agAccountQuery(chId, idx) {
  const el = document.getElementById('agacct-' + chId + '-' + idx)
  if (!el) return
  quotaReady = true
  el.innerHTML = '<div class="form-helper" style="padding:8px 0">查询中…</div>'
  try {
    const r = await fetch('/admin/api/antigravity/quota', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelId: chId, index: idx }) })
    const d = await r.json()
    if (!d.success || !d.data || !d.data.accounts || !d.data.accounts.length) {
      el.innerHTML = '<div class="al al-e">' + escapeHtml(d.message || '查询失败') + '</div>'
      return
    }
    el.innerHTML = renderAgQuota(d.data.accounts[0], chId)
  } catch (e) { el.innerHTML = '<div class="al al-e">请求失败</div>' }
}

// 一键添加全部 Azure TTS 音色为模型 (音色 id 即模型 id, 调用时直接用音色名)
function addAllTtsModels(id) {
  const voices = ${JSON.stringify(AZURE_TTS_VOICES.map((v) => v.id))}
  if (id === 'new') {
    const container = document.getElementById('amodels')
    const existing = new Set(Array.from(container.querySelectorAll('.ami')).map(i => i.value.trim()))
    let added = 0
    voices.forEach(v => {
      if (existing.has(v)) return
      const d = document.createElement('div')
      d.className = 'fc mb-4 field-row'
      d.innerHTML = '<input type="text" class="fx1 ami" value="' + v + '" placeholder="模型 ID"><label class="tg"><input type="checkbox" checked class="ame"><span class="sl"></span></label><button class="icon-btn" onclick="this.parentElement.remove()" title="移除"><i class="fas fa-times" aria-hidden="true"></i></button>'
      container.appendChild(d)
      existing.add(v)
      added++
    })
    toast('已添加 ' + added + ' 个音色模型', added ? 'success' : 'error')
  } else {
    const container = document.getElementById('ml-' + id)
    const existing = new Set(Array.from(container.querySelectorAll('[data-idx] input[id^="mid-"]')).map(i => i.value.trim()))
    let added = 0
    voices.forEach(v => {
      if (existing.has(v)) return
      const idx = container.querySelectorAll('[data-idx]').length
      const d = document.createElement('div')
      d.className = 'fc mb-3 field-row'
      d.dataset.idx = idx
      d.innerHTML = '<input type="text" value="' + v + '" class="fx1" id="mid-' + id + '-' + idx + '" placeholder="模型 ID" title="上游真实模型 ID"><input type="text" value="' + v + '" class="fx1" id="mal-' + id + '-' + idx + '" placeholder="对外名(可选)" title="对外显示名"><label class="tg"><input type="checkbox" checked id="men-' + id + '-' + idx + '" aria-label="启用模型"><span class="sl"></span></label><button class="icon-btn" onclick="copyRowVal(this)" title="复制模型 ID" aria-label="复制模型 ID"><i class="far fa-copy" aria-hidden="true"></i></button><button class="icon-btn" id="tm-' + id + '-' + idx + '" title="测试模型" aria-label="测试模型"><i class="fas fa-plug" aria-hidden="true"></i></button><button class="icon-btn" id="rm-' + id + '-' + idx + '" title="移除模型" aria-label="移除模型"><i class="fas fa-times" aria-hidden="true"></i></button>'
      container.appendChild(d)
      document.getElementById('tm-' + id + '-' + idx).addEventListener('click', function() { testMdl(id, v, idx) })
      document.getElementById('rm-' + id + '-' + idx).addEventListener('click', function() { rmMdl(id, idx) })
      existing.add(v)
      added++
    })
    toast('已添加 ' + added + ' 个音色模型', added ? 'success' : 'error')
  }
}

// 把当前选中的音色添加到模型列表
function addTtsModel(id) {
  const sel = document.getElementById('pv-' + id)
  const v = (sel ? sel.value : '').trim()
  if (!v) { toast('请先选择音色', 'error'); return }
  const container = document.getElementById('ml-' + id)
  const existing = new Set(Array.from(container.querySelectorAll('[data-idx] input[id^="mid-"]')).map(i => i.value.trim()))
  if (existing.has(v)) { toast('该音色已在模型列表中', 'error'); return }
  const idx = container.querySelectorAll('[data-idx]').length
  const d = document.createElement('div')
  d.className = 'fc mb-3 field-row'
  d.dataset.idx = idx
  d.innerHTML = '<input type="text" value="' + v + '" class="fx1" id="mid-' + id + '-' + idx + '" placeholder="模型 ID" title="上游真实模型 ID"><input type="text" value="' + v + '" class="fx1" id="mal-' + id + '-' + idx + '" placeholder="对外名(可选)" title="对外显示名"><label class="tg"><input type="checkbox" checked id="men-' + id + '-' + idx + '" aria-label="启用模型"><span class="sl"></span></label><button class="icon-btn" onclick="copyRowVal(this)" title="复制模型 ID" aria-label="复制模型 ID"><i class="far fa-copy" aria-hidden="true"></i></button><button class="icon-btn" id="tm-' + id + '-' + idx + '" title="测试模型" aria-label="测试模型"><i class="fas fa-plug" aria-hidden="true"></i></button><button class="icon-btn" id="rm-' + id + '-' + idx + '" title="移除模型" aria-label="移除模型"><i class="fas fa-times" aria-hidden="true"></i></button>'
  container.appendChild(d)
  document.getElementById('tm-' + id + '-' + idx).addEventListener('click', function() { testMdl(id, v, idx) })
  document.getElementById('rm-' + id + '-' + idx).addEventListener('click', function() { rmMdl(id, idx) })
  toast('已添加音色: ' + v, 'success')
}

// Azure TTS 音色试听: 用管理员会话调用 /admin/api/tts-preview 合成并播放
async function previewTts(id) {
  const voice = document.getElementById(id === 'new' ? 'av' : 'pv-' + id).value
  if (!voice) { toast('请先选择音色', 'error'); return }
  const box = document.getElementById('ttp-' + id)
  if (!box) return
  box.innerHTML = '<span class="form-helper">合成中…</span>'
  try {
    const r = await fetch('/admin/api/tts-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: id === 'new' ? 'tts' : id, voice }),
    })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      box.innerHTML = '<span class="form-helper" style="color:var(--danger,#e5484d)">试听失败: ' + (d.message || r.status) + '</span>'
      return
    }
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    box.innerHTML = '<audio controls autoplay style="width:100%;margin-block:8px"><source src="' + url + '" type="audio/mpeg"></audio><span class="form-helper">' + voice + '</span>'
  } catch (e) {
    box.innerHTML = '<span class="form-helper" style="color:var(--danger,#e5484d)">试听失败</span>'
  }
}

// aid 输入 opencode 时自动填充 API 地址
document.getElementById('aid').addEventListener('input', function() {
  if (this.value.trim() === 'opencode') {
    document.getElementById('aurl').value = '${OPENCODE_DEFAULT_URL}'
  }
})

// provider api keys (add form)
function addAKeyRow(val) {
  const c = document.getElementById('akeys')
  const d = document.createElement('div')
  d.className = 'fc mb-4 field-row'
  d.innerHTML = '<input type="text" placeholder="sk-xxx" class="fx1 aki" aria-label="上游 API Key" value="' + (val || '') + '"><label class="tg"><input type="checkbox" checked class="ake" aria-label="启用 Key"><span class="sl"></span></label><button class="icon-btn" onclick="copyRowVal(this)" title="复制 Key" aria-label="复制 Key"><i class="far fa-copy"></i></button><button class="icon-btn" onclick="testNewAKey(this)" title="测试 Key" aria-label="测试 Key"><i class="fas fa-plug"></i></button><button class="icon-btn" onclick="this.parentElement.remove()" title="移除 Key" aria-label="移除 Key"><i class="fas fa-times"></i></button>'
  c.appendChild(d)
}

function renderModelGrid(models, editId, providerId) {
  if (providerId === 'opencode') {
    models = (models || []).filter(function(m) {
      return m && typeof m.id === 'string' && /^[A-Za-z0-9._:/-]+$/.test(m.id) && (m.id === 'big-pickle' || m.id.endsWith('-free'))
    })
  }
  if (!models || models.length === 0) return '<span class="mu">未返回模型列表</span>'
  var h = models.map(function(m) {
    var modelId = String(m.id || '')
    var safeId = escapeHtml(modelId)
    var addFn = editId
      ? "addMdlToEdit('" + editId + "','" + modelId + "')"
      : "addMdlToForm('" + modelId + "')"
    return '<div class="mdl-item">' +
      '<i class="fas fa-cube"></i>' +
			'<span class="fx1 cp ov" onclick="copyText(\\'' + modelId + '\\',this)">' + safeId + '</span>' +
      '<button class="btn btn-gh mdl-add-btn" onclick="' + addFn + '" title="添加到表单">+</button></div>'
  }).join('')
  return '<div class="grid-2-gap6">' + h + '</div>'
}

// 可用模型面板 heading（添加态静态 HTML 与编辑态动态生成共用同一结构）
function modelPanelHeading(panelId) {
  return '<div class="panel-heading"><div>' +
    '<span class="panel-heading__mark"><i class="fas fa-cube" aria-hidden="true"></i></span>' +
    '<div><h3>可用模型</h3><p>点击“+”添加到配置。</p></div></div>' +
    '<button class="icon-btn" type="button" onclick="hideMdlPanel(\\'' + panelId + '\\')" title="关闭可用模型" aria-label="关闭可用模型"><i class="fas fa-times" aria-hidden="true"></i></button></div>'
}

// 关闭可用模型面板（仅隐藏，不清空已获取的模型数据）
function hideMdlPanel(panelId) {
  document.getElementById(panelId).classList.add('hd')
}

function testNewAKey(btn) {
  const inp = btn.parentElement.querySelector('.aki'), k = inp.value.trim()
  const providerId = document.getElementById('aid').value.trim()
  if (!k && providerId !== 'opencode') { toast('请输入 API Key', 'error'); return }
  const url = document.getElementById('aurl').value.trim()
  if (!url) { toast('请先填写 API 地址', 'error'); return }
  const apiType = document.getElementById('apt').value === 'anthropic' ? 'anthropic' : 'openai'
  const mirrorUrls = document.getElementById('amirror').value
  const tr = document.getElementById('atestR')
  showSpinner(tr)
  testKeyConnection(url, apiType, k, providerId, mirrorUrls, false, provType('new'), provProject('new')).then(function(result) {
    if (result.success && result.data) {
      document.getElementById('amcl').innerHTML = renderModelGrid(result.data.data || [], null, providerId)
      document.getElementById('amc').classList.remove('hd')
    } else {
      document.getElementById('amc').classList.add('hd')
    }
    showResult(tr, result.success, result.success ? '' : 'HTTP ' + result.status)
  })
}

// 批量添加 API Key: 弹窗粘贴, 一行一个
function batchAddKeys() {
  showM('<h3><i class="fas fa-list c-p"></i> 批量添加 API Key</h3><div class="fg"><label>每行一个 Key</label><textarea id="bkText" rows="8" class="fx1" placeholder="sk-xxx1&#10;sk-xxx2&#10;sk-xxx3" style="font-family:var(--font-mono);font-size:12px"></textarea></div><div class="fa"><button class="btn btn-s" onclick="closeM()">取消</button><button class="btn btn-p" id="bkOk">批量添加</button></div>')
  const ok = document.getElementById('bkOk')
  ok.onclick = function () {
    const text = document.getElementById('bkText').value.trim()
    if (!text) { toast('请粘贴至少一个 Key', 'error'); return }
    const keys = text.split(String.fromCharCode(10)).map(function (s) { return s.trim() }).filter(Boolean)
    // 先填已有空行, 不足再补新行
    let ki = 0
    Array.from(document.querySelectorAll('#akeys .aki')).forEach(function (r) {
      if (ki >= keys.length) return
      if (!r.value.trim()) { r.value = keys[ki]; ki++ }
    })
    while (ki < keys.length) { addAKeyRow(keys[ki]); ki++ }
    closeM()
    toast('已添加 ' + keys.length + ' 个 Key', 'success')
  }
}

// 批量测试所有 Key: 逐个调用, 结果标记到行尾
async function batchTestKeys() {
  const url = document.getElementById('aurl').value.trim()
  if (!url) { toast('请先填写 API 地址', 'error'); return }
  const apiType = document.getElementById('apt').value === 'anthropic' ? 'anthropic' : 'openai'
  const providerId = document.getElementById('aid').value.trim()
  const mirrorUrls = document.getElementById('amirror').value
  const rows = Array.from(document.querySelectorAll('#akeys .field-row'))
  const keys = rows.map(function (r) { return r.querySelector('.aki').value.trim() }).filter(Boolean)
  if (keys.length === 0) { toast('请先添加 API Key', 'error'); return }
  toast('正在批量测试 ' + keys.length + ' 个 Key…', 'info')
  // 每行加状态徽标
  rows.forEach(function (r) { r.querySelectorAll('.key-test-badge').forEach(function (b) { b.remove() }) })
  const badge = function (r, ok, msg) {
    r.querySelectorAll('.key-test-badge').forEach(function (b) { b.remove() })
    const b = document.createElement('span')
    b.className = 'key-test-badge ' + (ok ? 'bd-on' : 'bd-off')
    b.textContent = (ok ? '✓ ' : '✗ ') + (msg || '')
    b.style.cssText = 'font-size:11px;white-space:nowrap'
    r.appendChild(b)
  }
  let okCount = 0
  for (const r of rows) {
    const k = r.querySelector('.aki').value.trim()
    if (!k) continue
    try {
      const result = await testKeyConnection(url, apiType, k, providerId, mirrorUrls, false, provType('new'), provProject('new'))
      if (result.success) { okCount++; badge(r, true, 'OK') }
      else badge(r, false, 'HTTP ' + result.status)
    } catch (e) {
      badge(r, false, 'ERR')
    }
  }
  toast('批量测试完成: ' + okCount + '/' + keys.length + ' 成功', okCount === keys.length ? 'success' : 'error')
}

// 添加表单 — 获取免费/全部模型
async function fetchNewModels(freeOnly) {
  const url = document.getElementById('aurl').value.trim()
  if (!url) { toast('请先填写 API 地址', 'error'); return }
  const akeys = document.querySelectorAll('#akeys .aki')
  const configuredKey = Array.from(akeys).map(function(inp) { return inp.value.trim() }).filter(Boolean)[0] || ''
  const apiType = document.getElementById('apt').value === 'anthropic' ? 'anthropic' : 'openai'
  const providerId = document.getElementById('aid').value.trim()
  const mirrorUrls = document.getElementById('amirror').value
  const tr = document.getElementById('atestR')
  showSpinner(tr)
  try {
    const result = await testKeyConnection(url, apiType, configuredKey, providerId, mirrorUrls, freeOnly, provType('new'), provProject('new'))
    showResult(tr, result.success, result.success ? '' : 'HTTP ' + result.status)
    if (result.success && result.data) {
      const headEl = document.querySelector('#amc .panel-heading h3')
      if (headEl) headEl.textContent = freeOnly ? '免费模型' : '可用模型'
      document.getElementById('amcl').innerHTML = renderModelGrid(result.data.data || [], null, providerId)
      document.getElementById('amc').classList.remove('hd')
    }
  } catch (e) {
    showResult(tr, false, '请求失败')
  }
}

let mdlCount = 1
function addMdlRow() {
  const c = document.getElementById('amodels')
  const d = document.createElement('div')
  d.className = 'fc mb-4 field-row'
  d.innerHTML = '<input type="text" placeholder="deepseek-chat" class="fx1 ami" aria-label="模型 ID" title="上游真实模型 ID"><input type="text" placeholder="对外名(可选)" class="fx1 amal" aria-label="对外名" title="对外显示名, 留空自动去:free后缀"><label class="tg"><input type="checkbox" checked class="ame" aria-label="启用模型"><span class="sl"></span></label><button class="icon-btn" onclick="copyRowVal(this)" title="复制模型 ID" aria-label="复制模型 ID"><i class="far fa-copy"></i></button><button class="icon-btn" onclick="testNewMdl(this)" title="测试模型" aria-label="测试模型"><i class="fas fa-plug"></i></button><button class="icon-btn" onclick="this.parentElement.remove()" title="移除模型" aria-label="移除模型"><i class="fas fa-times"></i></button>'
  c.appendChild(d)
}

function addMdlToForm(mid) {
  const c = document.getElementById('amodels')
  const d = document.createElement('div')
  d.className = 'fc mb-4 field-row'
  d.innerHTML = '<input type="text" value="' + escapeHtml(mid) + '" class="fx1 ami" aria-label="模型 ID" title="上游真实模型 ID"><input type="text" placeholder="对外名(可选)" class="fx1 amal" aria-label="对外名" title="对外显示名, 留空自动去:free后缀"><label class="tg"><input type="checkbox" checked class="ame" aria-label="启用模型"><span class="sl"></span></label><button class="icon-btn" onclick="copyRowVal(this)" title="复制模型 ID" aria-label="复制模型 ID"><i class="far fa-copy"></i></button><button class="icon-btn" onclick="testNewMdl(this)" title="测试模型" aria-label="测试模型"><i class="fas fa-plug"></i></button><button class="icon-btn" onclick="this.parentElement.remove()" title="移除模型" aria-label="移除模型"><i class="fas fa-times"></i></button>'
  c.appendChild(d)
}

function testNewMdl(btn) {
  const inp = btn.parentElement.querySelector('.ami'), mid = inp.value.trim()
  if (!mid) { toast('请输入模型 ID', 'error'); return }
  const url = document.getElementById('aurl').value.trim()
    const akeys = document.querySelectorAll('#akeys .aki')
    const configuredKey = Array.from(akeys).map(function(inp) { return inp.value.trim() }).filter(Boolean)[0] || ''
    const apiType = document.getElementById('apt').value === 'anthropic' ? 'anthropic' : 'openai'
    const mirrorUrls = document.getElementById('amirror').value
    const tr = document.getElementById('atestR')
    showSpinner(tr)
  const providerId = document.getElementById('aid').value.trim()
  const apiKey = configuredKey
  testModelConnection(url, apiType, apiKey, mid, providerId, mirrorUrls, provType('new'), provProject('new')).then(function(result) {
    showResult(tr, result.success, result.success ? '' : 'HTTP ' + result.status)
  })
}

async function createProv() {
  const nm = document.getElementById('anm').value.trim(), id = document.getElementById('aid').value.trim()
  const type = document.getElementById('apt').value
  const apiType = type === 'anthropic' ? 'anthropic' : 'openai'
  const aki = document.querySelectorAll('#akeys .aki')
  let keys = Array.from(aki).map((inp, i) => {
    const k = inp.value.trim()
    const en = inp.parentElement.querySelector('.ake')?.checked ?? true
    return k ? { key: k, enabled: en } : null
  }).filter(Boolean)
  const vxNewKeys = type === 'vertex' ? provVertexKeys('new') : null
  if (vxNewKeys && vxNewKeys.length) keys = vxNewKeys.map(k => ({ key: k, enabled: true }))
  const dvNewKeys = type === 'devin' ? provDevinKeys('new') : null
  if (dvNewKeys && dvNewKeys.length) keys = dvNewKeys.map(k => ({ key: k, enabled: true }))
  const ami = document.querySelectorAll('#amodels .ami')
  const models = Array.from(ami).map(inp => {
    const mid = inp.value.trim()
    const en = inp.parentElement.querySelector('.ame')?.checked ?? true
    const alEl = inp.parentElement.querySelector('.amal')
    const alias = alEl ? alEl.value.trim() : ''
    if (!mid) return null
    return alias ? { id: mid, enabled: en, alias: alias } : { id: mid, enabled: en }
  }).filter(Boolean)
  const enabled = document.getElementById('aen').checked
  const mirrorUrls = document.getElementById('amirror').value
  const isTts = type === 'azure-tts'
  const isAg = type === 'antigravity'
  const isOa = isOauthType(type) || isDeepseekType(type)
  const url = document.getElementById('aurl').value.trim() || (isTts ? 'https://speech.platform.bing.com' : isAg ? 'https://daily-cloudcode-pa.googleapis.com' : type === 'vertex' ? 'https://aiplatform.googleapis.com' : type === 'devin' ? 'https://server.codeium.com' : (isOa || isZaiType(type)) ? OAUTH_DEFAULT_URLS[type] : '')
  if (!nm || !id || !url) { toast('请填写名称、ID 和 API 地址', 'error'); return }
  const ttsConf = isTts ? {
    voice: document.getElementById('av').value.trim() || 'zh-CN-XiaoxiaoNeural',
    rate: document.getElementById('ar').value.trim() || '+0%',
    volume: document.getElementById('avol').value.trim() || '+0%',
    pitch: document.getElementById('ap').value.trim() || '+0Hz',
  } : {}
  const r = await fetch('/admin/api/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name: nm, baseUrl: url, apiType, type, apiKeys: keys, models, mirrorUrls, enabled, project: provProject('new') || undefined, location: provVertexLocation('new') || undefined, ...ttsConf })
  })
  const d = await r.json()
  if (d.success) { toast('已创建', 'success'); location.reload() }
  else toast(d.message || '创建失败', 'error')
}

// provider api keys (edit)
function getKeys(id) {
  const c = document.getElementById('keys-' + id)
  const items = c.querySelectorAll('[data-kidx]')
  return Array.from(items).map(item => {
    const idx = parseInt(item.dataset.kidx)
    const k = document.getElementById('k-' + id + '-' + idx).value.trim()
    const en = document.getElementById('ken-' + id + '-' + idx).checked
    return k ? { key: k, enabled: en } : null
  }).filter(Boolean)
}

function addKeyRow(id) {
  const inp = document.getElementById('nk-' + id), k = inp.value.trim()
  if (!k) { toast('请输入 API Key', 'error'); return }
  const c = document.getElementById('keys-' + id), cnt = c.querySelectorAll('[data-kidx]').length
  const d = document.createElement('div')
  d.className = 'fc mb-3 field-row'
  d.dataset.kidx = cnt
  d.innerHTML = '<input type="text" value="' + k + '" class="fx1" id="k-' + id + '-' + cnt + '" placeholder="API Key"><label class="tg"><input type="checkbox" checked id="ken-' + id + '-' + cnt + '"><span class="sl"></span></label><button class="icon-btn" onclick="copyRowVal(this)" title="复制 Key" aria-label="复制 Key"><i class="far fa-copy"></i></button><button class="icon-btn" onclick="testKeyRow(\\'' + id + '\\',' + cnt + ')" title="测试 Key" aria-label="测试 Key"><i class="fas fa-plug"></i></button><button class="icon-btn" onclick="rmKeyRow(\\'' + id + '\\',' + cnt + ')" title="移除 Key" aria-label="移除 Key"><i class="fas fa-times"></i></button>'
  c.appendChild(d)
  inp.value = ''
  inp.focus()
}

function rmKeyRow(id, idx) {
  const c = document.getElementById('keys-' + id)
  c.querySelectorAll('[data-kidx]').forEach(item => {
    if (parseInt(item.dataset.kidx) === idx) item.remove()
  })
}

async function testKeyRow(id, idx) {
  const k = document.getElementById('k-' + id + '-' + idx).value.trim()
  const url = document.getElementById('url-' + id).value.trim()
  if (!k) { toast('请输入 API Key', 'error'); return }
  const ptEl = document.getElementById('pt-' + id)
  const apiType = (ptEl ? ptEl.value : 'openai') === 'anthropic' ? 'anthropic' : 'openai'
  const mirEl = document.getElementById('mir-' + id)
  const mirrorUrls = mirEl ? mirEl.value : undefined
  const tr = document.getElementById('tr-' + id)
  showSpinner(tr)
  const result = await testKeyConnection(url, apiType, k, id, mirrorUrls, false, provType(id), provProject(id))
  showResult(tr, result.success, result.success ? '' : 'HTTP ' + result.status)
  if (result.success && result.data) {
    showEditModelsList(id, result.data.data || [])
  }
}

// 编辑表单 — 获取模型（复用 testKeyConnection 逻辑; freeOnly=true 时只拉免费模型）
async function fetchEditModels(id, freeOnly) {
  const url = document.getElementById('url-' + id).value.trim()
  const keys = getKeys(id)
  const apiKey = keys.length > 0 ? keys[0].key : ''
  const ptEl = document.getElementById('pt-' + id)
  const apiType = (ptEl ? ptEl.value : 'openai') === 'anthropic' ? 'anthropic' : 'openai'
  const mirEl = document.getElementById('mir-' + id)
  const mirrorUrls = mirEl ? mirEl.value : undefined
  const tr = document.getElementById('tr-' + id)
  showSpinner(tr)
  const result = await testKeyConnection(url, apiType, apiKey, id, mirrorUrls, freeOnly, provType(id), provProject(id))
  showResult(tr, result.success, result.success ? '' : escapeHtml(result.message || '获取模型失败'))
  if (result.success && result.data) {
    showEditModelsList(id, result.data.data || [], freeOnly)
  }
}

function showEditModelsList(id, models, freeOnly) {
  const cid = 'mel-' + id
  let el = document.getElementById(cid)
  if (!el) {
    // 以 API Keys fieldset 为锚点插入，结构与添加态的 #amc 对称
    const keysFs = document.getElementById('keys-' + id).closest('fieldset')
    el = document.createElement('aside')
    el.id = cid
    el.className = 'mdl-list-panel'
    el.innerHTML = modelPanelHeading(cid) + '<div id="melc-' + id + '"></div>'
    keysFs.insertAdjacentElement('afterend', el)
  }
  el.classList.remove('hd')
  const headEl = el.querySelector('.panel-heading h3')
  if (headEl) headEl.textContent = freeOnly ? '免费模型' : '可用模型'
  document.getElementById('melc-' + id).innerHTML = renderModelGrid(models, id, id)
}

function addMdlToEdit(id, mid) {
  document.getElementById('nmid-' + id).value = mid
  addMdl(id)
}

function getMdl(id) {
  const c = document.getElementById('ml-' + id), items = c.querySelectorAll('[data-idx]')
  return Array.from(items).map(item => {
    const idx = parseInt(item.dataset.idx), mid = document.getElementById('mid-' + id + '-' + idx).value.trim()
    const en = document.getElementById('men-' + id + '-' + idx).checked
    const alEl = document.getElementById('mal-' + id + '-' + idx)
    const alias = alEl ? alEl.value.trim() : ''
    if (!mid) return null
    return alias ? { id: mid, enabled: en, alias: alias } : { id: mid, enabled: en }
  }).filter(Boolean)
}

async function save(id) {
  const nm = document.getElementById('nm-' + id).value.trim(), urlEl = document.getElementById('url-' + id)
  let url = urlEl ? urlEl.value.trim() : ''
  const pidEl = document.getElementById('pid-' + id)
  const newId = pidEl ? pidEl.value.trim() : id
  const ptEl = document.getElementById('pt-' + id)
  const type = ptEl ? ptEl.value : 'openai'
  const apiType = type === 'anthropic' ? 'anthropic' : 'openai'
  const isTts = type === 'azure-tts'
  if (!url && type === 'antigravity') url = 'https://daily-cloudcode-pa.googleapis.com'
  if (!url && type === 'vertex') url = 'https://aiplatform.googleapis.com'
  if (!url && type === 'devin') url = 'https://server.codeium.com'
  if (!url && (isOauthType(type) || isDeepseekType(type) || isZaiType(type))) url = OAUTH_DEFAULT_URLS[type] || ''
  let keys = getKeys(id)
  const vxKeys = type === 'vertex' ? provVertexKeys(id) : null
  if (vxKeys && vxKeys.length) keys = vxKeys.map(k => ({ key: k, enabled: true }))
  const dvKeys = type === 'devin' ? provDevinKeys(id) : null
  if (dvKeys && dvKeys.length) keys = dvKeys.map(k => ({ key: k, enabled: true }))
  const models = getMdl(id), enabled = document.getElementById('en-' + id).checked
  const mirEl = document.getElementById('mir-' + id)
  const mirrorUrls = mirEl ? mirEl.value : undefined
  const ttsConf = isTts ? {
    voice: document.getElementById('pv-' + id).value.trim() || 'zh-CN-XiaoxiaoNeural',
    rate: document.getElementById('pr-' + id).value.trim() || '+0%',
    volume: document.getElementById('pvol-' + id).value.trim() || '+0%',
    pitch: document.getElementById('pp-' + id).value.trim() || '+0Hz',
  } : {}
  if (newId !== id && !/^[a-zA-Z0-9_-]+$/.test(newId)) { toast('ID 只能包含字母/数字/下划线/连字符', 'error'); return }
  const r = await fetch('/admin/api/providers/' + encodeURIComponent(id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, baseUrl: url, apiType, type, apiKeys: keys, models, mirrorUrls, enabled, newId, project: provProject(id) || undefined, location: provVertexLocation(id) || undefined, ...ttsConf })
  })
  const d = await r.json()
  if (d.success) { toast('已保存', 'success'); location.reload() }
  else toast(d.message || '保存失败', 'error')
}

async function del(id) {
  if (!(await cM('确定要删除此渠道？'))) return
  const r = await fetch('/admin/api/providers/' + encodeURIComponent(id), { method: 'DELETE' })
  const d = await r.json()
  if (d.success) { toast('已删除', 'success'); location.reload() }
  else toast(d.message || '删除失败', 'error')
}

function addMdl(id) {
  const inp = document.getElementById('nmid-' + id), mid = inp.value.trim()
  const alInp = document.getElementById('nmal-' + id)
  const alias = alInp ? alInp.value.trim() : ''
  if (!mid) { toast('请输入模型 ID', 'error'); return }
  const c = document.getElementById('ml-' + id), cnt = c.querySelectorAll('[data-idx]').length
  const d = document.createElement('div')
  d.className = 'fc mb-3 field-row'
  d.dataset.idx = cnt
  d.innerHTML = '<input type="text" value="' + escapeHtml(mid) + '" class="fx1" id="mid-' + escapeHtml(id) + '-' + cnt + '" placeholder="模型 ID" title="上游真实模型 ID"><input type="text" value="' + escapeHtml(alias) + '" class="fx1" id="mal-' + escapeHtml(id) + '-' + cnt + '" placeholder="对外名(可选)" title="对外显示名, 留空自动去:free后缀"><label class="tg"><input type="checkbox" checked id="men-' + escapeHtml(id) + '-' + cnt + '"><span class="sl"></span></label><button class="icon-btn" onclick="copyRowVal(this)" title="复制模型 ID" aria-label="复制模型 ID"><i class="far fa-copy"></i></button><button class="icon-btn" id="tm-' + escapeHtml(id) + '-' + cnt + '" title="测试模型" aria-label="测试模型"><i class="fas fa-plug"></i></button><button class="icon-btn" id="rm-' + escapeHtml(id) + '-' + cnt + '" title="移除模型" aria-label="移除模型"><i class="fas fa-times"></i></button>'
  c.appendChild(d)
  document.getElementById('tm-' + id + '-' + cnt).addEventListener('click', function() { testMdl(id, mid, cnt) })
  document.getElementById('rm-' + id + '-' + cnt).addEventListener('click', function() { rmMdl(id, cnt) })
  inp.value = ''
  if (alInp) alInp.value = ''
}

function rmMdl(id, idx) {
  const c = document.getElementById('ml-' + id)
  c.querySelectorAll('[data-idx]').forEach(item => {
    if (parseInt(item.dataset.idx) === idx) item.remove()
  })
}

async function testMdl(id, mid, idx) {
  const tr = document.getElementById('tr-' + id)
  showSpinner(tr)
  try {
    const mirEl = document.getElementById('mir-' + id)
    const mirrorUrls = mirEl ? mirEl.value : undefined
    const ptEl = document.getElementById('pt-' + id)
    const type = ptEl ? ptEl.value : 'openai'
    const apiType = type === 'anthropic' ? 'anthropic' : 'openai'
    // antigravity：用表单当前值直接测，无需先保存（refresh_token 可能在表单里刚填）
    if (type === 'antigravity') {
      const keys = getKeys(id)
      const apiKey = keys.length > 0 ? keys[0].key : ''
      const url = document.getElementById('url-' + id).value.trim()
      const r = await testModelConnection(url, apiType, apiKey, mid, id, mirrorUrls, type, provProject(id))
      showResult(tr, r.success, r.success ? '' : (r.message || ('HTTP ' + r.status)))
      return
    }
    const r = await fetch('/admin/api/providers/' + encodeURIComponent(id) + '/test-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId: mid, mirrorUrls })
    })
    const d = await r.json()
    if (d.success && d.data) {
      showResult(tr, d.data.success, d.data.success ? '' : (d.data.message || '连接失败'))
    } else {
      showResult(tr, false, d.message || '测试失败')
    }
  } catch (e) { showResult(tr, false, '请求失败') }
}

// proxy keys
async function genKey() {
  const name = await pM('输入 Key 名称（可选）')
  if (name === null) return
  showM('<h3><i class="fas fa-key c-p"></i> 生成令牌</h3><div class="fg"><label>有效期</label><select id="exp"><option value="30d">30 天</option><option value="90d">90 天</option><option value="180d">180 天</option><option value="1y">1 年</option><option value="forever" selected>永久</option></select></div><div class="fa"><button class="btn btn-s" id="gKc">取消</button><button class="btn btn-p" id="gKo">生成</button></div>')
  document.getElementById('gKc').addEventListener('click', closeM)
  document.getElementById('gKo').addEventListener('click', function() { doGenKey(document.getElementById('exp').value, name) })
}

async function doGenKey(exp, name) {
  closeM()
  const nm = name || ''
  const r = await fetch('/admin/api/proxy-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nm, expiresIn: exp })
  })
  const d = await r.json()
  if (d.success && d.data) {
    showM('<h3><i class="fas fa-check-circle c-s"></i> 生成成功</h3><p>请妥善保存，切勿泄露：</p><div class="mk">' + d.data.key + '</div><div class="fa"><button class="btn btn-p" onclick="closeM();location.reload()">关闭</button></div>')
  } else toast(d.message || '生成失败', 'error')
}

async function rmKey(id) {
  if (!(await cM('确定要删除此 Key？'))) return
  const r = await fetch('/admin/api/proxy-keys/' + encodeURIComponent(id), { method: 'DELETE' })
  const d = await r.json()
  if (d.success) { toast('已删除', 'success'); location.reload() }
  else toast(d.message || '删除失败', 'error')
}

// 重新生成令牌: 旧 key 立即失效, 生成新 key
async function regenerateKey(id) {
  if (!(await cM('重新生成后旧 Key 将立即失效，确定继续？'))) return
  const r = await fetch('/admin/api/proxy-keys/' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regenerate: true })
  })
  const d = await r.json()
  if (!d.success) { toast(d.message || '重新生成失败', 'error'); return }
  const nk = d.data.key
  // 显示新 key 供复制 (用事件绑定避免模板字符串内引号转义问题)
  showM('<h3><i class="fas fa-sync-alt c-p"></i> 令牌已重新生成</h3><div class="fg"><label>新 Key（仅显示一次）</label><input type="text" id="rgKey" value="' + nk + '" readonly onclick="this.select()"></div><div class="fa"><button class="btn btn-p" id="rgCopyBtn">复制</button><button class="btn btn-s" onclick="closeM()">关闭</button></div>')
  const copyBtn = document.getElementById('rgCopyBtn')
  if (copyBtn) copyBtn.onclick = function () { copyText(document.getElementById('rgKey').value, this); toast('已复制', 'success') }
  toast('已重新生成', 'success')
}

// proxy key list interactions
async function togglePb(id, checked) {
  const pi = document.querySelector('.pi[data-id="' + id + '"]')
  if (!pi) return
  const b = pi.querySelector('.ps .bd')
  if (b) { b.textContent = checked ? '已启用' : '未启用'; b.className = 'bd ' + (checked ? 'bd-on' : 'bd-off') }
  const r = await fetch('/admin/api/providers/' + encodeURIComponent(id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: checked })
  })
  const d = await r.json()
  if (!d.success) toast(d.message || '操作失败', 'error')
}

function toggleKeyVis(id) {
  const el = document.getElementById('kv-' + id)
  const full = el.dataset.full
  const vis = el.dataset.vis === '1'
  if (vis) {
    el.textContent = full.length > 12
      ? full.substring(0, 8) + '*****' + full.substring(full.length - 4)
      : full
    el.dataset.vis = '0'
  } else {
    el.textContent = full
    el.dataset.vis = '1'
  }
}

async function toggleProxyKey(id, checked) {
  const r = await fetch('/admin/api/proxy-keys/' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: checked })
  })
  const d = await r.json()
  if (d.success) {
    const ki = document.querySelector('.ki[data-id="' + id + '"]')
    if (ki) {
      const b = ki.querySelector('.fc .bd')
      if (b) { b.textContent = checked ? '已启用' : '已禁用'; b.className = 'bd ' + (checked ? 'bd-on' : 'bd-off') }
    }
  } else toast(d.message || '操作失败', 'error')
}

// 中文说明：根据点击和 URL 锚点同步侧栏选中态，避免导航始终停留在“概览”。
const adminNavLinks = Array.from(document.querySelectorAll('.admin-nav a[href^="#"]'))
function setActiveAdminNav(hash) {
  const targetHash = adminNavLinks.some(function (link) { return link.getAttribute('href') === hash }) ? hash : '#overview'
  adminNavLinks.forEach(function (link) {
    const active = link.getAttribute('href') === targetHash
    link.classList.toggle('is-active', active)
    if (active) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  })
}
adminNavLinks.forEach(function (link) {
  link.addEventListener('click', function () { setActiveAdminNav(link.getAttribute('href') || '#overview') })
})
window.addEventListener('hashchange', function () { setActiveAdminNav(location.hash) })
setActiveAdminNav(location.hash)

// ===== 用量统计 =====
const fmtNum = (n) => Number(n || 0).toLocaleString('zh-CN')
const fmtTok = (n) => {
  const v = Number(n || 0)
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'
  return String(v)
}

async function loadUsage() {
  const days = document.getElementById('usage-days')?.value || '1'
  try {
    const r = await fetch('/admin/api/usage?days=' + days)
    const d = await r.json()
    if (!d.success) throw new Error(d.message || '加载失败')
    const s = d.data || {}
    setText('u-req', fmtNum(s.totalRequests))
    setText('u-ok', fmtNum(s.successRequests) + ' 成功')
    setText('u-in', fmtTok(s.totalPromptTokens))
    setText('u-out', fmtTok(s.totalCompletionTokens))
    setText('u-lat', s.avgLatencyMs ? fmtNum(s.avgLatencyMs) + ' ms' : '-')

    // 每日趋势
    const trendEl = document.getElementById('u-trend')
    const trendWrap = document.getElementById('u-trend-wrap')
    if (s.daily && s.daily.length > 1) {
      const max = Math.max(...s.daily.map((x) => x.requests), 1)
      trendEl.innerHTML = '<div class="fc" style="flex-direction:column;gap:8px">' + s.daily.map((x) => {
        const pct = Math.max(Math.round((x.requests / max) * 100), 2)
        return '<div class="fc" style="width:100%;gap:8px"><span style="flex:0 0 70px;font-size:11px;color:var(--color-muted)">' + x.date.slice(5) + '</span><div class="fc" style="flex:1;height:18px;background:var(--color-rule);border-radius:4px;overflow:hidden"><div class="trend-fill" style="width:' + pct + '%;height:100%;background:var(--color-accent);border-radius:4px"></div></div><span style="flex:0 0 90px;text-align:right;font-size:11px" title="输入 ' + fmtTok(x.promptTokens) + ' + 输出 ' + fmtTok(x.completionTokens) + ' tokens">' + fmtNum(x.requests) + ' 请求 · ' + fmtTok(x.promptTokens + x.completionTokens) + ' tok</span></div>'
      }).join('') + '</div>'
      trendWrap.classList.remove('hd')
    } else {
      trendWrap.classList.add('hd')
    }

    // 模型排行
    renderRank('u-models', s.byModel, 'model')
    // 渠道排行
    renderRank('u-providers', s.byProvider, 'provider')
  } catch (e) {
    toast(e.message || '用量加载失败', 'error')
  }
}

function renderRank(elId, list, keyName) {
  const el = document.getElementById(elId)
  if (!el) return
  if (!list || list.length === 0) {
    el.innerHTML = '<p class="mu" style="padding:8px 0">暂无数据</p>'
    return
  }
  const max = Math.max(...list.map((x) => x.requests), 1)
  el.innerHTML = list.slice(0, 10).map((x, i) => {
    const pct = Math.max(Math.round((x.requests / max) * 100), 3)
    return '<div class="rk-row" style="margin-bottom:10px">' +
      '<div class="fc" style="justify-content:space-between;gap:8px;margin-bottom:4px">' +
      '<code style="font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtml(x[keyName]) + '">' + escapeHtml(x[keyName]) + '</code>' +
      '<span style="font-size:11px;color:var(--color-muted);flex-shrink:0">' + fmtNum(x.requests) + ' 请求 · ' + fmtTok(x.promptTokens + x.completionTokens) + ' tokens</span></div>' +
      '<div style="height:6px;background:var(--color-rule);border-radius:3px;overflow:hidden"><div style="width:' + pct + '%;height:100%;background:var(--color-accent);border-radius:3px"></div></div></div>'
  }).join('')
}

function setText(id, text) {
  const el = document.getElementById(id)
  if (el) el.textContent = text
}

// ===== 备份与恢复 =====
function bkResult(elId, ok, msg) {
  const el = document.getElementById(elId)
  if (el) el.innerHTML = '<div class="al ' + (ok ? 'al-ok' : 'al-err') + '">' + msg + '</div>'
}
// 弹窗输入管理员密码, 返回 SHA-256 哈希; 取消返回 null
function adminAuthHash() {
  return new Promise(function (resolve) {
    showM('<h3><i class="fas fa-lock c-p"></i> 验证管理员密码</h3><p class="form-helper">此操作敏感，需要输入管理员密码确认。</p><div class="fg"><label>管理员密码</label><input type="password" id="authPass" class="fx1" placeholder="请输入密码" autocomplete="current-password"></div><div class="fa"><button class="btn btn-s" onclick="closeM()">取消</button><button class="btn btn-p" id="authOk">确认</button></div>')
    const ok = document.getElementById('authOk')
    ok.onclick = async function () {
      const pass = document.getElementById('authPass').value
      if (!pass) { toast('请输入密码', 'error'); return }
      closeM()
      const enc = new TextEncoder().encode(pass)
      const buf = await crypto.subtle.digest('SHA-256', enc)
      resolve(Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0') }).join(''))
    }
  })
}
async function backupExport() {
  const tr = document.getElementById('bk-io-result')
  showSpinner(tr)
  const hash = await adminAuthHash()
  if (!hash) { tr.innerHTML = ''; return }
  try {
    const r = await fetch('/admin/api/backup/export', { headers: { 'X-Admin-Auth': hash } })
    if (!r.ok) { bkResult('bk-io-result', false, '导出失败: ' + (r.status === 401 ? '密码验证失败' : 'HTTP ' + r.status)); return }
    const blob = await r.blob()
    const cd = r.headers.get('Content-Disposition') || ''
    const name = (cd.match(/filename="?([^";]+)/) || [])[1] || 'ai-gateway-backup.json'
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
    bkResult('bk-io-result', true, '已导出 ' + name + '（注：为保护隐私，Telegram 通知配置不包含在备份内，还原后需重新填写）')
  } catch (e) { bkResult('bk-io-result', false, '导出失败: ' + e.message) }
}
// 导入数据库: 点击按钮立即验证管理员密码, 通过后才选择文件
let bkImportHash = null
function backupImportPick() {
  cM('导入将<strong>覆盖</strong>当前所有数据(渠道/令牌/用量)，确定继续？').then(async function (ok) {
    if (!ok) return
    bkImportHash = await adminAuthHash()
    if (!bkImportHash) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = function () { backupImport(input.files[0]) }
    input.click()
  })
}
function backupImport(file) {
  if (!file || !bkImportHash) return
  const reader = new FileReader()
  reader.onload = async function () {
    try {
      const r = await fetch('/admin/api/backup/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Auth': bkImportHash },
        body: reader.result,
      })
      const d = await r.json()
      bkResult('bk-io-result', d.success, d.message || (r.status === 401 ? '密码验证失败' : '导入完成'))
      if (d.success) {
        toast('导入成功，即将重新登录…', 'success')
        setTimeout(function () { location.href = '/admin/login' }, 1500)
      }
    } catch (e) { bkResult('bk-io-result', false, '导入失败: ' + e.message) }
  }
  reader.readAsText(file)
}
async function backupToR2() {
  const tr = document.getElementById('bk-r2-result')
  showSpinner(tr)
  const r = await fetch('/admin/api/backup/to-r2', { method: 'POST' })
  const d = await r.json()
  bkResult('bk-r2-result', d.success, d.message || '备份失败')
  if (d.success) backupList()
}
async function backupList() {
  const el = document.getElementById('bk-r2-result')
  showSpinner(el)
  try {
    const r = await fetch('/admin/api/backup/list')
    const d = await r.json()
    if (!d.success) { bkResult('bk-r2-result', false, d.message || '获取失败'); return }
    const list = d.data || []
    if (list.length === 0) { bkResult('bk-r2-result', false, 'R2 中暂无备份快照'); return }
    el.innerHTML = '<div class="panel-list" style="margin-top:6px">' + list.map(function (f, i) {
      const shortKey = f.key.indexOf('/') >= 0 ? f.key.slice(f.key.indexOf('/') + 1) : f.key
      const Q = String.fromCharCode(39)
      return '<div class="fc field-row" style="justify-content:space-between;padding:6px 8px;border:1px solid var(--color-rule);border-radius:8px;margin-bottom:6px"><span style="font-family:var(--font-mono);font-size:11px;overflow:hidden;text-overflow:ellipsis">' + shortKey + '</span><span style="font-size:11px;color:var(--color-muted);flex-shrink:0">' + (f.size ? (f.size / 1024).toFixed(1) + ' KB' : '') + '</span><span class="fc" style="gap:4px;flex-shrink:0"><button class="btn btn-xs" onclick="backupRestore(' + Q + f.key + Q + ')" title="从该快照恢复"><i class="fas fa-history"></i>恢复</button><button class="btn btn-xs bd-del" onclick="backupDelete(' + Q + f.key + Q + ')" title="删除快照"><i class="fas fa-trash"></i></button></span></div>'
    }).join('') + '</div>'
  } catch (e) { bkResult('bk-r2-result', false, '获取失败: ' + e.message) }
}
async function backupRestore(key) {
  if (!(await cM('从快照恢复将<strong>覆盖</strong>当前所有数据，确定继续？'))) return
  const hash = await adminAuthHash()
  if (!hash) return
  const r = await fetch('/admin/api/backup/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Auth': hash },
    body: JSON.stringify({ key: key }),
  })
  const d = await r.json()
  bkResult('bk-r2-result', d.success, d.message || (r.status === 401 ? '密码验证失败' : '恢复失败'))
  if (d.success) {
    toast('恢复成功，即将重新登录…', 'success')
    setTimeout(function () { location.href = '/admin/login' }, 1500)
  }
}
async function backupDelete(key) {
  if (!(await cM('确定删除此快照？'))) return
  const hash = await adminAuthHash()
  if (!hash) return
  const r = await fetch('/admin/api/backup/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Auth': hash },
    body: JSON.stringify({ key: key }),
  })
  const d = await r.json()
  bkResult('bk-r2-result', d.success, d.message || (r.status === 401 ? '密码验证失败' : '删除失败'))
  if (d.success) backupList()
}

// ===== Telegram 备份 =====
function tgParams() {
  return {
    botToken: document.getElementById('tgToken').value.trim(),
    chatId: document.getElementById('tgChat').value.trim(),
  }
}
async function telegramTest() {
  const el = document.getElementById('bk-tg-result')
  showSpinner(el)
  const p = tgParams()
  if (!p.botToken || !p.chatId) { bkResult('bk-tg-result', false, '请先填写 Bot Token 和 USER ID'); return }
  const r = await fetch('/admin/api/telegram/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  })
  const d = await r.json()
  bkResult('bk-tg-result', d.success, d.message || '测试失败')
}
async function backupToTelegram() {
  const el = document.getElementById('bk-tg-result')
  showSpinner(el)
  const p = tgParams()
  if (!p.botToken || !p.chatId) { bkResult('bk-tg-result', false, '请先填写 Bot Token 和 USER ID'); return }
  const r = await fetch('/admin/api/backup/to-telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  })
  const d = await r.json()
  bkResult('bk-tg-result', d.success, d.message || '备份失败')
}

// ===== 侧边栏收缩/展开(PC 端, 记忆状态) =====
function toggleRail() {
  const shell = document.querySelector('.admin-shell')
  const collapsed = shell.classList.toggle('is-collapsed')
  try { localStorage.setItem('admin-rail-collapsed', collapsed ? '1' : '0') } catch (e) {}
  const btn = document.querySelector('.rail-toggle')
  if (btn) btn.title = collapsed ? '展开侧边栏' : '收缩侧边栏'
}
// 恢复上次状态
try {
  if (localStorage.getItem('admin-rail-collapsed') === '1') {
    document.querySelector('.admin-shell')?.classList.add('is-collapsed')
    const btn = document.querySelector('.rail-toggle')
    if (btn) btn.title = '展开侧边栏'
  }
} catch (e) {}

// ===== 模块化导航: 点击导航只显示对应模块 =====
function showModule() {
  const hash = location.hash || '#overview'
  const mods = ['overview', 'providers', 'quota', 'proxy-keys', 'usage', 'backup']
  mods.forEach(m => {
    const el = document.getElementById(m)
    if (el) el.style.display = (hash === '#' + m) ? '' : 'none'
  })
  document.querySelectorAll('.admin-nav__link').forEach(a => {
    const href = a.getAttribute('href') || ''
    a.classList.toggle('is-active', href === hash || (hash === '#overview' && href === '#overview'))
  })
  if (hash === '#usage') loadUsage()
  if (hash === '#quota' && !quotaReady) renderQuotaSkeleton()
}
window.addEventListener('hashchange', showModule)
showModule()

// 账号级「查询」按钮走事件委托（内容会被 innerHTML 替换，委托在容器上）
const quotaBodyEl = document.getElementById('quotaBody')
if (quotaBodyEl) {
  quotaBodyEl.addEventListener('click', function (e) {
    const b = e.target && e.target.closest ? e.target.closest('[data-agq]') : null
    if (!b) return
    agAccountQuery(b.getAttribute('data-agq'), Number(b.getAttribute('data-agi')))
  })
}

// 进入用量 section 时加载
if (location.hash === '#usage') loadUsage()
</script>
</body></html>`)
}