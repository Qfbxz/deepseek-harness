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
 * WP4 compaction snapshots: the consecutive-failure breaker stopping automatic
 * compaction at `maxConsecutiveFailures` while the turn keeps completing, and
 * the summarizer's retention-priority instruction proven by a checkpoint whose
 * scripted response echoes fragments of the live instruction back, each driven
 * through the assembled one-shot headless app by a scripted keyless llm-replay
 * override.
 */

interface JsonObject {
  [key: string]: unknown
}

const snapshotsDir = join(dirname(fileURLToPath(import.meta.url)), 'snapshots')
const breakerScenarioDir = join(snapshotsDir, 'compaction-breaker')
const breakerConfigPath = fileURLToPath(new URL('../compaction-breaker.cordis.snapshot.yml', import.meta.url))
const priorityScenarioDir = join(snapshotsDir, 'compaction-priority')
const priorityConfigPath = fileURLToPath(new URL('../compaction-priority.cordis.snapshot.yml', import.meta.url))
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

function replayEnv(scenarioDir: string): Record<string, string> {
  return {
    DSH_SNAPSHOT: 'replay',
    // The override fully replaces the derived script, so the scenario ships no
    // session.jsonl; the env var satisfies the required fixture reference.
    DSH_SNAPSHOT_FILE: join(scenarioDir, 'session.jsonl'),
    DSH_SNAPSHOT_OVERRIDE: join(scenarioDir, 'replay.override.json'),
    NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
  }
}

describe('wp4 compaction snapshots', () => {
  it('stops automatic compaction at the third consecutive failure and keeps the turn usable', async () => {
    const streamExpected = join(breakerScenarioDir, 'stream-json.expected.jsonl')
    let runCwd = ''
    const result = await runLoaderSmoke({
      label: 'wp4 compaction breaker stream-json snapshot',
      tempDirPrefix: 'headless-snapshot-wp4-compaction-breaker-',
      binScript,
      libBinScript: binScript,
      configPath: breakerConfigPath,
      binArgs: [
        breakerConfigPath,
        'Call todo_write four times with the identical single-item task list, then answer with the final summary.',
      ],
      tsconfigPath,
      env: replayEnv(breakerScenarioDir),
      prepare: (cwd) => { runCwd = cwd },
    })

    expect(result.stderr).toBe('')
    const normalized = normalizeHeadlessStream(result.stdout, runCwd)
    if (refreshing) await writeFile(streamExpected, normalized)
    expect(normalized).toBe(await readFile(streamExpected, 'utf8'))
    // Exactly three failed summarizer attempts ran; the durable envelope of
    // each failure is one compaction bracket closed with the thrown error, and
    // the breaker surfaced the trip without a fourth attempt.
    const events = parseJsonl(normalized).slice(0, -1)
      .map(record => (record as JsonObject).event as JsonObject)
    const types = events.map(event => event.type)
    expect(types.filter(type => type === 'compaction/start')).toHaveLength(3)
    expect(types.filter(type => type === 'compaction/end')).toHaveLength(3)
    expect(types.filter(type => type === 'compaction/summary')).toHaveLength(0)
    const endErrors = events
      .filter(event => event.type === 'compaction/end')
      .map(event => event.data as JsonObject)
    expect(endErrors).toEqual([
      expect.objectContaining({ error: expect.stringContaining('snapshot summarizer outage') }),
      expect.objectContaining({ error: expect.stringContaining('snapshot summarizer outage') }),
      expect.objectContaining({ error: expect.stringContaining('snapshot summarizer outage') }),
    ])
    // The trip did not block the user's turn: the fourth tool step ran without
    // a compaction attempt, and the final model call completed the task.
    expect(types.filter(type => type === 'tool/call')).toHaveLength(4)
    expect(normalized).toContain('BREAKER_STOPPED')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('echoes the summarizer retention priority through a committed checkpoint', async () => {
    const streamExpected = join(priorityScenarioDir, 'stream-json.expected.jsonl')
    let runCwd = ''
    const result = await runLoaderSmoke({
      label: 'wp4 compaction priority stream-json snapshot',
      tempDirPrefix: 'headless-snapshot-wp4-compaction-priority-',
      binScript,
      libBinScript: binScript,
      configPath: priorityConfigPath,
      binArgs: [
        priorityConfigPath,
        'Establish a durable retention-premise before continuing. Record every part of this historical evidence: the snapshot uses keyless replay; persistence uses JSONL; the assembled headless application loads its real Cordis composition; the compaction summarizer replays the conversation prefix and appends one compaction instruction as the final user message; that instruction ranks retention priorities from current task state over errors and fixes, files and code, user messages, down to earlier history; every checkpoint section carries MUST KEEP, MERGE, and REMOVE directives; the scripted summarizer response echoes fragments of that live instruction back through fromRequest placeholders, so a placeholder that matched nothing would fail the replay loudly; the echoed fragments land in the compaction/summary raw output and in the replacement checkpoint user message; compaction opens with compaction/start and closes with compaction/end; the checkpoint must stay smaller than the history it replaces; the final response proves the same turn continued; and no external API key is needed. Call todo_write once with the single-item task list, then finish the task after the required recovery with the exact words PRIORITY_ECHO_OK.',
      ],
      tsconfigPath,
      env: replayEnv(priorityScenarioDir),
      prepare: (cwd) => { runCwd = cwd },
    })

    expect(result.stderr).toBe('')
    const normalized = normalizeHeadlessStream(result.stdout, runCwd)
    if (refreshing) await writeFile(streamExpected, normalized)
    expect(normalized).toBe(await readFile(streamExpected, 'utf8'))
    // One successful compaction: the checkpoint's scripted response echoes
    // fragments of the live instruction back, so the recorded transcript
    // proves the summarizer request carried the retention priority ranking
    // and its MUST KEEP / REMOVE directives (a placeholder that matched
    // nothing would fail the replay loudly instead of echoing).
    expect(normalized).toContain('CHECKPOINT PRIORITY ECHO')
    expect(normalized).toContain('Retention priority: when the summary must shrink, keep higher-ranked content in preference to lower-ranked content:')
    expect(normalized).toContain('MUST KEEP: exact paths the task still touches, with their key changes. MERGE: repeated edits of one file into one bullet. REMOVE: files whose work is finished and verified.')
    expect(normalized).toContain('REMOVE: one-off errors that are fixed and cannot recur.')
    const events = parseJsonl(normalized).slice(0, -1)
      .map(record => (record as JsonObject).event as JsonObject)
    const types = events.map(event => event.type)
    expect(types.filter(type => type === 'compaction/start')).toHaveLength(1)
    expect(types.filter(type => type === 'compaction/summary')).toHaveLength(1)
    expect(types.filter(type => type === 'compaction/end')).toHaveLength(1)
    expect(normalized).toContain('PRIORITY_ECHO_OK')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
