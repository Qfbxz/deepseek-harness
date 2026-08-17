/**
 * pawl — universal web crawler plugin for DeepSeek Harness (host half).
 * Source of truth: /Users/boergege/compile/完结个人项目/pawl
 *
 * Engines: http (stdlib) / crawl4ai (markdown) / browser (patchright anti-detect,
 * persistent profile). Agent tools: crawler_config/fetch/batch/site/unlock/status.
 *
 * Config authority: ~/.dsh/crawler-config.json. The GUI card (client.js) edits
 * it through the loopback-fenced /api/dsh-crawler/config route; edits re-run
 * sync(), which registers/unregisters the agent tools live — enabled:false
 * removes every crawler_* tool from the session without a restart.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const RUNNER = join(ROOT, 'runner.py')
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const CONFIG_FILE = join(DSH_HOME, 'crawler-config.json')
const VENV_PY = join(DSH_HOME, 'venvs/scrape/bin/python')
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const API = { config: '/api/dsh-crawler/config', status: '/api/dsh-crawler/status' }

/** Execution tools removed by the enabled:false kill switch (config/status stay). */
const WORKER_TOOLS = new Set(['crawler_fetch', 'crawler_batch', 'crawler_site', 'crawler_unlock'])

/** Allowed top-level config keys (everything else is dropped on write). */
const CONFIG_KEYS = ['enabled', 'engine', 'headless', 'profileDir', 'outdir', 'minDelayMs', 'timeoutMs', 'headers', 'defaults', 'autoClick', 'autoClickBudgetMs', 'autoClickMaxTries']

export const inject = ['tools', 'webServer']
export const name = 'dsh-crawler'

// ---------------------------------------------------------------- config store
let cache = undefined

async function loadConfig() {
  if (cache !== undefined) return cache
  try { cache = JSON.parse(await readFile(CONFIG_FILE, 'utf8')) } catch { cache = {} }
  return cache
}

async function saveConfig(patch) {
  const current = await loadConfig()
  const next = { ...current }
  for (const k of CONFIG_KEYS) if (patch[k] !== undefined) next[k] = patch[k]
  await mkdir(dirname(CONFIG_FILE), { recursive: true })
  await writeFile(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n')
  cache = next
  return next
}

// ---------------------------------------------------------------- python runner
function pickPython() {
  return existsSync(VENV_PY) ? VENV_PY : 'python3'
}

function runRunner(cmd, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const child = spawn(pickPython(), [RUNNER], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, timeoutMs)
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: 'spawn-failed: ' + e.message }) })
    child.on('close', (code) => {
      clearTimeout(timer)
      const tail = err.trim().split('\n').slice(-3).join('\n').slice(0, 400)
      if (out.trim()) { try { return resolve(JSON.parse(out)) } catch { /* fallthrough */ } }
      resolve({ ok: false, error: 'runner-exit-' + code + (tail ? '\n' + tail : '') })
    })
    child.stdin.write(JSON.stringify(cmd))
    child.stdin.end()
  })
}

async function gatherStatus(cfg) {
  const venv = existsSync(VENV_PY)
  const expand = (p) => (p ? p.replace(/^~(?=$|\/)/, homedir()) : p)
  const profilesDir = expand(cfg.profileDir) || join(DSH_HOME, 'crawler-profiles')
  const outdir = expand(cfg.outdir) || join(DSH_HOME, 'crawler-out')
  const profiles = [], outputs = []
  try { for (const e of await readdir(profilesDir, { withFileTypes: true })) if (e.isDirectory()) { try { const s = await stat(join(profilesDir, e.name)); profiles.push({ name: e.name, modified: s.mtime.toISOString() }) } catch {} } } catch {}
  try { for (const e of await readdir(outdir, { withFileTypes: true })) if (e.isFile()) { try { const s = await stat(join(outdir, e.name)); outputs.push({ file: e.name, bytes: s.size, modified: s.mtime.toISOString() }) } catch {} } } catch {}
  return { enabled: cfg.enabled !== false, venvPython: venv ? VENV_PY : null, engines: venv ? ['http', 'crawl4ai', 'browser'] : ['http'], profiles, outputs: outputs.slice(-10) }
}

