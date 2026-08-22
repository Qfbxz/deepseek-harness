/**
 * dsh-bocha-search — host half.
 *
 * Own config file ~/.dsh/bocha-search.json: { apiKey, baseURL, totalCalls }.
 * The API key never leaves the host: the browser only sees hasApiKey.
 * Current count is read from ~/.dsh/bocha-usage.json (written by the external
 * search provider); the settings panel may reset or overwrite it.
 *
 * Routes (webServer is late-mounted via ctx.inject):
 *   GET  /dsh-local/bocha-search/config  → { baseURL, totalCalls, hasApiKey, count, updatedAt }
 *   POST /dsh-local/bocha-search/config  → save { apiKey?, baseURL, totalCalls }
 *   POST /dsh-local/bocha-search/reset   → count := 0
 *   GET  /dsh-local/bocha-searxng/search?q=&format=json → SearXNG 协议垫片（供 search-pool）
 */
import { WebError } from '@deepseek-ai/dsh-web'
import { DeepSeekSearchProvider } from '@deepseek-ai/dsh-web-search-deepseek'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { createShimHandler } from './lib/searxng-shim.mjs'

export const name = 'bocha-search'

const HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const CONFIG_FILE = join(HOME, 'bocha-search.json')
const USAGE_FILE = join(HOME, 'bocha-usage.json')

const DEFAULTS = { apiKey: '', baseURL: 'https://api.bochaai.com', totalCalls: 2000 }

async function readConfig() {
  try {
    const parsed = JSON.parse(await readFile(CONFIG_FILE, 'utf-8'))
    return {
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : DEFAULTS.apiKey,
      baseURL: typeof parsed.baseURL === 'string' && parsed.baseURL !== '' ? parsed.baseURL : DEFAULTS.baseURL,
      totalCalls: Number.isFinite(parsed.totalCalls) && parsed.totalCalls > 0 ? parsed.totalCalls : DEFAULTS.totalCalls,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

async function writeConfig(next) {
  await writeFile(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n', 'utf-8')
}

async function readCount() {
  try {
    return { count: JSON.parse(await readFile(USAGE_FILE, 'utf-8')).count ?? 0, updatedAt: Date.now() }
  } catch {
    return { count: 0, updatedAt: Date.now() }
  }
}

async function writeCount(count) {
  await writeFile(USAGE_FILE, JSON.stringify({ count, updatedAt: Date.now() }) + '\n', 'utf-8')
}

/** Search defaults (Bocha caps `count` at 50). */
const DEFAULT_SEARCH_COUNT = 10

/**
 * Increment the persisted call counter. Serialized through one promise chain so
 * parallel searches cannot lose updates; counting failures never break a search.
 */
let usageChain = Promise.resolve()
function recordUsage() {
  usageChain = usageChain.then(async () => {
    try {
      let count = 0
      try {
        count = JSON.parse(await readFile(USAGE_FILE, 'utf8')).count ?? 0
      } catch { /* absent file means zero uses so far */ }
      await writeFile(USAGE_FILE, `${JSON.stringify({ count: count + 1, updatedAt: Date.now() })}\n`)
    } catch { /* a failed counter write only costs the status display */ }
  })
  return usageChain
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')) }
      catch (err) { reject(err) }
    })
    req.on('error', reject)
  })
}

