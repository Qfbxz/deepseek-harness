import { readFile, readdir, writeFile } from 'node:fs/promises'
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
 * WP2 subagent report floor snapshots: a foreground `subagent_fork` delegation
 * through the assembled one-shot headless app, driven keyless by llm-replay.
 * The SHORT arm proves the floor costs exactly one continuation in the child's
 * own conversation and the longer raised report reaches the parent; the LONG
 * arm proves a report above the floor returns untouched; the DISABLED arm
 * proves `floorContinuationAttempts: 0` keeps a short report unchanged.
 */

interface JsonObject {
  [key: string]: unknown
}

const SHORT_REPORT = 'Found it: the widget lives in src/widget.ts.'

const LONG_REPORT = 'FLOOR_RAISED_REPORT: The widget factory initializes lazily and caches one instance in module '
  + 'scope. Configuration flows from the deployment settings file at startup; overrides apply per request. The '
  + 'delegation boundary keeps intermediate steps in the child session, so the parent receives only this final '
  + 'report. The floor continuation reuses the child conversation, and the longer message replaces the short one.'

/** The pinned model-facing fragment of the floor continuation demand. */
const FLOOR_PROMPT_FRAGMENT = 'complete final report in one message'

const snapshotsDir = join(dirname(fileURLToPath(import.meta.url)), 'snapshots')
const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'

const scenarios = [
  {
    name: 'subagent-floor-short',
    config: 'subagent-floor-short.cordis.snapshot.yml',
    task: 'Delegate a widget research report to a subagent with subagent_fork, then summarize its report.',
    result: 'FLOOR_PARENT_DONE: the subagent\'s raised report is received and summarized.',
    toolResult: LONG_REPORT,
    absentFromStream: [SHORT_REPORT, FLOOR_PROMPT_FRAGMENT],
    childTexts: [SHORT_REPORT, LONG_REPORT],
    continuationCount: 1,
  },
  {
    name: 'subagent-floor-long',
    config: 'subagent-floor-long.cordis.snapshot.yml',
    task: 'Delegate a widget research report to a subagent with subagent_fork, then summarize its report.',
    result: 'FLOOR_PARENT_DONE: the long subagent report is received and summarized.',
    toolResult: LONG_REPORT,
    absentFromStream: [SHORT_REPORT, FLOOR_PROMPT_FRAGMENT],
    childTexts: [LONG_REPORT],
    continuationCount: 0,
  },
  {
    name: 'subagent-floor-disabled',
    config: 'subagent-floor-disabled.cordis.snapshot.yml',
    task: 'Delegate a widget research report to a subagent with subagent_fork, then summarize its report.',
    result: 'FLOOR_PARENT_DONE: the short subagent report is received and summarized.',
    toolResult: SHORT_REPORT,
    absentFromStream: [LONG_REPORT, FLOOR_PROMPT_FRAGMENT],
    childTexts: [SHORT_REPORT],
    continuationCount: 0,
  },
] as const

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
    // parent session.jsonl; the env var satisfies the required fixture reference.
    DSH_SNAPSHOT_FILE: join(scenarioDir, 'session.jsonl'),
    DSH_SNAPSHOT_OVERRIDE: join(scenarioDir, 'replay.override.json'),
    DSH_SNAPSHOT_CHILD_FILES: join(scenarioDir, 'child.replay.jsonl'),
    NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
  }
}

/** The persisted child log under `.sessions`, identified by its parentSession header. */
async function childLog(runCwd: string): Promise<{ content: string; childId: string }> {
  const sessionsDir = join(runCwd, '.sessions')
  const files = (await readdir(sessionsDir, { recursive: true })).filter(file => file.endsWith('.jsonl'))
  const logs = await Promise.all(files.map(async file => readFile(join(sessionsDir, file), 'utf8')))
  const child = logs.find((content) => {
    const header = JSON.parse(content.split('\n')[0] ?? '{}') as Record<string, unknown>
    return typeof header.parentSession === 'string'
  })
  if (child === undefined) throw new Error('missing persisted child log')
  const header = JSON.parse(child.split('\n')[0] ?? '{}') as { id?: string }
  return { content: child, childId: String(header.id) }
}

describe('wp2 subagent report floor snapshots', () => {
  for (const scenario of scenarios) {
    it(`replays the ${scenario.name} arm through the one-shot app`, async () => {
      const scenarioDir = join(snapshotsDir, scenario.name)
      const configPath = fileURLToPath(new URL(`../${scenario.config}`, import.meta.url))
      const streamExpected = join(scenarioDir, 'stream-json.expected.jsonl')
      let runCwd = ''
      const result = await runLoaderSmoke({
        label: `wp2 subagent floor ${scenario.name} stream-json snapshot`,
        tempDirPrefix: `headless-snapshot-wp2-${scenario.name}-`,
        binScript,
        libBinScript: binScript,
        configPath,
        binArgs: [configPath, scenario.task],
        tsconfigPath,
        env: replayEnv(scenarioDir),
        prepare: (cwd) => { runCwd = cwd },
        inspect: async (inspectCwd) => {
          const { content, childId } = await childLog(inspectCwd)
          const context: NormalizeContext = { sessionIds: [childId], cwd: inspectCwd }
          // THE model-visible fact in the child's own log: the floor demand was
          // delivered exactly `continuationCount` times (counted as entered
          // user messages; the inbox splice echoes the same content), and the
          // child produced exactly the scripted turns.
          const floorPrompts = content.trimEnd().split('\n').filter((line) => {
            const event = JSON.parse(line) as { type?: string; data?: { content?: Array<{ type?: string; text?: string }> } }
            if (event.type !== 'user/message') return false
            return event.data?.content?.some(block => block.type === 'text' && block.text?.includes(FLOOR_PROMPT_FRAGMENT)) === true
          })
          expect(floorPrompts).toHaveLength(scenario.continuationCount)
          for (const text of scenario.childTexts) expect(content).toContain(text)
          // The persisted child log stays replay-stable under the canonical normalizer.
          const normalizedChild = scrubRequestHeaders(normalizeSessionLog(content, context))
          const childExpected = join(scenarioDir, 'child.expected.jsonl')
          if (refreshing) await writeFile(childExpected, normalizedChild)
          expect(normalizedChild).toBe(await readFile(childExpected, 'utf8'))
        },
      })

      expect(result.stderr).toBe('')
      const normalized = normalizeHeadlessStream(result.stdout, runCwd)
      if (refreshing) await writeFile(streamExpected, normalized)
      expect(normalized).toBe(await readFile(streamExpected, 'utf8'))
      // The parent's tool result carries exactly the floor-selected report, and
      // neither the rejected text nor the internal continuation demand leaks
      // into the parent stream.
      expect(normalized).toContain(scenario.toolResult)
      expect(normalized).toContain(scenario.result)
      for (const absent of scenario.absentFromStream) expect(normalized).not.toContain(absent)
    }, LOADER_SMOKE_TEST_TIMEOUT_MS)
  }
})
