// 管理后台客户端核心交互脚本
export const ADMIN_CLIENT_SCRIPT = `
// ── 复制控制 ──
function copyText(t, el) {
  var iconEl = el.querySelector('.svg-icon') || el.querySelector('i') || (el.classList.contains('svg-icon') ? el : null)
  navigator.clipboard.writeText(t).then(function() {
    el.setAttribute('data-state', 'success')
    if (iconEl && window.SVG_ICONS && window.SVG_ICONS.check) {
      iconEl.innerHTML = window.SVG_ICONS.check
      iconEl.className = 'svg-icon c-s'
    }
    setTimeout(function() {
      el.removeAttribute('data-state')
      if (iconEl && window.SVG_ICONS && window.SVG_ICONS.copy) {
        iconEl.innerHTML = window.SVG_ICONS.copy
        iconEl.className = 'svg-icon'
      }
    }, 1800)
  }).catch(function() {
    el.setAttribute('data-state', 'error')
  })
}

function copyRowVal(btn) {
  const inp = btn.parentElement.querySelector('input[type=text]')
  if (inp) copyText(inp.value, btn)
}

// ── 弹窗 Modal ──
function showM(h) { 
  document.getElementById('mc').innerHTML = h
  document.getElementById('modal').classList.remove('hd') 
}
function closeM() { 
  document.getElementById('modal').classList.add('hd') 
}
function cM(msg) {
  return new Promise(function(r) {
    showM('<h3>' + svgIcon('info', 'c-p', 20) + ' 确认操作</h3><p>' + msg + '</p><div class="fa"><button class="btn btn-s" onclick="closeM();r(false)">取消</button><button class="btn btn-p" onclick="closeM();r(true)">确定</button></div>')
    window.r = r
  })
}
function pM(msg, def) {
  return new Promise(function(r) {
    showM('<h3>' + svgIcon('key', 'c-p', 20) + ' ' + escapeHtml(msg) + '</h3><div class="fg"><input type="text" id="pv" value="' + escapeHtml(def || '') + '" placeholder="请输入"></div><div class="fa"><button class="btn btn-s" id="pMc">取消</button><button class="btn btn-p" id="pMo">确定</button></div>')
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
  const ic = t === 'success' ? svgIcon('check', 'c-s', 20) : svgIcon('alert', 'c-d', 20)
  showM('<h3>' + ic + ' ' + (t === 'success' ? '操作成功' : '系统提示') + '</h3><p>' + escapeHtml(msg) + '</p><div class="fa"><button class="btn btn-p" onclick="closeM()">确定</button></div>')
}

function toast(msg, t) {
  const el = document.getElementById('toast')
  const ic = t === 'success' ? svgIcon('check', '', 16) : svgIcon('alert', '', 16)
  const cls = t === 'success' ? 'al-s' : 'al-e'
  el.innerHTML = '<div class="al ' + cls + '">' + ic + ' <span>' + escapeHtml(msg) + '</span></div>'
  el.classList.remove('hd')
  setTimeout(function() { el.classList.add('hd') }, 3000)
}

// ── 渠道卡片折叠与展开 ──
function tog(id) {
  const d = document.getElementById('dt-' + id), c = document.getElementById('ch-' + id)
  if (!d) return
  d.classList.toggle('open')
  if (c) c.style.transform = d.classList.contains('open') ? 'rotate(90deg)' : ''
}

function showAdd() { 
  document.getElementById('af').classList.remove('hd')
  document.getElementById('af').scrollIntoView({ behavior: 'smooth' })
}
function hideAdd() { 
  document.getElementById('af').classList.add('hd')
  document.getElementById('amc').classList.add('hd') 
}

const OAUTH_DEFAULT_URLS = { 
  claude: 'https://api.anthropic.com', 
  codex: 'https://chatgpt.com/backend-api/codex', 
  kimi: 'https://api.kimi.ai/coding', 
  grok: 'https://cli-chat-proxy.grok.com/v1', 
  qwen: 'https://portal.qwen.ai/v1', 
  deepseek: 'https://chat.deepseek.com', 
  zai: 'https://api.z.ai/api/coding/paas/v4', 
  codebuddy: 'https://copilot.tencent.com', 
  cline: 'https://api.cline.bot' 
}
function isOauthType(t) { return ['claude', 'codex', 'kimi', 'grok', 'qwen', 'codebuddy', 'cline'].indexOf(t) !== -1 }
function isDeepseekType(t) { return t === 'deepseek' }
function isZaiType(t) { return t === 'zai' }
function isCodebuddyType(t) { return t === 'codebuddy' }

const CB_REGION_URLS = { cn: 'https://copilot.tencent.com', global: 'https://www.workbuddy.ai' }
function cbRegionValue(id) {
  const el = document.getElementById('cbr-' + id)
  return el && el.value === 'global' ? 'global' : 'cn'
}
function cbRegionUrl(id) { return CB_REGION_URLS[cbRegionValue(id)] }
function cbRegionChange(id) {
  const urlEl = document.getElementById(id === 'new' ? 'aurl' : 'url-' + id)
  if (urlEl) urlEl.value = cbRegionUrl(id)
  const box = document.getElementById(id === 'new' ? 'cbst-new' : 'cbst-' + id)
  if (box) box.innerHTML = ''
}

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
  const isCb = isCodebuddyType(sel.value)
  const cbBox = document.getElementById('cb-' + id)
  if (cbBox) cbBox.style.display = isCb ? '' : 'none'
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
      : sel.value === 'antigravity' ? 'Antigravity 反代: 点「用 Google 账号授权」获取 refresh_token, 请求自动翻译成 Gemini 协议。支持多账号(一行一个)。'
      : sel.value === 'claude' ? 'Claude OAuth 反代: 授权登录获取 refresh_token, 请求自动翻译成 Anthropic Messages 协议。'
      : sel.value === 'codex' ? 'ChatGPT (Codex) 反代: 授权登录获取 refresh_token, 请求自动翻译成 Responses 协议。'
      : sel.value === 'kimi' ? 'Kimi 反代: 设备码授权获取 refresh_token, OpenAI 兼容直通。'
      : sel.value === 'grok' ? 'Grok (xAI) 反代: 设备码授权获取 refresh_token, 请求自动翻译成 Responses 协议。'
      : sel.value === 'qwen' ? 'Qwen 反代: 设备码授权获取 refresh_token, OpenAI 兼容直通。'
      : sel.value === 'deepseek' ? 'DeepSeek 反代: 填官方 API Key(sk-, 直连 api.deepseek.com) 或网页 userToken(PoW)。'
      : sel.value === 'codebuddy' ? 'CodeBuddy(腾讯) 反代: 先在下方选国内版或国际版, 再点「授权登录」获取 refresh_token。'
      : sel.value === 'cline' ? 'Cline 反代: 点「授权登录」走设备码流程获取 refreshToken, 多账号一行一个轮换。'
      : sel.value === 'zai' ? 'Z.AI 预设: 填 z.ai 的 API Key(编码套餐)。/v1/messages 自动走 Anthropic 端点, 其余走 OpenAI 端点。'
      : 'Agnes 等聚合平台建议选 OpenAI 兼容, 视频模型自动走异步适配。'
  }
  const hideForOAuth = isAg || isOa || isDs
  const scope = id === 'new' ? document.getElementById('af') : document.getElementById('dt-' + id)
  if (scope) {
    scope.querySelectorAll('[data-hide-ag]').forEach(function (el) { el.style.display = hideForOAuth ? 'none' : '' })
  }
  if (id === 'new') {
    const url = document.getElementById('aurl')
    if (url) {
      url.disabled = isTts || isAg || (isOa && !isCb) || isDs
      if (isTts) url.value = ''
      else if (isAg) url.value = 'https://daily-cloudcode-pa.googleapis.com'
      else if (isCb) url.value = cbRegionUrl('new')
      else if (isOa || isDs) url.value = OAUTH_DEFAULT_URLS[sel.value] || 'https://'
      else if (isZai) url.value = OAUTH_DEFAULT_URLS.zai
      else if (!url.value) url.value = 'https://'
    }
  } else {
    const url = document.getElementById('url-' + id)
    if (url) {
      url.disabled = isTts || isAg || (isOa && !isCb) || isDs
      if (isAg && !url.value) url.value = 'https://daily-cloudcode-pa.googleapis.com'
      if (isCb && !url.value) url.value = cbRegionUrl(id)
      if ((isOa && !isCb || isDs) && !url.value) url.value = OAUTH_DEFAULT_URLS[sel.value] || 'https://'
      if (isZai && !url.value) url.value = OAUTH_DEFAULT_URLS.zai
      if (isTts && !url.dataset.orig) url.dataset.orig = url.value
    }
  }
}

function provType(id) { const el = document.getElementById(id === 'new' ? 'apt' : 'pt-' + id); return el ? el.value : 'openai' }
function provProject(id) {
  const el = document.getElementById(id === 'new' ? 'agpj' : 'agpj-' + id)
  return el ? el.value.trim() : ''
}
function provVertexKeys(id) {
  const el = document.getElementById(id === 'new' ? 'vxs' : 'vxs-' + id)
  if (!el) return null
  const txt = (el.value || '').trim()
  if (!txt) return null
  return txt.split(new RegExp('\\\\n\\\\s*\\\\n')).map(function (s) { return s.trim() }).filter(Boolean)
}
function provVertexLocation(id) {
  const el = document.getElementById(id === 'new' ? 'vxl' : 'vxl-' + id)
  return el ? el.value.trim() : ''
}
function provDevinKeys(id) {
  const el = document.getElementById(id === 'new' ? 'dvt' : 'dvt-' + id)
  if (!el) return null
  const txt = (el.value || '').trim()
  if (!txt) return null
  return txt.split(new RegExp('\\\\n+')).map(function (s) { return s.trim() }).filter(Boolean)
}

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

async function devinOAuth(id) {
  const w = window.open('', '_blank')
  try {
    const r = await fetch('/admin/api/devin/oauth/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const d = await r.json()
    if (!d.success || !d.data) { if (w) w.close(); toast(d.message || '生成授权链接失败', 'error'); return }
    if (w) w.location.href = d.data.url; else window.open(d.data.url, '_blank')
    showM('<h3>' + svgIcon('key', 'c-p', 20) + ' Devin 授权</h3><p class="form-helper" style="margin-bottom:8px">在打开的 Devin 页面登录并确认授权，页面会直接显示一段授权码（code），复制到下面。</p><div class="fg"><label>授权码 code</label><textarea id="dvcode" rows="3" class="fx1" placeholder="粘贴页面给出的 code"></textarea></div><div class="fa"><button class="btn btn-s" onclick="closeM()">取消</button><button class="btn btn-p" id="dvok">完成授权</button></div>')
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
          if (el) { el.value = (el.value ? el.value.replace(new RegExp('\\\\s*$'), '\\\\n') : '') + dd.data.session_token }
          closeM()
          toast('授权成功（' + (dd.data.user_name || dd.data.user_id || 'Devin') + '），凭据已填入，保存渠道后生效', 'success')
        } else { ok.disabled = false; toast(dd.message || '授权失败', 'error') }
      } catch (e) { ok.disabled = false; toast('授权请求失败', 'error') }
    }
  } catch (e) { if (w) w.close(); toast('生成授权链接失败', 'error') }
}

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

function addKeyValue(id, value) {
  if (!value) return
  if (id === 'new') { addAKeyRow(value); return }
  const inp = document.getElementById('nk-' + id)
  if (inp) { inp.value = value; addKeyRow(id) } else { addAKeyRow(value) }
}

async function antigravityOAuth(id) {
  const tr = document.getElementById(id === 'new' ? 'atestR' : 'tr-' + id)
  const w = window.open('', '_blank')
  if (tr) showSpinner(tr)
  try {
    const r = await fetch('/admin/api/antigravity/oauth/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const d = await r.json()
    if (!d.success || !d.data) { if (w) w.close(); if (tr) showResult(tr, false, d.message || '生成授权链接失败'); return }
    if (w) w.location.href = d.data.url; else window.open(d.data.url, '_blank')
    showM('<h3>' + svgIcon('key', 'c-p', 20) + ' Antigravity 授权</h3><p class="form-helper" style="margin-bottom:8px">在打开的 Google 页面登录并同意授权。授权后浏览器会跳转到 <code>localhost:51121</code> 并提示「无法访问」—— 这是正常的，把地址栏 <code>code=</code> 后面那段复制到下面。</p><div class="fg"><label>code 或回调地址</label><textarea id="agcode" rows="3" class="fx1" placeholder="4/0A... 或 http://localhost:51121/oauth-callback?code=..."></textarea></div><div class="fa"><button class="btn btn-s" onclick="closeM()">取消</button><button class="btn btn-p" id="agok">完成授权</button></div>')
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
    const existing = {}
    const sel = id === 'new' ? '#amodels .ami' : '#ml-' + id + ' [data-idx] input'
    document.querySelectorAll(sel).forEach(function (inp) { if (inp.value.trim()) existing[inp.value.trim()] = 1 })
    const toAdd = models.filter(function (m) { return !existing[m] })
    toAdd.forEach(function (m) { if (id === 'new') addMdlToForm(m); else addMdlToEdit(id, m) })
    toast('已添加 ' + toAdd.length + ' 个模型' + (toAdd.length < models.length ? '（跳过 ' + (models.length - toAdd.length) + ' 个已存在）' : ''), 'success')
    if (tr) showResult(tr, true, '')
  } catch (e) { if (tr) showResult(tr, false, '请求失败') }
}

async function oauthChannel(id) {
  const provider = provType(id)
  if (!isOauthType(provider)) { toast('当前渠道类型不支持 OAuth 授权', 'error'); return }
  const tr = document.getElementById(id === 'new' ? 'atestR' : 'tr-' + id)
  if (tr) showSpinner(tr)
  try {
    const baseEl = document.getElementById(id === 'new' ? 'aurl' : 'url-' + id)
    const baseUrl = baseEl ? baseEl.value.trim() : ''
    const r = await fetch('/admin/api/oauth/' + provider + '/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: baseUrl, region: cbRegionValue(id) }) })
    const d = await r.json()
    if (!d.success || !d.data) { if (tr) showResult(tr, false, d.message || '发起授权失败'); return }
    if (d.data.mode === 'redirect') {
      const w = window.open('', '_blank')
      if (w) { try { w.location.href = d.data.url } catch (e) { } } else window.open(d.data.url, '_blank')
      const loopback = provider === 'claude' ? 'localhost:54545' : 'localhost:1455'
      const pname = provider === 'claude' ? 'Claude' : 'ChatGPT'
      showM('<h3>' + svgIcon('key', 'c-p', 20) + ' ' + pname + ' 授权</h3><p class="form-helper" style="margin-bottom:8px">在打开的官方页面登录并同意授权。跳转到 <code>' + loopback + '</code> 提示「无法访问」属正常，复制地址栏 <code>code=</code> 后面那段到下方。</p><div class="fg"><label>code 或回调地址</label><textarea id="oacode" rows="3" class="fx1" placeholder="粘贴 code"></textarea></div><div class="fa"><button class="btn btn-s" onclick="closeM()">取消</button><button class="btn btn-p" id="oaok">完成授权</button></div>')
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
    } else if (d.data.mode === 'redirect-poll') {
      window.open(d.data.url, '_blank')
      const realmName = d.data.realm === 'global' ? '国际版 (workbuddy.ai)' : '国内版 (copilot.tencent.com)'
      showM('<h3>' + svgIcon('key', 'c-p', 20) + ' CodeBuddy 授权</h3>'
        + '<p class="form-helper" style="margin-bottom:8px">已在新窗口打开腾讯登录页（' + realmName + '）。用账号完成登录即可，<b>无需复制 code</b> —— 登录完成后自动填入凭据。</p>'
        + '<p style="margin:8px 0"><a class="btn btn-p" href="' + escapeHtml(d.data.url) + '" target="_blank" rel="noreferrer">' + svgIcon('external', '', 14) + ' 打开登录页</a></p>'
        + '<div id="oadev" class="mu">' + svgIcon('spinner', 'spin', 14) + ' 等待登录完成...</div>'
        + '<div class="fa"><button class="btn btn-s" onclick="closeM()">取消</button></div>')
      pollDeviceFlow(provider, d.data.state, id, tr, document.getElementById('oadev'))
    } else {
      const complete = d.data.verification_uri_complete
        || (d.data.verification_uri ? d.data.verification_uri + '?user_code=' + encodeURIComponent(d.data.user_code || '') : '')
      window.open(complete, '_blank')
      const pname = provider === 'kimi' ? 'Kimi' : provider === 'qwen' ? 'Qwen' : provider === 'cline' ? 'Cline' : 'Grok'
      showM('<h3>' + svgIcon('key', 'c-p', 20) + ' ' + pname + ' 设备码授权</h3>'
        + '<p class="form-helper" style="margin-bottom:8px">已在新窗口打开授权页面（已带验证码）。完成后将自动填入凭据。</p>'
        + '<p style="margin:8px 0"><a class="btn btn-p" href="' + escapeHtml(complete) + '" target="_blank" rel="noreferrer">' + svgIcon('external', '', 14) + ' 打开授权页面</a></p>'
        + '<div class="fg"><label>验证码 User Code</label><input type="text" class="fx1" value="' + escapeHtml(d.data.user_code || '') + '" readonly onclick="this.select()"></div>'
        + '<div id="oadev" class="mu">' + svgIcon('spinner', 'spin', 14) + ' 等待授权确认...</div>'
        + '<div class="fa"><button class="btn btn-s" onclick="closeM()">取消</button></div>')
      pollDeviceFlow(provider, d.data.state, id, tr, document.getElementById('oadev'))
    }
  } catch (e) {
    if (tr) showResult(tr, false, '请求失败')
  }
}

async function pollDeviceFlow(provider, state, id, tr, boxEl) {
  const intervalMs = 5000
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
    } catch (e) { }
  }
}

async function codebuddyStatus(id) {
  const tr = document.getElementById(id === 'new' ? 'atestR' : 'tr-' + id)
  const box = document.getElementById(id === 'new' ? 'cbst-new' : 'cbst-' + id)
  let key = ''
  if (id === 'new') {
    const first = document.querySelector('#akeys .aki')
    key = first ? first.value.trim() : ''
  } else {
    const keys = getKeys(id)
    key = keys.length > 0 ? keys[0].key : ''
  }
  if (!key) { toast('请先填写 refresh_token', 'error'); return }
  if (tr) showSpinner(tr)
  if (box) box.innerHTML = '<span class="mu">' + svgIcon('spinner', 'spin', 14) + ' 查询中...</span>'
  try {
    const baseEl = document.getElementById(id === 'new' ? 'aurl' : 'url-' + id)
    const baseUrl = baseEl ? baseEl.value.trim() : ''
    const r = await fetch('/admin/api/codebuddy/status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: key, baseUrl: baseUrl, region: cbRegionValue(id) }),
    })
    const d = await r.json()
    if (tr) showResult(tr, !!(d.success && d.data && d.data.ok), (d.success && d.data && d.data.ok) ? '' : (d.message || (d.data && d.data.message) || '查询失败'))
    if (!d.success || !d.data || !d.data.ok) {
      if (box) box.innerHTML = '<span class="c-e">' + escapeHtml(d.message || (d.data && d.data.message) || '查询失败') + '</span>'
      return
    }
    const s = d.data
    const num = function (v) { return (Number(v) || 0).toLocaleString() }
    let html = '<div class="quota-row" style="background:var(--bg-surface);padding:12px;border:1px solid var(--border-color);border-radius:var(--radius-md);margin-top:8px">'
      + '<div><strong>账号：</strong>' + escapeHtml(s.nickname || s.uid || '未知') + ' · <strong>区域：</strong>' + (s.realm === 'global' ? '国际版' : '国内版') + '</div>'
      + '<div style="margin-top:4px"><strong>剩余积分：</strong><span class="c-s">' + num(s.remain) + '</span> · <strong>已用/总额：</strong>' + num(s.used) + ' / ' + num(s.size) + '</div>'
      + '</div>'
    if (box) box.innerHTML = html
  } catch (e) {
    if (tr) showResult(tr, false, '请求失败')
    if (box) box.innerHTML = '<span class="c-e">请求失败</span>'
  }
}

async function codebuddyCheckin(id) {
  const tr = document.getElementById(id === 'new' ? 'atestR' : 'tr-' + id)
  const box = document.getElementById(id === 'new' ? 'cbst-new' : 'cbst-' + id)
  let key = ''
  if (id === 'new') {
    const first = document.querySelector('#akeys .aki')
    key = first ? first.value.trim() : ''
  } else {
    const keys = getKeys(id)
    key = keys.length > 0 ? keys[0].key : ''
  }
  if (!key) { toast('请先填写 refresh_token', 'error'); return }
  if (tr) showSpinner(tr)
  if (box) box.innerHTML = '<span class="mu">' + svgIcon('spinner', 'spin', 14) + ' 签到中...</span>'
  try {
    const baseEl = document.getElementById(id === 'new' ? 'aurl' : 'url-' + id)
    const baseUrl = baseEl ? baseEl.value.trim() : ''
    const r = await fetch('/admin/api/codebuddy/checkin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: key, baseUrl: baseUrl, region: cbRegionValue(id) }),
    })
    const d = await r.json()
    const ok = !!(d.success && d.data && d.data.ok)
    if (tr) showResult(tr, ok, ok ? '' : (d.message || (d.data && d.data.message) || '签到失败'))
    if (!ok) {
      if (box) box.innerHTML = '<span class="c-e">' + escapeHtml(d.message || (d.data && d.data.message) || '签到失败') + '</span>'
      return
    }
    const s = d.data
    const num = function (v) { return (Number(v) || 0).toLocaleString() }
    let html = '<div class="quota-row" style="background:var(--bg-surface);padding:12px;border:1px solid var(--border-color);border-radius:var(--radius-md);margin-top:8px">'
      + '<div><strong>状态：</strong><span class="c-s">' + (s.already ? '今日已签到' : '签到成功') + '</span> · <strong>剩余积分：</strong>' + num(s.remain) + '</div>'
      + '</div>'
    if (box) box.innerHTML = html
  } catch (e) {
    if (tr) showResult(tr, false, '请求失败')
    if (box) box.innerHTML = '<span class="c-e">请求失败</span>'
  }
}

// ── DeepSeek 弹窗与校验 ──
function openDeepseekTokenDialog(id) {
  const already = id === 'new'
    ? (document.querySelector('#akeys .aki') || {}).value || ''
    : (getKeys(id)[0] || {}).key || ''
  showM(
    '<h3>' + svgIcon('key', 'c-p', 20) + ' 获取并填入 userToken</h3>'
    + '<p class="form-helper" style="margin-bottom:8px">userToken 是 DeepSeek 网页版登录凭据。从开发者工具的 Application -> Local Storage 复制 userToken 即可。</p>'
    + '<div class="fg" style="margin-top:10px"><label for="ds-tok">粘贴 userToken 或官方 Key</label>'
    + '<textarea id="ds-tok" rows="4" class="fx1" placeholder="eyJ... 或 sk-..."></textarea>'
    + '<span class="form-helper" id="ds-tok-hint">支持网页 userToken (eyJ...) 或官方 API Key (sk-...)</span></div>'
    + '<div class="fa"><button class="btn btn-s" onclick="closeM()">取消</button>'
    + '<button class="btn btn-p" id="ds-tok-ok">' + svgIcon('check', '', 14) + ' 填入并验证</button></div>'
  )
  const ta = document.getElementById('ds-tok')
  if (ta) {
    if (already) ta.value = already
    ta.focus()
  }
  const okBtn = document.getElementById('ds-tok-ok')
  if (okBtn) okBtn.onclick = function () { applyDeepseekToken(id) }
}

function openDeepseekAccountDialog(id) {
  const el = document.getElementById('dsacc-' + id)
  const acc = el ? JSON.parse(el.textContent || '{}') : {}
  const has = !!(acc.hasPassword || acc.tokenSet)
  showM(
    '<h3>' + svgIcon('shield', 'c-p', 20) + ' DeepSeek 账号代登录</h3>'
    + '<p class="form-helper" style="margin-bottom:8px">填入账号密码，网关将自动调用官方登录接口换取 userToken。密码将采用 AES-GCM 加密存储。</p>'
    + '<div class="fg"><label>手机号 / 邮箱</label><input type="text" id="ds-acc-user" class="fx1" value="' + escapeHtml(acc.mobile || acc.email || '') + '"></div>'
    + '<div class="fg"><label>密码</label><input type="password" id="ds-acc-pass" class="fx1" placeholder="输入密码"></div>'
    + '<div class="fa"><button class="btn btn-s" onclick="closeM()">取消</button>'
    + (has ? '<button class="btn btn-d" onclick="clearDeepseekAccount(\\'' + id + '\\')">清除托管</button>' : '')
    + '<button class="btn btn-p" onclick="submitDeepseekAccount(\\'' + id + '\\')">' + svgIcon('check', '', 14) + ' 登录并保存</button></div>'
  )
}

function fillDeepseekKeyInput(id, v) {
  if (id === 'new') {
    const first = document.querySelector('#akeys .aki')
    if (first) first.value = v
    else addAKeyRow(v)
  } else {
    const list = document.getElementById('keys-' + id)
    const first = list ? list.querySelector('input[type=text]') : null
    if (first) first.value = v
    else addKeyRow(id)
  }
}

async function submitDeepseekAccount(id) {
  const u = (document.getElementById('ds-acc-user').value || '').trim()
  const p = document.getElementById('ds-acc-pass').value
  if (!u || !p) { toast('请填写账号和密码', 'error'); return }
  toast('登录中…', 'success')
  try {
    const r = await fetch('/admin/api/deepseek/account', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: id === 'new' ? (document.getElementById('aid').value.trim() || 'deepseek') : id, username: u, password: p }),
    })
    const d = await r.json()
    if (!d.success) { toast(d.message || '登录失败', 'error'); return }
    if (d.data && d.data.userToken) {
      fillDeepseekKeyInput(id, d.data.userToken)
      toast('登录成功，userToken 已填入 API Keys', 'success')
    }
    closeM()
  } catch (e) { toast('登录请求失败', 'error') }
}

async function clearDeepseekAccount(id) {
  if (!(await cM('确定清除此托管账号？'))) return
  try {
    const r = await fetch('/admin/api/deepseek/account', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: id === 'new' ? (document.getElementById('aid').value.trim() || 'deepseek') : id }),
    })
    const d = await r.json()
    toast(d.success ? '已清除' : (d.message || '清除失败'), d.success ? 'success' : 'error')
    closeM()
  } catch (e) { toast('清除请求失败', 'error') }
}

async function applyDeepseekToken(id) {
  const tok = (document.getElementById('ds-tok').value || '').trim()
  if (!tok) { toast('请填写 token', 'error'); return }
  fillDeepseekKeyInput(id, tok)
  closeM()
  toast('已填入凭据，正在校验…', 'success')
  await verifyDeepseek(id)
}

async function verifyDeepseek(id) {
  const key = id === 'new'
    ? ((document.querySelector('#akeys .aki') || {}).value || '').trim()
    : ((getKeys(id)[0] || {}).key || '').trim()
  if (!key) { toast('请先填写 API Key 或 userToken', 'error'); return }
  toast('校验凭据中…', 'success')
  try {
    const r = await fetch('/admin/api/test-key', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://chat.deepseek.com', apiKey: key, apiType: 'openai', providerType: 'deepseek' })
    })
    const d = await r.json()
    if (d.success && d.data && d.data.success) {
      toast('凭据有效', 'success')
    } else {
      toast('凭据无效: ' + ((d.data && d.data.message) || d.message || '验证失败'), 'error')
    }
  } catch (e) { toast('校验请求失败', 'error') }
}

async function fetchOAuthModels(id) {
  const tr = document.getElementById(id === 'new' ? 'atestR' : 'tr-' + id)
  const provider = provType(id)
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
    const baseEl = document.getElementById(id === 'new' ? 'aurl' : 'url-' + id)
    const baseUrl = baseEl ? baseEl.value.trim() : ''
    const r = await fetch('/admin/api/oauth/' + provider + '/models', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: key, baseUrl: baseUrl, region: cbRegionValue(id) })
    })
    const d = await r.json()
    if (!d.success) { if (tr) showResult(tr, false, d.message || '获取失败'); return }
    const models = (d.data && d.data.models) || []
    if (!models.length) { if (tr) showResult(tr, false, '未解析到模型'); return }
    const existing = {}
    const sel = id === 'new' ? '#amodels .ami' : '#ml-' + id + ' [data-idx] input'
    document.querySelectorAll(sel).forEach(function (inp) { if (inp.value.trim()) existing[inp.value.trim()] = 1 })
    const toAdd = models.filter(function (m) { return !existing[m] })
    toAdd.forEach(function (m) { if (id === 'new') addMdlToForm(m); else addMdlToEdit(id, m) })
    toast('已添加 ' + toAdd.length + ' 个模型', 'success')
    if (tr) showResult(tr, true, '')
  } catch (e) { if (tr) showResult(tr, false, '请求失败') }
}

// ── 额度 Quota 管理 ──
let quotaReady = false
async function refreshAgAccounts() {
  const box = document.getElementById('quotaBody')
  if (!box) return
  box.innerHTML = '<div class="form-helper" style="padding:12px 0;grid-column:1/-1">' + svgIcon('spinner', 'spin', 14) + ' 正在刷新账号…</div>'
  try {
    const r = await fetch('/admin/api/antigravity/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const d = await r.json()
    if (!d.success || !d.data || !Array.isArray(d.data.channels)) {
      box.innerHTML = '<div class="al al-e" style="grid-column:1/-1">' + escapeHtml(d.message || '获取账号失败') + '</div>'
      return
    }
    AG_CHANNELS = d.data.channels
    renderQuotaSkeleton()
    toast('已刷新账号列表', 'success')
  } catch (e) { box.innerHTML = '<div class="al al-e" style="grid-column:1/-1">请求失败</div>' }
}

function renderQuotaSkeleton() {
  const box = document.getElementById('quotaBody')
  if (!box) return
  if (!AG_CHANNELS.length) {
    box.innerHTML = '<div class="empty-state" style="grid-column:1/-1">' + svgIcon('gauge', '', 36) + '<h3>暂无 Antigravity 渠道</h3><p>添加一个 Antigravity 反代渠道后即可查看额度。</p></div>'
    return
  }
  box.innerHTML = renderQuotaCards(AG_CHANNELS)
}

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
  const mail = a.email ? '<code style="font-size:12px;font-weight:500;color:var(--text-primary)">' + escapeHtml(a.email) + '</code>' : ''
  const paid = (a.paidTierId && a.paidTierId !== 'free-tier')
    ? '<span class="bd bd-on">' + escapeHtml(a.paidTier || a.paidTierId) + '</span>'
    : '<span class="bd bd-off">Free</span>'
  const tierTxt = a.tierId ? (a.tier && a.tier !== 'Antigravity' ? a.tier + ' · ' + a.tierId : a.tierId) : (a.tier || '')
  const info = '<span class="fc" style="gap:8px;align-items:center;flex-wrap:wrap"><strong>账号 #' + (a.index + 1) + '</strong>' + mail + paid + '<span class="form-helper">' + escapeHtml(tierTxt) + '</span></span>'
  const btn = (chId === undefined || chId === null) ? '' : '<button class="btn btn-s" type="button" data-agq="' + chId + '" data-agi="' + a.index + '">' + svgIcon('refresh', '', 12) + ' 查询</button>'
  const head = '<div class="quota-card__head">' + info + btn + '</div>'
  if (!a.ok) {
    const isErr = !!a.error
    const msg = isErr
      ? '<div class="al al-e" style="margin-top:8px">' + escapeHtml(a.error) + '</div>'
      : '<div class="form-helper" style="margin-top:8px">未查询，点击上方「查询」获取额度详情。</div>'
    return '<div class="quota-row">' + head + msg + '</div>'
  }
  const rows = (a.models || []).map(function (m) {
    const pct = (m.remaining === null || m.remaining === undefined) ? null : Math.round(m.remaining * 100)
    const color = pct === null ? 'var(--text-subtle)' : pct > 50 ? 'var(--success)' : pct > 10 ? 'var(--warning)' : 'var(--danger)'
    const bar = pct === null ? '' : '<span class="quota-bar"><span class="quota-bar__fill" style="width:' + pct + '%;background:' + color + '"></span></span>'
    const reset = m.resetTime ? '<span class="form-helper" style="font-size:11px" title="' + escapeHtml(fmtResetLocal(m.resetTime)) + '">' + escapeHtml(fmtResetIn(m.resetTime)) + '</span>' : ''
    return '<div class="quota-row__info"><code>' + escapeHtml(m.id) + '</code><span class="fc" style="gap:6px;flex-wrap:wrap">' + reset + bar + '<strong style="min-width:36px;text-align:right">' + (pct === null ? '—' : pct + '%') + '</strong></span></div>'
  }).join('')
  return '<div class="quota-row">' + head + '<div style="margin-top:10px">' + rows + '</div></div>'
}

function renderQuotaCards(channels) {
  return channels.map(function (ch) {
    const head = '<div class="quota-card__head"><div class="quota-card__identity"><h4>' + escapeHtml(ch.name) + '</h4><code style="font-size:11px;color:var(--text-muted)">' + escapeHtml(ch.id) + '</code></div></div>'
    let accts = ''
    if (ch.accounts && ch.accounts.length) {
      ch.accounts.forEach(function (a) {
        accts += '<div class="ag-acct" id="agacct-' + ch.id + '-' + a.index + '">' + renderAgQuota(a, ch.id) + '</div>'
      })
    } else if (ch.accountCount > 0) {
      for (let i = 0; i < ch.accountCount; i++) {
        accts += '<div class="ag-acct" id="agacct-' + ch.id + '-' + i + '">' + renderAgQuota({ index: i, ok: false, models: [] }, ch.id) + '</div>'
      }
    } else {
      accts = '<div class="form-helper" style="padding:8px 0">该渠道未配置可用凭据</div>'
    }
    return '<article class="quota-card">' + head + accts + '</article>'
  }).join('')
}

async function queryAllAgQuota() {
  const box = document.getElementById('quotaBody')
  if (!box) return
  quotaReady = true
  box.innerHTML = '<div class="form-helper" style="padding:12px 0;grid-column:1/-1">' + svgIcon('spinner', 'spin', 14) + ' 正在查询全部账号，这通常需要数秒…</div>'
  try {
    const r = await fetch('/admin/api/antigravity/quota', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const d = await r.json()
    if (!d.success || !d.data || !Array.isArray(d.data.channels)) {
      box.innerHTML = '<div class="al al-e" style="grid-column:1/-1">' + escapeHtml(d.message || '查询失败') + '</div>'
      return
    }
    box.innerHTML = d.data.channels.length
      ? renderQuotaCards(d.data.channels)
      : '<div class="empty-state" style="grid-column:1/-1">' + svgIcon('gauge', '', 36) + '<h3>暂无 Antigravity 渠道</h3></div>'
    toast('已刷新全部账号额度', 'success')
  } catch (e) {
    box.innerHTML = '<div class="al al-e" style="grid-column:1/-1">请求失败</div>'
  }
}

async function agAccountQuery(chId, idx) {
  const el = document.getElementById('agacct-' + chId + '-' + idx)
  if (!el) return
  quotaReady = true
  el.innerHTML = '<div class="form-helper" style="padding:8px 0">' + svgIcon('spinner', 'spin', 14) + ' 查询中…</div>'
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

function fmtTokens(n) {
  if (!n) return '0'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

function fmtCoolUntil(ts) {
  const ms = Number(ts) - Date.now()
  if (ms <= 0) return ''
  const mins = Math.round(ms / 60000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return (h > 0 ? h + '小时' + m + '分' : Math.max(1, m) + '分钟') + '后恢复'
}

function renderClineQuotaCard(a, idx) {
  const mail = a.email ? '<code style="font-size:12px;font-weight:500;color:var(--text-primary)">' + escapeHtml(a.email) + '</code>' : ''
  const bal = (a.ok && a.balance !== undefined && a.balance !== null)
    ? '<span class="bd bd-on">' + a.balance.toFixed(4) + ' Credits</span>'
    : ''
  const head = '<div class="quota-card__head"><span class="fc" style="gap:8px;flex-wrap:wrap"><strong>账号 #' + (idx + 1) + '</strong>' + mail + bal + '</span></div>'
  if (!a.ok) {
    return '<div class="quota-row">' + head + '<div class="al al-e" style="margin-top:4px">' + escapeHtml(a.error || '查询失败') + '</div></div>'
  }
  const allModels = []
  Object.keys(a.usage || {}).forEach(function (m) { if (allModels.indexOf(m) === -1) allModels.push(m) })
  Object.keys(a.cooldowns || {}).forEach(function (m) { if (allModels.indexOf(m) === -1) allModels.push(m) })
  const rows = allModels.map(function (m) {
    const u = (a.usage || {})[m] || { requests: 0, promptTokens: 0, completionTokens: 0 }
    const until = Number((a.cooldowns || {})[m] || 0)
    const pill = until > Date.now()
      ? '<span class="bd" style="background:var(--warning-light);color:var(--warning-text);border-color:var(--warning-border)">冷却 · ' + escapeHtml(fmtCoolUntil(until)) + '</span>'
      : '<span class="bd bd-on">可用</span>'
    return '<div class="quota-row__info"><code>' + escapeHtml(m) + '</code><span class="fc" style="gap:8px">' + pill + '<span class="form-helper">今日 ' + u.requests + ' 次 · ' + fmtTokens(u.promptTokens) + '入 / ' + fmtTokens(u.completionTokens) + '出</span></span></div>'
  }).join('')
  const body = allModels.length
    ? '<div style="margin-top:10px">' + rows + '</div>'
    : '<div class="form-helper" style="margin-top:6px">今日暂无调用记录。</div>'
  return '<div class="quota-row">' + head + body + '</div>'
}

function renderClineQuotaCards(channels) {
  return channels.map(function (ch) {
    const head = '<div class="quota-card__head"><div class="quota-card__identity"><h4>' + escapeHtml(ch.name) + '</h4><code style="font-size:11px;color:var(--text-muted)">' + escapeHtml(ch.id) + '</code></div></div>'
    let accts = ''
    if (ch.accounts && ch.accounts.length) {
      ch.accounts.forEach(function (a, i) { accts += '<div class="ag-acct">' + renderClineQuotaCard(a, i) + '</div>' })
    } else {
      accts = '<div class="form-helper" style="padding:8px 0">该渠道未配置可用凭据</div>'
    }
    return '<article class="quota-card">' + head + accts + '</article>'
  }).join('')
}

async function queryAllClineQuota() {
  const box = document.getElementById('clineQuotaBody')
  if (!box) return
  box.innerHTML = '<div class="form-helper" style="padding:12px 0;grid-column:1/-1">' + svgIcon('spinner', 'spin', 14) + ' 正在查询全部 Cline 账号…</div>'
  try {
    const r = await fetch('/admin/api/cline/quota', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const d = await r.json()
    if (!d.success || !d.data || !Array.isArray(d.data.channels)) {
      box.innerHTML = '<div class="al al-e" style="grid-column:1/-1">' + escapeHtml(d.message || '查询失败') + '</div>'
      return
    }
    box.innerHTML = d.data.channels.length
      ? renderClineQuotaCards(d.data.channels)
      : '<div class="empty-state" style="grid-column:1/-1">' + svgIcon('gauge', '', 36) + '<h3>暂无 Cline 渠道</h3></div>'
    toast('已刷新 Cline 账号额度', 'success')
  } catch (e) {
    box.innerHTML = '<div class="al al-e" style="grid-column:1/-1">请求失败</div>'
  }
}

// ── Azure TTS ──
function addAllTtsModels(id) {
  if (id === 'new') {
    const container = document.getElementById('amodels')
    const existing = new Set(Array.from(container.querySelectorAll('.ami')).map(i => i.value.trim()))
    let added = 0
    AZURE_VOICE_IDS.forEach(v => {
      if (existing.has(v)) return
      const d = document.createElement('div')
      d.className = 'fc mb-4 field-row'
      d.innerHTML = '<input type="text" value="' + escapeHtml(v) + '" class="fx1 ami"><input type="text" placeholder="对外名(可选)" class="fx1 amal"><label class="tg"><input type="checkbox" checked class="ame"><span class="sl"></span></label><button class="icon-btn" onclick="copyRowVal(this)">' + svgIcon('copy', '', 14) + '</button><button class="icon-btn" onclick="testNewMdl(this)">' + svgIcon('plug', '', 14) + '</button><button class="icon-btn" onclick="this.parentElement.remove()">' + svgIcon('times', '', 14) + '</button>'
      container.appendChild(d)
      added++
    })
    toast('已添加 ' + added + ' 个音色为模型', 'success')
  } else {
    const container = document.getElementById('ml-' + id)
    const existing = new Set(Array.from(container.querySelectorAll('[id^=mid-]')).map(i => i.value.trim()))
    let added = 0
    AZURE_VOICE_IDS.forEach(v => {
      if (existing.has(v)) return
      const idx = container.querySelectorAll('[data-idx]').length
      const d = document.createElement('div')
      d.className = 'fc mb-3 field-row'
      d.dataset.idx = idx
      d.innerHTML = '<input type="text" value="' + escapeHtml(v) + '" class="fx1" id="mid-' + id + '-' + idx + '"><input type="text" placeholder="对外名(可选)" class="fx1" id="mal-' + id + '-' + idx + '"><label class="tg"><input type="checkbox" checked id="men-' + id + '-' + idx + '"><span class="sl"></span></label><button class="icon-btn" onclick="copyRowVal(this)">' + svgIcon('copy', '', 14) + '</button><button class="icon-btn" onclick="testMdl(\\'' + id + '\\',\\'' + v + '\\',' + idx + ')">' + svgIcon('plug', '', 14) + '</button><button class="icon-btn" onclick="rmMdl(\\'' + id + '\\',' + idx + ')">' + svgIcon('times', '', 14) + '</button>'
      container.appendChild(d)
      added++
    })
    toast('已添加 ' + added + ' 个音色为模型', 'success')
  }
}

function addTtsModel(id) {
  const sel = document.getElementById(id === 'new' ? 'av' : 'pv-' + id)
  const voice = sel ? sel.value.trim() : ''
  if (!voice) { toast('请先选择一个音色', 'error'); return }
  if (id === 'new') addMdlToForm(voice)
  else addMdlToEdit(id, voice)
  toast('已添加音色模型：' + voice, 'success')
}

async function previewTts(id) {
  const box = document.getElementById('ttp-' + id)
  if (!box) return
  const vEl = document.getElementById(id === 'new' ? 'av' : 'pv-' + id)
  const voice = vEl ? vEl.value.trim() : ''
  const rEl = document.getElementById(id === 'new' ? 'ar' : 'pr-' + id)
  const rate = rEl ? rEl.value.trim() : ''
  const volEl = document.getElementById(id === 'new' ? 'avol' : 'pvol-' + id)
  const vol = volEl ? volEl.value.trim() : ''
  const pEl = document.getElementById(id === 'new' ? 'ap' : 'pp-' + id)
  const pitch = pEl ? pEl.value.trim() : ''
  box.innerHTML = '<span class="mu">' + svgIcon('spinner', 'spin', 14) + ' 正在生成试听音频…</span>'
  try {
    const res = await fetch('/admin/api/tts/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice: voice || undefined, rate: rate || undefined, volume: vol || undefined, pitch: pitch || undefined }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      box.innerHTML = '<div class="al al-e">' + escapeHtml(err.message || '生成试听音频失败') + '</div>'
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    box.innerHTML = '<audio controls autoplay src="' + url + '" style="width:100%;margin-top:6px;height:36px"></audio>'
  } catch (e) {
    box.innerHTML = '<div class="al al-e">试听请求失败</div>'
  }
}

// ── 表单动态行管理 ──
function addAKeyRow(val) {
  const c = document.getElementById('akeys')
  const d = document.createElement('div')
  d.className = 'fc mb-4 field-row'
  d.innerHTML = '<input type="text" placeholder="sk-xxx" class="fx1 aki" value="' + (val || '') + '"><label class="tg"><input type="checkbox" checked class="ake"><span class="sl"></span></label><button class="icon-btn" onclick="copyRowVal(this)" title="复制">' + svgIcon('copy', '', 14) + '</button><button class="icon-btn" onclick="testNewAKey(this)" title="测试">' + svgIcon('plug', '', 14) + '</button><button class="icon-btn" onclick="this.parentElement.remove()" title="移除">' + svgIcon('times', '', 14) + '</button>'
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
    return '<div class="model-token" style="margin:4px">' +
      '<span class="cp" onclick="copyText(\\'' + modelId + '\\',this)">' + safeId + '</span>' +
      '<button class="icon-btn" style="width:20px;height:20px;margin-left:4px" onclick="' + addFn + '" title="添加到表单">' + svgIcon('plus', '', 10) + '</button></div>'
  }).join('')
  return '<div class="fc" style="flex-wrap:wrap;gap:4px">' + h + '</div>'
}

function modelPanelHeading(panelId) {
  return '<div class="panel-heading"><div>' +
    '<span class="panel-heading__mark">' + svgIcon('cube', '', 16) + '</span>' +
    '<div><h3>可用模型</h3><p>点击加号添加到配置中。</p></div></div>' +
    '<button class="icon-btn" type="button" onclick="hideMdlPanel(\\'' + panelId + '\\')">' + svgIcon('times', '', 14) + '</button></div>'
}

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

function batchAddKeys() {
  showM('<h3>' + svgIcon('key', 'c-p', 20) + ' 批量添加 API Key</h3><div class="fg"><label>每行一个 Key</label><textarea id="bkText" rows="8" class="fx1" placeholder="sk-xxx1&#10;sk-xxx2"></textarea></div><div class="fa"><button class="btn btn-s" onclick="closeM()">取消</button><button class="btn btn-p" id="bkOk">批量添加</button></div>')
  const ok = document.getElementById('bkOk')
  ok.onclick = function () {
    const text = document.getElementById('bkText').value.trim()
    if (!text) { toast('请粘贴至少一个 Key', 'error'); return }
    const keys = text.split(String.fromCharCode(10)).map(function (s) { return s.trim() }).filter(Boolean)
    let ki = 0
    Array.from(document.querySelectorAll('#akeys .aki')).forEach(function (r) {
      if (ki >= keys.length) return
      if (!r.value.trim()) { r.value = keys[ki++]; }
    })
    while (ki < keys.length) { addAKeyRow(keys[ki++]) }
    closeM()
    toast('已导入 ' + keys.length + ' 个 Key', 'success')
  }
}

async function batchTestKeys() {
  const rows = Array.from(document.querySelectorAll('#akeys .aki')).map(function (el) { return el.value.trim() }).filter(Boolean)
  if (!rows.length) { toast('没有需要测试的 Key', 'error'); return }
  const url = document.getElementById('aurl').value.trim()
  if (!url) { toast('请先填写 API 地址', 'error'); return }
  const apiType = document.getElementById('apt').value === 'anthropic' ? 'anthropic' : 'openai'
  const tr = document.getElementById('atestR')
  showSpinner(tr)
  let ok = 0
  for (const k of rows) {
    const res = await testKeyConnection(url, apiType, k, document.getElementById('aid').value.trim(), document.getElementById('amirror').value, false, provType('new'), provProject('new'))
    if (res.success) ok++
  }
  showResult(tr, ok > 0, '测试完成: ' + ok + ' / ' + rows.length + ' 个 Key 连接正常')
}

function cleanModelAlias(id) {
  return String(id || '')
    .replace(/[:\/_-]free$/i, '')
    .replace(/:free(?=[:\/_-]|$)/gi, '')
}

function addMdlRow() {
  const c = document.getElementById('amodels')
  const d = document.createElement('div')
  d.className = 'fc mb-4 field-row'
  d.innerHTML = '<input type="text" placeholder="模型 ID" class="fx1 ami"><input type="text" placeholder="对外名(可选)" class="fx1 amal"><label class="tg"><input type="checkbox" checked class="ame"><span class="sl"></span></label><button class="icon-btn" onclick="copyRowVal(this)">' + svgIcon('copy', '', 14) + '</button><button class="icon-btn" onclick="testNewMdl(this)">' + svgIcon('plug', '', 14) + '</button><button class="icon-btn" onclick="this.parentElement.remove()">' + svgIcon('times', '', 14) + '</button>'
  c.appendChild(d)
}

function addMdlToForm(mid) {
  const rows = document.querySelectorAll('#amodels .ami')
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].value.trim()) {
      rows[i].value = mid
      const al = rows[i].parentElement.querySelector('.amal')
      if (al && !al.value) al.value = cleanModelAlias(mid)
      return
    }
  }
  addMdlRow()
  const all = document.querySelectorAll('#amodels .ami')
  const last = all[all.length - 1]
  last.value = mid
  const al = last.parentElement.querySelector('.amal')
  if (al && !al.value) al.value = cleanModelAlias(mid)
}

function testNewMdl(btn) {
  const mid = btn.parentElement.querySelector('.ami').value.trim()
  if (!mid) { toast('请输入模型 ID', 'error'); return }
  const url = document.getElementById('aurl').value.trim()
  const firstKey = (document.querySelector('#akeys .aki') || {}).value || ''
  const apiType = document.getElementById('apt').value === 'anthropic' ? 'anthropic' : 'openai'
  const tr = document.getElementById('atestR')
  showSpinner(tr)
  testModelConnection(url, apiType, firstKey, mid, document.getElementById('aid').value.trim(), document.getElementById('amirror').value, provType('new'), provProject('new')).then(function(r) {
    showResult(tr, r.success, r.success ? '' : 'HTTP ' + r.status)
  })
}

async function fetchNewModels(freeOnly) {
  const url = document.getElementById('aurl').value.trim()
  const firstKey = (document.querySelector('#akeys .aki') || {}).value || ''
  const apiType = document.getElementById('apt').value === 'anthropic' ? 'anthropic' : 'openai'
  const tr = document.getElementById('atestR')
  showSpinner(tr)
  const result = await testKeyConnection(url, apiType, firstKey, document.getElementById('aid').value.trim(), document.getElementById('amirror').value, freeOnly, provType('new'), provProject('new'))
  showResult(tr, result.success, result.success ? '' : escapeHtml(result.message || '获取模型失败'))
  if (result.success && result.data) {
    document.getElementById('amcl').innerHTML = renderModelGrid(result.data.data || [], null, document.getElementById('aid').value.trim())
    document.getElementById('amc').classList.remove('hd')
  }
}

async function createProv() {
  const nm = document.getElementById('anm').value.trim()
  const id = document.getElementById('aid').value.trim()
  let url = document.getElementById('aurl').value.trim()
  const type = document.getElementById('apt').value
  const apiType = type === 'anthropic' ? 'anthropic' : 'openai'
  const isTts = type === 'azure-tts'
  if (!nm || !id) { toast('请填写渠道名称和 ID', 'error'); return }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) { toast('ID 只能包含字母/数字/下划线/连字符', 'error'); return }
  if (!url && type === 'antigravity') url = 'https://daily-cloudcode-pa.googleapis.com'
  if (!url && type === 'vertex') url = 'https://aiplatform.googleapis.com'
  if (!url && type === 'devin') url = 'https://server.codeium.com'
  if (!url && (isOauthType(type) || isDeepseekType(type) || isZaiType(type))) url = OAUTH_DEFAULT_URLS[type] || ''
  if (!url && !isTts) { toast('请填写 API 地址', 'error'); return }

  let keys = Array.from(document.querySelectorAll('#akeys .field-row')).map(r => {
    const k = r.querySelector('.aki').value.trim(), en = r.querySelector('.ake').checked
    return k ? { key: k, enabled: en } : null
  }).filter(Boolean)

  const vxKeys = type === 'vertex' ? provVertexKeys('new') : null
  if (vxKeys && vxKeys.length) keys = vxKeys.map(k => ({ key: k, enabled: true }))
  const dvKeys = type === 'devin' ? provDevinKeys('new') : null
  if (dvKeys && dvKeys.length) keys = dvKeys.map(k => ({ key: k, enabled: true }))

  const models = Array.from(document.querySelectorAll('#amodels .field-row')).map(r => {
    const mid = r.querySelector('.ami').value.trim(), en = r.querySelector('.ame').checked
    const alEl = r.querySelector('.amal'), alias = alEl ? alEl.value.trim() : ''
    if (!mid) return null
    return alias ? { id: mid, enabled: en, alias: alias } : { id: mid, enabled: en }
  }).filter(Boolean)

  const enabled = document.getElementById('aen').checked
  const autoSyncModels = document.getElementById('async-new') ? document.getElementById('async-new').checked : false
  const mirrorUrls = document.getElementById('amirror').value
  const ttsConf = isTts ? {
    voice: document.getElementById('av').value.trim() || 'zh-CN-XiaoxiaoNeural',
    rate: document.getElementById('ar').value.trim() || '+0%',
    volume: document.getElementById('avol').value.trim() || '+0%',
    pitch: document.getElementById('ap').value.trim() || '+0Hz',
  } : {}

  const r = await fetch('/admin/api/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name: nm, baseUrl: url, apiType, type, region: isCodebuddyType(type) ? cbRegionValue('new') : undefined, apiKeys: keys, models, mirrorUrls, enabled, autoSyncModels, project: provProject('new') || undefined, location: provVertexLocation('new') || undefined, ...ttsConf })
  })
  const d = await r.json()
  if (d.success) { toast('渠道创建成功', 'success'); location.reload() }
  else toast(d.message || '创建失败', 'error')
}

// ── 编辑渠道 ──
function getKeys(id) {
  const c = document.getElementById('keys-' + id), items = c.querySelectorAll('[data-kidx]')
  return Array.from(items).map(item => {
    const idx = parseInt(item.dataset.kidx)
    const k = document.getElementById('k-' + id + '-' + idx).value.trim()
    const en = document.getElementById('ken-' + id + '-' + idx).checked
    return k ? { key: k, enabled: en } : null
  }).filter(Boolean)
}

function addKeyRow(id) {
  const inp = document.getElementById('nk-' + id), v = inp.value.trim()
  if (!v) { toast('请输入 Key', 'error'); return }
  const c = document.getElementById('keys-' + id), idx = c.querySelectorAll('[data-kidx]').length
  const d = document.createElement('div')
  d.className = 'fc mb-3 field-row'
  d.dataset.kidx = idx
  d.innerHTML = '<input type="text" value="' + escapeHtml(v) + '" class="fx1" id="k-' + id + '-' + idx + '"><label class="tg"><input type="checkbox" checked id="ken-' + id + '-' + idx + '"><span class="sl"></span></label><button class="icon-btn" onclick="copyRowVal(this)">' + svgIcon('copy', '', 14) + '</button><button class="icon-btn" onclick="testKeyRow(\\'' + id + '\\',' + idx + ')">' + svgIcon('plug', '', 14) + '</button><button class="icon-btn" onclick="rmKeyRow(\\'' + id + '\\',' + idx + ')">' + svgIcon('times', '', 14) + '</button>'
  c.appendChild(d)
  inp.value = ''
}

function rmKeyRow(id, idx) {
  const el = document.querySelector('#keys-' + id + ' [data-kidx="' + idx + '"]')
  if (el) el.remove()
}

async function testKeyRow(id, idx) {
  const k = document.getElementById('k-' + id + '-' + idx).value.trim()
  const url = document.getElementById('url-' + id).value.trim()
  const ptEl = document.getElementById('pt-' + id)
  const apiType = (ptEl ? ptEl.value : 'openai') === 'anthropic' ? 'anthropic' : 'openai'
  const mirEl = document.getElementById('mir-' + id)
  const mirrorUrls = mirEl ? mirEl.value : undefined
  const tr = document.getElementById('tr-' + id)
  showSpinner(tr)
  const result = await testKeyConnection(url, apiType, k, id, mirrorUrls, false, provType(id), provProject(id))
  showResult(tr, result.success, result.success ? '' : 'HTTP ' + result.status)
}

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
    const keysFs = document.getElementById('keys-' + id).closest('fieldset')
    el = document.createElement('aside')
    el.id = cid
    el.className = 'mdl-list-panel'
    el.innerHTML = modelPanelHeading(cid) + '<div id="melc-' + id + '"></div>'
    keysFs.insertAdjacentElement('afterend', el)
  }
  el.classList.remove('hd')
  document.getElementById('melc-' + id).innerHTML = renderModelGrid(models, id, id)
}

function addMdlToEdit(id, mid) {
  document.getElementById('nmid-' + id).value = mid
  const al = document.getElementById('nmal-' + id)
  if (al) al.value = cleanModelAlias(mid)
  addMdl(id)
}

function getMdl(id) {
  const c = document.getElementById('ml-' + id), items = c.querySelectorAll('[data-idx]')
  return Array.from(items).map(item => {
    const idx = parseInt(item.dataset.idx), mid = document.getElementById('mid-' + id + '-' + idx).value.trim()
    const en = document.getElementById('men-' + id + '-' + idx).checked
    const alEl = document.getElementById('mal-' + id + '-' + idx)
    let alias = alEl ? alEl.value.trim() : ''
    if (!alias && mid) alias = cleanModelAlias(mid)
    if (!mid) return null
    return alias ? { id: mid, enabled: en, alias: alias } : { id: mid, enabled: en }
  }).filter(Boolean)
}

async function save(id) {
  const nm = document.getElementById('nm-' + id).value.trim()
  const urlEl = document.getElementById('url-' + id)
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
  const autoSyncModels = document.getElementById('sync-' + id) ? document.getElementById('sync-' + id).checked : false
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
    body: JSON.stringify({ name: nm, baseUrl: url, apiType, type, region: isCodebuddyType(type) ? cbRegionValue(id) : undefined, apiKeys: keys, models, mirrorUrls, enabled, autoSyncModels, newId, project: provProject(id) || undefined, location: provVertexLocation(id) || undefined, ...ttsConf })
  })
  const d = await r.json()
  if (d.success) { toast('已保存', 'success'); location.reload() }
  else toast(d.message || '保存失败', 'error')
}

async function del(id) {
  if (!(await cM('确定要删除此渠道？此操作不可逆。'))) return
  const r = await fetch('/admin/api/providers/' + encodeURIComponent(id), { method: 'DELETE' })
  const d = await r.json()
  if (d.success) { toast('已删除', 'success'); location.reload() }
  else toast(d.message || '删除失败', 'error')
}

async function autoUpdateProviderModels(id) {
  toast('正在拉取上游最新模型并自动去 -free 增量入库…', 'success')
  try {
    const r = await fetch('/admin/api/providers/' + encodeURIComponent(id) + '/sync-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ freeOnly: false }),
    })
    const d = await r.json()
    if (d.success) {
      toast(d.message || '模型已更新并保存入库', 'success')
      setTimeout(() => location.reload(), 1200)
    } else {
      toast(d.message || '更新失败', 'error')
    }
  } catch (e) {
    toast('网络请求失败: ' + e.message, 'error')
  }
}

async function syncAllEnabledModels() {
  toast('正在同步所有开启了「自动同步」的渠道…', 'success')
  try {
    const r = await fetch('/admin/api/sync-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ freeOnly: false }),
    })
    const d = await r.json()
    if (d.success) {
      toast(d.message || '全渠道同步完成', 'success')
      setTimeout(() => location.reload(), 1500)
    } else {
      toast(d.message || '同步失败', 'error')
    }
  } catch (e) {
    toast('网络请求失败: ' + e.message, 'error')
  }
}

function addMdl(id) {
  const inp = document.getElementById('nmid-' + id), mid = inp.value.trim()
  const alInp = document.getElementById('nmal-' + id)
  let alias = alInp ? alInp.value.trim() : ''
  if (!alias && mid) alias = cleanModelAlias(mid)
  if (!mid) { toast('请输入模型 ID', 'error'); return }
  const c = document.getElementById('ml-' + id), idx = c.querySelectorAll('[data-idx]').length
  const d = document.createElement('div')
  d.className = 'fc mb-3 field-row'
  d.dataset.idx = idx
  d.innerHTML = '<input type="text" value="' + escapeHtml(mid) + '" class="fx1" id="mid-' + id + '-' + idx + '"><input type="text" value="' + escapeHtml(alias) + '" placeholder="对外名(可选)" class="fx1" id="mal-' + id + '-' + idx + '"><label class="tg"><input type="checkbox" checked id="men-' + id + '-' + idx + '"><span class="sl"></span></label><button class="icon-btn" onclick="copyRowVal(this)">' + svgIcon('copy', '', 14) + '</button><button class="icon-btn" onclick="testMdl(\\'' + id + '\\',\\'' + mid + '\\',' + idx + ')">' + svgIcon('plug', '', 14) + '</button><button class="icon-btn" onclick="rmMdl(\\'' + id + '\\',' + idx + ')">' + svgIcon('times', '', 14) + '</button>'
  c.appendChild(d)
  inp.value = ''
  if (alInp) alInp.value = ''
}

function rmMdl(id, idx) {
  const el = document.querySelector('#ml-' + id + ' [data-idx="' + idx + '"]')
  if (el) el.remove()
}

async function testMdl(id, mid, idx) {
  const url = document.getElementById('url-' + id).value.trim()
  const keys = getKeys(id)
  const apiKey = keys.length > 0 ? keys[0].key : ''
  const ptEl = document.getElementById('pt-' + id)
  const apiType = (ptEl ? ptEl.value : 'openai') === 'anthropic' ? 'anthropic' : 'openai'
  const mirEl = document.getElementById('mir-' + id)
  const mirrorUrls = mirEl ? mirEl.value : undefined
  const tr = document.getElementById('tr-' + id)
  showSpinner(tr)
  try {
    const r = await fetch('/admin/api/test-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url, apiKey: apiKey, apiType: apiType, model: mid, providerId: id, mirrorUrls: mirrorUrls || undefined, providerType: provType(id), project: provProject(id) || undefined })
    })
    const d = await r.json()
    showResult(tr, d.success, d.message || '')
  } catch (e) { showResult(tr, false, '请求失败') }
}

// ── 令牌管理 ──
async function genKey() {
  const name = await pM('输入令牌名称（例如：应用开发、生产环境）')
  if (name === null) return
  showM('<h3>' + svgIcon('key', 'c-p', 20) + ' 生成访问令牌</h3><div class="fg"><label>有效期</label><select id="exp"><option value="30d">30 天</option><option value="90d">90 天</option><option value="180d">180 天</option><option value="1y">1 年</option><option value="forever" selected>永久有效</option></select></div><div class="fa"><button class="btn btn-s" id="gKc">取消</button><button class="btn btn-p" id="gKo">立即生成</button></div>')
  document.getElementById('gKc').addEventListener('click', closeM)
  document.getElementById('gKo').addEventListener('click', function() { doGenKey(document.getElementById('exp').value, name) })
}

async function doGenKey(exp, name) {
  closeM()
  const r = await fetch('/admin/api/proxy-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name || '', expiresIn: exp })
  })
  const d = await r.json()
  if (d.success && d.data) {
    showM('<h3>' + svgIcon('check', 'c-s', 20) + ' 令牌生成成功</h3><p>请妥善保存该 Key，出于安全原因它只展示一次：</p><div class="endpoint-box endpoint-box--key" style="margin-top:10px"><code>' + d.data.key + '</code><button class="btn btn-s" onclick="copyText(\\'' + d.data.key + '\\',this)">' + svgIcon('copy', '', 14) + ' 复制</button></div><div class="fa"><button class="btn btn-p" onclick="closeM();location.reload()">完成</button></div>')
  } else toast(d.message || '生成失败', 'error')
}

async function rmKey(id) {
  if (!(await cM('确定要删除此 Key？删除后客户端将立即无法接入。'))) return
  const r = await fetch('/admin/api/proxy-keys/' + encodeURIComponent(id), { method: 'DELETE' })
  const d = await r.json()
  if (d.success) { toast('已删除', 'success'); location.reload() }
  else toast(d.message || '删除失败', 'error')
}

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
  showM('<h3>' + svgIcon('refresh', 'c-p', 20) + ' 令牌已重新生成</h3><div class="endpoint-box endpoint-box--key" style="margin-top:10px"><code>' + nk + '</code><button class="btn btn-s" id="rgCopyBtn">' + svgIcon('copy', '', 14) + ' 复制</button></div><div class="fa"><button class="btn btn-p" onclick="closeM()">关闭</button></div>')
  const copyBtn = document.getElementById('rgCopyBtn')
  if (copyBtn) copyBtn.onclick = function () { copyText(nk, this); toast('已复制', 'success') }
  toast('已重新生成', 'success')
}

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
    el.textContent = full.length > 12 ? full.substring(0, 8) + '*****' + full.substring(full.length - 4) : full
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
      const b = ki.querySelector('.key-actions .bd')
      if (b) { b.textContent = checked ? '已启用' : '已禁用'; b.className = 'bd ' + (checked ? 'bd-on' : 'bd-off') }
    }
  } else toast(d.message || '操作失败', 'error')
}

// ── 导航与路由 ──
const adminNavLinks = Array.from(document.querySelectorAll('.admin-nav a[href^="#"], .admin-topbar__nav a[href^="#"]'))
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

// ── 用量统计 ──
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

    const trendEl = document.getElementById('u-trend')
    const trendWrap = document.getElementById('u-trend-wrap')
    if (s.daily && s.daily.length > 1) {
      const max = Math.max(...s.daily.map((x) => x.requests), 1)
      trendEl.innerHTML = '<div class="fc" style="flex-direction:column;gap:10px">' + s.daily.map((x) => {
        const pct = Math.max(Math.round((x.requests / max) * 100), 2)
        return '<div class="fc" style="width:100%;gap:12px"><span style="flex:0 0 70px;font-size:12px;color:var(--text-muted)">' + x.date.slice(5) + '</span><div style="flex:1;height:12px;background:var(--bg-surface-subtle);border-radius:var(--radius-full);overflow:hidden"><div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,#2563eb,#3b82f6);border-radius:var(--radius-full)"></div></div><span style="flex:0 0 120px;text-align:right;font-size:11px">' + fmtNum(x.requests) + ' 次 · ' + fmtTok(x.promptTokens + x.completionTokens) + ' tok</span></div>'
      }).join('') + '</div>'
      trendWrap.classList.remove('hd')
    } else {
      trendWrap.classList.add('hd')
    }

    renderRank('u-models', s.byModel, 'model')
    renderRank('u-providers', s.byProvider, 'provider')
  } catch (e) {
    toast(e.message || '用量加载失败', 'error')
  }
}

function renderRank(elId, list, keyName) {
  const el = document.getElementById(elId)
  if (!el) return
  if (!list || list.length === 0) {
    el.innerHTML = '<p class="mu" style="padding:12px 0">暂无数据</p>'
    return
  }
  const max = Math.max(...list.map((x) => x.requests), 1)
  el.innerHTML = list.slice(0, 10).map((x) => {
    const pct = Math.max(Math.round((x.requests / max) * 100), 3)
    return '<div class="rank-row" style="margin-bottom:12px">' +
      '<div class="quota-row__info">' +
      '<code style="font-size:12px;max-width:65%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtml(x[keyName]) + '">' + escapeHtml(x[keyName]) + '</code>' +
      '<span class="form-helper">' + fmtNum(x.requests) + ' 次 · ' + fmtTok(x.promptTokens + x.completionTokens) + ' tok</span></div>' +
      '<div class="rank-bar"><div class="rank-bar__fill" style="width:' + pct + '%"></div></div></div>'
  }).join('')
}

function setText(id, text) {
  const el = document.getElementById(id)
  if (el) el.textContent = text
}

// ── 备份与恢复 ──
function bkResult(elId, ok, msg) {
  const el = document.getElementById(elId)
  if (el) el.innerHTML = '<div class="al ' + (ok ? 'al-s' : 'al-e') + '" style="margin-top:10px">' + (ok ? svgIcon('check', '', 14) : svgIcon('alert', '', 14)) + ' <span>' + escapeHtml(msg) + '</span></div>'
}

function adminAuthHash() {
  return new Promise(function (resolve) {
    showM('<h3>' + svgIcon('lock', 'c-p', 20) + ' 验证管理员密码</h3><p class="form-helper">此操作敏感，请输入管理员密码继续。</p><div class="fg"><label>管理员密码</label><input type="password" id="authPass" class="fx1" placeholder="请输入密码" autocomplete="current-password"></div><div class="fa"><button class="btn btn-s" onclick="closeM()">取消</button><button class="btn btn-p" id="authOk">确认</button></div>')
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
    bkResult('bk-io-result', true, '已成功导出数据库文件 ' + name)
  } catch (e) { bkResult('bk-io-result', false, '导出失败: ' + e.message) }
}

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
    el.innerHTML = '<div class="panel-list" style="margin-top:10px">' + list.map(function (f) {
      const shortKey = f.key.indexOf('/') >= 0 ? f.key.slice(f.key.indexOf('/') + 1) : f.key
      const Q = String.fromCharCode(39)
      return '<div class="fc field-row" style="justify-content:space-between;padding:8px 12px;background:var(--bg-surface-subtle);border:1px solid var(--border-color);border-radius:var(--radius-md);margin-bottom:6px"><span style="font-family:var(--font-mono);font-size:12px;overflow:hidden;text-overflow:ellipsis">' + shortKey + '</span><span class="fc" style="gap:8px"><span style="font-size:11px;color:var(--text-muted)">' + (f.size ? (f.size / 1024).toFixed(1) + ' KB' : '') + '</span><button class="btn btn-s" onclick="backupRestore(' + Q + f.key + Q + ')" style="padding:2px 8px;font-size:11px">' + svgIcon('refresh', '', 12) + ' 恢复</button><button class="btn btn-d" onclick="backupDelete(' + Q + f.key + Q + ')" style="padding:2px 8px;font-size:11px">' + svgIcon('trash', '', 12) + '</button></span></div>'
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

async function telegramSave() {
  const el = document.getElementById('bk-tg-result')
  showSpinner(el)
  const p = tgParams()
  if (!p.botToken || !p.chatId) { bkResult('bk-tg-result', false, '请先填写 Bot Token 和 USER ID'); return }
  try {
    const r = await fetch('/admin/api/telegram/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    })
    const d = await r.json()
    bkResult('bk-tg-result', d.success, d.message || (d.success ? '配置已保存' : '保存失败'))
    if (d.success) toast('Telegram 备份配置已保存', 'success')
  } catch (e) {
    bkResult('bk-tg-result', false, '保存请求失败')
  }
}

async function backupToTelegram() {
  const el = document.getElementById('bk-tg-result')
  showSpinner(el)
  const p = tgParams()
  if (!p.botToken || !p.chatId) { bkResult('bk-tg-result', false, '请先填写 Bot Token 和 USER ID'); return }
  const r = await fetch('/admin/api/telegram/to-telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  })
  const d = await r.json()
  bkResult('bk-tg-result', d.success, d.message || '备份失败')
}

// ── 侧边栏收缩与展开 ──
function toggleRail() {
  const rail = document.querySelector('.admin-rail')
  const collapsed = rail.classList.toggle('collapsed')
  try { localStorage.setItem('admin-rail-collapsed', collapsed ? '1' : '0') } catch (e) {}
  const btn = document.querySelector('.rail-toggle')
  if (btn) btn.title = collapsed ? '展开侧边栏' : '收缩侧边栏'
}
try {
  if (localStorage.getItem('admin-rail-collapsed') === '1') {
    document.querySelector('.admin-rail')?.classList.add('collapsed')
    const btn = document.querySelector('.rail-toggle')
    if (btn) btn.title = '展开侧边栏'
  }
} catch (e) {}

// ── Tab 切换 ──
function showModule() {
  const hash = location.hash || '#overview'
  const mods = ['overview', 'providers', 'quota', 'proxy-keys', 'usage', 'backup']
  mods.forEach(m => {
    const el = document.getElementById(m)
    if (el) {
      if (hash === '#' + m) {
        el.style.display = 'block'
        el.classList.add('is-active')
      } else {
        el.style.display = 'none'
        el.classList.remove('is-active')
      }
    }
  })
  document.querySelectorAll('.admin-nav__link, .admin-topbar__nav a').forEach(a => {
    const href = a.getAttribute('href') || ''
    a.classList.toggle('is-active', href === hash || (hash === '#overview' && href === '#overview'))
  })
  if (hash === '#usage') loadUsage()
  if (hash === '#quota' && !quotaReady) renderQuotaSkeleton()
}
window.addEventListener('hashchange', showModule)
showModule()

const quotaBodyEl = document.getElementById('quotaBody')
if (quotaBodyEl) {
  quotaBodyEl.addEventListener('click', function (e) {
    const b = e.target && e.target.closest ? e.target.closest('[data-agq]') : null
    if (!b) return
    agAccountQuery(b.getAttribute('data-agq'), Number(b.getAttribute('data-agi')))
  })
}

if (location.hash === '#usage') loadUsage()

// ── 通用复制按钮（概览 API BASE URL 等）：图标换对勾 + 文字变已复制，1.8s 还原 ──
document.querySelectorAll('.copy-control').forEach(function (button) {
  button.addEventListener('click', async function () {
    var text = button.getAttribute('data-copy') || ''
    var iconWrap = button.querySelector('.svg-icon')
    var label = button.querySelector('.copy-label')
    var originalLabel = label ? label.textContent : ''
    try {
      await navigator.clipboard.writeText(text)
      button.setAttribute('data-state', 'success')
      if (iconWrap && window.SVG_ICONS && window.SVG_ICONS.check) iconWrap.innerHTML = window.SVG_ICONS.check
      if (label) label.textContent = '已复制'
      setTimeout(function () {
        button.removeAttribute('data-state')
        if (iconWrap && window.SVG_ICONS && window.SVG_ICONS.copy) iconWrap.innerHTML = window.SVG_ICONS.copy
        if (label) label.textContent = originalLabel
      }, 1800)
    } catch (e) {
      button.setAttribute('data-state', 'error')
    }
  })
})
`
