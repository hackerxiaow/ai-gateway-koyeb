export const CSS_CONTENT = `
/* ==========================================================================
   AI GATEWAY - Modern Fintech Design System (Linear / Stripe / Vercel Aesthetic)
   ========================================================================== */

:root {
  /* 基底与表面 */
  --bg-page: #f8fafc;
  --bg-surface: #ffffff;
  --bg-surface-subtle: #f1f5f9;
  --bg-surface-hover: #f8fafc;
  --bg-glass: rgba(255, 255, 255, 0.85);
  --bg-glass-heavy: rgba(255, 255, 255, 0.94);
  --bg-overlay: rgba(15, 23, 42, 0.45);

  /* 终端与深色对比面板 */
  --bg-terminal: #0f172a;
  --bg-terminal-subtle: #1e293b;
  --text-terminal: #f8fafc;
  --text-terminal-muted: #94a3b8;
  --border-terminal: #334155;

  /* 文字排版 */
  --text-primary: #0f172a;
  --text-secondary: #334155;
  --text-muted: #64748b;
  --text-subtle: #94a3b8;
  --text-inverse: #ffffff;

  /* 边框与分割线 */
  --border-color: #e2e8f0;
  --border-light: #f1f5f9;
  --border-strong: #cbd5e1;
  --border-hover: #94a3b8;

  /* 品牌与主强调色 (Aurora Blue) */
  --primary: #2563eb;
  --primary-hover: #1d4ed8;
  --primary-active: #1e40af;
  --primary-light: #eff6ff;
  --primary-border: #bfdbfe;
  --primary-text: #1d4ed8;

  /* 状态色：成功 (Emerald) */
  --success: #10b981;
  --success-light: #ecfdf5;
  --success-text: #065f46;
  --success-border: #a7f3d0;

  /* 状态色：警示 / 琥珀金 (Amber) */
  --warning: #f59e0b;
  --warning-light: #fffbeb;
  --warning-text: #92400e;
  --warning-border: #fde68a;

  /* 状态色：危险 (Ruby / Rose) */
  --danger: #ef4444;
  --danger-hover: #dc2626;
  --danger-light: #fef2f2;
  --danger-text: #991b1b;
  --danger-border: #fecaca;

  /* 阴影体系 */
  --shadow-xs: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-sm: 0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px -1px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.03);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -4px rgba(0, 0, 0, 0.02);
  --shadow-hover: 0 10px 25px -5px rgba(37, 99, 235, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.02);
  --shadow-modal: 0 25px 50px -12px rgba(15, 23, 42, 0.25);

  /* 圆角 */
  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
  --radius-full: 9999px;

  /* 字体体系 */
  --font-sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, Monaco, monospace;

  /* 布局容器 */
  --shell-max: 1200px;
  --rail-width: 250px;
  --rail-width-collapsed: 72px;
  --topbar-height: 60px;
  --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-normal: 220ms cubic-bezier(0.4, 0, 0.2, 1);

  /* 脚本兼容别名 */
  --c-primary: var(--primary);
  --c-primary-hover: var(--primary-hover);
  --c-primary-glow: var(--primary-light);
  --c-text: var(--text-secondary);
  --c-text-dark: var(--text-primary);
  --c-text-muted: var(--text-muted);
  --c-bg: var(--bg-page);
  --c-bg-white: var(--bg-surface);
  --c-border: var(--border-color);
  --c-success: var(--success);
  --c-success-bg: var(--success-light);
  --c-success-text: var(--success-text);
  --c-danger: var(--danger);
  --c-danger-bg: var(--danger-light);
  --c-danger-text: var(--danger-text);
  --c-overlay: var(--bg-overlay);
}

/* ==========================================================================
   CSS Reset & Base
   ========================================================================== */

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-primary);
  background-color: var(--bg-page);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  scroll-behavior: smooth;
}

body {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  background-color: var(--bg-page);
}

button, input, select, textarea {
  font: inherit;
  color: inherit;
}

a {
  color: inherit;
  text-decoration: none;
}

code, pre {
  font-family: var(--font-mono);
}

.hd {
  display: none !important;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.svg-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  vertical-align: middle;
  flex-shrink: 0;
  line-height: 1;
}

.svg-icon svg {
  width: 100% !important;
  height: 100% !important;
  max-width: 100% !important;
  max-height: 100% !important;
  display: block !important;
}

.shell {
  width: 100%;
  max-width: var(--shell-max);
  margin-inline: auto;
  padding-inline: 24px;
}

@media (max-width: 640px) {
  .shell {
    padding-inline: 16px;
  }
}

/* ==========================================================================
   Typography & Helpers
   ========================================================================== */

.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--primary);
  margin-bottom: 8px;
}

.eyebrow::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background-color: var(--primary);
}

.c-p { color: var(--primary) !important; }
.c-s { color: var(--success) !important; }
.c-d { color: var(--danger) !important; }
.mu { color: var(--text-muted); font-size: 13px; }

/* ==========================================================================
   Buttons & Controls
   ========================================================================== */

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
  user-select: none;
  background-color: transparent;
}

.btn:active {
  transform: translateY(1px);
}

.btn-p {
  background-color: var(--primary);
  color: #ffffff;
  box-shadow: 0 1px 2px 0 rgba(37, 99, 235, 0.2);
}

.btn-p:hover {
  background-color: var(--primary-hover);
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
}

.btn-s {
  background-color: var(--bg-surface);
  color: var(--text-secondary);
  border-color: var(--border-color);
  box-shadow: var(--shadow-xs);
}

.btn-s:hover {
  background-color: var(--bg-surface-subtle);
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.btn-d {
  background-color: var(--danger-light);
  color: var(--danger-text);
  border-color: var(--danger-border);
}

.btn-d:hover {
  background-color: var(--danger);
  color: #ffffff;
  border-color: var(--danger);
}

.btn-gh {
  color: var(--text-muted);
}

.btn-gh:hover {
  background-color: var(--bg-surface-subtle);
  color: var(--text-primary);
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  background-color: var(--bg-surface);
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.icon-btn:hover {
  background-color: var(--bg-surface-subtle);
  color: var(--text-primary);
  border-color: var(--border-strong);
}

.icon-btn[data-state="success"] {
  color: var(--success);
  border-color: var(--success-border);
  background-color: var(--success-light);
}

/* Toggle Switch */
.tg {
  position: relative;
  display: inline-block;
  width: 38px;
  height: 22px;
  flex-shrink: 0;
  cursor: pointer;
}

.tg input {
  opacity: 0;
  width: 0;
  height: 0;
}

.sl {
  position: absolute;
  inset: 0;
  background-color: var(--border-strong);
  border-radius: var(--radius-full);
  transition: all var(--transition-fast);
}

.sl::before {
  position: absolute;
  content: "";
  height: 16px;
  width: 16px;
  left: 3px;
  bottom: 3px;
  background-color: #ffffff;
  border-radius: var(--radius-full);
  transition: all var(--transition-fast);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.tg input:checked + .sl {
  background-color: var(--primary);
}

.tg input:checked + .sl::before {
  transform: translateX(16px);
}

/* Badges */
.bd {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
  border-radius: var(--radius-full);
  line-height: 1.4;
}

.bd-on {
  background-color: var(--success-light);
  color: var(--success-text);
  border: 1px solid var(--success-border);
}

.bd-off {
  background-color: var(--bg-surface-subtle);
  color: var(--text-muted);
  border: 1px solid var(--border-color);
}

.bd-info {
  background-color: var(--primary-light);
  color: var(--primary-text);
  border: 1px solid var(--primary-border);
}

.bd-del {
  background-color: var(--danger-light);
  color: var(--danger-text);
  border: 1px solid var(--danger-border);
  cursor: pointer;
}

/* Status Badges */
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: var(--radius-full);
}

.status-badge--on {
  background-color: var(--success-light);
  color: var(--success-text);
  border: 1px solid var(--success-border);
}

.status-badge--on::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--success);
}

/* Form inputs */
.fg {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}

.fg label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.fr {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}

.fc {
  display: flex;
  align-items: center;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.fx1 {
  flex: 1;
}

.fx-s0 {
  flex-shrink: 0;
}

input[type="text"],
input[type="password"],
input[type="url"],
input[type="search"],
select,
textarea {
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  background-color: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  transition: all var(--transition-fast);
  outline: none;
}

input:focus,
select:focus,
textarea:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-light);
}

.select-sm {
  padding: 6px 10px;
  font-size: 12px;
}

textarea {
  resize: vertical;
  min-height: 80px;
  line-height: 1.5;
}

.form-helper {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
}

.input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.input-wrap input {
  padding-left: 36px;
  padding-right: 44px;
}

/* 仅作用于输入框左侧的字段图标；右侧密码切换按钮内的图标不受影响 */
.input-wrap > .svg-icon {
  position: absolute;
  left: 12px;
  color: var(--text-subtle);
  pointer-events: none;
}

.password-toggle {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
  z-index: 2;
  -webkit-appearance: none;
  appearance: none;
}

.password-toggle .svg-icon {
  position: static;
  left: auto;
  top: auto;
  pointer-events: none;
  color: inherit;
}

.password-toggle:hover {
  color: var(--text-primary);
  background-color: var(--bg-surface-subtle);
}

@media (max-width: 640px) {
  .input-wrap input {
    padding-right: 48px;
  }
  .password-toggle {
    right: 2px;
    width: 44px;
    height: 44px;
  }
}

/* Alerts */
.al {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  font-size: 13px;
  margin-bottom: 14px;
}

.al-s {
  background-color: var(--success-light);
  color: var(--success-text);
  border: 1px solid var(--success-border);
}

.al-e {
  background-color: var(--danger-light);
  color: var(--danger-text);
  border: 1px solid var(--danger-border);
}

/* Modal */
.modal-o {
  position: fixed;
  inset: 0;
  background-color: var(--bg-overlay);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  animation: fadeIn var(--transition-fast);
}

.modal {
  background-color: var(--bg-surface);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-modal);
  width: 100%;
  max-width: 520px;
  padding: 24px;
  max-height: 90vh;
  overflow-y: auto;
  animation: scaleUp var(--transition-normal);
}

.modal h3 {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.modal p {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 16px;
}

.modal .fa {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}

/* Toast */
.toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 1100;
  animation: slideInUp var(--transition-normal);
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes scaleUp {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes slideInUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ==========================================================================
   Header & Topbar
   ========================================================================== */

.topbar {
  position: sticky;
  top: 0;
  z-index: 100;
  height: var(--topbar-height);
  background-color: var(--bg-glass);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
}

@media (max-width: 640px) {
  .topbar {
    height: 52px;
  }
  .brand__name {
    font-size: 14px;
    letter-spacing: 0.02em;
  }
  .brand__mark {
    width: 28px;
    height: 28px;
  }
  .topbar__actions .btn {
    padding: 5px 10px;
    font-size: 12px;
    gap: 4px;
  }
}

.topbar__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  flex-shrink: 0;
}

.brand__mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, #2563eb, #3b82f6);
  color: #ffffff;
  box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25);
  flex-shrink: 0;
}

.brand__name {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}

.topbar__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* ==========================================================================
   Home Page
   ========================================================================== */

.home-page {
  background: radial-gradient(circle at 50% 0%, rgba(37, 99, 235, 0.04) 0%, transparent 60%), var(--bg-page);
}

.home-hero {
  padding-block: 48px 24px;
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 36px;
  align-items: center;
}

@media (max-width: 900px) {
  .home-hero {
    grid-template-columns: 1fr;
    padding-block: 32px 24px;
  }
}

.home-hero__copy h1 {
  font-size: clamp(28px, 4vw, 40px);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.15;
  color: var(--text-primary);
  margin-bottom: 14px;
}

.home-hero__lede {
  font-size: 15px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 24px;
  max-width: 560px;
}

.endpoint-box {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 14px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  box-shadow: var(--shadow-sm);
  margin-bottom: 20px;
}

.endpoint-box__label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--primary);
  background: var(--primary-light);
  padding: 3px 8px;
  border-radius: var(--radius-xs);
  flex-shrink: 0;
}

.endpoint-box code {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* API 地址盒：标签 / 网址 / 复制按钮始终同一行；网址放不下时由脚本隐藏 */
.endpoint-box--url {
  flex-wrap: nowrap;
  gap: 10px;
}

.endpoint-box--url code {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.endpoint-box--url .copy-control {
  flex-shrink: 0;
}

/* 弹窗中展示的新生成令牌：完整换行显示，避免被省略号截断 */
.endpoint-box--key {
  display: block;
  flex-wrap: wrap;
}

.endpoint-box--key code {
  display: block;
  width: 100%;
  white-space: pre-wrap;
  word-break: break-all;
  overflow: visible;
  font-size: 12px;
  margin-bottom: 10px;
}

@media (max-width: 640px) {
  .endpoint-box--url {
    padding: 10px;
    gap: 8px;
  }
  .endpoint-box--url .endpoint-box__label {
    font-size: 10px;
    padding: 3px 6px;
    letter-spacing: 0;
  }
  .endpoint-box--url code {
    font-size: 11px;
  }
  .endpoint-box--url .copy-control {
    padding: 6px 8px;
    font-size: 12px;
    gap: 4px;
  }
}

.endpoint-box--list {
  display: block;
  padding: 18px 20px;
  margin-bottom: 32px;
}

.endpoint-box__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.endpoint-box__hint {
  font-size: 12px;
  color: var(--text-muted);
}

.endpoint-list {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-top: 14px;
}

@media (max-width: 1080px) {
  .endpoint-list {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .endpoint-list {
    grid-template-columns: 1fr;
  }
}

.ep-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background-color: var(--bg-surface-subtle);
  border: 1px solid var(--border-light);
}

.ep-item code {
  font-size: 11px;
  color: var(--text-secondary);
}

.ep-item .endpoint-method {
  font-weight: 700;
  color: var(--primary);
  margin-right: 4px;
}

.ep-item small {
  font-size: 11px;
  color: var(--text-muted);
}

/* 端点条目：始终单行（方法+路径左、中文说明右），路径过长时省略号截断 */
.ep-item {
  min-width: 0;
  white-space: nowrap;
}

.ep-item code {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ep-item small {
  flex-shrink: 0;
}

@media (max-width: 640px) {
  .ep-item {
    padding: 7px 10px;
    gap: 8px;
  }
}

/* Request Panel (Dark Terminal style) */
.request-panel {
  background-color: var(--bg-terminal);
  border: 1px solid var(--border-terminal);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-lg);
}

.request-panel figcaption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  background-color: var(--bg-terminal-subtle);
  border-bottom: 1px solid var(--border-terminal);
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-terminal-muted);
}

.protocol-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--success);
  font-weight: 600;
}

.protocol-state::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--success);
}

.request-panel pre {
  padding: 18px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-terminal);
}

/* 移动端：终端示例自动折行，避免长 URL 溢出被裁切 */
@media (max-width: 640px) {
  .request-panel pre {
    padding: 14px;
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-x: hidden;
  }
}

.syntax-command { color: #38bdf8; font-weight: 600; }
.syntax-key { color: #a78bfa; }
.syntax-string { color: #34d399; }

.request-panel__foot {
  padding: 10px 18px;
  background-color: var(--bg-terminal-subtle);
  border-top: 1px solid var(--border-terminal);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-terminal-muted);
}

.request-panel__foot code {
  color: #38bdf8;
}

/* Metrics Strip */
.metrics-strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 40px;
}

@media (max-width: 768px) {
  .metrics-strip {
    grid-template-columns: repeat(2, 1fr);
  }
}

.metric {
  background-color: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 18px 20px;
  box-shadow: var(--shadow-sm);
  transition: all var(--transition-fast);
}

.metric:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-hover);
  border-color: var(--primary-border);
}

.metric__value {
  display: block;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  line-height: 1.2;
}

.metric__label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  margin-top: 4px;
}

/* Directory Section */
.directory {
  margin-bottom: 60px;
}

.section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.section-heading h2 {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.section-heading p {
  font-size: 13px;
  color: var(--text-muted);
}

.search-field {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 260px;
}

.search-field input {
  padding-left: 36px;
  border-radius: var(--radius-full);
}

@media (max-width: 640px) {
  .search-field {
    min-width: 0;
    width: 100%;
  }
}

.search-field .svg-icon,
.search-field i {
  position: absolute;
  left: 12px;
  color: var(--text-muted);
  pointer-events: none;
}

.provider-index {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.provider-row {
  background-color: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 16px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  box-shadow: var(--shadow-sm);
  transition: all var(--transition-fast);
  min-width: 0;
}

.provider-row:hover {
  border-color: var(--primary-border);
  box-shadow: var(--shadow-md);
}

.provider-row__identity {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 180px;
}

.provider-row__mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: var(--bg-surface-subtle);
  border: 1px solid var(--border-color);
  font-weight: 700;
  font-size: 16px;
  color: var(--primary);
  flex-shrink: 0;
}

.provider-row__identity > div {
  min-width: 0;
}

.provider-row__identity h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.provider-row__identity p {
  font-size: 12px;
  color: var(--text-muted);
}

.provider-row__models {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.model-token {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--radius-md);
  background-color: var(--bg-surface-subtle);
  border: 1px solid var(--border-color);
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  max-width: 100%;
  min-width: 0;
}

.model-token code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.model-token .svg-icon {
  flex-shrink: 0;
}

/* 移动端：渠道卡片改为「身份 + 状态」同一行、模型标签整行换行，杜绝横向溢出 */
@media (max-width: 720px) {
  .provider-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: "identity badge" "models models";
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
  }
  .provider-row__identity {
    grid-area: identity;
    min-width: 0;
  }
  .provider-row__models {
    grid-area: models;
    width: 100%;
  }
  .provider-row > .status-badge {
    grid-area: badge;
  }
  .provider-row__mark {
    width: 34px;
    height: 34px;
    font-size: 14px;
  }
  .empty-inline {
    font-size: 12px;
  }
}

.model-token:hover {
  background-color: var(--primary-light);
  color: var(--primary);
  border-color: var(--primary-border);
}

.model-token[data-state="success"] {
  background-color: var(--success-light);
  color: var(--success-text);
  border-color: var(--success-border);
}

.empty-state {
  text-align: center;
  padding: 48px 24px;
  background-color: var(--bg-surface);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  color: var(--text-muted);
}

.empty-state h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-block: 8px 4px;
}

/* ==========================================================================
   Auth / Login Page
   ========================================================================== */

.auth-page {
  background: radial-gradient(circle at 50% 30%, rgba(37, 99, 235, 0.05) 0%, transparent 60%), var(--bg-page);
  align-items: center;
  justify-content: center;
}

.auth-shell {
  width: 100%;
  max-width: 420px;
  padding: 24px;
  margin: auto;
}

.auth-form-wrap {
  background-color: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xl);
  padding: 32px 28px;
  box-shadow: var(--shadow-lg);
}

.auth-form__heading {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}

.auth-form__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-lg);
  background-color: var(--primary-light);
  color: var(--primary);
  border: 1px solid var(--primary-border);
}

.auth-form__heading h2 {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
}

.auth-form__heading p {
  font-size: 13px;
  color: var(--text-muted);
}

.btn-submit {
  width: 100%;
  padding-block: 10px;
  font-size: 14px;
  margin-top: 12px;
}

.button-loading {
  display: none;
}

.btn-submit[data-state="loading"] .button-label {
  display: none;
}

.btn-submit[data-state="loading"] .button-loading {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

/* ==========================================================================
   Admin Workbench Shell
   ========================================================================== */

.admin-page {
  background-color: var(--bg-page);
  display: flex;
  min-height: 100vh;
}

.admin-shell {
  display: flex;
  width: 100%;
  min-height: 100vh;
}

/* Admin Sidebar (Rail) */
.admin-rail {
  width: var(--rail-width);
  background-color: var(--bg-surface);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
  z-index: 90;
  flex-shrink: 0;
  transition: width var(--transition-normal);
}

.admin-rail.collapsed {
  width: var(--rail-width-collapsed);
}

.admin-rail__head {
  padding: 18px 20px;
  border-bottom: 1px solid var(--border-color);
}

.admin-rail__brand strong {
  display: block;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.2;
}

.admin-rail__brand small {
  font-size: 10px;
  color: var(--text-muted);
  font-weight: 600;
  letter-spacing: 0.05em;
}

.admin-rail.collapsed .admin-rail__brand span:last-child {
  display: none;
}

.admin-nav {
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  overflow-y: auto;
}

.admin-nav__link {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  transition: all var(--transition-fast);
}

.admin-nav__link:hover {
  background-color: var(--bg-surface-subtle);
  color: var(--text-primary);
}

.admin-nav__link.is-active {
  background-color: var(--primary-light);
  color: var(--primary);
  font-weight: 600;
}

.admin-nav__link b {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  background-color: var(--bg-surface-subtle);
  color: var(--text-muted);
  padding: 1px 7px;
  border-radius: var(--radius-full);
}

.admin-nav__link.is-active b {
  background-color: #ffffff;
  color: var(--primary);
}

.admin-rail.collapsed .admin-nav__link span,
.admin-rail.collapsed .admin-nav__link b {
  display: none;
}

.admin-rail__foot {
  padding: 14px 12px;
  border-top: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rail-toggle {
  background: transparent;
  border: none;
  width: 100%;
  cursor: pointer;
}

/* Admin Main Area */
.admin-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.admin-topbar {
  display: none;
  background-color: var(--bg-glass);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-color);
  position: sticky;
  top: 0;
  z-index: 80;
  padding: 10px 16px 8px;
}

@media (max-width: 860px) {
  .admin-rail {
    display: none;
  }
  /* 移动端顶部栏：品牌 + 导航 + 操作保持在同一栏（导航可横向滑动） */
  .admin-topbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
  }
  .admin-topbar .brand__name {
    display: none;
  }
  .admin-topbar__actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .admin-topbar__actions .icon-btn {
    width: 30px;
    height: 30px;
  }
  .admin-topbar__nav {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1 1 auto;
    min-width: 0;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    padding-bottom: 0;
  }
  .admin-topbar__nav::-webkit-scrollbar {
    display: none;
  }
  .admin-topbar__nav a {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px;
    font-size: 12px;
    font-weight: 500;
    border-radius: var(--radius-full);
    color: var(--text-secondary);
    background-color: var(--bg-surface);
    border: 1px solid var(--border-color);
    white-space: nowrap;
    flex-shrink: 0;
    transition: all var(--transition-fast);
  }
  .admin-topbar__nav a.is-active {
    background-color: var(--primary);
    color: #ffffff;
    border-color: var(--primary);
    box-shadow: 0 1px 3px rgba(37, 99, 235, 0.25);
  }
  .admin-topbar__nav a.is-active b {
    background-color: rgba(255, 255, 255, 0.25);
    color: #ffffff;
  }
  .admin-topbar__nav a b {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: var(--radius-full);
    background-color: var(--bg-surface-subtle);
    color: var(--text-muted);
  }
}

.admin-content {
  padding: 32px 36px;
  flex: 1;
  max-width: 1300px;
  width: 100%;
  margin-inline: auto;
}

@media (max-width: 640px) {
  .admin-content {
    padding: 16px;
  }
}

.admin-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.admin-heading h1 {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.admin-heading p {
  font-size: 13px;
  color: var(--text-muted);
}

/* Admin Overview Stat Cards */
.admin-metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 32px;
}

@media (max-width: 900px) {
  .admin-metrics {
    grid-template-columns: repeat(2, 1fr);
  }
}

.admin-metrics > div {
  background-color: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 20px;
  box-shadow: var(--shadow-sm);
  transition: all var(--transition-fast);
}

.admin-metrics > div:hover {
  transform: translateY(-2px);
  border-color: var(--primary-border);
  box-shadow: var(--shadow-hover);
}

.admin-metrics span {
  display: block;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  line-height: 1.2;
}

.admin-metrics p {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-top: 4px;
}

.admin-metrics small {
  font-size: 12px;
  color: var(--text-muted);
}

.status-dot--online {
  color: var(--success);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.status-dot--online::before {
  content: "";
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--success);
}

/* ==========================================================================
   Provider Management (Accordion & Panels)
   ========================================================================== */

.workspace-section {
  display: none;
}

.workspace-section.is-active {
  display: block;
  animation: fadeIn var(--transition-fast);
}

.add-form-panel {
  background-color: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 24px;
  margin-bottom: 24px;
  box-shadow: var(--shadow-md);
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border-light);
}

.panel-heading > div {
  display: flex;
  align-items: center;
  gap: 12px;
}

.panel-heading__mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background-color: var(--primary-light);
  color: var(--primary);
}

.panel-heading h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.panel-heading p {
  font-size: 12px;
  color: var(--text-muted);
}

.provider-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pi {
  background-color: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  transition: all var(--transition-fast);
}

.pi:hover {
  border-color: var(--border-strong);
}

.ps {
  padding: 16px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
  background-color: var(--bg-surface);
  transition: background-color var(--transition-fast);
}

.ps:hover {
  background-color: var(--bg-surface-subtle);
}

.ps .l {
  display: flex;
  align-items: center;
  gap: 14px;
}

.provider-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--text-subtle);
  transition: transform var(--transition-fast);
}

.provider-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background-color: var(--bg-surface-subtle);
  border: 1px solid var(--border-color);
  font-weight: 700;
  font-size: 14px;
  color: var(--primary);
  flex-shrink: 0;
}

.ps h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.pu {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.pu code {
  color: var(--text-secondary);
  font-weight: 500;
}

/* 渠道卡片头：参照老站始终保持单行（左侧身份 + 右侧开关/状态），窄屏隐藏头像让出空间 */
.ps {
  flex-wrap: nowrap;
}

.ps .l {
  min-width: 0;
  flex: 1 1 auto;
}

.ps > .fc {
  flex-shrink: 0;
}

@media (max-width: 520px) {
  .ps {
    padding: 14px 16px;
    gap: 10px;
  }
  .ps .l {
    gap: 10px;
  }
  .provider-avatar {
    display: none;
  }
  .ps h3 {
    font-size: 14px;
    overflow-wrap: anywhere;
  }
  .pu {
    flex-wrap: wrap;
    gap: 2px 8px;
    line-height: 1.5;
  }
  .pu > * {
    white-space: nowrap;
  }
  .ps > .fc {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
}

/* 表单行：参照老站保持单行、输入框可收缩 */
.field-row {
  min-width: 0;
  flex-wrap: nowrap;
}

.field-row .fx1 {
  min-width: 0;
}

.pd {
  display: none;
  padding: 24px;
  border-top: 1px solid var(--border-light);
  background-color: #fafbfc;
}

.pd.open {
  display: block;
  animation: fadeIn var(--transition-fast);
}

.detail-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border-color);
}

.protocol-chip {
  font-size: 11px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: var(--radius-xs);
  background-color: var(--primary-light);
  color: var(--primary-text);
  border: 1px solid var(--primary-border);
}

fieldset.form-group {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 16px;
  margin-bottom: 16px;
  background-color: var(--bg-surface);
}

fieldset.form-group legend {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  padding-inline: 8px;
}

/* 底部操作区：参照老站「状态在上、按钮换行右对齐」的布局 */
.detail-actions,
.panel-actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

.detail-actions > div:last-child,
.panel-actions > div:last-child {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}

@media (max-width: 640px) {
  .detail-actions > div:last-child > .btn,
  .panel-actions > div:last-child > .btn {
    flex: 1 1 auto;
    min-width: 0;
  }
}

/* ==========================================================================
   Quota & Usage & Backup Grid Styles
   ========================================================================== */

.rank-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 18px;
  margin-top: 16px;
}

/* 额度卡片整行铺满，内部账号按多列铺开，避免右侧大片留白 */
.quota-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 18px;
  margin-top: 16px;
}

@media (max-width: 640px) {
  .rank-grid {
    grid-template-columns: 1fr;
  }
}

.quota-card,
.rank-card {
  background-color: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 20px;
  box-shadow: var(--shadow-sm);
}

/* 账号卡片内部：PC 端两列铺满整行，窄屏自适应为单列 */
.quota-card {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  align-content: start;
}

@media (max-width: 380px) {
  .quota-card {
    grid-template-columns: minmax(0, 1fr);
  }
}

.quota-card > .quota-card__head {
  grid-column: 1 / -1;
}

.quota-card > .ag-acct:only-of-type {
  grid-column: 1 / -1;
}

/* 额度条目在窄列中允许换行，避免挤压错位 */
.quota-card .quota-row__info {
  flex-wrap: wrap;
  gap: 4px 6px;
}

.quota-card .quota-row__info > span:last-child {
  white-space: nowrap;
}

.quota-bar {
  display: inline-block;
  flex: 1 1 48px;
  min-width: 32px;
  max-width: 88px;
  height: 6px;
  border-radius: var(--radius-full);
  background-color: var(--bg-surface-subtle);
  overflow: hidden;
  vertical-align: middle;
}

.quota-bar__fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-full);
}

.quota-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-light);
}

.quota-card__identity {
  display: flex;
  align-items: center;
  gap: 10px;
}

.quota-card__identity h4 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.quota-card__identity p {
  font-size: 12px;
  color: var(--text-muted);
}

.quota-row {
  margin-bottom: 12px;
}

.quota-row:last-child {
  margin-bottom: 0;
}

.quota-row__info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 4px;
}

.quota-row__name {
  font-weight: 500;
  color: var(--text-secondary);
}

.quota-row__meta {
  color: var(--text-muted);
  font-size: 11px;
}

.quota-bar,
.rank-bar {
  height: 6px;
  border-radius: var(--radius-full);
  background-color: var(--bg-surface-subtle);
  overflow: hidden;
}

.quota-bar__fill,
.rank-bar__fill {
  height: 100%;
  border-radius: var(--radius-full);
  background: linear-gradient(90deg, #2563eb, #3b82f6);
  transition: width var(--transition-normal);
}

/* Key List */
.key-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 令牌卡片：参照老站「上信息 / 下操作」的竖向布局，样式维持新版质感 */
.ki {
  background-color: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  box-shadow: var(--shadow-sm);
  transition: all var(--transition-fast);
}

.ki:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-md);
}

.key-main {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
}

.key-main > div {
  min-width: 0;
  flex: 1 1 auto;
}

.key-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: var(--radius-md);
  background-color: var(--primary-light);
  color: var(--primary);
  border: 1px solid var(--primary-border);
}

.kv {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.kv__value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.key-meta {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.key-meta h3 {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.key-meta p {
  min-width: 0;
}

.key-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

/* ==========================================================================
   Site Footer
   ========================================================================== */

.site-footer {
  margin-top: auto;
  border-top: 1px solid var(--border-color);
  background-color: var(--bg-surface);
  padding-block: 20px;
  font-size: 12px;
  color: var(--text-muted);
}

.site-footer__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.site-footer__brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.site-footer__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--success);
  flex-shrink: 0;
}

/* 移动端：页脚版权与平台标识保持同一行，超长部分省略 */
@media (max-width: 640px) {
  .site-footer {
    padding-block: 14px;
    font-size: 11px;
  }
  .site-footer__inner {
    flex-wrap: nowrap;
    gap: 8px;
  }
  .site-footer__copy {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .site-footer__suffix {
    display: none;
  }
  .site-footer__meta {
    flex-shrink: 0;
  }
  .platform-tag {
    font-size: 10px;
    padding: 2px 6px;
  }
}

.site-footer__link {
  color: var(--text-secondary);
  font-weight: 500;
}

.site-footer__link:hover {
  color: var(--primary);
}

.platform-tag {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  background-color: var(--bg-surface-subtle);
  border: 1px solid var(--border-color);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
}
`
