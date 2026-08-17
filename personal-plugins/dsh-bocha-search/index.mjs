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
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'

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
  ctx.inject(['webServer'], (host) => {
    const json = (res, code, body) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    }

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
