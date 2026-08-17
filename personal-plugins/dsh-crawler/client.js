/**
 * pawl — browser half for the dsh web GUI (vanilla DOM, no build chain).
 *
 * Injects a sidebar entry (爬虫 / Crawler) and a center-column panel: the
 * master enabled switch, engine pick, headless, politeness delay, profile &
 * output dirs — persisted through the loopback /api/dsh-crawler/config
 * route, live re-registering the agent tools. Status card lists engines,
 * profiles, and recent batch outputs.
 *
 * DOM-extension precedent: dsh-ssh / dsh-task-board (MutationObserver
 * self-healing sidebar row, center-column takeover via a <html> attribute,
 * cross-panel eviction event). Failures degrade this card, never the GUI.
 */

const API = { config: '/api/dsh-crawler/config', status: '/api/dsh-crawler/status' }
const ACTIVE_ATTR = 'data-dsh-crawler-active'
const VIEW_SEL = '[data-dsh-crawler-view]'
const PANEL_NAME = 'crawler'
const ACTIVATE_EVENT = 'dsh-panel-activate'
const OTHER_ACTIVE_ATTRS = ['data-dsh-ssh-active', 'data-dsh-taskboard-active', 'data-dsh-pet-active']

const zh = {
  entry: '爬虫', tooltip: 'pawl 网页爬取配置',
  title: 'pawl 网页爬取', subtitle: '通用爬虫插件 · 6 个 agent 工具 · 配置即时生效',
  enabled: '启用插件', enabledHint: '关闭立即从会话注销全部 crawler_* 工具',
  engine: '默认引擎', engines: { auto: 'auto 自动', http: 'http 纯静态（最快）', crawl4ai: 'crawl4ai 智能提取', browser: 'browser 反检测浏览器' },
  headless: '无头模式', headlessHint: '关闭 = 弹真实窗口（首次解锁/调试用）',
  autoClick: '自动过人机验证', autoClickHint: '遇 Cloudflare 自动点复选框（约 1-2 分钟）；失败才提醒人工',
  minDelayMs: '抓取间隔 (ms)', profileDir: '浏览器 profile 目录', outdir: '存储文件夹',
  outdirHint: '所有抓取结果的存储位置：批量/整站 JSONL、整站单页文件、saveTo 默认目录',
  save: '保存', saved: '已保存 ✓', saveFail: '保存失败', reset: '重载',
  status: '运行状态', none: '暂无',
  venvOk: '完整引擎（crawl4ai + patchright）', venvMissing: '仅 http 引擎（缺 venv）',
  toolsHint: '会话内直接说「用 crawler_fetch 抓取 …」即可调用',
  reload: '刷新状态',
}
const en = {
  entry: 'Crawler', tooltip: 'pawl web crawler settings',
  title: 'pawl Web Crawler', subtitle: 'Universal crawler plugin · 6 agent tools · edits apply live',
  enabled: 'Enable plugin', enabledHint: 'Off unregisters every crawler_* tool from the session instantly',
  engine: 'Default engine', engines: { auto: 'auto', http: 'http static (fastest)', crawl4ai: 'crawl4ai smart extraction', browser: 'browser anti-detect' },
  headless: 'Headless', headlessHint: 'Off = real window (first unlock / debugging)',
  autoClick: 'Auto-pass human check', autoClickHint: 'Auto-clicks the Cloudflare checkbox (~1-2 min); human only as fallback',
  minDelayMs: 'Fetch delay (ms)', profileDir: 'Browser profile dir', outdir: 'Storage folder',
  outdirHint: 'Where every crawl result lands: batch/site JSONL, per-page files, saveTo default dir',
  save: 'Save', saved: 'Saved ✓', saveFail: 'Save failed', reset: 'Reload',
  status: 'Status', none: 'none',
  venvOk: 'Full engines (crawl4ai + patchright)', venvMissing: 'http engine only (venv missing)',
  toolsHint: 'In a session just say "use crawler_fetch to scrape …"',
  reload: 'Refresh status',
}
const t = (navigator.language || 'en').toLowerCase().startsWith('zh') ? zh : en

