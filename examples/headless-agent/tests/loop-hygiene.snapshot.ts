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
 * WP1 loop-hygiene snapshots: the repeat-tool-reminder reminder ladder plus
 * force stop (default config), and the agent-loop turn tool-call budget event,
 * each driven through the assembled one-shot headless app by a scripted
 * keyless llm-replay override.
 */

interface JsonObject {
  [key: string]: unknown
}

const snapshotsDir = join(dirname(fileURLToPath(import.meta.url)), 'snapshots')
const loopRepeatScenarioDir = join(snapshotsDir, 'loop-repeat')
const loopRepeatConfigPath = fileURLToPath(new URL('../loop-repeat.cordis.snapshot.yml', import.meta.url))
const loopBudgetScenarioDir = join(snapshotsDir, 'loop-budget')
const loopBudgetConfigPath = fileURLToPath(new URL('../loop-budget.cordis.snapshot.yml', import.meta.url))
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

describe('wp1 loop-hygiene snapshots', () => {
  it('replays the 3/5/8 reminder ladder and the force stop at 12 through the one-shot app', async () => {
    const streamExpected = join(loopRepeatScenarioDir, 'stream-json.expected.jsonl')
    let runCwd = ''
    const result = await runLoaderSmoke({
      label: 'wp1 loop-hygiene repeat force-stop stream-json snapshot',
      tempDirPrefix: 'headless-snapshot-wp1-loop-repeat-',
      binScript,
      libBinScript: binScript,
      configPath: loopRepeatConfigPath,
      binArgs: [
        loopRepeatConfigPath,
        'Call todo_write twelve times with the identical single-item task list, then answer with the final summary.',
      ],
      tsconfigPath,
      env: replayEnv(loopRepeatScenarioDir),
      prepare: (cwd) => { runCwd = cwd },
    })

    expect(result.stderr).toBe('')
    const normalized = normalizeHeadlessStream(result.stdout, runCwd)
    if (refreshing) await writeFile(streamExpected, normalized)
    expect(normalized).toBe(await readFile(streamExpected, 'utf8'))
    // The reminder ladder (3 gentle, 5 and 8 detailed) rides the durable stream.
    expect(normalized).toContain('repeating the exact same tool call')
    expect(normalized).toContain('consecutive_calls: 5')
    expect(normalized).toContain('consecutive_calls: 8')
    // The 12th identical call force-stops the turn: the pinned instruction and
    // the guard-attributed notice are model-visible context, then the final
    // model call summarizes in text.
    expect(normalized).toContain('停止工具调用，改用文字总结当前进展与结论')
    expect(normalized).toContain('(Force stop: 12 consecutive identical calls to todo_write.)')
    expect(normalized).toContain('todo_write × 12 force-stop')
    expect(normalized).toContain('LOOP_REPEAT_FORCE_STOP')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('replays the turn tool-call budget event through the one-shot app', async () => {
    const streamExpected = join(loopBudgetScenarioDir, 'stream-json.expected.jsonl')
    let runCwd = ''
    const result = await runLoaderSmoke({
      label: 'wp1 loop-hygiene tool-call budget stream-json snapshot',
      tempDirPrefix: 'headless-snapshot-wp1-loop-budget-',
      binScript,
      libBinScript: binScript,
      configPath: loopBudgetConfigPath,
      binArgs: [
        loopBudgetConfigPath,
        'Call todo_write five times with the identical single-item task list, then answer with the final summary.',
      ],
      tsconfigPath,
      env: replayEnv(loopBudgetScenarioDir),
      prepare: (cwd) => { runCwd = cwd },
    })

    expect(result.stderr).toBe('')
    const normalized = normalizeHeadlessStream(result.stdout, runCwd)
    if (refreshing) await writeFile(streamExpected, normalized)
    expect(normalized).toBe(await readFile(streamExpected, 'utf8'))
    // Calls past maxToolCallsPerTurn carry the canonical budget-skip error
    // result, the once-per-turn notice names the exhausted budget to the
    // model, and the turn still ends completed with a text summary.
    expect(normalized).toContain('TOOL_CALL_BUDGET_EXHAUSTED')
    expect(normalized).toContain('tool call not executed: the turn reached its tool-call budget of 4')
    expect(normalized).toContain('Tool-call budget exhausted: this turn reached its limit of 4 tool calls')
    expect(normalized).toContain('(agent-loop maxToolCallsPerTurn)')
    expect(normalized).toContain('LOOP_BUDGET_EVENT')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
