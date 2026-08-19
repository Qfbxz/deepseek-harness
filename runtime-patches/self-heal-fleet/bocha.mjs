/**
 * Bocha (博查) web-search provider for DeepSeek Harness: registers into `ctx.web`
 * exactly like `web-search-exa`. Calls `POST /v1/web-search` and maps
 * `webPages.value[]` to normalized sources; `summary` (when requested) wins over
 * the raw `snippet` as the richer excerpt. Self-contained ESM; resolves
 * `@deepseek-ai/*` peers through the profiles module fallback.
 * @module dsh-local/web-search-bocha
 */

import { WebError } from '@deepseek-ai/dsh-web'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

/** Stable id this provider registers under. */
export const BOCHA_PROVIDER_ID = 'bocha'

/** Default Bocha OpenAPI base; `/v1/web-search` is the operation. */
export const BOCHA_DEFAULT_BASE_URL = 'https://api.bochaai.com'

/** Default results per request (Bocha caps `count` at 50). */
export const BOCHA_DEFAULT_COUNT = 10

/** Usage counter file under the Harness home; shared with the status plugin. */
export const BOCHA_USAGE_FILE = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'bocha-usage.json')

/**
 * Increment the persisted call counter. Serialized through one promise chain so
 * parallel searches cannot lose updates; counting failures never break a search.
 * @returns a promise settling when the file write completed or failed.
 */
let usageChain = Promise.resolve()
function recordUsage() {
  usageChain = usageChain.then(async () => {
    try {
      let count = 0
      try {
        count = JSON.parse(await readFile(BOCHA_USAGE_FILE, 'utf8')).count ?? 0
      } catch {
        // First use or unreadable file: start from zero.
      }
      await mkdir(dirname(BOCHA_USAGE_FILE), { recursive: true })
      await writeFile(BOCHA_USAGE_FILE, `${JSON.stringify({ count: count + 1, updatedAt: Date.now() })}\n`)
    } catch {
      // A failed counter write only costs the status display, never the search.
    }
  })
}

/** The web seam this provider registers into. */
export const inject = ['web']

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-bocha'

/** Plugin config; `apply` re-defaults every field so a raw config object also works. */
export const Config = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default('BOCHA_API_KEY'),
  baseURL: z.string().default(BOCHA_DEFAULT_BASE_URL),
  count: z.number().step(1).min(1).max(50).default(BOCHA_DEFAULT_COUNT),
  freshness: z.string().default('noLimit'),
  summary: z.boolean().default(true),
  include: z.string(),
  exclude: z.string(),
})

/**
 * Resolve one operation's key: literal config wins, then the credentials
 * service (the `~/.dsh/.credentials.yaml` plane), then the launch environment.
 * @param ctx - plugin context supplying the credentials seam.
 * @param config - the plugin's config.
 * @returns the resolved key, or `undefined` when absent everywhere.
 */
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

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error) {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** Register the Bocha search provider with `ctx.web`. */
export function apply(ctx, config = {}) {
  const baseURL = config.baseURL ?? BOCHA_DEFAULT_BASE_URL
  const defaultCount = config.count ?? BOCHA_DEFAULT_COUNT
  const freshness = config.freshness ?? 'noLimit'
  const summary = config.summary ?? true
  ctx.web.registerSearchProvider({
    id: BOCHA_PROVIDER_ID,
    available: () => URL.canParse(baseURL),
    async search(request, signal) {
      const apiKey = await resolveApiKey(ctx, config)
      if (signal?.aborted === true) throw new WebError('Bocha search aborted', 'WEB_ABORTED')
      if (apiKey === undefined) {
        throw new WebError(
          `Bocha search has no API key for "${config.apiKeyEnv ?? 'BOCHA_API_KEY'}"; store it through the`
          + ' credentials service (~/.dsh/.credentials.yaml), export it in the launching environment,'
          + ' or set a literal "apiKey" in the plugin config',
          'WEB_PROVIDER_CREDENTIAL_MISSING',
        )
      }
      const count = Math.min(50, Math.max(1, request.maxResults ?? defaultCount))
      let response
      try {
        response = await fetch(`${baseURL}/v1/web-search`, {
          method: 'POST',
          redirect: 'error',
          headers: {
            'authorization': `Bearer ${apiKey}`,
            'content-type': 'application/json',
            'accept': 'application/json',
            'user-agent': 'dsh-web-search-bocha/0.1.0',
          },
          body: JSON.stringify({
            query: request.query,
            freshness,
            summary,
            count,
            page: 1,
            ...config.include !== undefined && config.include.length > 0 ? { include: config.include } : {},
            ...config.exclude !== undefined && config.exclude.length > 0 ? { exclude: config.exclude } : {},
          }),
          ...signal !== undefined ? { signal } : {},
        })
      } catch (error) {
        if (signal?.aborted === true || isAbortError(error)) throw new WebError('Bocha search aborted', 'WEB_ABORTED', { cause: error })
        throw new WebError(`Bocha search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
      }

      let payload
      try {
        payload = await response.json()
      } catch (error) {
        if (signal?.aborted === true || isAbortError(error)) throw new WebError('Bocha search aborted', 'WEB_ABORTED')
        throw new WebError(`Bocha API error (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR', { cause: error })
      }
      // Bocha reports failures either as a non-2xx status or as HTTP 200 with an error `code`.
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
        const snippet = summary && typeof item.summary === 'string' && item.summary.length > 0 ? item.summary : item.snippet
        // `datePublished` is the authoritative timestamp; `dateLastCrawled` carries a
        // UTC+8 value mislabeled with a `Z` suffix (official docs), so the suffix is
        // corrected rather than trusting it as UTC.
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
      // The web service owns the final `maxResults` truncation, so this provider
      // reports `truncated: false` exactly like the built-in REST providers.
      return { sources, truncated: false }
    },
  })
}