// ---------------------------------------------------------------- agent tools
function makeTools(getCfg, onSync) {
  const guard = async (fn) => {
    const cfg = await getCfg()
    if (cfg.enabled === false) return { ok: false, error: 'pawl crawler is disabled: re-enable via crawler_config set {enabled:true} or the GUI card (sidebar 爬虫)' }
    return await fn(cfg)
  }

  const text = (v) => [{ type: 'text', text: JSON.stringify(v, null, 1).slice(0, 12000) }]
  const O = () => ({ schema: { type: 'object', additionalProperties: true }, render: (_a, v) => text(v) })

  return [
    defineTool({
      name: 'crawler_config',
      description: 'Get or set pawl crawler defaults (same store the GUI card edits). The enabled:false switch removes every crawler_* tool live. ' +
        'Keys: enabled, engine (auto|http|crawl4ai|browser), profileDir, outdir, headers, headless, minDelayMs, timeoutMs, defaults (default per-fetch options: mode/selectors/extractJs/maxChars).',
      parameters: {
        action: { type: 'string', enum: ['get', 'set'], description: 'get current config or merge-set keys' },
        values: { type: 'object', additionalProperties: true, description: 'for set: keys to merge, e.g. {enabled:false} or {engine:"browser", minDelayMs:3000}' },
      },
      output: O(),
      async execute(args) {
        if (args.action === 'set' && args.values) {
          const patch = {}
          for (const k of CONFIG_KEYS) if (args.values[k] !== undefined) patch[k] = args.values[k]
          if (args.values.defaults && typeof args.values.defaults === 'object') {
            const cur = (await loadConfig()).defaults ?? {}
            patch.defaults = { ...cur, ...args.values.defaults }
          }
          const next = await saveConfig(patch)
          if (onSync) onSync()
          return { ok: true, config: next }
        }
        return { ok: true, config: await loadConfig() }
      },
    }),

    defineTool({
      name: 'crawler_fetch',
      description: 'Fetch ONE web page with free-form extraction. Engines: http (fast, stdlib) / crawl4ai (clean markdown) / ' +
        'browser (patchright anti-detect Chromium — JS sites, Cloudflare-protected pages after crawler_unlock). ' +
        'Free-form output: mode text|markdown|html|links, CSS selectors map, custom extractJs, meta tags, screenshot, ' +
        'scroll & waitForSelector for lazy content. Optional saveTo persists the page into the storage folder (outdir). ' +
        'Triggers: scrape/crawl/fetch a page, 抓取/爬取网页, extract page content.',
      parameters: {
        url: { type: 'string', description: 'http(s) URL to fetch' },
        engine: { type: 'string', enum: ['auto', 'http', 'crawl4ai', 'browser'], description: 'default auto (browser for JS-heavy or when http gets challenged)' },
        mode: { type: 'string', enum: ['text', 'markdown', 'html', 'links'], description: 'main content shape (markdown via crawl4ai; text elsewhere)' },
        selectors: { type: 'object', additionalProperties: true, description: 'CSS selector map: fieldName -> selector; returns fields{} with innerText' },
        extractJs: { type: 'string', description: 'browser engine only: arbitrary JS evaluated in page, result returned as extract' },
        meta: { type: 'boolean', description: 'include meta tags (title/description/og:*)' },
        screenshot: { type: 'string', description: 'browser engine only: save screenshot to this path' },
        waitMs: { type: 'number', description: 'browser: extra settle wait after load' },
        waitForSelector: { type: 'string', description: 'browser: wait for CSS selector before extract' },
        scroll: { type: 'number', description: 'browser: scroll N times to trigger lazy loading' },
        maxChars: { type: 'number', description: 'truncate text/html/markdown (default 50000)' },
        allowChallenge: { type: 'boolean', description: 'return page content even when a bot-challenge is detected' },
        saveTo: { type: 'string', description: 'save main content into the storage folder: "auto" (auto-named file in outdir), a filename resolved inside outdir, or an absolute path. Result carries savedTo.' },
        autoClick: { type: 'boolean', description: 'auto-click the Cloudflare/Turnstile checkbox when challenged (default true; budget autoClickBudgetMs)' },
        timeoutMs: { type: 'number', description: 'overall timeout (default 10 min)' },
      },
      output: O(),
      async execute(args) {
        return guard(async (cfg) => {
          const { mode: contentMode = (cfg.defaults ?? {}).mode, ...rest } = args
          const cmd = { mode: 'fetch', ...rest, contentMode, config: { ...cfg, ...(cfg.defaults ?? {}) } }
          const res = await runRunner(cmd, args.timeoutMs || cfg.timeoutMs || DEFAULT_TIMEOUT_MS)
          return res.ok === false ? res : { ok: true, result: res.result }
        })
      },
    }),

    defineTool({
      name: 'crawler_batch',
      description: 'Batch-fetch many URLs (resumable). Input: urls[] and/or urlsFile (one URL per line, # comments ok). ' +
        'Results append as JSONL to outFile (~/.dsh/crawler-out/batch.jsonl default); resume:true skips URLs already in outFile. ' +
        'Triggers: bulk scrape, batch download pages, 批量抓取, list of URLs.',
      parameters: {
        urls: { type: 'array', items: { type: 'string' }, description: 'URL list' },
        urlsFile: { type: 'string', description: 'path to a file of URLs (one per line)' },
        engine: { type: 'string', enum: ['auto', 'http', 'crawl4ai', 'browser'] },
        mode: { type: 'string', enum: ['text', 'markdown', 'html', 'links'] },
        selectors: { type: 'object', additionalProperties: true, description: 'CSS selector map applied to every page' },
        extractJs: { type: 'string', description: 'browser engine only: JS applied to every page' },
        maxChars: { type: 'number', description: 'per-page truncation' },
        outFile: { type: 'string', description: 'JSONL output path (default <outdir>/batch.jsonl; relative resolves inside the storage folder)' },
        resume: { type: 'boolean', description: 'skip URLs already in outFile (default true)' },
        limit: { type: 'number', description: 'max pages this run' },
        minDelayMs: { type: 'number', description: 'politeness delay between pages (default 1500)' },
        timeoutMs: { type: 'number', description: 'overall timeout' },
      },
      output: O(),
      async execute(args) {
        return guard(async (cfg) => {
          const { mode: contentMode = (cfg.defaults ?? {}).mode, ...rest } = args
          return runRunner({ mode: 'batch', ...rest, contentMode, config: cfg }, args.timeoutMs || cfg.timeoutMs || DEFAULT_TIMEOUT_MS)
        })
      },
    }),

    defineTool({
      name: 'crawler_site',
      description: 'Crawl a whole site BFS-style from a start URL: same-origin by default, include/exclude regex filters, ' +
        'maxPages/maxDepth budgets. Every visited page persists into the storage folder (outdir): JSONL and/or one file per page. ' +
        'Triggers: site crawl, sitemap walk, 整站爬取, crawl all pages of.',
      parameters: {
        url: { type: 'string', description: 'start URL' },
        maxPages: { type: 'number', description: 'page budget (default 20)' },
        maxDepth: { type: 'number', description: 'link depth (default 2)' },
        sameOrigin: { type: 'boolean', description: 'stay on the start origin (default true)' },
        include: { type: 'array', items: { type: 'string' }, description: 'regex allowlist for URLs to visit' },
        exclude: { type: 'array', items: { type: 'string' }, description: 'regex denylist (pdf/zip/images auto-skipped)' },
        outFile: { type: 'string', description: 'JSONL output path (default <outdir>/<site>-site.jsonl; relative resolves inside the storage folder)' },
        saveMode: { type: 'string', enum: ['jsonl', 'files', 'both'], description: 'storage shape: jsonl = one record per page (default) | files = one .md/.txt/.html per page under outdir/pages | both' },
        resume: { type: 'boolean', description: 'skip URLs already in outFile (default true)' },
        returnPages: { type: 'boolean', description: 'include full page contents in the response (default: url+title+file summary only — content lives in the storage folder)' },
        engine: { type: 'string', enum: ['auto', 'http', 'crawl4ai', 'browser'] },
        mode: { type: 'string', enum: ['text', 'markdown', 'html', 'links'] },
        selectors: { type: 'object', additionalProperties: true, description: 'CSS selector map per page' },
        extractJs: { type: 'string', description: 'browser engine only' },
        timeoutMs: { type: 'number', description: 'overall timeout' },
      },
      output: O(),
      async execute(args) {
        return guard(async (cfg) => {
          const { mode: contentMode = (cfg.defaults ?? {}).mode, ...rest } = args
          return await runRunner({ mode: 'site', ...rest, contentMode, config: cfg }, args.timeoutMs || cfg.timeoutMs || DEFAULT_TIMEOUT_MS)
        })
      },
    }),

    defineTool({
      name: 'crawler_unlock',
      description: 'Open a REAL (headed) browser window for human-in-the-loop unlock: click the Cloudflare checkbox and/or ' +
        'log into a site once; clearance cookies persist in profileDir and every later browser-engine fetch reuses them. ' +
        'Tries the built-in auto-click responder first (no human needed in most cases, ~1-2 min); beeps for manual action only when auto fails. ' +
        'Triggers: site blocked by Cloudflare/login, 解锁, bot check fails, need login to crawl.',
      parameters: {
        url: { type: 'string', description: 'page to unlock (default https://onepetro.org/)' },
        loginHint: { type: 'string', description: 'when set: pause after challenge so you can also log in, then press Enter in the terminal' },
        profileDir: { type: 'string', description: 'persistent profile dir (default ~/.dsh/crawler-profiles/default)' },
        waitMs: { type: 'number', description: 'max wait for human action (default 300000)' },
      },
      output: O(),
      async execute(args) {
        return guard(async (cfg) => runRunner({ mode: 'unlock', ...args, config: cfg }, (args.waitMs || 300000) + 60000))
      },
    }),

    defineTool({
      name: 'crawler_status',
      description: 'pawl crawler health: enabled state, venv presence (crawl4ai/patchright engines), config, profile dirs, recent batch outputs. Triggers: crawler 状态/健康检查.',
      parameters: {},
      output: O(),
      async execute() {
        const cfg = await loadConfig()
        return { ok: true, ...(await gatherStatus(cfg)), config: cfg }
      },
    }),
  ]
}

