import { Context } from 'hono'
import { SITE_CONFIG } from './config'
import type { Env } from './types'
import { CSS_CONTENT } from './pages.css'
import { icon } from './shared.js'

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

export async function renderLoginPage(c: Context<{ Bindings: Env }>) {
  return c.html(`<!DOCTYPE html><html lang="zh-CN">
${H('登录')}
<body class="site-page auth-page">
<header class="topbar topbar--auth" style="width:100%">
  <div class="shell topbar__inner">
    <a class="brand" href="/" aria-label="AI GATEWAY 首页">
      <span class="brand__mark">${icon('cloud', '', 18)}</span>
      <span class="brand__name">AI GATEWAY</span>
    </a>
    <a href="/" class="btn btn-gh">${icon('arrowLeft', '', 14)}返回首页</a>
  </div>
</header>

<main class="auth-shell">
  <section class="auth-form-wrap" aria-labelledby="login-title">
    <form class="auth-form" id="login-form" novalidate>
      <div class="auth-form__heading">
        <span class="auth-form__icon" aria-hidden="true">${icon('lock', '', 22)}</span>
        <div>
          <h2 id="login-title">管理员登录</h2>
          <p>请输入部署时配置的凭据以管理系统</p>
        </div>
      </div>

      <div id="er" class="al al-e hd" role="alert" aria-live="assertive">
        ${icon('alert', '', 16)}<span id="em"></span>
      </div>

      <div class="fg">
        <label for="u">用户名</label>
        <div class="input-wrap">
          ${icon('user', '', 16)}
          <input type="text" id="u" name="username" placeholder="admin" autocomplete="username" aria-required="true">
        </div>
      </div>
      <div class="fg">
        <label for="p">密码</label>
        <div class="input-wrap">
          ${icon('key', '', 16)}
          <input type="password" id="p" name="password" placeholder="部署环境变量中的密码" autocomplete="current-password" aria-required="true">
          <button class="password-toggle" id="password-toggle" type="button" aria-label="显示密码">
            ${icon('eye', '', 16)}
          </button>
        </div>
      </div>
      <p id="login-helper" class="form-helper" style="margin-top:4px">登录成功后将进入完整的管理控制台。</p>
      
      <button class="btn btn-p btn-submit" id="login-button" type="submit">
        <span class="button-label">${icon('signIn', '', 14)} 登录管理控制台</span>
        <span class="button-loading">${icon('spinner', 'spin', 14)} 正在验证凭据...</span>
      </button>
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
    var iconWrap = toggle.querySelector('.svg-icon')
    if (iconWrap && window.SVG_ICONS) {
      iconWrap.innerHTML = show ? window.SVG_ICONS.eyeSlash : window.SVG_ICONS.eye
    }
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
      showError('无法连接网关服务，请检查网络后重试。')
    }
    submit.disabled = false
    submit.removeAttribute('data-state')
  })
})()
</script>
</body></html>`)
}