const CSS = [
  '.pawl-entry{display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);background:none;border:none;border-radius:8px;cursor:pointer;text-align:left}',
  '.pawl-entry:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
  '.pawl-entry span{display:inline-flex;opacity:.85}',
  'html[' + ACTIVE_ATTR + '] [data-pane="conversation"]>*:not(' + VIEW_SEL + '){display:none}',
  '.pawl-view{height:100%;overflow:auto;padding:24px 28px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px}',
  '.pawl-card{max-width:640px;margin:0 auto;display:flex;flex-direction:column;gap:16px}',
  '.pawl-head h2{margin:0;font-size:16px}.pawl-head p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px}',
  '.pawl-box{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:14px;background:var(--dsw-alias-bg-layer-2)}',
  '.pawl-row{display:flex;align-items:center;gap:12px}',
  '.pawl-row .grow{flex:1;min-width:0}',
  '.pawl-row label{font-weight:500}.pawl-row small{display:block;color:var(--dsw-alias-label-secondary);font-weight:400;margin-top:2px}',
  '.pawl-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsh-alias-bg-layer-3,var(--dsw-alias-bg-layer-3));color:var(--dsw-alias-label-primary);height:32px;border-radius:8px;padding:0 10px;font:inherit;font-size:13px;min-width:0}',
  '.pawl-input.short{width:110px}',
  '.pawl-sw{position:relative;width:38px;height:22px;flex:none}',
  '.pawl-sw input{opacity:0;position:absolute;inset:0;margin:0;cursor:pointer;z-index:1}',
  '.pawl-sw i{position:absolute;inset:0;border-radius:999px;background:var(--dsw-alias-bg-layer-4);transition:.15s}',
  '.pawl-sw i::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-tertiary);transition:.15s}',
  '.pawl-sw input:checked+i{background:var(--dsw-alias-accent,#3b82f6)}',
  '.pawl-sw input:checked+i::after{left:19px;background:#fff}',
  '.pawl-engines{display:flex;flex-direction:column;gap:6px}',
  '.pawl-engines label{display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:400}',
  '.pawl-btn{font:inherit;font-size:13px;padding:7px 16px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);cursor:pointer}',
  '.pawl-btn.primary{background:var(--dsw-alias-accent,#3b82f6);border-color:transparent;color:#fff}',
  '.pawl-btn:disabled{opacity:.5;cursor:default}',
  '.pawl-ok{color:#22c55e;font-size:12px}.pawl-err{color:#ef4444;font-size:12px}',
  '.pawl-kv{display:flex;flex-wrap:wrap;gap:8px}',
  '.pawl-tag{border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 10px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
  '.pawl-list{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.7}',
].join('\n')

function el(tag, attrs, kids) {
  const node = document.createElement(tag)
  attrs = attrs || {}
  for (const k of Object.keys(attrs)) {
    const v = attrs[k]
    if (k === 'class') node.className = v
    else if (k === 'text') node.textContent = v
    else if (v !== undefined) node.setAttribute(k, v)
  }
  for (const kid of kids || []) if (kid != null) node.append(kid)
  return node
}

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

function switchRow(input, label, hint) {
  return el('div', { class: 'pawl-row' },
    el('div', { class: 'pawl-sw' }, input, el('i')),
    el('div', { class: 'grow' }, el('label', { text: label }), el('small', { text: hint })))
}

