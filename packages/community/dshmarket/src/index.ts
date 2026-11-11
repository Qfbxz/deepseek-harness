/**
 * dsh-market host entry: mounts the market's HTTP routes once the profile
 * composes the webServer and shell services.
 */

import type { Context } from '@deepseek-ai/cordis'
import { mountMarketRoutes, type MarketConfig, type MarketHost } from './routes.ts'

export const name = 'dsh-market'

/** Optional cordis.yml configuration; profile defaults to `web`. */
export type Config = Partial<MarketConfig>

/**
 * Register the market against the host context.
 * @param ctx - Host context that may acquire webServer and shell services.
 * @param config - Optional profile override from the loader.
 */
export function apply(ctx: Context, config?: Config): void {
  const resolved: MarketConfig = { profile: config?.profile ?? 'web' }
  ctx.inject(['webServer'], (hostCtx: Context) => {
    const host = hostCtx as unknown as MarketHost & {
      effect(callback: () => () => void, label: string): void
    }
    host.effect(() => mountMarketRoutes(host, resolved), 'dsh-market: http routes')
  })
}