export function apply(ctx) {
  // Free-first search chain behind one provider id: the harness `web_search`
  // tool resolves a single provider, so this plugin registers `bocha` as a
  // wrapper that tries the FREE leg first (DeepSeek official web search —
  // costs a model turn, no separate search billing) and falls back to the
  // PAID Bocha API (counted) only when the free leg errors or returns no
  // sources. The argo MCP stays a separate free path the model can pick.
  const freeProvider = new DeepSeekSearchProvider(() => ({
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) {
        const value = (await credentials.resolve(credentialRefLike('DEEPSEEK_API_KEY')))?.value
        if (value !== undefined && value.length > 0) return value
      }
      return process.env.DEEPSEEK_API_KEY
    },
    baseURL: 'https://api.deepseek.com/anthropic/v1',
    model: 'deepseek-v4-flash',
    maxTokens: 4096,
    maxUses: 5,
    apiVersion: '2023-06-01',
  }))

  ctx.inject(['web'], async (web) => {
    web.effect(() => web.web.registerSearchProvider({
      id: 'bocha',
      available: async () => {
        const config = await readConfig()
        return config.apiKey !== ''
      },
      search: async (request, signal) => {
        // Free leg first: only an error or an empty result page falls through
        // to the paid Bocha call. A signal abort must propagate, not fall back.
        if (signal?.aborted === true) throw new WebError('search aborted', 'WEB_ABORTED')
        if (freeProvider.available()) {
          try {
            const free = await freeProvider.search(request, signal)
            if (free.sources.length > 0) return free
          } catch (error) {
            if (signal?.aborted === true) throw new WebError('search aborted', 'WEB_ABORTED')
            // free leg failed — fall through to Bocha below
          }
        }
        const config = await readConfig()
        if (config.apiKey === '') {
          throw new WebError(
            'Bocha search has no API key; set it in the Bocha settings panel (~/.dsh/bocha-search.json)',
            'WEB_PROVIDER_CREDENTIAL_MISSING',
          )
        }
        if (signal?.aborted === true) throw new WebError('Bocha search aborted', 'WEB_ABORTED')
        const count = Math.min(50, Math.max(1, request.maxResults ?? DEFAULT_SEARCH_COUNT))
        let response
        try {
          response = await fetch(`${config.baseURL}/v1/web-search`, {
            method: 'POST',
            redirect: 'error',
            headers: {
              authorization: `Bearer ${config.apiKey}`,
              'content-type': 'application/json',
              accept: 'application/json',
              'user-agent': 'dsh-bocha-search/0.2.0',
            },
            body: JSON.stringify({ query: request.query, freshness: 'noLimit', summary: true, count, page: 1 }),
            ...signal !== undefined ? { signal } : {},
          })
        } catch (error) {
          if (signal?.aborted === true) throw new WebError('Bocha search aborted', 'WEB_ABORTED')
          throw new WebError(`Bocha search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
        }
        let payload
        try {
          payload = await response.json()
        } catch (error) {
          throw new WebError(`Bocha API error (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR', { cause: error })
        }
        if (!response.ok || payload.code !== 200) {
          const detail = payload.msg ?? payload.message
          throw new WebError(
            detail !== undefined && detail.length > 0 ? String(detail) : `Bocha API error (HTTP ${response.status}, code ${payload.code})`,
            'WEB_PROVIDER_ERROR',
          )
        }
        recordUsage()
        const seen = new Set()
        const sources = []
        for (const item of payload.data?.webPages?.value ?? []) {
          if (typeof item?.url !== 'string' || item.url.length === 0 || seen.has(item.url)) continue
          seen.add(item.url)
          const snippet = typeof item.summary === 'string' && item.summary.length > 0 ? item.summary : item.snippet
          const publishedAt = typeof item.datePublished === 'string' && item.datePublished.length > 0
            ? item.datePublished
            : typeof item.dateLastCrawled === 'string' && item.dateLastCrawled.length > 0
              ? item.dateLastCrawled.replace(/Z$/u, '+08:00')
              : undefined
          sources.push({
            url: item.url,
            ...typeof item.name === 'string' && item.name.length > 0 ? { title: item.name } : {},
            ...typeof snippet === 'string' && snippet.length > 0 ? { snippet } : {},
            ...publishedAt !== undefined ? { publishedAt } : {},
          })
        }
        return { sources, truncated: false }
      },
    }), 'bocha-search: search provider')
  })

  ctx.inject(['webServer'], (host) => {
    const json = (res, code, body) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    }

    // SearXNG 协议垫片：dsh-search-failover 的 searxng 后端指向
    // http://127.0.0.1:<port>/dsh-local/bocha-searxng 即可把博查接入
    // failover 链（免费引擎优先、博查兜底）。成功搜索沿用 usage 计数链。
    host.effect(() => host.webServer.register({
      kind: 'exact',
      path: '/dsh-local/bocha-searxng/search',
      handler: createShimHandler({ getConfig: readConfig, recordUsage }),
    }), 'bocha-search: searxng shim route')

    host.effect(() => host.webServer.register({
      kind: 'exact',
      path: '/dsh-local/bocha-search/config',
      handler: async (req, res) => {
        try {
          if (req.method === 'GET') {
            const config = await readConfig()
            const usage = await readCount()
            return json(res, 200, {
              ok: true,
              baseURL: config.baseURL,
              totalCalls: config.totalCalls,
              hasApiKey: config.apiKey !== '',
              count: usage.count,
              updatedAt: usage.updatedAt,
            })
          }
          if (req.method === 'POST') {
            const body = await readBody(req)
            const prev = await readConfig()
            const next = {
              // empty apiKey on submit keeps the stored key (never wiped by accident)
              apiKey: typeof body.apiKey === 'string' && body.apiKey !== '' ? body.apiKey : prev.apiKey,
              baseURL: typeof body.baseURL === 'string' && body.baseURL !== '' ? body.baseURL : prev.baseURL,
              totalCalls: Number.isFinite(body.totalCalls) && body.totalCalls > 0 ? Math.floor(body.totalCalls) : prev.totalCalls,
            }
            await writeConfig(next)
            if (Number.isFinite(body.count) && body.count >= 0) await writeCount(Math.floor(body.count))
            return json(res, 200, { ok: true, hasApiKey: next.apiKey !== '' })
          }
          res.writeHead(405, { allow: 'GET, POST' })
          res.end()
        } catch (err) {
          json(res, 500, { ok: false, message: String(err?.message ?? err) })
        }
      },
    }), 'bocha-search: config route')

    host.effect(() => host.webServer.register({
      kind: 'exact',
      path: '/dsh-local/bocha-search/reset',
      handler: async (req, res) => {
        try {
          if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST' })
            res.end()
            return
          }
          await writeCount(0)
          json(res, 200, { ok: true, count: 0 })
        } catch (err) {
          json(res, 500, { ok: false, message: String(err?.message ?? err) })
        }
      },
    }), 'bocha-search: reset route')
  })
}