function buildPanel() {
  const fEnabled = el('input', { type: 'checkbox' })
  const fHeadless = el('input', { type: 'checkbox' })
  const fAuto = el('input', { type: 'checkbox' })
  const fDelay = el('input', { class: 'pawl-input short', type: 'number', min: '0', step: '100' })
  const fProfile = el('input', { class: 'pawl-input', style: 'flex:1', placeholder: '~/.dsh/crawler-profiles/default' })
  const fOutdir = el('input', { class: 'pawl-input', style: 'flex:1', placeholder: '~/.dsh/crawler-out', title: t.outdirHint })
  const msg = el('span', {})
  const statusBox = el('div', { class: 'pawl-list', text: '…' })

  const engineBox = el('div', { class: 'pawl-engines' })
  const radios = ['auto', 'http', 'crawl4ai', 'browser'].map((e) => {
    const r = el('input', { type: 'radio', name: 'pawl-engine', value: e })
    engineBox.append(el('label', {}, [r, document.createTextNode(' ' + t.engines[e])]))
    return r
  })

  const fill = (cfg) => {
    fEnabled.checked = cfg.enabled !== false
    fHeadless.checked = cfg.headless !== false
    fAuto.checked = cfg.autoClick !== false
    fDelay.value = cfg.minDelayMs != null ? cfg.minDelayMs : 1500
    fProfile.value = cfg.profileDir || ''
    fOutdir.value = cfg.outdir || ''
    const want = cfg.engine || 'auto'
    for (const r of radios) r.checked = r.value === want
  }
  const collect = () => {
    const out = {
      enabled: fEnabled.checked,
      engine: (radios.find((r) => r.checked) || radios[0]).value,
      headless: fHeadless.checked,
      autoClick: fAuto.checked,
      minDelayMs: Number(fDelay.value) || 1500,
    }
    if (fProfile.value.trim()) out.profileDir = fProfile.value.trim()
    if (fOutdir.value.trim()) out.outdir = fOutdir.value.trim()
    return out
  }

  const loadStatus = () => api(API.status).then((s) => {
    const tags = [el('span', { class: 'pawl-tag', text: s.venvPython ? t.venvOk : t.venvMissing })]
    for (const p of s.profiles || []) tags.push(el('span', { class: 'pawl-tag', text: p.name }))
    for (const o of (s.outputs || []).slice(-4)) tags.push(el('span', { class: 'pawl-tag', text: o.file + ' (' + Math.round(o.bytes / 1024) + 'K)' }))
    if (tags.length === 1) tags.push(el('span', { class: 'pawl-tag', text: t.none }))
    statusBox.replaceChildren(el('div', { class: 'pawl-kv' }, tags))
  }).catch(() => { statusBox.textContent = '—' })

  const saveBtn = el('button', { class: 'pawl-btn primary', text: t.save })
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true; msg.className = ''; msg.textContent = '…'
    try {
      const r = await api(API.config, collect())
      fill(r.config); msg.className = 'pawl-ok'; msg.textContent = t.saved
    } catch (e) { msg.className = 'pawl-err'; msg.textContent = t.saveFail }
    saveBtn.disabled = false
    setTimeout(() => { msg.textContent = '' }, 2500)
  })
  const resetBtn = el('button', { class: 'pawl-btn', text: t.reset })
  resetBtn.addEventListener('click', () => { api(API.config).then((r) => fill(r.config)).catch(() => {}) })
  const reloadBtn = el('button', { class: 'pawl-btn', text: t.reload })
  reloadBtn.addEventListener('click', loadStatus)

  const card = el('div', { class: 'pawl-card' }, [
    el('div', { class: 'pawl-head' }, [
      el('h2', { text: t.title }),
      el('p', { text: t.subtitle + ' · ' + t.toolsHint }),
    ]),
    el('div', { class: 'pawl-box' }, [
      switchRow(fEnabled, t.enabled, t.enabledHint),
      el('div', { class: 'pawl-row' }, [el('div', { class: 'grow' }, [el('label', { text: t.engine })]), engineBox]),
      switchRow(fHeadless, t.headless, t.headlessHint),
      switchRow(fAuto, t.autoClick, t.autoClickHint),
      el('div', { class: 'pawl-row' }, [el('label', { text: t.minDelayMs }), fDelay]),
      el('div', { class: 'pawl-row' }, [el('label', { text: t.profileDir }), fProfile]),
      el('div', { class: 'pawl-row' }, [el('label', { text: t.outdir }), fOutdir]),
      el('div', { class: 'pawl-row' }, [saveBtn, resetBtn, msg]),
      el('div', {}, [el('div', { style: 'font-weight:500;margin-bottom:6px', text: t.status }), statusBox, reloadBtn]),
    ]),
  ])
  return { card, fill, loadStatus }
}

