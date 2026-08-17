/**
 * context-ring client: sidebar entry「圆环」+ palette panel.
 * Swatch-grid color pickers (no hex typing) + threshold sliders; saves via
 * /api/context-ring/config; applies live via injected CSS variables.
 * Palette = curated swatches; click applies instantly.
 */
const API = '/api/context-ring/config'
const PALETTE = ['#ef4444', '#f43f5e', '#f97316', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6',
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#78716c']

const zh = {
  entry: '圆环', title: '上下文圆环配色', warn: '警告色（≥ 阈值一）', danger: '危险色（≥ 阈值二）',
  warnAt: '阈值一', dangerAt: '阈值二', save: '保存', saved: '已保存 ✓', fail: '保存失败',
  hint: '点色块选色，拖滑块调阈值；立即生效',
}
const en = {
  entry: 'Ring', title: 'Context Ring Colors', warn: 'Warn color (≥ T1)', danger: 'Danger color (≥ T2)',
  warnAt: 'T1', dangerAt: 'T2', save: 'Save', saved: 'Saved ✓', fail: 'Save failed',
  hint: 'Pick swatches, drag thresholds; applies instantly',
}
const t = (navigator.language || 'en').toLowerCase().startsWith('zh') ? zh : en

const CSS = [
  '.cr-entry{display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);background:none;border:none;border-radius:8px;cursor:pointer;text-align:left}',
  '.cr-entry:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
  'html[data-cr-open] [data-pane="conversation"]>*:not([data-cr-view]){display:none}',
  '.cr-view{height:100%;overflow:auto;padding:24px 28px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px}',
  '.cr-card{max-width:560px;margin:0 auto;display:flex;flex-direction:column;gap:18px}',
  '.cr-box{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-2)}',
  '.cr-label{font-weight:500;display:flex;justify-content:space-between}',
  '.cr-swatches{display:grid;grid-template-columns:repeat(9,1fr);gap:8px;padding:4px 0}',
  '.cr-sw{width:26px;height:26px;border-radius:8px;cursor:pointer;border:2px solid transparent;display:inline-block}',
  '.cr-sw.on{border-color:var(--dsw-alias-label-primary);box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2) inset}',
  '.cr-range{width:100%;accent-color:var(--dsw-alias-accent,#3b82f6)}',
  '.cr-btn{font:inherit;font-size:13px;padding:7px 16px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);cursor:pointer}',
  '.cr-btn.primary{background:var(--dsw-alias-accent,#3b82f6);border-color:transparent;color:#fff}',
  '.cr-ok{color:#22c55e;font-size:12px}.cr-err{color:#ef4444;font-size:12px}',
  '.cr-preview{display:flex;align-items:center;gap:10px;color:var(--dsw-alias-label-secondary)}',
].join('\n')

function el(tag, attrs, kids) {
  const n = document.createElement(tag)
  attrs = attrs || {}
  for (const k of Object.keys(attrs)) {
    const v = attrs[k]
    if (k === 'class') n.className = v
    else if (k === 'text') n.textContent = v
    else if (v !== undefined) n.setAttribute(k, v)
  }
  for (const kid of kids || []) if (kid != null) n.append(kid)
  return n
}

function ringSvg(p, color, pct) {
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 14 14'); svg.setAttribute('width', '22'); svg.setAttribute('height', '22')
  const track = document.createElementNS(NS, 'circle')
  track.setAttribute('cx', 7); track.setAttribute('cy', 7); track.setAttribute('r', 6)
  track.setAttribute('fill', 'none'); track.setAttribute('stroke', 'var(--dsw-alias-border-l3)'); track.setAttribute('stroke-width', '2')
  const fill = document.createElementNS(NS, 'circle')
  fill.setAttribute('cx', 7); fill.setAttribute('cy', 7); fill.setAttribute('r', 6)
  fill.setAttribute('fill', 'none'); fill.setAttribute('stroke', color); fill.setAttribute('stroke-width', '2')
  fill.setAttribute('stroke-linecap', 'round')
  const C = 2 * Math.PI * 6
  fill.setAttribute('stroke-dasharray', (C * pct / 100) + ' ' + C)
  fill.setAttribute('transform', 'rotate(-90 7 7)')
  svg.append(track, fill)
  return svg
}

export function apply(ctx) {
  let open = false, cfg = { warnAt: 50, dangerAt: 80, warnColor: '#f59e0b', dangerColor: '#ef4444' }
  let style, entry, panel, liveStyle, observer

  const ensureStyles = () => {
    if (liveStyle === undefined || !liveStyle.isConnected) {
      liveStyle = el('style', { 'data-cr-live': '' })
      document.head.append(liveStyle)
    }
    if (style === undefined || !style.isConnected) {
      style = el('style', { 'data-cr-css': '' }); style.textContent = CSS
      document.head.append(style)
    }
  }
  const applyLive = () => {
    ensureStyles()
    liveStyle.textContent = [
      '.dsh-ring-warn circle[class*="_fill"]{stroke:' + cfg.warnColor + ' !important}',
      '.dsh-ring-danger circle[class*="_fill"]{stroke:' + cfg.dangerColor + ' !important}',
    ].join('\n')
  }

  const classify = () => {
    for (const svg of document.querySelectorAll('svg')) {
      if (!svg.querySelector('circle[class*="_track"]')) continue
      for (const c of svg.querySelectorAll('circle[class*="_fill"]')) {
        const dash = (c.getAttribute('stroke-dasharray') || '').trim()
        if (!dash) continue
        const p = dash.split(/[\s,]+/).map(Number)
        if (p.length < 2 || !p[1]) continue
        const pct = (p[0] / p[1]) * 100
        const host = svg.closest('[class*="_trigger"], button') || svg
        host.classList.remove('dsh-ring-warn', 'dsh-ring-danger')
        if (pct >= Number(cfg.dangerAt)) host.classList.add('dsh-ring-danger')
        else if (pct >= Number(cfg.warnAt)) host.classList.add('dsh-ring-warn')
      }
    }
  }

  const swatchRow = (key) => {
    const box = el('div', { class: 'cr-swatches' })
    const update = () => { for (const s of box.children) s.classList.toggle('on', s.dataset.c === cfg[key]) }
    for (const c of PALETTE) {
      const s = el('span', { class: 'cr-sw', 'data-c': c })
      s.style.background = c
      s.addEventListener('click', () => { cfg[key] = c; update(); applyLive(); classify(); renderPreview() })
      box.append(s)
    }
    update()
    return box
  }

  let previewBox
  const renderPreview = () => {
    if (!previewBox) return
    previewBox.replaceChildren(
      ringSvg(0, 'var(--dsw-alias-label-tertiary)', 30), el('span', { text: '30%' }),
      ringSvg(0, cfg.warnColor, 65), el('span', { text: '65%' }),
      ringSvg(0, cfg.dangerColor, 90), el('span', { text: '90%' }))
  }

  const buildPanel = () => {
    ensureStyles()
    const msg = el('span', {})
    const warnAtVal = el('span', {}), dangerAtVal = el('span', {})
    const wRange = el('input', { class: 'cr-range', type: 'range', min: '0', max: '100', step: '5' })
    const dRange = el('input', { class: 'cr-range', type: 'range', min: '0', max: '100', step: '5' })
    const syncRanges = () => {
      wRange.value = cfg.warnAt; dRange.value = cfg.dangerAt
      warnAtVal.textContent = cfg.warnAt + '%'; dangerAtVal.textContent = cfg.dangerAt + '%'
    }
    wRange.addEventListener('input', () => { cfg.warnAt = Number(wRange.value); syncRanges(); classify() })
    dRange.addEventListener('input', () => { cfg.dangerAt = Number(dRange.value); syncRanges(); classify() })

    const saveBtn = el('button', { class: 'cr-btn primary', text: t.save })
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true; msg.className = ''; msg.textContent = '…'
      try {
        const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cfg) })
        const j = await r.json()
        if (!j.ok) throw 0
        msg.className = 'cr-ok'; msg.textContent = t.saved
      } catch { msg.className = 'cr-err'; msg.textContent = t.fail }
      saveBtn.disabled = false
      setTimeout(() => { msg.textContent = '' }, 2500)
    })

    previewBox = el('div', { class: 'cr-preview' })
    const card = el('div', { class: 'cr-card' }, [
      el('div', {}, [el('h2', { style: 'margin:0;font-size:16px', text: t.title }), el('p', { style: 'margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px', text: t.hint })]),
      el('div', { class: 'cr-box' }, [
        el('div', { class: 'cr-label', text: t.warn }), swatchRow('warnColor'),
        el('div', { class: 'cr-label' }, [el('span', { text: t.warnAt }), warnAtVal]), wRange,
        el('div', { class: 'cr-label', text: t.danger }), swatchRow('dangerColor'),
        el('div', { class: 'cr-label' }, [el('span', { text: t.dangerAt }), dangerAtVal]), dRange,
        previewBox,
        el('div', { style: 'display:flex;gap:10px;align-items:center' }, [saveBtn, msg]),
      ]),
    ])
    syncRanges(); renderPreview()
    return card
  }

  const sidebarRoot = () => {
    const col = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
    if (!col) return undefined
    return (col.querySelector('[class*="logoRow"]') || {}).parentElement || col.firstElementChild || undefined
  }
  const ensureEntry = () => {
    if (entry !== undefined && entry.isConnected) return
    const root = sidebarRoot(); if (!root) return
    ensureStyles()
    entry = el('button', { type: 'button', class: 'cr-entry', 'data-cr-entry': '', 'aria-label': t.entry, title: t.title })
    const icon = el('span'); icon.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="8" cy="8" r="5.6"/><path d="M8 2.4v2.2M13.6 8h-2.2M8 13.6v-2.2M2.4 8h2.2" stroke-width="1"/></svg>'
    entry.append(icon, document.createTextNode(t.entry))
    entry.addEventListener('click', () => toggle(!open))
    const anchor = root.querySelector('button[class*="newSession"]') || Array.prototype.find.call(root.children, (c) => c.tagName === 'BUTTON')
    if (anchor !== undefined && anchor.parentElement !== null) anchor.parentElement.insertBefore(entry, anchor.nextSibling)
    else root.prepend(entry)
  }
  const ensurePanel = () => {
    if (panel !== undefined && panel.isConnected) return
    const col = document.querySelector('[data-pane="conversation"]'); if (!col) return
    ensureStyles()
    panel = el('div', { 'data-cr-view': '', class: 'cr-view' }, [buildPanel()])
    col.append(panel)
  }
  const applyActive = () => {
    if (open) {
      document.documentElement.removeAttribute('data-dsh-ssh-active')
      document.documentElement.removeAttribute('data-dsh-taskboard-active')
      document.documentElement.setAttribute('data-cr-open', '')
      document.dispatchEvent(new CustomEvent('dsh-panel-activate', { detail: 'context-ring' }))
    } else document.documentElement.removeAttribute('data-cr-open')
  }
  const toggle = (next) => { open = next; if (open) ensurePanel(); applyActive() }
  const onActivate = (ev) => { if (ev.detail !== 'context-ring' && open) { open = false; applyActive() } }
  const onDeactivate = () => { if (open) { open = false; applyActive() } }
  document.addEventListener('dsh-panel-activate', onActivate)
  document.addEventListener('dsh-panel-deactivate', onDeactivate)

  applyLive()
  observer = new MutationObserver(() => { ensureEntry(); if (open) ensurePanel(); classify() })
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['stroke-dasharray'] })
  ensureEntry(); classify()
  fetch(API).then((r) => r.json()).then((j) => { if (j.ok && j.config) { cfg = { ...cfg, ...j.config }; applyLive(); classify() } }).catch(() => {})

  const dispose = () => {
    if (observer) observer.disconnect()
    document.removeEventListener('dsh-panel-activate', onActivate)
    document.removeEventListener('dsh-panel-deactivate', onDeactivate)
    if (entry) entry.remove(); if (panel) panel.remove()
    if (style) style.remove(); if (liveStyle) liveStyle.remove()
  }
  if (ctx && typeof ctx.effect === 'function') ctx.effect(() => dispose, 'context-ring: ui')
  else if (typeof dispose === 'function') { /* keep */ }
}

export const inject = []
