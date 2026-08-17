/* ⚠️ REWRITE RULE: this file MUST use the __ModuleLoader__ script contract:
 * window.__ModuleLoader__.load({ id, factory }) with the factory returning
 * { apply }. Plain ESM exports are IGNORED by the client loader and break
 * the whole UI ("loaded without registering"). */
window.__ModuleLoader__.load({
  id: "dsh-crawler",
  factory: function () {
    var module = { exports: {} };
    var exports = module.exports;
/**
 * pawl browser half — full settings panel (vanilla DOM, no build chain).
 * Sections: 基础 · 人机验证 · 抓取内容(格式+提取开关组:文字/图片/表格/链接/meta/PDF)
 * · 存放(格式/文件名/文件夹/profile) · 节流限额 · 网页列表(网址/文本导入)
 * · 检索词列表(引擎三选,保存即并入网页列表) · 批量控制 · 状态。
 */
const API = {
  config: '/api/dsh-crawler/config', status: '/api/dsh-crawler/status',
  seeds: '/api/dsh-crawler/seeds', terms: '/api/dsh-crawler/terms',
  batch: '/api/dsh-crawler/batch', batchStop: '/api/dsh-crawler/batch/stop',
}
const ACTIVE_ATTR = 'data-dsh-crawler-active'
const VIEW_SEL = '[data-dsh-crawler-view]'
const PANEL_NAME = 'crawler'
const ACTIVATE_EVENT = 'dsh-panel-activate'
const OTHERS = ['data-dsh-ssh-active', 'data-dsh-taskboard-active', 'data-cr-open']

const zh = {
  entry: '爬虫', tooltip: 'pawl 网页爬取设置',
  title: 'pawl 网页爬取', subtitle: '通用爬虫 · 设置即存 · 批量可跑',
  secBasic: '基础', enabled: '启用插件', enabledHint: '关闭立即注销全部执行工具',
  engine: '默认引擎', engines: { auto: 'auto', http: 'http 最快', crawl4ai: 'crawl4ai 智能提取', browser: 'browser 反检测' },
  headless: '无头模式', headlessHint: '关闭 = 弹真实窗口（首次解锁/调试）',
  secCf: '人机验证', autoClick: '自动过人机验证', autoClickHint: '遇 Cloudflare 自动点复选框；失败才提醒人工',
  budget: '自动点击预算 (ms)',
  secContent: '抓取内容与提取', contentMode: '内容格式', modes: { text: 'text', markdown: 'markdown', html: 'html', links: 'links' },
  maxChars: '单页字数上限',
  exTitle: '结构化提取（每页附带）',
  ex: { text: '文字', images: '图片', tables: '表格', links: '链接', meta: '元数据', pdf: 'PDF', docs: '文档/电子书(pdf/epub/mobi/docx/xlsx/pptx/csv/zip)' },
  secStore: '存放', saveMode: '存放格式', saveModes: { jsonl: 'jsonl 汇总', files: 'files 每页一文件', both: 'both 两者' },
  outFile: '汇总文件名', outdir: '存储文件夹', outdirHint: '所有结果与相对路径的解析根',
  profileDir: '浏览器 profile 目录',
  secThrottle: '节流与限额', minDelayMs: '抓取间隔 (ms)', limit: '单轮页数上限', resume: '断点续爬', timeoutMs: '总超时 (ms)',
  secSeeds: '网页列表（爬什么）', seedsHint: '粘贴网址或任意文本——保存时自动提取全部 URL；也可导入 .txt/.csv/.md 文件',
  importFile: '导入文件', saveSeeds: '保存列表',
  secTerms: '检索词列表（搜索什么）', termsHint: '每行一个关键词；保存后自动生成搜索结果页 URL 并入网页列表',
  enginePick: '搜索引擎', engines3: { bing: 'Bing', duckduckgo: 'DuckDuckGo', baidu: '百度' },
  saveTerms: '保存检索词',
  startBatch: '开始批量爬取', stopBatch: '停止', refresh: '刷新状态', running: '运行中', idle: '空闲',
  secStatus: '运行状态', save: '保存设置', saved: '已保存 ✓', saveFail: '保存失败',
  venvOk: '完整引擎', venvMissing: '仅 http（缺 venv）', toolsHint: '会话内说「用 crawler_fetch 抓 …」即可调用',
}
const en = {
  entry: 'Crawler', tooltip: 'pawl web crawler settings',
  title: 'pawl Web Crawler', subtitle: 'Universal crawler · settings persist · batch runs',
  secBasic: 'Basics', enabled: 'Enable', enabledHint: 'Off unregisters worker tools',
  engine: 'Engine', engines: { auto: 'auto', http: 'http fastest', crawl4ai: 'crawl4ai', browser: 'browser anti-detect' },
  headless: 'Headless', headlessHint: 'Off = real window',
  secCf: 'Human check', autoClick: 'Auto-pass', autoClickHint: 'Auto-clicks CF checkbox; human fallback',
  budget: 'Budget (ms)',
  secContent: 'Content & extraction', contentMode: 'Format', modes: { text: 'text', markdown: 'markdown', html: 'html', links: 'links' },
  maxChars: 'Max chars/page',
  exTitle: 'Structured extraction (per page)',
  ex: { text: 'Text', images: 'Images', tables: 'Tables', links: 'Links', meta: 'Meta', pdf: 'PDF', docs: 'Docs/ebooks (pdf/epub/mobi/docx/xlsx/pptx/csv/zip)' },
  secStore: 'Storage', saveMode: 'Format', saveModes: { jsonl: 'jsonl', files: 'files', both: 'both' },
  outFile: 'Summary filename', outdir: 'Storage folder', outdirHint: 'Root for all results',
  profileDir: 'Profile dir',
  secThrottle: 'Throttle', minDelayMs: 'Delay (ms)', limit: 'Pages/run', resume: 'Resume', timeoutMs: 'Timeout (ms)',
  secSeeds: 'Page list (what to crawl)', seedsHint: 'Paste URLs or text — auto-extracts URLs; or import a file',
  importFile: 'Import file', saveSeeds: 'Save list',
  secTerms: 'Search terms', termsHint: 'One query per line; saving builds search-result URLs into the page list',
  enginePick: 'Engine', engines3: { bing: 'Bing', duckduckgo: 'DuckDuckGo', baidu: 'Baidu' },
  saveTerms: 'Save terms',
  startBatch: 'Start batch', stopBatch: 'Stop', refresh: 'Refresh', running: 'Running', idle: 'Idle',
  secStatus: 'Status', save: 'Save settings', saved: 'Saved ✓', saveFail: 'Save failed',
  venvOk: 'Full engines', venvMissing: 'http only', toolsHint: 'Say "use crawler_fetch …" in a session',
}
const t = (navigator.language || 'en').toLowerCase().startsWith('zh') ? zh : en

const CSS = [
  '.pawl-entry{display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);background:none;border:none;border-radius:8px;cursor:pointer;text-align:left}',
  '.pawl-entry:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
  '.pawl-entry span{display:inline-flex;opacity:.85}',
  'html[' + ACTIVE_ATTR + '] [data-pane="conversation"]>*:not(' + VIEW_SEL + '){display:none}',
  '.pawl-view{height:100%;overflow:auto;padding:22px 26px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px}',
  '.pawl-card{max-width:680px;margin:0 auto;display:flex;flex-direction:column;gap:14px}',
  '.pawl-head h2{margin:0;font-size:16px}.pawl-head p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px}',
  '.pawl-sec{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:12px;background:var(--dsw-alias-bg-layer-2)}',
  '.pawl-sec>h3{margin:0;font-size:13px;color:var(--dsw-alias-label-secondary);font-weight:600}',
  '.pawl-row{display:flex;align-items:center;gap:12px}',
  '.pawl-row .grow{flex:1;min-width:0}',
  '.pawl-row label{font-weight:500}.pawl-row small{display:block;color:var(--dsw-alias-label-secondary);font-weight:400;margin-top:2px}',
  '.pawl-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);height:32px;border-radius:8px;padding:0 10px;font:inherit;font-size:13px;min-width:0;flex:1}',
  '.pawl-input.short{width:120px;flex:none}',
  '.pawl-sw{position:relative;width:38px;height:22px;flex:none}',
  '.pawl-sw input{opacity:0;position:absolute;inset:0;margin:0;cursor:pointer;z-index:1}',
  '.pawl-sw i{position:absolute;inset:0;border-radius:999px;background:var(--dsw-alias-bg-layer-4);transition:.15s}',
  '.pawl-sw i::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-tertiary);transition:.15s}',
  '.pawl-sw input:checked+i{background:var(--dsw-alias-accent,#3b82f6)}',
  '.pawl-sw input:checked+i::after{left:19px;background:#fff}',
  '.pawl-radios{display:flex;flex-wrap:wrap;gap:6px 16px}',
  '.pawl-radios label{display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:400}',
  '.pawl-checks{display:flex;flex-wrap:wrap;gap:10px 18px}',
  '.pawl-checks label{display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:400}',
  '.pawl-btn{font:inherit;font-size:13px;padding:7px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);cursor:pointer}',
  '.pawl-btn.primary{background:var(--dsw-alias-accent,#3b82f6);border-color:transparent;color:#fff}',
  '.pawl-btn.danger{border-color:#ef444455;color:#ef4444}',
  '.pawl-btn:disabled{opacity:.5;cursor:default}',
  '.pawl-ok{color:#22c55e;font-size:12px}.pawl-err{color:#ef4444;font-size:12px}.pawl-mute{color:var(--dsw-alias-label-secondary);font-size:12px}',
  '.pawl-ta{width:100%;min-height:100px;resize:vertical;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:8px 10px;font:12px/1.6 ui-monospace,Menlo,monospace}',
  '.pawl-pre{margin:0;white-space:pre-wrap;font:11px/1.6 ui-monospace,Menlo,monospace;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;max-height:120px;overflow:auto}',
  '.pawl-kv{display:flex;flex-wrap:wrap;gap:8px}',
  '.pawl-tag{border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 10px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
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
async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok && res.status !== 409) throw new Error('HTTP ' + res.status)
  return res.json()
}
function swRow(input, label, hint) {
  return el('div', { class: 'pawl-row' }, [
    el('div', { class: 'pawl-sw' }, [input, el('i')]),
    el('div', { class: 'grow' }, [el('label', { text: label }), hint ? el('small', { text: hint }) : null]),
  ])
}
function radioGroup(name, options) {
  const box = el('div', { class: 'pawl-radios' })
  const radios = Object.keys(options).map((v) => {
    const r = el('input', { type: 'radio', name: name, value: v })
    box.append(el('label', {}, [r, document.createTextNode(' ' + options[v])]))
    return r
  })
  return { box, set(v) { for (const r of radios) r.checked = r.value === v }, get: () => (radios.find((r) => r.checked) || radios[0]).value }
}

function buildPanel() {
  const f = {
    enabled: el('input', { type: 'checkbox' }),
    headless: el('input', { type: 'checkbox' }),
    autoClick: el('input', { type: 'checkbox' }),
    resume: el('input', { type: 'checkbox' }),
    budget: el('input', { class: 'pawl-input short', type: 'number', min: '10000', step: '10000' }),
    maxChars: el('input', { class: 'pawl-input short', type: 'number', min: '1000', step: '1000' }),
    outFile: el('input', { class: 'pawl-input', placeholder: 'batch.jsonl' }),
    outdir: el('input', { class: 'pawl-input', placeholder: '~/.dsh/crawler-out' }),
    profileDir: el('input', { class: 'pawl-input', placeholder: '~/.dsh/crawler-profiles/default' }),
    minDelay: el('input', { class: 'pawl-input short', type: 'number', min: '0', step: '500' }),
    limit: el('input', { class: 'pawl-input short', type: 'number', min: '1', step: '1', placeholder: '∞' }),
    timeout: el('input', { class: 'pawl-input short', type: 'number', min: '60000', step: '60000' }),
    ta: el('textarea', { class: 'pawl-ta', placeholder: 'https://example.com/a\nhttps://example.com/b\n# 注释行忽略' }),
    taTerms: el('textarea', { class: 'pawl-ta', style: 'min-height:72px', placeholder: '钻柱屈曲\ntorque and drag SPE\n# 每行一个检索词' }),
  }
  const exKeys = ['text', 'images', 'tables', 'links', 'meta', 'pdf', 'docs']
  const exBoxes = {}
  const exBox = el('div', { class: 'pawl-checks' })
  for (const k of exKeys) {
    const c = el('input', { type: 'checkbox' }); exBoxes[k] = c
    exBox.append(el('label', {}, [c, document.createTextNode(' ' + t.ex[k])]))
  }
  const rEngine = radioGroup('pawl-engine', t.engines)
  const rMode = radioGroup('pawl-mode', t.modes)
  const rSave = radioGroup('pawl-save', t.saveModes)
  const rSearch = radioGroup('pawl-search', t.engines3)
  const fFuzzy = el('input', { type: 'checkbox' }); fFuzzy.checked = true
  const fMulti = el('input', { type: 'checkbox' })
  const msg = el('span', {})
  const seedsMsg = el('span', { class: 'pawl-mute', text: '—' })
  const termsMsg = el('span', { class: 'pawl-mute', text: '—' })
  const batchBox = el('pre', { class: 'pawl-pre', text: '—' })
  const statusBox = el('div', { class: 'pawl-mute', text: '…' })
  const fileIn = el('input', { type: 'file', accept: '.txt,.csv,.md,.json,.html', style: 'display:none' })

  const fill = (cfg) => {
    const d = cfg.defaults || {}
    f.enabled.checked = cfg.enabled !== false
    f.headless.checked = cfg.headless !== false
    f.autoClick.checked = cfg.autoClick !== false
    f.resume.checked = d.resume !== false
    f.budget.value = cfg.autoClickBudgetMs || 120000
    f.maxChars.value = d.maxChars || 50000
    f.outFile.value = d.outFile || ''
    f.outdir.value = cfg.outdir || ''
    f.profileDir.value = cfg.profileDir || ''
    f.minDelay.value = cfg.minDelayMs != null ? cfg.minDelayMs : 1500
    f.limit.value = d.limit || ''
    f.timeout.value = cfg.timeoutMs || 600000
    rEngine.set(cfg.engine || 'auto'); rMode.set(d.mode || 'text'); rSave.set(d.saveMode || 'jsonl')
    const ex = d.extractOptions || {}
    for (const k of exKeys) exBoxes[k].checked = !!ex[k]
  }
  const collect = () => {
    const extractOptions = {}
    for (const k of exKeys) if (exBoxes[k].checked) extractOptions[k] = true
    const defaults = { mode: rMode.get(), saveMode: rSave.get(), maxChars: Number(f.maxChars.value) || 50000, resume: f.resume.checked, extractOptions }
    if (f.outFile.value.trim()) defaults.outFile = f.outFile.value.trim()
    if (f.limit.value.trim()) defaults.limit = Number(f.limit.value)
    const out = {
      enabled: f.enabled.checked, engine: rEngine.get(), headless: f.headless.checked,
      autoClick: f.autoClick.checked, autoClickBudgetMs: Number(f.budget.value) || 120000,
      minDelayMs: Number(f.minDelay.value) || 1500, timeoutMs: Number(f.timeout.value) || 600000, defaults,
    }
    if (f.outdir.value.trim()) out.outdir = f.outdir.value.trim()
    if (f.profileDir.value.trim()) out.profileDir = f.profileDir.value.trim()
    return out
  }

  const loadStatus = () => api(API.status).then((s) => {
    const tags = [el('span', { class: 'pawl-tag', text: s.venvPython ? t.venvOk : t.venvMissing })]
    for (const p of s.profiles || []) tags.push(el('span', { class: 'pawl-tag', text: p.name }))
    for (const o of (s.outputs || []).slice(-4)) tags.push(el('span', { class: 'pawl-tag', text: o.file + ' (' + Math.round(o.bytes / 1024) + 'K)' }))
    statusBox.replaceChildren(el('div', { class: 'pawl-kv' }, tags))
  }).catch(() => { statusBox.textContent = '—' })
  const loadBatch = () => api(API.batch).then((b) => {
    const lines = [(b.running ? '▶ ' + t.running + ' (pid ' + b.pid + ')' : '■ ' + t.idle), 'records: ' + (b.doneRecords || 0)]
    if (b.logTail && b.logTail.length) lines.push('--- log ---', ...b.logTail)
    if (b.lastResult && b.lastResult.fetched != null) lines.push('--- last ---', 'fetched ' + b.lastResult.fetched)
    batchBox.textContent = lines.join('\n')
  }).catch(() => { batchBox.textContent = '—' })
  const loadSeeds = () => api(API.seeds).then((s) => {
    if (s.text && !f.ta.value.trim()) f.ta.value = s.text
    seedsMsg.textContent = s.count ? s.count + ' 条 · ' + s.path : '—'
  }).catch(() => {})
  const loadTerms = () => api(API.terms).then((s) => {
    if (s.text && !f.taTerms.value.trim()) f.taTerms.value = s.text
    termsMsg.textContent = s.count ? s.count + ' 词 · ' + s.path : '—'
  }).catch(() => {})

  fileIn.addEventListener('change', async () => {
    const file = fileIn.files && fileIn.files[0]
    if (!file) return
    f.ta.value = await file.text()
    seedsMsg.textContent = file.name + ' 已载入，点「保存列表」生效'
  })
  const doImport = el('button', { class: 'pawl-btn', text: t.importFile })
  doImport.addEventListener('click', () => fileIn.click())
  const doSaveSeeds = el('button', { class: 'pawl-btn primary', text: t.saveSeeds })
  doSaveSeeds.addEventListener('click', async () => {
    doSaveSeeds.disabled = true
    try { const r = await api(API.seeds, { text: f.ta.value }); seedsMsg.textContent = '✓ ' + r.count + ' 条'; seedsMsg.className = 'pawl-ok' }
    catch (e) { seedsMsg.textContent = String(e.message || e); seedsMsg.className = 'pawl-err' }
    doSaveSeeds.disabled = false
  })
  const doSaveTerms = el('button', { class: 'pawl-btn primary', text: t.saveTerms })
  doSaveTerms.addEventListener('click', async () => {
    doSaveTerms.disabled = true
    try {
      const r = await api(API.terms, { text: f.taTerms.value, engine: rSearch.get(), fuzzy: fFuzzy.checked, multiEngine: fMulti.checked })
      termsMsg.textContent = '✓ ' + r.count + ' 词 → ' + r.seedsNow + ' 条列表'; termsMsg.className = 'pawl-ok'
    } catch (e) { termsMsg.textContent = String(e.message || e); termsMsg.className = 'pawl-err' }
    doSaveTerms.disabled = false
  })
  const doStart = el('button', { class: 'pawl-btn primary', text: t.startBatch })
  doStart.addEventListener('click', async () => {
    doStart.disabled = true
    try { await api(API.batch, {}); setTimeout(loadBatch, 800) } catch (e) { batchBox.textContent = String(e.message || e) }
    doStart.disabled = false
  })
  const doStop = el('button', { class: 'pawl-btn danger', text: t.stopBatch })
  doStop.addEventListener('click', async () => { try { await api(API.batchStop, {}) } catch {} setTimeout(loadBatch, 500) })
  const doRefresh = el('button', { class: 'pawl-btn', text: t.refresh })
  doRefresh.addEventListener('click', () => { loadBatch(); loadStatus() })
  const doSave = el('button', { class: 'pawl-btn primary', text: t.save })
  doSave.addEventListener('click', async () => {
    doSave.disabled = true; msg.className = ''; msg.textContent = '…'
    try { const r = await api(API.config, collect()); fill(r.config); msg.className = 'pawl-ok'; msg.textContent = t.saved }
    catch { msg.className = 'pawl-err'; msg.textContent = t.saveFail }
    doSave.disabled = false
    setTimeout(() => { msg.textContent = '' }, 2500)
  })

  const sec = (title, ...rows) => el('div', { class: 'pawl-sec' }, [el('h3', { text: title }), ...rows])
  const numRow = (label, input) => el('div', { class: 'pawl-row' }, [el('label', { style: 'flex:none;width:130px', text: label }), input])
  const pathRow = (label, input) => el('div', { class: 'pawl-row' }, [el('label', { style: 'flex:none;width:130px', text: label }), input])

  const card = el('div', { class: 'pawl-card' }, [
    el('div', { class: 'pawl-head' }, [el('h2', { text: t.title }), el('p', { text: t.subtitle + ' · ' + t.toolsHint })]),
    sec(t.secBasic,
      swRow(f.enabled, t.enabled, t.enabledHint),
      el('div', { class: 'pawl-row' }, [el('div', { class: 'grow' }, [el('label', { text: t.engine })]), rEngine.box]),
      swRow(f.headless, t.headless, t.headlessHint)),
    sec(t.secCf, swRow(f.autoClick, t.autoClick, t.autoClickHint), numRow(t.budget, f.budget)),
    sec(t.secContent,
      el('div', { class: 'pawl-row' }, [el('div', { class: 'grow' }, [el('label', { text: t.contentMode })]), rMode.box]),
      numRow(t.maxChars, f.maxChars),
      el('div', {}, [el('label', { style: 'font-weight:500;display:block;margin-bottom:6px', text: t.exTitle }), exBox])),
    sec(t.secStore,
      el('div', { class: 'pawl-row' }, [el('div', { class: 'grow' }, [el('label', { text: t.saveMode })]), rSave.box]),
      numRow(t.outFile, f.outFile),
      pathRow(t.outdir, f.outdir),
      pathRow(t.profileDir, f.profileDir),
      el('small', { class: 'pawl-mute', text: t.outdirHint })),
    sec(t.secThrottle,
      numRow(t.minDelayMs, f.minDelay), numRow(t.limit, f.limit),
      swRow(f.resume, t.resume), numRow(t.timeoutMs, f.timeout)),
    sec(t.secSeeds,
      el('small', { class: 'pawl-mute', text: t.seedsHint }),
      f.ta, fileIn,
      el('div', { class: 'pawl-row' }, [doImport, doSaveSeeds, seedsMsg])),
    sec(t.secTerms,
      el('small', { class: 'pawl-mute', text: t.termsHint }),
      f.taTerms,
      el('div', { class: 'pawl-row' }, [el('label', { style: 'flex:none', text: t.enginePick }), rSearch.box]),
      el('div', { class: 'pawl-checks' }, [el('label', {}, [fFuzzy, document.createTextNode(' 模糊匹配（含 filetype:pdf 变体）')]), el('label', {}, [fMulti, document.createTextNode(' 三引擎同搜')])]),
      el('div', { class: 'pawl-row' }, [doSaveTerms, termsMsg])),
    sec(t.secSeeds + ' · ' + t.startBatch,
      el('div', { class: 'pawl-row' }, [doStart, doStop, doRefresh]),
      batchBox),
    sec(t.secStatus, statusBox),
    el('div', { class: 'pawl-row' }, [doSave, msg]),
  ])

  api(API.config).then((r) => fill(r.config)).catch(() => {})
  loadSeeds(); loadTerms(); loadStatus(); loadBatch()
  return { card, loadStatus, loadBatch }
}

function apply(ctx) {
  let open = false, style, entry, panel, observer
  const ensureStyle = () => {
    if (style !== undefined && style.isConnected) return
    style = el('style', { 'data-pawl-css': '' }); style.textContent = CSS
    document.head.append(style)
  }
  const sidebarRoot = () => {
    const col = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
    if (!col) return undefined
    return (col.querySelector('[class*="logoRow"]') || {}).parentElement || col.firstElementChild || undefined
  }
  const ensureEntry = () => {
    if (entry !== undefined && entry.isConnected) return
    const root = sidebarRoot(); if (!root) return
    ensureStyle()
    entry = el('button', { type: 'button', class: 'pawl-entry', 'data-dsh-crawler-entry': '', 'aria-label': t.entry, title: t.tooltip })
    const icon = el('span')
    icon.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="2.2"/><path d="M8 2.2v2M8 11.8v2M2.2 8h2M11.8 8h2M3.8 3.8l1.5 1.5M10.7 10.7l1.5 1.5M12.2 3.8l-1.5 1.5M5.3 10.7l-1.5 1.5"/></svg>'
    entry.append(icon, document.createTextNode(' ' + t.entry))
    entry.addEventListener('click', () => toggle(!open))
    const anchor = root.querySelector('button[class*="newSession"]') || Array.prototype.find.call(root.children, (c) => c.tagName === 'BUTTON')
    if (anchor !== undefined && anchor.parentElement !== null) anchor.parentElement.insertBefore(entry, anchor.nextSibling)
    else root.prepend(entry)
  }
  const ensurePanel = () => {
    if (panel !== undefined && panel.isConnected) {
      if (panel._pawl) { panel._pawl.loadStatus(); panel._pawl.loadBatch() }
      return
    }
    const col = document.querySelector('[data-pane="conversation"]'); if (!col) return
    ensureStyle()
    const b = buildPanel()
    panel = el('div', { 'data-dsh-crawler-view': '', class: 'pawl-view' }, [b.card])
    panel._pawl = b
    col.append(panel)
  }
  const applyActive = () => {
    if (open) {
      for (const a of OTHERS) document.documentElement.removeAttribute(a)
      document.documentElement.setAttribute(ACTIVE_ATTR, '')
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }))
    } else document.documentElement.removeAttribute(ACTIVE_ATTR)
  }
  const toggle = (next) => { open = next; if (open) ensurePanel(); applyActive() }
  const onActivate = (ev) => { if (ev.detail !== PANEL_NAME && open) { open = false; applyActive() } }
  document.addEventListener(ACTIVATE_EVENT, onActivate)
  observer = new MutationObserver(() => { ensureEntry(); if (open) ensurePanel() })
  observer.observe(document.body, { childList: true, subtree: true })
  ensureEntry()
  const dispose = () => {
    if (observer) observer.disconnect()
    document.removeEventListener(ACTIVATE_EVENT, onActivate)
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    if (entry) entry.remove(); if (panel) panel.remove(); if (style) style.remove()
  }
  if (ctx && typeof ctx.effect === 'function') ctx.effect(() => dispose, 'dsh-crawler: ui')
}

const inject = []

    exports.apply = apply;
    return module.exports;
  },
});
