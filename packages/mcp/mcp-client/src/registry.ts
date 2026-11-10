/**
 * MCP registry plugin: the base-bundle composition entry for the MCP
 * capability (`@deepseek-ai/dsh-mcp-client/registry`). One row carries the
 * whole server fleet: each `servers` entry is one complete `mcp-client` config
 * and activates as a child `mcp-client` instance with that plugin's own
 * connection, discovery, and reconnect semantics. The default registry is
 * empty, so a profile mounting the row dormant starts no server process and
 * registers no `mcp__*` tool.
 *
 * Misconfiguration fails loud at load. An entry that fails the `mcp-client`
 * Config validation or a duplicated `serverName` inside the registry rejects
 * this plugin's activation, so a broken composition never boots a partially
 * mounted fleet.
 *
 * Namespace plugin (named exports, no default export). HMR reloads the
 * registry row as one unit: editing it disconnects and remounts every server.
 *
 * @module @deepseek-ai/dsh-mcp-client/registry
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import * as mcpClient from './index.ts'
import type { Config as ServerConfig } from './index.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mcp-registry'

/** Config for the MCP registry: the server fleet mounted by one profile. */
export interface RegistryConfig {
  /**
   * Servers to mount, each one complete `mcp-client` config. The default
   * registry is empty: the base bundle mounts the capability dormant, and a
   * deployment supplies its fleet by replacing this list in a later patch
   * layer (a patch replaces the row's whole `config`).
   */
  servers: ServerConfig[]
}

export const Config = z.object({
  servers: z.array(mcpClient.Config).default([]),
}) as unknown as z<RegistryConfig>

/**
 * Validate the registry shape, then mount one `mcp-client` child per server.
 * Awaiting the children folds each entry's config-validation and startup
 * failures into this activation, so a broken entry fails this row at load
 * instead of leaving earlier servers mounted. Connection failure with
 * `failOnStartupError: false` stays the per-entry choice: the child logs and
 * enters its reconnect loop, and the registry still activates.
 *
 * @param ctx - plugin context; each child declares its own `tools` injection.
 * @param config - validated registry config; `servers` defaults to empty.
 * @returns startup readiness after every server's first connection attempt settles.
 */
export async function apply(ctx: Context, config: RegistryConfig): Promise<void> {
  const firstUse = new Map<string, number>()
  for (const [index, entry] of config.servers.entries()) {
    const first = firstUse.get(entry.serverName)
    if (first !== undefined) {
      throw new Error(
        `mcp-registry: servers[${index}] repeats serverName "${entry.serverName}" (first used at servers[${first}])`
        + ' — server names must be unique within one registry',
      )
    }
    firstUse.set(entry.serverName, index)
  }
  await Promise.all(config.servers.map(entry => ctx.plugin(mcpClient, entry)))
}
