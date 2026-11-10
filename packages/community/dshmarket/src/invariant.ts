/** Package-owned invariant companion for the plugin-market host plugin. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-market'

/** Cordis companion plugin name. */
export const name = 'dsh-market-invariant'
/** Invariant registry dependency. */
export const inject = ['invariants']

/** No runtime invariant: the market mounts HTTP routes and a browser card; durable relations live in the curated
 * registry it reads and the plugin tree it installs into. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant ownership. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
