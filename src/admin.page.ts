import { Context } from 'hono'
import { getProviders, getProxyKeys } from './storage'
import { getCodexUpstreamRelay } from './codex'
import { SITE_CONFIG, OPENCODE_DEFAULT_URL } from './config'
import type { Env } from './types'
import { CSS_CONTENT } from './pages.css'
import { getExternalOrigin } from './request-utils'
import { icon, SHARED_JS, renderSiteFooter } from './shared.js'
import { storageTypeLabel } from './storage-adapter'
import { AZURE_TTS_VOICES, voiceGroup } from './azure-voices'
import { ADMIN_CLIENT_SCRIPT } from './admin.script'
import { getTgConfig } from './backup'

function getPlatformLabel(_env: any, _host?: string): string {
  return 'Koyeb · PostgreSQL'
}

const AZURE_VOICE_OPTIONS = (() => {
  const groups = new Map<string, string[]>()
  for (const v of AZURE_TTS_VOICES) {
    const g = v.group || voiceGroup(v.id)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(`<option value="${v.id}">${v.label} (${v.id})</option>`)
  }
  return Array.from(groups.entries()).map(([g, opts]) => `<optgroup label="${g}">${opts.join('')}</optgroup>`).join('')
})()

const azureVoiceOptions = (selected: string) => {
  const groups = new Map<string, string[]>()
  for (const v of AZURE_TTS_VOICES) {
    const g = v.group || voiceGroup(v.id)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(`<option value="${v.id}" ${v.id === selected ? 'selected' : ''}>${v.label} (${v.id})</option>`)
  }
  return Array.from(groups.entries()).map(([g, opts]) => `<optgroup label="${g}">${opts.join('')}</optgroup>`).join('')
}

const escapePageHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const cbRealmOf = (p: { region?: string; baseUrl?: string }): 'cn' | 'global' => {
  if (p.region === 'global') return 'global'
  if (p.region === 'cn') return 'cn'
  return /workbuddy\.ai/i.test(p.baseUrl || '') ? 'global' : 'cn'
}

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

