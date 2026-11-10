import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeSessionLog,
  normalizeStdout,
  scrubRequestHeaders,
  type NormalizeContext,
} from '@deepseek-ai/dsh-acp-snapshot'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

/**
 * WP8 approval-cache snapshots: the session approval cache serves an
 * identical second request shape without a second prompt, and a persisted
 * command-prefix rule answers a different-shaped command while a forbidden
 * `rm` persistence is refused through the assembled one-shot headless app.
 * All keyless: the interaction fixture drives the real pre-execute ask and
 * approval/request answer paths, and the model side is a scripted adapter.
 */

interface JsonObject {
  [key: string]: unknown
}

const snapshotsDir = join(dirname(fileURLToPath(import.meta.url)), 'snapshots')
const cacheScenarioDir = join(snapshotsDir, 'wp8-approval-cache')
const cacheConfigPath = fileURLToPath(new URL('../wp8-approval-cache.cordis.snapshot.yml', import.meta.url))
const prefixScenarioDir = join(snapshotsDir, 'wp8-approval-prefix')
const prefixConfigPath = fileURLToPath(new URL('../wp8-approval-prefix.cordis.snapshot.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'

function parseJsonl(content: string): JsonObject[] {
  return content.split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as JsonObject)
}

function normalizeHeadlessStream(rawStdout: string, cwd: string): string {
  const records = parseJsonl(rawStdout)
  if (records.length === 0) throw new Error('headless snapshot emitted no stream-json records')
  const final = records.at(-1)
  if (final?.type !== 'result') throw new Error('headless snapshot did not end with a result record')
  if (records.slice(0, -1).some(record => record.type !== 'session_event')) {
    throw new Error('headless snapshot emitted a non-event record before its result')
  }

  const sessionIds = [...new Set(records.flatMap(record => typeof record.sessionId === 'string' ? [record.sessionId] : []))]
  if (sessionIds.length !== 1) throw new Error(`headless snapshot streamed ${sessionIds.length} main session ids`)
  const context: NormalizeContext = { sessionIds, cwd }
  const events = records.slice(0, -1).map((record) => {
    if (record.event === null || typeof record.event !== 'object' || Array.isArray(record.event)) {
      throw new Error('headless snapshot emitted an invalid session event')
    }
    return record.event as JsonObject
  })
  const normalizedEvents = parseJsonl(scrubRequestHeaders(normalizeSessionLog(
    `${events.map(event => JSON.stringify(event)).join('\n')}\n`,
    context,
  )))
  const normalizedRecords = records.map((record, index) => index < normalizedEvents.length
    ? { ...record, event: normalizedEvents[index] }
    : record)
  return normalizeStdout(`${normalizedRecords.map(record => JSON.stringify(record)).join('\n')}\n`, context)
}

function scenarioEnv(scenarioDir: string): Record<string, string> {
  return {
    NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
    ...process.env.DSH_SNAPSHOT === 'refresh' ? { DSH_SNAPSHOT: 'refresh' } : {},
    // No llm-replay fixture: the wp8 adapters script their own calls, so no
    // session.jsonl or replay override rides along.
    DSH_SNAPSHOT_FILE: join(scenarioDir, 'session.jsonl'),
  }
}

describe('wp8 approval-cache snapshots', () => {
  it('serves the identical second request shape from the session approval cache', async () => {
    const streamExpected = join(cacheScenarioDir, 'stream-json.expected.jsonl')
    let runCwd = ''
    const result = await runLoaderSmoke({
      label: 'wp8 approval cache reduced-interruption stream-json snapshot',
      tempDirPrefix: 'headless-snapshot-wp8-approval-cache-',
      binScript,
      libBinScript: binScript,
      configPath: cacheConfigPath,
      binArgs: [
        cacheConfigPath,
        'Call todo_write twice with the identical single-item task list, then answer with the exact words WP8_CACHE_OK.',
      ],
      tsconfigPath,
      env: scenarioEnv(cacheScenarioDir),
      prepare: (cwd) => { runCwd = cwd },
      inspect: cwd =>
        readFile(join(cwd, 'wp8-answerer-consultations.txt'), 'utf8').then((consultations) => {
          // The answerer ran for the first ask only: the second identical call
          // was served by the session approval cache.
          expect(consultations).toBe('wp8-cache-call-1\n')
        }),
    })

    expect(result.stderr).toBe('')
    const normalized = normalizeHeadlessStream(result.stdout, runCwd)
    if (refreshing) await writeFile(streamExpected, normalized)
    expect(normalized).toBe(await readFile(streamExpected, 'utf8'))
    // Two identical todo_write calls ran; both resolved `allowed-once`, but
    // the answerer was consulted exactly once — the second same-shape ask was
    // served by the session approval cache. Every resolved ask still audits
    // its asked/decided pair, so the durable stream shows two pairs while the
    // consultation marker shows one prompt.
    const events = parseJsonl(normalized).slice(0, -1)
      .map(record => (record as JsonObject).event as JsonObject)
    const asked = events.filter(event => event.type === 'approval/asked')
    const decided = events.filter(event => event.type === 'approval/decided')
    expect(asked).toHaveLength(2)
    expect(decided.map(event => (event.data as JsonObject | undefined)?.outcome)).toEqual(['allowed-once', 'allowed-once'])
    const calls = events.filter(event => event.type === 'tool/call')
    expect(calls).toHaveLength(2)
    expect(new Set(calls.map(call => (call.data as JsonObject | undefined)?.arguments)).size).toBe(1)
    expect(normalized).toContain('WP8_CACHE_OK')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('answers a different-shaped command through a persisted prefix rule and refuses a forbidden one', async () => {
    const streamExpected = join(prefixScenarioDir, 'stream-json.expected.jsonl')
    let runCwd = ''
    const result = await runLoaderSmoke({
      label: 'wp8 approval prefix-rule stream-json snapshot',
      tempDirPrefix: 'headless-snapshot-wp8-approval-prefix-',
      binScript,
      libBinScript: binScript,
      configPath: prefixConfigPath,
      binArgs: [
        prefixConfigPath,
        'Run echo alpha, then echo beta, then try rm -rf wp8-forbidden-target, then answer with the exact words WP8_PREFIX_OK.',
      ],
      tsconfigPath,
      env: scenarioEnv(prefixScenarioDir),
      prepare: (cwd) => { runCwd = cwd },
      inspect: (cwd) => {
        // The forbidden persist attempt must have been refused with the
        // executable reason, never recorded, and the answerer consulted for
        // `echo alpha` and the `rm -rf` call only — `echo beta` ran under the
        // persisted prefix rule without a prompt.
        const refusal = join(cwd, 'wp8-forbidden-prefix-refusal.txt')
        expect(existsSync(join(cwd, 'wp8-forbidden-prefix-BUG-succeeded.txt'))).toBe(false)
        const assertions = Promise.all([
          readFile(refusal, 'utf8').then((content) => {
            expect(content).toContain('forbidden command "rm"')
          }),
          readFile(join(cwd, 'wp8-answerer-consultations.txt'), 'utf8').then((consultations) => {
            expect(consultations).toBe('wp8-prefix-call-1\nwp8-prefix-call-3\n')
          }),
        ])
        return assertions.then(() => {})
      },
    })

    expect(result.stderr).toBe('')
    const normalized = normalizeHeadlessStream(result.stdout, runCwd)
    if (refreshing) await writeFile(streamExpected, normalized)
    expect(normalized).toBe(await readFile(streamExpected, 'utf8'))
    // Three bash calls ran; every resolved ask audits its pair, so the
    // durable stream shows three asked events — `echo alpha` (granted),
    // `echo beta` (answered by the persisted prefix rule), and the `rm -rf`
    // call (rejected). The consultation marker proves only two of them
    // prompted the answerer: `echo beta` ran under the rule, and the
    // forbidden `rm` persistence was refused before the rejection.
    const events = parseJsonl(normalized).slice(0, -1)
      .map(record => (record as JsonObject).event as JsonObject)
    const asked = events.filter(event => event.type === 'approval/asked')
    const decided = events.filter(event => event.type === 'approval/decided')
    expect(asked).toHaveLength(3)
    expect(decided.map(event => (event.data as JsonObject | undefined)?.outcome))
      .toEqual(['allowed-once', 'allowed-once', 'rejected'])
    const calls = events.filter(event => event.type === 'tool/call')
    expect(calls).toHaveLength(3)
    expect(normalized).toContain('WP8_PREFIX_OK')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
