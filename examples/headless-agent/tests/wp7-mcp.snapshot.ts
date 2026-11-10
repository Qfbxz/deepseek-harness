import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeSessionLog, scrubRequestHeaders, type NormalizeContext } from '@deepseek-ai/dsh-acp-snapshot'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { decompressZstdFrame, scanZstdFrames } from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.ts'
import { describe, expect, it } from 'vitest'

/**
 * WP7 MCP base-bundle snapshots: the base profile mounts the MCP capability
 * as the `mcp` registry row with an empty default registry, misconfiguration
 * on that row fails the boot loudly at load, and a configured fixture server
 * round-trips a real `mcp__fixture__add` call through the assembled product
 * headless profile. All keyless: the model side is the scripted mcp-mock
 * adapter, the MCP side is a real stdio fixture server.
 */

interface JsonObject {
  [key: string]: unknown
}

const snapshotsDir = join(dirname(fileURLToPath(import.meta.url)), 'snapshots')
const mcpScenarioDir = join(snapshotsDir, 'mcp-fixture')
const mcpSessionExpected = join(mcpScenarioDir, 'session.expected.jsonl')
const dshBinScript = fileURLToPath(new URL('../../../apps/cli/src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const mcpRoundtripOverlayPath = fileURLToPath(new URL('./fixtures/mcp-profile.cordis.yml', import.meta.url))
const mcpDuplicateOverlayPath = fileURLToPath(new URL('./fixtures/mcp-duplicate-server.cordis.yml', import.meta.url))
const mcpInvalidOverlayPath = fileURLToPath(new URL('./fixtures/mcp-invalid-entry.cordis.yml', import.meta.url))
const mcpMockLlmPluginPath = fileURLToPath(new URL('./fixtures/mcp-mock-llm.ts', import.meta.url))
const mcpFixtureServerPath = fileURLToPath(new URL('./fixtures/mcp-fixture-server.mjs', import.meta.url))
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'

function parseJsonl(content: string): JsonObject[] {
  return content.split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as JsonObject)
}

function contextFromLogs(contents: readonly string[]): NormalizeContext {
  const headers = contents.map(content => parseJsonl(content)[0])
  return {
    sessionIds: headers.flatMap(header => typeof header?.id === 'string' ? [header.id] : []),
    cwd: typeof headers[0]?.cwd === 'string' ? headers[0].cwd : '\0no-cwd\0',
  }
}

async function persistedLogs(cwd: string): Promise<{ content: string }[]> {
  const root = join(cwd, '.dsh', 'sessions')
  const files = (await readdir(root, { recursive: true }))
    .filter(file => file.endsWith('.jsonl') || file.endsWith('.jsonl.zstd'))
  return Promise.all(files.map(async (file) => {
    const content = await readFile(join(root, file))
    if (!file.endsWith('.zstd')) return { content: content.toString('utf8') }
    const scan = scanZstdFrames(content)
    if (scan.tornStart !== undefined) throw new Error(`persisted snapshot log has a torn Zstandard frame: ${file}`)
    const decoded: Buffer[] = []
    for (const frame of scan.frames) {
      decoded.push(await decompressZstdFrame(content.subarray(frame.start, frame.end)))
    }
    return { content: Buffer.concat(decoded).toString('utf8') }
  }))
}

/** Install the keyless mcp-mock adapter into the temporary headless profile. */
async function prepareMcpMockFixture(cwd: string): Promise<void> {
  const fixtureDir = join(cwd, '.dsh', 'profiles', 'headless', 'snapshot-fixtures')
  await mkdir(fixtureDir, { recursive: true })
  await Promise.all([
    copyFile(mcpMockLlmPluginPath, join(fixtureDir, 'mcp-mock-llm.ts')),
    writeFile(join(fixtureDir, 'package.json'), '{"type":"module"}\n'),
  ])
}

describe('wp7 mcp base-bundle snapshots', () => {
  it('mounts the mcp registry row with an empty registry in the product headless profile', async () => {
    const result = await runLoaderSmoke({
      label: 'wp7 mcp empty-registry dump-config snapshot',
      tempDirPrefix: 'headless-snapshot-wp7-mcp-dump-',
      binScript: dshBinScript,
      configPath: dshBinScript,
      binArgs: ['--profile', 'headless', '--dump-config'],
      tsconfigPath,
      env: {
        DSH_TELEMETRY_DISABLED: '1',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
    })

    expect(result.stderr).toBe('')
    // The base bundle row is present, dormant, and the only MCP row: the
    // shipped composition carries no server list.
    expect(result.stdout).toContain("id: mcp\n  name: '@deepseek-ai/dsh-mcp-client/registry'")
    expect(result.stdout).toContain('servers: []')
    expect(result.stdout).not.toContain("name: '@deepseek-ai/dsh-mcp-client'\n")
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('fails the boot loudly when the registry repeats a serverName', async () => {
    const result = await runLoaderSmoke({
      label: 'wp7 mcp duplicate serverName load failure snapshot',
      tempDirPrefix: 'headless-snapshot-wp7-mcp-duplicate-',
      binScript: dshBinScript,
      configPath: dshBinScript,
      binArgs: ['--profile', 'headless', '--patch', mcpDuplicateOverlayPath, 'unused task'],
      tsconfigPath,
      expectedExitCode: 1,
      env: {
        DSH_TELEMETRY_DISABLED: '1',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
    })

    // The registry's own check names both entry indices; nothing mounts.
    expect(result.stderr).toContain('mcp-registry: servers[1] repeats serverName "dup" (first used at servers[0])')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('fails the boot loudly when a registry entry fails the mcp-client config schema', async () => {
    const result = await runLoaderSmoke({
      label: 'wp7 mcp invalid entry load failure snapshot',
      tempDirPrefix: 'headless-snapshot-wp7-mcp-invalid-',
      binScript: dshBinScript,
      configPath: dshBinScript,
      binArgs: ['--profile', 'headless', '--patch', mcpInvalidOverlayPath, 'unused task'],
      tsconfigPath,
      expectedExitCode: 1,
      env: {
        DSH_TELEMETRY_DISABLED: '1',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
    })

    // The child's schema rejection propagates with the offending entry path.
    expect(result.stderr).toContain('failed to apply loader entry mcp (@deepseek-ai/dsh-mcp-client/registry): invalid config:')
    expect(result.stderr).toContain('$.servers[0] expected')
    expect(result.stderr).toContain('(at servers.0)')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('round-trips a fixture MCP server tool call through the mounted registry', async () => {
    const task = 'Call mcp__fixture__add with a=2 and b=3, then report the sum.'
    const result = await runLoaderSmoke({
      label: 'wp7 mcp fixture roundtrip snapshot',
      tempDirPrefix: 'headless-snapshot-wp7-mcp-fixture-',
      binScript: dshBinScript,
      configPath: dshBinScript,
      binArgs: ['--profile', 'headless', '--patch', mcpRoundtripOverlayPath, task],
      tsconfigPath,
      env: {
        DSH_MCP_FIXTURE_SERVER: mcpFixtureServerPath,
        DSH_TELEMETRY_DISABLED: '1',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      prepare: prepareMcpMockFixture,
      inspect: async (cwd) => {
        const logs = await persistedLogs(cwd)
        expect(logs).toHaveLength(1)
        const actual = logs[0]
        if (actual === undefined) throw new Error('the mcp fixture snapshot did not persist its session')
        const records = parseJsonl(actual.content)
        const context = contextFromLogs([actual.content])
        const normalized = scrubRequestHeaders(normalizeSessionLog(actual.content, context))
        if (refreshing) await writeFile(mcpSessionExpected, normalized)
        expect(normalized).toBe(await readFile(mcpSessionExpected, 'utf8'))

        // The mounted registry published the fixture tool into the assembled
        // request catalog, the call and its result are durable, and the tool
        // executed on the real server process.
        const headers = records.filter(record => record.type === 'request/header')
        expect(headers.length).toBeGreaterThan(0)
        const header = (headers.at(-1)?.data as JsonObject | undefined)?.header as JsonObject | undefined
        const toolNames = ((header?.tools ?? []) as JsonObject[]).map(tool => tool.name)
        expect(toolNames).toContain('mcp__fixture__add')
        const calls = records.filter(record => record.type === 'tool/call')
        expect(calls.map(record => (record.data as JsonObject | undefined)?.name)).toEqual(['mcp__fixture__add'])
        const results = records.filter(record => record.type === 'tool/result')
        expect(JSON.stringify(results.at(-1))).toContain('"5"')
        expect(normalized).toContain('MCP_FIXTURE_ROUNDTRIP_OK: mcp__fixture__add(2, 3) => 5')
      },
    })

    expect(result.stderr).toBe('')
    expect(result.stdout).toBe('MCP_FIXTURE_ROUNDTRIP_OK: mcp__fixture__add(2, 3) => 5\n')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