export async function renderAdminPage(c: Context<{ Bindings: Env }>) {
  const providers = await getProviders(c.env)
  const proxyKeys = await getProxyKeys(c.env)
  const tgConfig = await getTgConfig(c.env).catch(() => null)
  const codexRelay = await getCodexUpstreamRelay(c.env).catch(() => null)
  const codexRelayHost = codexRelay ? codexRelay.url.replace(/^https?:\/\//, '') : ''
  const enabledProvidersCount = providers.filter((p) => p.enabled).length
  const modelsCount = providers.reduce((total, p) => total + p.models.length, 0)
  const enabledModelsCount = providers.reduce((total, p) => total + p.models.filter((m) => m.enabled).length, 0)
  const enabledProxyKeysCount = proxyKeys.filter((k) => k.enabled).length

  const agChannels = providers
    .filter((p) => (p.type || '') === 'antigravity' && p.enabled)
    .map((p) => ({
      id: p.id,
      name: p.name,
      accountCount: p.apiKeys.filter((k) => k.enabled && k.key && k.key.trim()).length,
    }))
  const agAccountCount = agChannels.reduce((total, ch) => total + ch.accountCount, 0)
  const storageLabel = storageTypeLabel(c.env)
  const apiBase = `${getExternalOrigin(c)}/v1`

  return c.html(`<!DOCTYPE html><html lang="zh-CN">
${H('控制台')}
<body class="site-page admin-page">
<div class="admin-shell">
  <aside class="admin-rail" aria-label="控制台导航">
    <div class="admin-rail__head">
      <a class="brand admin-rail__brand" href="/">
        <span class="brand__mark">${icon('cloud', '', 18)}</span>
        <span><strong>AI GATEWAY</strong><small>CONTROL PANEL</small></span>
      </a>
    </div>
    <nav class="admin-nav">
      <a class="admin-nav__link is-active" href="#overview">${icon('overview', '', 16)}<span>概览</span></a>
      <a class="admin-nav__link" href="#providers">${icon('server', '', 16)}<span>渠道</span><b>${providers.length}</b></a>
      <a class="admin-nav__link" href="#quota">${icon('gauge', '', 16)}<span>额度</span><b>${agAccountCount}</b></a>
      <a class="admin-nav__link" href="#proxy-keys">${icon('key', '', 16)}<span>令牌</span><b>${proxyKeys.length}</b></a>
      <a class="admin-nav__link" href="#usage">${icon('chart', '', 16)}<span>用量</span></a>
      <a class="admin-nav__link" href="#backup">${icon('database', '', 16)}<span>备份</span></a>
    </nav>
    <div class="admin-rail__foot">
      <button class="admin-nav__link rail-toggle" type="button" onclick="toggleRail()" title="收缩侧边栏">${icon('anglesLeft', '', 16)}<span>收缩侧边栏</span></button>
      <a href="/" class="admin-nav__link">${icon('arrowLeft', '', 16)}<span>返回首页</span></a>
      <a href="/admin/logout" class="admin-nav__link">${icon('signOut', '', 16)}<span>退出登录</span></a>
    </div>
  </aside>

  <div class="admin-main">
    <header class="admin-topbar">
      <a class="brand" href="/"><span class="brand__mark">${icon('cloud', '', 16)}</span><span class="brand__name">AI GATEWAY</span></a>
      <nav class="admin-topbar__nav" aria-label="移动端控制台导航">
        <a class="is-active" href="#overview">${icon('overview', '', 13)}概览</a>
        <a href="#providers">${icon('server', '', 13)}渠道<b>${providers.length}</b></a>
        <a href="#quota">${icon('gauge', '', 13)}额度<b>${agAccountCount}</b></a>
        <a href="#proxy-keys">${icon('key', '', 13)}令牌<b>${proxyKeys.length}</b></a>
        <a href="#usage">${icon('chart', '', 13)}用量</a>
        <a href="#backup">${icon('database', '', 13)}备份</a>
      </nav>
      <div class="admin-topbar__actions">
        <a href="/" class="icon-btn" title="查看前台" aria-label="查看前台">${icon('external', '', 14)}</a>
        <a class="icon-btn" href="/admin/logout" aria-label="退出登录" title="退出登录">${icon('signOut', '', 14)}</a>
      </div>
    </header>

    <main class="admin-content">
      <div id="toast" class="hd toast" role="status" aria-live="polite"></div>

      <!-- 概览 Section -->
      <section id="overview" class="admin-overview" aria-labelledby="admin-title">
        <div class="admin-heading">
          <div>
            <p class="eyebrow">${icon('cloud', '', 12)}GATEWAY RUNTIME STATUS</p>
            <h1 id="admin-title">网关总览控制台</h1>
            <p>统一管理模型路由、上游渠道与令牌。持久化数据存储于 <strong>${storageLabel}</strong>。</p>
          </div>
          <div class="admin-heading__actions">
            <a href="/" class="btn btn-s">${icon('external', '', 14)} 查看前台可用模型</a>
          </div>
        </div>

        <div class="admin-metrics" aria-label="配置统计">
          <div onclick="location.hash='#providers'" style="cursor:pointer" title="点击管理渠道">
            <span>${providers.length}</span><p>渠道</p><small>${enabledProvidersCount} 个已启用</small>
          </div>
          <div onclick="location.hash='#providers'" style="cursor:pointer" title="点击管理模型">
            <span>${modelsCount}</span><p>模型</p><small>${enabledModelsCount} 个当前可用</small>
          </div>
          <div onclick="location.hash='#proxy-keys'" style="cursor:pointer" title="点击管理令牌">
            <span>${proxyKeys.length}</span><p>访问令牌</p><small>${enabledProxyKeysCount} 个有效可用</small>
          </div>
          <div onclick="location.hash='#usage'" style="cursor:pointer" title="点击查看用量">
            <span class="status-dot--online">已连接</span><p>存储引擎</p><small>${storageLabel}</small>
          </div>
        </div>

        <div class="endpoint-box endpoint-box--url" style="margin-bottom:24px" aria-label="API 接入地址">
          <span class="endpoint-box__label">API BASE URL</span>
          <code>${escapePageHtml(apiBase)}</code>
          <button class="btn btn-s copy-control" type="button" data-copy="${escapePageHtml(apiBase)}" aria-label="复制 API 地址">
            ${icon('copy', '', 14)}<span>复制地址</span>
          </button>
        </div>
      </section>

      <!-- 渠道 Section -->
      <section id="providers" class="workspace-section" aria-labelledby="providers-title">
        <div class="section-heading">
          <div><h2 id="providers-title">渠道管理</h2><p>配置上游 API 地址、请求协议、访问密钥与模型映射。</p></div>
          <button class="btn btn-p" onclick="showAdd()">${icon('plus', '', 14)}添加渠道</button>
        </div>

        <div class="af-w">
          <div id="af" class="hd add-form-panel">
            <div class="panel-heading">
              <div>
                <span class="panel-heading__mark">${icon('plus', '', 16)}</span>
                <div><h3>添加新渠道</h3><p>配置基础信息、专用反代参数及 API Keys。</p></div>
              </div>
              <button class="icon-btn" type="button" onclick="hideAdd()" aria-label="关闭">${icon('times', '', 14)}</button>
            </div>
            
            <div class="fr">
              <div class="fg"><label for="anm">渠道名称</label><input type="text" id="anm" placeholder="例如：DeepSeek 官方"></div>
              <div class="fg"><label for="aid">渠道 ID (前缀标识)</label><input type="text" id="aid" placeholder="deepseek"><span class="form-helper">创建后作为模型命名前缀，不可修改。</span></div>
            </div>
            
            <div class="fg"><label for="aurl">API 上游地址</label><input type="url" id="aurl" placeholder="https://api.deepseek.com"></div>
            
            <div class="fg" data-hide-ag><label for="amirror">镜像备用地址 (自动故障转移)</label><textarea id="amirror" rows="2" placeholder="每行一个备用 URL"></textarea></div>
            
            <div class="fg"><label for="apt">渠道协议类型</label>
              <select id="apt" class="select-sm" onchange="onTypeChange(this, 'new')">
                <option value="openai">OpenAI 兼容</option>
                <option value="anthropic">Anthropic 兼容</option>
                <option value="openai-video">OpenAI 视频</option>
                <option value="agnes-video">Agnes 异步视频</option>
                <option value="azure-tts">Azure TTS 语音</option>
                <option value="antigravity">Antigravity 反代</option>
                <option value="claude">Claude OAuth 反代</option>
                <option value="codex">ChatGPT (Codex) 反代</option>
                <option value="kimi">Kimi OAuth 反代</option>
                <option value="grok">Grok OAuth 反代</option>
                <option value="qwen">Qwen OAuth 反代</option>
                <option value="deepseek">DeepSeek 反代</option>
                <option value="vertex">Vertex AI 反代</option>
                <option value="devin">Devin 反代</option>
                <option value="zai">Z.AI (GLM 国际)</option>
                <option value="codebuddy">CodeBuddy (腾讯) 反代</option>
                <option value="cline">Cline 反代</option>
              </select>
              <span class="form-helper" id="apt-hint-new">Agnes 等聚合平台建议选 OpenAI 兼容, 视频模型自动走异步适配。</span>
            </div>

            <!-- Antigravity 配置 -->
            <div class="ag-config" id="ag-new" style="display:none">
              <div class="fg"><label>Google 账号授权</label>
                <div class="fc" style="gap:8px">
                  <button class="btn btn-s" type="button" onclick="antigravityOAuth('new')">${icon('key', '', 14)} 用 Google 账号授权</button>
                  <button class="btn btn-s" type="button" onclick="fetchAgModels('new')">${icon('download', '', 14)} 获取可用模型</button>
                </div>
              </div>
            </div>

            <!-- DeepSeek 配置 -->
            <div class="ag-config" id="ds-new" style="display:none">
              <div class="fg"><label>DeepSeek 凭据托管</label>
                <div class="fc field-row" style="gap:8px;flex-wrap:wrap">
                  <button class="btn btn-p btn-s" type="button" onclick="openDeepseekTokenDialog('new')">${icon('key', '', 14)} 粘贴 userToken</button>
                  <button class="btn btn-s" type="button" onclick="openDeepseekAccountDialog('new')">${icon('shield', '', 14)} 账号代登录</button>
                  <button class="btn btn-s" type="button" onclick="verifyDeepseek('new')">${icon('plug', '', 14)} 验证已填凭据</button>
                </div>
              </div>
            </div>

            <!-- OAuth 配置 -->
            <div class="ag-config" id="oa-new" style="display:none">
              <div class="fg"><label>OAuth 登录与模型获取</label>
                <div class="fc" style="gap:8px">
                  <button class="btn btn-s" type="button" onclick="oauthChannel('new')">${icon('key', '', 14)} 授权登录获取 refresh_token</button>
                  <button class="btn btn-s" type="button" onclick="fetchOAuthModels('new')">${icon('download', '', 14)} 获取模型列表</button>
                </div>
              </div>
            </div>

            <!-- CodeBuddy 配置 -->
            <div class="cb-config" id="cb-new" style="display:none">
              <div class="fg"><label for="cbr-new">版本 / 区域</label>
                <select id="cbr-new" class="select-sm" onchange="cbRegionChange('new')">
                  <option value="cn">国内版 · copilot.tencent.com</option>
                  <option value="global">国际版 · workbuddy.ai</option>
                </select>
              </div>
              <div class="fg"><label>账号积分与签到</label>
                <div class="fc" style="gap:8px">
                  <button class="btn btn-s" type="button" onclick="codebuddyStatus('new')">${icon('coins', '', 14)} 查询积分/套餐</button>
                  <button class="btn btn-s" type="button" onclick="codebuddyCheckin('new')">${icon('calendar', '', 14)} 每日签到</button>
                </div>
              </div>
              <div class="mt-1" id="cbst-new" aria-live="polite"></div>
            </div>

            <!-- Azure TTS 配置 -->
            <div class="tts-config" id="tts-new" style="display:none">
              <fieldset class="form-group"><legend>Azure TTS 默认音色配置</legend>
                <div class="fr">
                  <div class="fg"><label>音色 Voice</label>
                    <div class="fc" style="gap:8px">
                      <select id="av" class="select-sm"><option value="">自定义…</option>${AZURE_VOICE_OPTIONS}</select>
                      <button class="btn btn-s" type="button" onclick="previewTts('new')">${icon('play', '', 14)} 试听</button>
                    </div>
                  </div>
                  <div class="fg"><label>语速 Rate</label><input type="text" id="ar" value="+0%" placeholder="+0%"></div>
                </div>
                <div class="fr">
                  <div class="fg"><label>音量 Volume</label><input type="text" id="avol" value="+0%" placeholder="+0%"></div>
                  <div class="fg"><label>音调 Pitch</label><input type="text" id="ap" value="+0Hz" placeholder="+0Hz"></div>
                </div>
                <div id="ttp-new"></div>
                <button class="btn btn-s" type="button" onclick="addAllTtsModels('new')" style="margin-top:8px">${icon('microphone', '', 14)} 添加全部音色为模型</button>
              </fieldset>
            </div>

            <!-- Vertex 配置 -->
            <div class="vx-config" id="vx-new" style="display:none">
              <div class="fg"><label>服务账号 JSON</label><textarea id="vxs" rows="3" class="fx1" placeholder='{"type":"service_account",...}'></textarea></div>
              <div class="fr"><div class="fg"><label>区域 Location</label><input type="text" id="vxl" placeholder="us-central1"></div><div class="fg"><label>凭据校验</label><button class="btn btn-s" type="button" onclick="verifyVertex('new')">${icon('plug', '', 14)} 验证</button></div></div>
            </div>

            <!-- Devin 配置 -->
            <div class="dv-config" id="dv-new" style="display:none">
              <div class="fg"><label>Devin 授权</label><button class="btn btn-s" type="button" onclick="devinOAuth('new')">${icon('key', '', 14)} Devin 账号授权</button></div>
              <div class="fg"><label>Session Token</label><textarea id="dvt" rows="2" class="fx1" placeholder="devin-session-token$... (每行一个)"></textarea></div>
              <div class="fg"><button class="btn btn-s" type="button" onclick="verifyDevin('new')">${icon('plug', '', 14)} 校验凭据</button></div>
            </div>

            <!-- 上游 API Keys -->
            <fieldset class="form-group"><legend>上游 API Keys</legend>
              <div id="akeys">
                <div class="fc mb-4 field-row">
                  <input type="text" placeholder="sk-xxx" class="fx1 aki">
                  <label class="tg"><input type="checkbox" checked class="ake"><span class="sl"></span></label>
                  <button class="icon-btn" onclick="copyRowVal(this)">${icon('copy', '', 14)}</button>
                  <button class="icon-btn" onclick="testNewAKey(this)">${icon('plug', '', 14)}</button>
                  <button class="icon-btn" onclick="this.parentElement.remove()">${icon('times', '', 14)}</button>
                </div>
              </div>
              <div class="fc" style="gap:8px;flex-wrap:wrap">
                <button class="btn btn-s" onclick="addAKeyRow()">${icon('plus', '', 14)}添加 Key</button>
                <button class="btn btn-s" onclick="batchAddKeys()">${icon('key', '', 14)}批量导入</button>
                <button class="btn btn-s" onclick="batchTestKeys()">${icon('plug', '', 14)}批量测试</button>
              </div>
            </fieldset>

            <aside id="amc" class="hd mdl-list-panel"><div class="panel-heading"><div><span class="panel-heading__mark">${icon('cube', '', 16)}</span><div><h3>可用模型</h3><p>点击添加到配置列表。</p></div></div><button class="icon-btn" type="button" onclick="hideMdlPanel('amc')">${icon('times', '', 14)}</button></div><div id="amcl"></div></aside>

            <div class="fc" data-hide-ag style="gap:8px;margin-bottom:12px">
              <button class="btn btn-s" type="button" onclick="fetchNewModels(true)">${icon('gift', '', 14)} 获取免费模型</button>
              <button class="btn btn-s" type="button" onclick="fetchNewModels(false)">${icon('download', '', 14)} 获取全部模型</button>
            </div>

            <!-- 模型 ID 列表 -->
            <fieldset class="form-group"><legend>模型配置</legend>
              <div id="amodels">
                <div class="fc mb-4 field-row">
                  <input type="text" placeholder="模型 ID，例如：deepseek-chat" class="fx1 ami">
                  <input type="text" placeholder="对外别名(可选)" class="fx1 amal">
                  <label class="tg"><input type="checkbox" checked class="ame"><span class="sl"></span></label>
                  <button class="icon-btn" onclick="copyRowVal(this)">${icon('copy', '', 14)}</button>
                  <button class="icon-btn" onclick="testNewMdl(this)">${icon('plug', '', 14)}</button>
                  <button class="icon-btn" onclick="this.parentElement.remove()">${icon('times', '', 14)}</button>
                </div>
              </div>
              <button class="btn btn-s" onclick="addMdlRow()">${icon('plus', '', 14)}添加模型</button>
            </fieldset>

            <div class="panel-actions">
              <label class="fc" style="gap:8px;cursor:pointer">
                <span class="tg"><input type="checkbox" checked id="aen"><span class="sl"></span></span>
                <span style="font-size:13px;font-weight:500">创建后立即启用</span>
              </label>
              <div>
                <button class="btn btn-s" onclick="hideAdd()">取消</button>
                <button class="btn btn-p" onclick="createProv()">${icon('check', '', 14)} 创建渠道</button>
              </div>
            </div>
            <div id="atestR" style="margin-top:10px" aria-live="polite"></div>
          </div>
        </div>

        <!-- 渠道卡片列表 -->
        <div class="provider-list" id="plist">
          ${providers.length ? providers.map(p => `
          <article class="pi" data-id="${escapePageHtml(p.id)}">
            <div class="ps" onclick="tog('${p.id}')" role="button" tabindex="0">
              <div class="l">
                <span class="provider-chevron" id="ch-${escapePageHtml(p.id)}">${icon('chevronRight', '', 14)}</span>
                <span class="provider-avatar">${escapePageHtml(p.name.charAt(0).toUpperCase() || 'A')}</span>
                <div>
                  <h3>${escapePageHtml(p.name)}</h3>
                  <div class="pu">
                    <code>${escapePageHtml(p.id)}</code>
                    <span>${p.type === 'antigravity' ? 'Antigravity' : p.type === 'claude' ? 'Claude' : p.type === 'codex' ? 'Codex' : p.type === 'kimi' ? 'Kimi' : p.type === 'grok' ? 'Grok' : p.type === 'qwen' ? 'Qwen' : p.type === 'deepseek' ? 'DeepSeek' : p.type === 'vertex' ? 'Vertex' : p.type === 'devin' ? 'Devin' : p.type === 'codebuddy' ? 'CodeBuddy' : p.type === 'cline' ? 'Cline' : p.type === 'zai' ? 'Z.AI' : (p.apiType || 'openai') === 'anthropic' ? 'Anthropic' : 'OpenAI'}</span>
                    <span>${p.apiKeys.length} 个 Key</span>
                    <span>${p.models.length} 个模型</span>
                  </div>
                </div>
              </div>
              <div class="fc" style="gap:10px" onclick="event.stopPropagation()">
                <label class="tg">
                  <input type="checkbox" ${p.enabled ? 'checked' : ''} id="en-${escapePageHtml(p.id)}" onchange="togglePb('${p.id}',this.checked)">
                  <span class="sl"></span>
                </label>
                <span class="bd ${p.enabled ? 'bd-on' : 'bd-off'}">${p.enabled ? '已启用' : '未启用'}</span>
                ${(p.type || '') === 'codex' && codexRelayHost ? `<span class="bd bd-info" title="经 ${escapePageHtml(codexRelayHost)} 中继">经中继</span>` : ''}
              </div>
            </div>

            <div class="pd" id="dt-${escapePageHtml(p.id)}">
              <div class="detail-heading">
                <div><h3>编辑 ${escapePageHtml(p.name)}</h3><p>修改配置后保存即刻生效于后续请求。</p></div>
                <span class="protocol-chip">${(p.type || p.apiType || 'openai').toUpperCase()}</span>
              </div>

              <div class="fr">
                <div class="fg"><label>渠道名称</label><input type="text" id="nm-${escapePageHtml(p.id)}" value="${escapePageHtml(p.name)}"></div>
                <div class="fg"><label>渠道 ID</label><input type="text" id="pid-${escapePageHtml(p.id)}" value="${escapePageHtml(p.id)}"></div>
              </div>
              <div class="fg"><label>API 地址</label><input type="url" id="url-${escapePageHtml(p.id)}" value="${escapePageHtml(p.baseUrl)}" ${(p.type || 'openai') === 'azure-tts' ? 'disabled placeholder="Azure TTS 为内置服务，无需地址"' : ''}></div>
              <div class="fr">
                <div class="fg"><label>渠道类型</label>
                  <select id="pt-${escapePageHtml(p.id)}" class="select-sm" onchange="onTypeChange(this, '${escapePageHtml(p.id)}')">
                    <option value="openai" ${(p.type || 'openai') === 'openai' ? 'selected' : ''}>OpenAI 兼容</option>
                    <option value="anthropic" ${p.type === 'anthropic' ? 'selected' : ''}>Anthropic 兼容</option>
                    <option value="openai-video" ${p.type === 'openai-video' ? 'selected' : ''}>OpenAI 视频</option>
                    <option value="agnes-video" ${p.type === 'agnes-video' ? 'selected' : ''}>Agnes 异步视频</option>
                    <option value="azure-tts" ${p.type === 'azure-tts' ? 'selected' : ''}>Azure TTS 语音</option>
                    <option value="antigravity" ${p.type === 'antigravity' ? 'selected' : ''}>Antigravity 反代</option>
                    <option value="claude" ${p.type === 'claude' ? 'selected' : ''}>Claude OAuth 反代</option>
                    <option value="codex" ${p.type === 'codex' ? 'selected' : ''}>ChatGPT (Codex) 反代</option>
                    <option value="kimi" ${p.type === 'kimi' ? 'selected' : ''}>Kimi OAuth 反代</option>
                    <option value="grok" ${p.type === 'grok' ? 'selected' : ''}>Grok OAuth 反代</option>
                    <option value="qwen" ${p.type === 'qwen' ? 'selected' : ''}>Qwen OAuth 反代</option>
                    <option value="deepseek" ${p.type === 'deepseek' ? 'selected' : ''}>DeepSeek 反代</option>
                    <option value="vertex" ${p.type === 'vertex' ? 'selected' : ''}>Vertex AI 反代</option>
                    <option value="devin" ${p.type === 'devin' ? 'selected' : ''}>Devin 反代</option>
                    <option value="zai" ${p.type === 'zai' ? 'selected' : ''}>Z.AI (GLM 国际)</option>
                    <option value="codebuddy" ${p.type === 'codebuddy' ? 'selected' : ''}>CodeBuddy (腾讯) 反代</option>
                    <option value="cline" ${p.type === 'cline' ? 'selected' : ''}>Cline 反代</option>
                  </select>
                </div>
              </div>

              <!-- Antigravity 配置 -->
              <div class="ag-config" id="ag-${escapePageHtml(p.id)}" ${p.type === 'antigravity' ? '' : 'style="display:none"'}>
                <div class="fg"><label>Google 账号授权</label>
                  <div class="fc" style="gap:8px">
                    <button class="btn btn-s" type="button" onclick="antigravityOAuth('${escapePageHtml(p.id)}')">${icon('key', '', 14)} 用 Google 账号授权</button>
                    <button class="btn btn-s" type="button" onclick="fetchAgModels('${escapePageHtml(p.id)}')">${icon('download', '', 14)} 获取可用模型</button>
                  </div>
                </div>
              </div>

              <!-- DeepSeek 配置 -->
              <div class="ag-config" id="ds-${escapePageHtml(p.id)}" ${p.type === 'deepseek' ? '' : 'style="display:none"'}>
                <div class="fg"><label>DeepSeek 凭据托管</label>
                  <div class="fc field-row" style="gap:8px;flex-wrap:wrap">
                    <button class="btn btn-p btn-s" type="button" onclick="openDeepseekTokenDialog('${escapePageHtml(p.id)}')">${icon('key', '', 14)} 粘贴 userToken</button>
                    <button class="btn btn-s" type="button" onclick="openDeepseekAccountDialog('${escapePageHtml(p.id)}')">${icon('shield', '', 14)} 账号代登录</button>
                    <button class="btn btn-s" type="button" onclick="verifyDeepseek('${escapePageHtml(p.id)}')">${icon('plug', '', 14)} 验证已填凭据</button>
                  </div>
                  <script type="application/json" id="dsacc-${escapePageHtml(p.id)}">${JSON.stringify(p.dsAccount || {}).replace(/</g, '\\u003c')}</script>
                </div>
              </div>

              <!-- OAuth 反代配置 -->
              <div class="ag-config" id="oa-${escapePageHtml(p.id)}" ${['claude', 'codex', 'kimi', 'grok', 'qwen', 'codebuddy', 'cline'].includes(p.type || '') ? '' : 'style="display:none"'}>
                <div class="fg"><label>OAuth 登录与模型获取</label>
                  <div class="fc" style="gap:8px">
                    <button class="btn btn-s" type="button" onclick="oauthChannel('${escapePageHtml(p.id)}')">${icon('key', '', 14)} 授权登录获取 refresh_token</button>
                    <button class="btn btn-s" type="button" onclick="fetchOAuthModels('${escapePageHtml(p.id)}')">${icon('download', '', 14)} 获取模型列表</button>
                  </div>
                </div>
              </div>

              <!-- CodeBuddy 配置 -->
              <div class="cb-config" id="cb-${escapePageHtml(p.id)}" ${p.type === 'codebuddy' ? '' : 'style="display:none"'}>
                <div class="fg"><label for="cbr-${escapePageHtml(p.id)}">版本 / 区域</label>
                  <select id="cbr-${escapePageHtml(p.id)}" class="select-sm" onchange="cbRegionChange('${escapePageHtml(p.id)}')">
                    <option value="cn" ${cbRealmOf(p) === 'cn' ? 'selected' : ''}>国内版 · copilot.tencent.com</option>
                    <option value="global" ${cbRealmOf(p) === 'global' ? 'selected' : ''}>国际版 · workbuddy.ai</option>
                  </select>
                </div>
                <div class="fg"><label>账号积分与签到</label>
                  <div class="fc" style="gap:8px">
                    <button class="btn btn-s" type="button" onclick="codebuddyStatus('${escapePageHtml(p.id)}')">${icon('coins', '', 14)} 查询积分/套餐</button>
                    <button class="btn btn-s" type="button" onclick="codebuddyCheckin('${escapePageHtml(p.id)}')">${icon('calendar', '', 14)} 每日签到</button>
                  </div>
                </div>
                <div class="mt-1" id="cbst-${escapePageHtml(p.id)}" aria-live="polite"></div>
              </div>

              <!-- Azure TTS 配置 -->
              <div class="tts-config" id="tts-${escapePageHtml(p.id)}" ${(p.type || 'openai') === 'azure-tts' ? '' : 'style="display:none"'}>
                <fieldset class="form-group"><legend>Azure TTS 音色参数</legend>
                  <div class="fr">
                    <div class="fg"><label>音色 Voice</label>
                      <div class="fc" style="gap:8px">
                        <select id="pv-${escapePageHtml(p.id)}" class="select-sm"><option value="">自定义…</option>${azureVoiceOptions(p.voice || 'zh-CN-XiaoxiaoNeural')}</select>
                        <button class="btn btn-s" type="button" onclick="previewTts('${escapePageHtml(p.id)}')">${icon('play', '', 14)} 试听</button>
                      </div>
                    </div>
                    <div class="fg"><label>语速 Rate</label><input type="text" id="pr-${escapePageHtml(p.id)}" value="${escapePageHtml(p.rate || '+0%')}"></div>
                  </div>
                  <div class="fr">
                    <div class="fg"><label>音量 Volume</label><input type="text" id="pvol-${escapePageHtml(p.id)}" value="${escapePageHtml(p.volume || '+0%')}"></div>
                    <div class="fg"><label>音调 Pitch</label><input type="text" id="pp-${escapePageHtml(p.id)}" value="${escapePageHtml(p.pitch || '+0Hz')}"></div>
                  </div>
                  <div id="ttp-${escapePageHtml(p.id)}"></div>
                  <div class="fc" style="gap:8px;margin-top:8px">
                    <button class="btn btn-s" type="button" onclick="addTtsModel('${escapePageHtml(p.id)}')">${icon('plus', '', 14)} 添加当前音色为模型</button>
                    <button class="btn btn-s" type="button" onclick="addAllTtsModels('${escapePageHtml(p.id)}')">${icon('microphone', '', 14)} 添加全部音色</button>
                  </div>
                </fieldset>
              </div>

              <!-- 镜像地址 -->
              <div class="fg" data-hide-ag ${p.type === 'antigravity' ? 'style="display:none"' : ''}><label>镜像备用地址</label><textarea id="mir-${escapePageHtml(p.id)}" rows="2">${(p.mirrorUrls || []).map(escapePageHtml).join('\\n')}</textarea></div>

              <!-- 上游 API Keys 列表 -->
              <fieldset class="form-group"><legend>上游 API Keys</legend>
                <div id="keys-${escapePageHtml(p.id)}">${p.apiKeys.map((k, ki) => `<div class="fc mb-3 field-row" data-kidx="${ki}"><input type="text" value="${escapePageHtml(k.key)}" class="fx1" id="k-${escapePageHtml(p.id)}-${ki}"><label class="tg"><input type="checkbox" ${k.enabled ? 'checked' : ''} id="ken-${escapePageHtml(p.id)}-${ki}"><span class="sl"></span></label><button class="icon-btn" onclick="copyRowVal(this)">${icon('copy', '', 14)}</button><button class="icon-btn" onclick="testKeyRow('${p.id}',${ki})">${icon('plug', '', 14)}</button><button class="icon-btn" onclick="rmKeyRow('${p.id}',${ki})">${icon('times', '', 14)}</button></div>`).join('')}</div>
                <div class="fc mt-1 field-row"><input type="text" id="nk-${escapePageHtml(p.id)}" placeholder="添加新的 API Key" class="fx1"><button class="btn btn-s" onclick="addKeyRow('${p.id}')">${icon('plus', '', 14)}添加</button></div>
              </fieldset>

              <!-- 模型列表 -->
              <fieldset class="form-group"><legend>模型配置</legend>
                <div id="ml-${escapePageHtml(p.id)}">${p.models.map((m, mi) => `<div class="fc mb-3 field-row" data-idx="${mi}"><input type="text" value="${escapePageHtml(m.id)}" class="fx1" id="mid-${escapePageHtml(p.id)}-${mi}"><input type="text" value="${escapePageHtml(m.alias || '')}" class="fx1" id="mal-${escapePageHtml(p.id)}-${mi}" placeholder="对外别名(可选)"><label class="tg"><input type="checkbox" ${m.enabled ? 'checked' : ''} id="men-${escapePageHtml(p.id)}-${mi}"><span class="sl"></span></label><button class="icon-btn" onclick="copyRowVal(this)">${icon('copy', '', 14)}</button><button class="icon-btn" onclick="testMdl('${p.id}','${m.id}',${mi})">${icon('plug', '', 14)}</button><button class="icon-btn" onclick="rmMdl('${p.id}',${mi})">${icon('times', '', 14)}</button></div>`).join('')}</div>
                <div class="fc mt-1 field-row"><input type="text" id="nmid-${escapePageHtml(p.id)}" placeholder="模型 ID" class="fx1"><input type="text" id="nmal-${escapePageHtml(p.id)}" placeholder="对外别名(可选)" class="fx1"><button class="btn btn-s" onclick="addMdl('${p.id}')">${icon('plus', '', 14)}添加</button></div>
              </fieldset>

              <div class="detail-actions">
                <div id="tr-${escapePageHtml(p.id)}" aria-live="polite"></div>
                <div>
                  <button class="btn btn-s" data-hide-ag ${p.type === 'antigravity' ? 'style="display:none"' : ''} onclick="fetchEditModels('${p.id}', false)">${icon('download', '', 14)} 获取模型</button>
                  <button class="btn btn-s" data-hide-ag ${p.type === 'antigravity' ? 'style="display:none"' : ''} onclick="fetchEditModels('${p.id}', true)">${icon('gift', '', 14)} 获取免费模型</button>
                  <button class="btn btn-d" onclick="del('${p.id}')">${icon('trash', '', 14)} 删除渠道</button>
                  <button class="btn btn-p" onclick="save('${p.id}')">${icon('save', '', 14)} 保存更改</button>
                </div>
              </div>
            </div>
          </article>`).join('') : `<div class="empty-state">${icon('server', '', 36)}<h3>暂未配置上游渠道</h3><p>添加第一个渠道，开启统一大模型路由。</p><button class="btn btn-p" onclick="showAdd()" style="margin-top:12px">添加渠道</button></div>`}
        </div>
      </section>

      <!-- 额度 Section -->
      <section id="quota" class="workspace-section" aria-labelledby="quota-title">
        <div class="section-heading">
          <div><h2 id="quota-title">额度管理</h2><p>Antigravity 与 Cline 账号的剩余额度、套餐订阅层与重置倒计时（共 ${agAccountCount} 个 Google 账号）。</p></div>
          <div class="fc" style="gap:8px;flex-wrap:wrap">
            <button class="btn btn-p" onclick="queryAllAgQuota()">${icon('gauge', '', 14)} 查询全部额度</button>
            <button class="btn btn-s" onclick="refreshAgAccounts()">${icon('refresh', '', 14)} 刷新账号列表</button>
          </div>
        </div>
        <div id="quotaBody" class="quota-grid"><div class="form-helper" style="padding:12px 0;grid-column:1/-1">点击上方「查询全部额度」或单账号旁的「查询」按钮获取最新实时额度。</div></div>

        <div class="section-heading" style="margin-top:36px">
          <div><h3 style="font-size:16px;font-weight:600">Cline 账号额度与用量</h3><p>查看每个 Cline 凭据的余额及各模型今日调用次数与 429 冷却状态。</p></div>
          <button class="btn btn-p" onclick="queryAllClineQuota()">${icon('gauge', '', 14)} 查询 Cline 账号</button>
        </div>
        <div id="clineQuotaBody" class="quota-grid"><div class="form-helper" style="padding:12px 0;grid-column:1/-1">点击上方「查询 Cline 账号」获取余额与冷却状态。</div></div>
      </section>

      <!-- 令牌 Section -->
      <section id="proxy-keys" class="workspace-section" aria-labelledby="proxy-keys-title">
        <div class="section-heading">
          <div><h2 id="proxy-keys-title">客户端令牌 (Proxy Keys)</h2><p>客户端（如 Cherry Studio, NextChat, 自动化脚本）使用此类令牌连接 <code>/v1</code> 接口。</p></div>
          <button class="btn btn-p" onclick="genKey()">${icon('plus', '', 14)} 生成令牌</button>
        </div>
        <div class="key-list">
          ${proxyKeys.length === 0 ? `<div class="empty-state">${icon('key', '', 36)}<h3>暂无访问令牌</h3><p>生成令牌后即可授权外部客户端调用本网关。</p><button class="btn btn-p" onclick="genKey()" style="margin-top:12px">生成令牌</button></div>` : ''}
          ${proxyKeys.map(k => `<article class="ki" data-id="${escapePageHtml(k.id)}">
            <div class="key-main">
              <span class="key-icon">${icon('key', '', 18)}</span>
              <div>
                <div class="kv">
                  <span class="kv__value" id="kv-${escapePageHtml(k.id)}" data-full="${escapePageHtml(k.key)}" data-vis="0">${escapePageHtml(k.key.length > 12 ? k.key.substring(0, 8) + '*****' + k.key.substring(k.key.length - 4) : k.key)}</span>
                  <button class="icon-btn" onclick="toggleKeyVis('${k.id}')" title="明文切换">${icon('eye', '', 14)}</button>
                  <button class="icon-btn" onclick='copyText("${escapePageHtml(k.key)}",this)' title="复制">${icon('copy', '', 14)}</button>
                  <button class="icon-btn" onclick="regenerateKey('${k.id}')" title="重新生成">${icon('refresh', '', 14)}</button>
                </div>
                <div class="key-meta">
                  <h3>${escapePageHtml(k.name || '未命名令牌')}</h3>
                  <span>·</span>
                  <p>创建于 ${new Date(k.createdAt).toLocaleDateString()} · ${k.expiresAt ? '有效至 ' + new Date(k.expiresAt).toLocaleDateString() : '永久有效'}</p>
                </div>
              </div>
            </div>
            <div class="key-actions">
              <label class="tg"><input type="checkbox" ${k.enabled ? 'checked' : ''} onchange="toggleProxyKey('${k.id}',this.checked)"><span class="sl"></span></label>
              <span class="bd ${k.enabled ? 'bd-on' : 'bd-off'}">${k.enabled ? '已启用' : '已禁用'}</span>
              <button class="icon-btn bd-del" onclick="rmKey('${k.id}')" title="删除令牌">${icon('trash', '', 14)}</button>
            </div>
          </article>`).join('')}
        </div>
      </section>

      <!-- 用量 Section -->
      <section id="usage" class="workspace-section" aria-labelledby="usage-title">
        <div class="section-heading">
          <div><h2 id="usage-title">用量分析与排行榜</h2><p>分析 Token 消耗趋势与各模型调用占比，数据自动滚动保留 30 天。</p></div>
          <select id="usage-days" class="select-sm" onchange="loadUsage()" aria-label="时间跨度">
            <option value="1" selected>今天</option>
            <option value="7">近 7 天</option>
            <option value="14">近 14 天</option>
            <option value="30">近 30 天</option>
          </select>
        </div>
        <div class="admin-metrics" aria-label="用量指标看板">
          <div><span id="u-req">-</span><p>请求总数</p><small id="u-ok">- 成功</small></div>
          <div><span id="u-in">-</span><p>输入 Tokens</p><small>提示词消耗</small></div>
          <div><span id="u-out">-</span><p>输出 Tokens</p><small>模型回复生成</small></div>
          <div><span id="u-lat">-</span><p>平均耗时</p><small>端到端延时 (毫秒)</small></div>
        </div>
        <div id="u-trend-wrap" class="hd add-form-panel">
          <div class="panel-heading"><div><span class="panel-heading__mark">${icon('chart', '', 16)}</span><div><h3>每日请求趋势</h3></div></div></div>
          <div id="u-trend" style="padding:16px"></div>
        </div>
        <div class="rank-grid">
          <div class="rank-card">
            <div class="panel-heading" style="border:none;padding:0;margin-bottom:14px"><div><span class="panel-heading__mark">${icon('cube', '', 16)}</span><div><h3>模型消耗排行 Top 10</h3></div></div></div>
            <div id="u-models"></div>
          </div>
          <div class="rank-card">
            <div class="panel-heading" style="border:none;padding:0;margin-bottom:14px"><div><span class="panel-heading__mark">${icon('server', '', 16)}</span><div><h3>渠道调用排行 Top 10</h3></div></div></div>
            <div id="u-providers"></div>
          </div>
        </div>
      </section>

      <!-- 备份 Section -->
      <section id="backup" class="workspace-section" aria-labelledby="backup-title">
        <div class="section-heading">
          <div><h2 id="backup-title">数据备份与快照恢复</h2><p>支持本地 JSON 完整导出/导入、Cloudflare R2 自动化对象存储快照以及 Telegram 机器人安全推送。</p></div>
        </div>
        <div class="rank-grid">
          <div class="rank-card">
            <div class="panel-heading" style="border:none;padding:0;margin-bottom:14px"><div><span class="panel-heading__mark">${icon('download', '', 16)}</span><div><h3>本地 JSON 导出与恢复</h3><p>全量导出渠道配置、API Key 与用量。</p></div></div></div>
            <div class="fc" style="gap:8px;flex-wrap:wrap">
              <button class="btn btn-p" onclick="backupExport()">${icon('download', '', 14)} 导出数据库</button>
              <button class="btn btn-s" onclick="backupImportPick()">${icon('upload', '', 14)} 导入数据库文件</button>
            </div>
            <div id="bk-io-result" aria-live="polite"></div>
          </div>
          <div class="rank-card">
            <div class="panel-heading" style="border:none;padding:0;margin-bottom:14px"><div><span class="panel-heading__mark">${icon('cloud', '', 16)}</span><div><h3>Cloudflare R2 快照</h3><p>存入 R2 存储桶，自动保留最新 30 份快照。</p></div></div></div>
            <div class="fc" style="gap:8px;flex-wrap:wrap">
              <button class="btn btn-p" onclick="backupToR2()">${icon('cloud', '', 14)} 立即备份到 R2</button>
              <button class="btn btn-s" onclick="backupList()">${icon('refresh', '', 14)} 刷新快照列表</button>
            </div>
            <div id="bk-r2-result" aria-live="polite"></div>
          </div>
          <div class="rank-card">
            <div class="panel-heading" style="border:none;padding:0;margin-bottom:14px"><div><span class="panel-heading__mark">${icon('paperPlane', '', 16)}</span><div><h3>Telegram 自动化备份</h3><p>通过 Bot 将加密备份推送到指定会话。</p></div></div></div>
            <div class="fg"><label>Telegram Bot Token</label><input type="password" id="tgToken" value="${escapePageHtml(tgConfig?.botToken || '')}" placeholder="123456:ABC-DEF..." autocomplete="off"></div>
            <div class="fg"><label>Telegram Chat ID</label><input type="text" id="tgChat" value="${escapePageHtml(tgConfig?.chatId || '')}" placeholder="例如：987654321"></div>
            <div class="fc" style="gap:8px;flex-wrap:wrap;margin-top:10px">
              <button class="btn btn-s" onclick="telegramTest()">${icon('plug', '', 14)} 测试通道</button>
              <button class="btn btn-s" onclick="telegramSave()">${icon('save', '', 14)} 保存配置</button>
              <button class="btn btn-p" onclick="backupToTelegram()">${icon('paperPlane', '', 14)} 推送备份</button>
            </div>
            <div id="bk-tg-result" aria-live="polite"></div>
          </div>
        </div>
      </section>
    </main>

    ${renderSiteFooter(SITE_CONFIG.title, getPlatformLabel(c.env, c.req.header('host')))}
  </div>
</div>

<div id="modal" class="modal-o hd" role="presentation" onclick="if(event.target===this)closeM()"><div class="modal" id="mc" role="dialog" aria-modal="true" aria-live="polite"></div></div>

<script>${SHARED_JS}
let AG_CHANNELS = ${JSON.stringify(agChannels).replace(/</g, '\\u003c')}
const AZURE_VOICE_IDS = ${JSON.stringify(AZURE_TTS_VOICES.map((v) => v.id))}
${ADMIN_CLIENT_SCRIPT}
</script>
</body></html>`)
}