export function apply(ctx) {
  let open = false
  let style, entry, panel, observer, disposeEffect

  const ensureStyle = () => {
    if (style !== undefined && style.isConnected) return
    style = el('style', { 'data-pawl-css': '' })
    style.textContent = CSS
    document.head.append(style)
  }

  const sidebarRoot = () => {
    const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
    if (column === null) return undefined
    return (column.querySelector('[class*="logoRow"]') || {}).parentElement || column.firstElementChild || undefined
  }

  const ensureEntry = () => {
    if (entry !== undefined && entry.isConnected) return
    const root = sidebarRoot()
    if (root === undefined) return
    ensureStyle()
    entry = el('button', { type: 'button', class: 'pawl-entry', 'data-dsh-crawler-entry': '', 'aria-label': t.entry, title: t.tooltip })
    const icon = el('span')
    icon.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="2.2"/><path d="M8 2.2v2M8 11.8v2M2.2 8h2M11.8 8h2M3.8 3.8l1.5 1.5M10.7 10.7l1.5 1.5M12.2 3.8l-1.5 1.5M5.3 10.7l-1.5 1.5"/></svg>'
    entry.append(icon, document.createTextNode(t.entry))
    entry.addEventListener('click', () => toggle(!open))
    const anchor = root.querySelector('button[class*="newSession"]') || Array.prototype.find.call(root.children, (c) => c.tagName === 'BUTTON')
    if (anchor !== undefined && anchor.parentElement !== null) anchor.parentElement.insertBefore(entry, anchor.nextSibling)
    else root.prepend(entry)
  }

  const ensurePanel = () => {
    if (panel !== undefined && panel.isConnected) { if (panel._pawl) panel._pawl.loadStatus(); return }
    const column = document.querySelector('[data-pane="conversation"]')
    if (column === null) return
    ensureStyle()
    const built = buildPanel()
    panel = el('div', { 'data-dsh-crawler-view': '', class: 'pawl-view' }, [built.card])
    panel._pawl = built
    column.append(panel)
    api(API.config).then((r) => built.fill(r.config)).catch(() => {})
    built.loadStatus()
  }

  const applyActive = () => {
    if (open) {
      for (const attr of OTHER_ACTIVE_ATTRS) document.documentElement.removeAttribute(attr)
      document.documentElement.setAttribute(ACTIVE_ATTR, '')
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }))
    } else {
      document.documentElement.removeAttribute(ACTIVE_ATTR)
    }
  }

  const toggle = (next) => {
    open = next
    if (open) ensurePanel()
    applyActive()
  }

  const onActivate = (ev) => { if (ev.detail !== PANEL_NAME && open) { open = false; applyActive() } }
  document.addEventListener(ACTIVATE_EVENT, onActivate)

  observer = new MutationObserver(() => { ensureEntry(); if (open) ensurePanel() })
  observer.observe(document.body, { childList: true, subtree: true })
  ensureEntry()

  disposeEffect = () => {
    if (observer) observer.disconnect()
    document.removeEventListener(ACTIVATE_EVENT, onActivate)
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    if (entry) entry.remove()
    if (panel) panel.remove()
    if (style) style.remove()
  }
  if (ctx && typeof ctx.effect === 'function') ctx.effect(() => disposeEffect, 'dsh-crawler: ui')
  else if (typeof dispose === 'function') dispose(disposeEffect)
}

export const inject = []
