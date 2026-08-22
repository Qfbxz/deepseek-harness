/**
 * Host side of the Bocha status cell: one GET route (`/dsh-local/bocha-balance`)
 * joining the official remaining-balance poll (cached, key stays host-side)
 * with the call counter the `web-search-bocha` provider persists. The browser
 * never sees the API key — it reads this same-origin route.
 * @module dsh-bocha-status
 */

import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'bocha-status'

/** Usage counter file written by the web-search-bocha provider. */
const USAGE_FILE = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'bocha-usage.json')

/** Resolve the Bocha key: literal config, then the credentials service, then env. */
async function resolveApiKey(ctx, config) {
  if (config.apiKey !== undefined && config.apiKey.length > 0) return config.apiKey
  const ref = credentialRef(config.apiKeyEnv ?? 'BOCHA_API_KEY')
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    const value = (await credentials.resolve(ref))?.value
    if (value !== undefined && value.length > 0) return value
  }
  const ambient = process.env[ref]
  return ambient !== undefined && ambient.length > 0 ? ambient : undefined
}

/** Read the persisted call count; absent file means zero uses so far. */
async function readUsage() {
  try {
    return JSON.parse(await readFile(USAGE_FILE, 'utf8')).count ?? 0
  } catch {
    return 0
  }
}

/** Register the balance route once the profile composes the webServer service. */
export function apply(ctx, config = {}) {
  const intervalMs = config.intervalMs ?? 5 * 60_000
  const totalCalls = config.totalCalls
  const lowRemaining = config.lowRemaining ?? 100
  let cache
  let inflight

  async function poll() {
    const apiKey = await resolveApiKey(ctx, config)
    if (apiKey === undefined) throw new Error('BOCHA_API_KEY is not configured')
    const response = await fetch('https://api.bochaai.com/v1/fund/remaining', {
      headers: { authorization: `Bearer ${apiKey}` },
    })
    const payload = await response.json().catch(() => null)
    if (payload === null || !response.ok || payload.code !== '200') {
      throw new Error(payload?.msg ?? `Bocha balance HTTP ${response.status}`)
    }
    return { remaining: payload.data.remaining, updatedAt: Date.now() }
  }

  ctx.inject(['webServer'], (host) => {
    host.effect(() => host.webServer.register({
      kind: 'exact',
      path: '/dsh-local/bocha-balance',
      handler: async (request, response) => {
        if (request.method !== 'GET') {
          response.writeHead(405, { allow: 'GET' })
          response.end()
          return
        }
        const send = (status, body) => {
          response.writeHead(status, {
            'cache-control': 'no-store',
            'content-type': 'application/json; charset=utf-8',
          })
          response.end(JSON.stringify(body))
        }
        try {
          if (cache === undefined || Date.now() - cache.updatedAt > intervalMs) {
            cache = await (inflight ??= poll().finally(() => { inflight = undefined }))
          }
          const count = await readUsage()
          send(200, {
            ...cache,
            count,
            ...totalCalls !== undefined ? { totalCalls, remainingCalls: Math.max(0, totalCalls - count) } : {},
            low: totalCalls !== undefined ? totalCalls - count < lowRemaining : cache.remaining < 3,
          })
        } catch (error) {
          send(502, { error: String(error) })
        }
      },
    }), 'bocha-status: balance route')
  })
}