// ---------------------------------------------------------------- loopback API
function isLoopbackRequest(request) {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try { hostUrl = new URL('http://' + host) } catch { return false }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try { return new URL(origin).host === hostUrl.host } catch { return false }
}

function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req, cap = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > cap) return undefined
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return undefined }
}

// ---------------------------------------------------------------- apply
export function apply(ctx, config = {}) {
  let disposeTools

  const sync = () => {
    if (disposeTools !== undefined) { disposeTools(); disposeTools = undefined }
    const cfg = cache
    if (cfg === undefined) return
    const disabled = cfg.enabled === false
    disposeTools = ctx.effect(() => {
      const disposers = makeTools(() => loadConfig(), sync)
        .filter((tool) => !disabled || !WORKER_TOOLS.has(tool.name))
        .map((t) => ctx.tools.register(t))
      return () => { for (const d of disposers) d() }
    }, 'dsh-crawler: tools')
  }

  loadConfig().then((stored) => {
    // composition config seeds the store only for keys the file does not define yet
    let changed = false
    for (const k of CONFIG_KEYS) if (stored[k] === undefined && config[k] !== undefined) { stored[k] = config[k]; changed = true }
    cache = stored
    if (changed) saveConfig(stored).catch(() => {})
    sync()
  }).catch(() => { cache = { ...config }; sync() })

  const disposeRoutes = ctx.effect(() => {
    const routes = [
      {
        kind: 'exact', path: API.config,
        handler: async (req, res) => {
          if (!isLoopbackRequest(req)) return writeJson(res, 403, { ok: false, error: 'loopback only' })
          if (req.method === 'GET') return writeJson(res, 200, { ok: true, config: await loadConfig() })
          if (req.method === 'POST') {
            const body = await readJsonBody(req)
            if (body === null || typeof body !== 'object') return writeJson(res, 400, { ok: false, error: 'invalid json' })
            const patch = {}
            for (const k of CONFIG_KEYS) if (body[k] !== undefined) patch[k] = body[k]
            const next = await saveConfig(patch)
            sync()
            return writeJson(res, 200, { ok: true, config: next })
          }
          return writeJson(res, 405, { ok: false, error: 'method not allowed' })
        },
      },
      {
        kind: 'exact', path: API.status,
        handler: async (req, res) => {
          if (!isLoopbackRequest(req)) return writeJson(res, 403, { ok: false, error: 'loopback only' })
          const cfg = await loadConfig()
          writeJson(res, 200, { ok: true, ...(await gatherStatus(cfg)) })
        },
      },
    ]
    const disposers = routes.map((r) => ctx.webServer.register(r))
    return () => { for (const d of disposers) d() }
  }, 'dsh-crawler: routes')

  return () => {
    if (disposeTools !== undefined) disposeTools()
    disposeRoutes()
  }
}
