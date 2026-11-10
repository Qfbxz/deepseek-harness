/**
 * Registry semantics for the `@deepseek-ai/dsh-mcp-client/registry` entry:
 * the empty default mounts nothing, and misconfiguration — a duplicated
 * serverName, an entry that fails the mcp-client config schema, or a child
 * whose startup fails under `failOnStartupError` — rejects the registry's
 * activation at load. Mounted-server behavior is proven end to end by the
 * assembled headless snapshots (`examples/headless-agent` WP7 scenarios).
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as registry from '@deepseek-ai/dsh-mcp-client/registry'
import type { RegistryConfig } from '@deepseek-ai/dsh-mcp-client/registry'
import type { Config } from '@deepseek-ai/dsh-mcp-client'
async function mountRegistry(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

function stdioEntry(serverName: string, command: string): Config {
  return {
    transport: 'stdio',
    serverName,
    command,
    args: [],
    env: {},
    cwd: '',
    toolCallTimeoutMs: 15_000,
    connectTimeoutMs: 30_000,
    failOnStartupError: false,
  }
}

describe('dsh-mcp-client registry', () => {
  it('resolves an omitted server list to the empty registry', () => {
    const result = registry.Config['~standard'].validate({})
    if (!('value' in result)) throw new Error('empty registry config must validate')
    expect((result.value as RegistryConfig).servers).toEqual([])
  })

  it('mounts nothing and activates cleanly on the empty registry', async () => {
    const ctx = await mountRegistry()
    await ctx.plugin(registry, { servers: [] })
    expect(ctx.tools.schemas().map(schema => schema.name).filter(name => name.startsWith('mcp__'))).toEqual([])
    await ctx.fiber.dispose()
  })

  it('rejects a duplicated serverName with both entry indices', async () => {
    const ctx = await mountRegistry()
    const config: RegistryConfig = {
      servers: [
        stdioEntry('dup', 'never-spawned'),
        {
          transport: 'streamable-http',
          serverName: 'dup',
          url: 'http://127.0.0.1:9/mcp',
          headers: {},
          toolCallTimeoutMs: 15_000,
          connectTimeoutMs: 30_000,
          failOnStartupError: false,
        },
      ],
    }
    await expect(ctx.plugin(registry, config)).rejects.toThrow(
      /servers\[1\] repeats serverName "dup" \(first used at servers\[0\]\)/,
    )
    await ctx.fiber.dispose()
  })

  it('rejects an entry that fails the mcp-client config schema', async () => {
    const ctx = await mountRegistry()
    const config = {
      servers: [{ transport: 'stdio', serverName: 'broken' }],
    } as unknown as RegistryConfig
    await expect(ctx.plugin(registry, config)).rejects.toThrow()
    expect(ctx.tools.schemas().map(schema => schema.name).filter(name => name.startsWith('mcp__'))).toEqual([])
    await ctx.fiber.dispose()
  })

  it('folds a child startup failure into the registry activation', async () => {
    const ctx = await mountRegistry()
    const config: RegistryConfig = {
      servers: [
        {
          ...stdioEntry('doomed', 'dsh-mcp-registry-spec-nonexistent-command'),
          // A valid config whose spawn can never succeed: the child's first
          // attempt fails and `failOnStartupError` turns that into a startup
          // rejection, which the registry propagates.
          failOnStartupError: true,
          reconnect: { enabled: false },
        },
      ],
    }
    await expect(ctx.plugin(registry, config)).rejects.toThrow(
      /mcp-client\(doomed\): initial connection or tool synchronization failed/,
    )
    // Rollback unmounted the failed child's generation: no tools remain.
    expect(ctx.tools.schemas().map(schema => schema.name).filter(name => name.startsWith('mcp__'))).toEqual([])
    await ctx.fiber.dispose()
  })
})
