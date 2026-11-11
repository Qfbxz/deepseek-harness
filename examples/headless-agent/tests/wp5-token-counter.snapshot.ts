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
 * WP5 token-counter snapshots: the scripted keyless counter-mock adapter
 * declares the provider token-count capability, so the pressure threshold
 * compares the provider-reported count; the absent-declaration control proves
 * the same content stays below the same threshold on the character estimate.
 */

interface JsonObject {
  [key: string]: unknown
}

const snapshotsDir = join(dirname(fileURLToPath(import.meta.url)), 'snapshots')
const counterScenarioDir = join(snapshotsDir, 'token-counter')
const counterConfigPath = fileURLToPath(new URL('../token-counter.cordis.snapshot.yml', import.meta.url))
const absentScenarioDir = join(snapshotsDir, 'token-counter-absent')
const absentConfigPath = fileURLToPath(new URL('../token-counter-absent.cordis.snapshot.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'

const SCENARIO_PROMPT = [
  'Establish a durable counter premise before continuing. Record every part of this historical evidence:',
  'the snapshot uses keyless replay; persistence uses JSONL; the assembled headless application loads its real Cordis composition;',
  'step-boundary compaction pressure resolves through the token meter;',
  'when the routed adapter declares a provider token-count capability, the pressure threshold compares the provider-reported count for the full request envelope instead of the character estimate;',
  'the character estimate remains the fallback when no capability is declared or a count call fails;',
  'the scripted summarizer returns one short checkpoint line; the checkpoint must stay smaller than the history it replaces;',
  'compaction opens with compaction/start and closes with compaction/end; and no external API key is needed.',
  'Also preserve these grounding facts for the checkpoint: the counter fixture prices the request envelope at two characters per token;',
  'the scenario threshold sits between the post-compaction count and the pre-compaction count, so only the reported count crosses it;',
  'the retained tail keeps the todo_write call and its result verbatim while the long premise is summarized;',
  'the replacement checkpoint lands as one user message framed with compacted-summary tags;',
  'the final model call runs after the checkpoint replacement and answers in plain text.',
  'Also record this padded calibration block so the summarized premise clearly outweighs the retained tail: calibration block one covers request-envelope accounting, calibration block two covers threshold margins, calibration block three covers post-compaction floors, calibration block four covers provider-declared counting, calibration block five covers estimate fallbacks, and calibration block six covers one-compaction convergence.',
  'Call todo_write once with the single-item task list, then finish the task with the exact words TOKEN_COUNTER_OK.',
].join(' ')

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
    // No llm-replay fixture: the counter-mock adapters script their own calls,
    // so no session.jsonl or replay override rides along.
    DSH_SNAPSHOT_FILE: join(scenarioDir, 'session.jsonl'),
  }
}

describe('wp5 token-counter snapshots', () => {
  it('crosses the pressure threshold on the provider-reported count and compacts', async () => {
    const streamExpected = join(counterScenarioDir, 'stream-json.expected.jsonl')
    let runCwd = ''
    const result = await runLoaderSmoke({
      label: 'wp5 token counter reported stream-json snapshot',
      tempDirPrefix: 'headless-snapshot-wp5-token-counter-',
      binScript,
      libBinScript: binScript,
      configPath: counterConfigPath,
      binArgs: [counterConfigPath, SCENARIO_PROMPT],
      tsconfigPath,
      env: scenarioEnv(counterScenarioDir),
      prepare: (cwd) => { runCwd = cwd },
    })

    expect(result.stderr).toBe('')
    const normalized = normalizeHeadlessStream(result.stdout, runCwd)
    if (refreshing) await writeFile(streamExpected, normalized)
    expect(normalized).toBe(await readFile(streamExpected, 'utf8'))
    // One committed compaction bracket: the threshold decision consumed the
    // reported count, summarized once, and the turn completed in text.
    const events = parseJsonl(normalized).slice(0, -1)
      .map(record => (record as JsonObject).event as JsonObject)
    const types = events.map(event => event.type)
    expect(types.filter(type => type === 'compaction/start')).toHaveLength(1)
    expect(types.filter(type => type === 'compaction/summary')).toHaveLength(1)
    expect(types.filter(type => type === 'compaction/end')).toHaveLength(1)
    expect(types.filter(type => type === 'tool/call')).toHaveLength(1)
    expect(normalized).toContain('COUNTER_CHECKPOINT')
    expect(normalized).toContain('TOKEN_COUNTER_OK')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('stays on the character estimate without a declared counting capability', async () => {
    const streamExpected = join(absentScenarioDir, 'stream-json.expected.jsonl')
    let runCwd = ''
    const result = await runLoaderSmoke({
      label: 'wp5 token counter absent stream-json snapshot',
      tempDirPrefix: 'headless-snapshot-wp5-token-counter-absent-',
      binScript,
      libBinScript: binScript,
      configPath: absentConfigPath,
      binArgs: [absentConfigPath, SCENARIO_PROMPT],
      tsconfigPath,
      env: scenarioEnv(absentScenarioDir),
      prepare: (cwd) => { runCwd = cwd },
    })

    expect(result.stderr).toBe('')
    const normalized = normalizeHeadlessStream(result.stdout, runCwd)
    if (refreshing) await writeFile(streamExpected, normalized)
    expect(normalized).toBe(await readFile(streamExpected, 'utf8'))
    // Same content, same threshold: without the declared capability the
    // character estimate stays below the threshold and nothing compacts.
    const events = parseJsonl(normalized).slice(0, -1)
      .map(record => (record as JsonObject).event as JsonObject)
    const types = events.map(event => event.type)
    expect(types.filter(type => type === 'compaction/start')).toHaveLength(0)
    expect(types.filter(type => type === 'compaction/end')).toHaveLength(0)
    expect(normalized).toContain('TOKEN_COUNTER_OK')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
