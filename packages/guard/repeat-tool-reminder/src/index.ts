/**
 * Advisory per-agent repeat-call detector plus same-step duplicate reuse. It
 * enriches post-execute decisions with logged model context, force-stops a turn
 * whose repeat chain reaches `forceStopStreak`, and serves an exact same-step
 * duplicate from the recorded result without re-execution. Configuration and
 * chain semantics live in the package README; rationale lives in the
 * repeat-tool-reminder Agent Note.
 * @module @deepseek-ai/dsh-repeat-tool-reminder
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type {
  PostToolDecision,
  ToolDispatchExecution,
  ToolExecution,
  ToolExecutionResult,
  ToolExecutionToken,
  ToolRunContext,
} from '@deepseek-ai/dsh-tools'

export const name = 'repeat-tool-reminder'

/**
 * Plugin config, validated by the same-named schemastery schema plus the
 * load-time checks in `apply` (misconfiguration fails loud: an empty
 * `thresholds` list, a non-integer, a value below 2, a duplicate, a negative
 * or fractional `forceStopStreak`, or a non-positive `argumentsPreviewChars`
 * throws at plugin load, never a silent fall-back). `include`/`exclude`
 * entries are `*`-wildcard predicates over tool names at call time, not
 * references to registry entries — a pattern matching no currently registered
 * tool is valid (`exclude: [mcp_*]` must stay legal in a deployment that
 * loads no MCP tools).
 */
export interface Config {
  /** Consecutive-repeat counts that trigger a reminder (default `[3, 5, 8]`). */
  thresholds?: number[]
  /** Tool-name patterns to track; empty means every tool is tracked. */
  include?: string[]
  /** Tool-name patterns transparent to the chain (neither count nor reset). */
  exclude?: string[]
  /**
   * Maximum characters of canonical arguments quoted in the DETAILED reminder
   * (default 500). Large payloads (a `write` body, a long command) would
   * otherwise ride into the next request unbounded — precisely in a loop
   * scenario; the cap bounds the reminder, never the detection (the chain key
   * always compares the FULL canonical string).
   */
  argumentsPreviewChars?: number
  /**
   * Consecutive-repeat count at which the guard force-stops the agent's turn
   * (default 12; `0` disables the force stop and keeps only the reminder
   * ladder). Reaching the count injects the stop instruction through the
   * reminder channel and marks the call's result `concludesTurn`, so the turn
   * ends once the model has seen the instruction. Because a call denied or
   * failed at the threshold cannot carry a successful conclusion, every later
   * repeat of the same chain stays above the threshold and re-arms the force
   * stop, so the first successful commit at or after the threshold ends the
   * turn.
   */
  forceStopStreak?: number
}

export const Config: z<Config> = z.object({
  thresholds: z.array(z.number()).default([3, 5, 8]),
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
  argumentsPreviewChars: z.number().default(500),
  forceStopStreak: z.number().default(12),
})

/**
 * The `{kind:'plugin'}` source stamped on every context this guard injects —
 * the label is load-bearing (an unlabeled context would render as a user
 * prompt in derived history).
 */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'repeat-tool-reminder' }

/**
 * The gentle first-threshold reminder. Keyed to `thresholds[0]`, not a literal
 * count, so a custom first threshold keeps the gentle-then-detailed escalation.
 */
const GENTLE_REMINDER =
  'You are repeating the exact same tool call with identical arguments. '
  + 'Carefully analyze the previous result before calling again: if the task is '
  + 'not complete, try a different approach or different arguments instead of '
  + 'repeating the call.'

/** The detailed later-threshold reminder naming the tool, the run length, and the canonical arguments. */
function detailedReminder(toolName: string, count: number, canonicalArguments: string): string {
  return 'Repeated tool call detected:\n'
    + `- tool: ${toolName}\n`
    + `- consecutive_calls: ${count}\n`
    + `- arguments: ${canonicalArguments}\n`
    + 'The repeated calls are not making progress. Do not call this tool with '
    + 'these exact arguments again. Inspect the latest result and choose a '
    + 'different action, different arguments, or finish the task if enough '
    + 'evidence has been gathered.'
}

/** The model-facing instruction a force stop injects at the threshold. */
const FORCE_STOP_INSTRUCTION = '停止工具调用，改用文字总结当前进展与结论'

/**
 * The force-stop context message: the pinned instruction first, then the
 * identifying facts a model needs to act on it.
 */
function forceStopMessage(toolName: string, count: number): UserMessage {
  return createUserMessage({
    content: [{
      type: 'text',
      text: `${FORCE_STOP_INSTRUCTION}\n(Force stop: ${count} consecutive identical calls to ${toolName}.)`,
    }],
    source: { ...PLUGIN_SOURCE, form: 'notice', summary: `${toolName} × ${count} force-stop` },
  })
}

/** The annotation a reused same-step duplicate carries on its result context. */
const DUPLICATE_NOTE = 'duplicate of an earlier call in this step; recorded result reused'

/**
 * Deep key-sort of a parsed-JSON value so two argument objects that differ
 * only in property order canonicalize identically. Arguments reach the guard
 * as the loop's `JSON.parse` output (or its raw-string fallback for malformed
 * argument JSON), so JSON's value domain is the whole input domain — no
 * bigint, cycle, or `undefined` handling exists because no input path can
 * produce them.
 */
function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJsonValue(record[key])
    }
    return sorted
  }
  return value
}

/** Canonical string form of a call's arguments: deep key-sort, then stringify. */
function canonicalize(argumentsValue: unknown): string {
  return JSON.stringify(sortJsonValue(argumentsValue))
}

/** The chain key and the duplicate-identity key are the same `(tool, canonical arguments)` pair. */
function callKey(name: string, argumentsValue: unknown): string {
  return JSON.stringify([name, canonicalize(argumentsValue)])
}

/** Compile one `*`-wildcard pattern to an anchored RegExp (every other regex metacharacter is matched literally). */
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`)
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
}

/**
 * Head-truncate the canonical arguments for quoting in the detailed reminder,
 * marking how much was omitted. Bounds only the model-visible text — the
 * chain key always uses the full canonical string.
 */
function previewArguments(canonical: string, cap: number): string {
  if (canonical.length <= cap) return canonical
  return `${canonical.slice(0, cap)}… (+${canonical.length - cap} more chars)`
}

/**
 * Validate `thresholds` per the fail-loud contract and return them sorted
 * ascending (the escalation rule reads `thresholds[0]` as the gentle tier, so
 * order is normalized here, once).
 */
function validateThresholds(values: number[]): number[] {
  if (values.length === 0) {
    throw new Error('repeat-tool-reminder: `thresholds` must not be empty')
  }
  for (const value of values) {
    if (!Number.isInteger(value) || value < 2) {
      throw new Error(`repeat-tool-reminder: invalid threshold ${value} — every threshold must be an integer >= 2`)
    }
  }
  if (new Set(values).size !== values.length) {
    throw new Error('repeat-tool-reminder: `thresholds` must not contain duplicates')
  }
  return [...values].sort((a, b) => a - b)
}

/** Validate `forceStopStreak` per the fail-loud contract: a non-negative integer, `0` disabling. */
function validateForceStopStreak(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`repeat-tool-reminder: invalid forceStopStreak ${value} — must be an integer >= 0 (0 disables the force stop)`)
  }
  return value
}

/**
 * Prepend the guard's context messages while preserving every downstream
 * context's source and metadata.
 */
function prependContext(ours: UserMessage[], theirs: UserMessage[] | undefined): UserMessage[] {
  return [...ours, ...theirs ?? []]
}

/** One agent's consecutive-repeat chain: the last tracked call's identity key and its run length. */
interface Chain {
  key: string
  count: number
}

/**
 * One same-step reuse record for the first execution of a `(tool, arguments)`
 * pair inside a step. `dispatch` settles with that execution's dispatch result
 * (rejecting with its scheduler failure), so an in-flight same-step duplicate
 * can reuse without racing the body; `final` is overwritten by the frozen
 * final outcome once `tools/result` fires, and later duplicates prefer it.
 */
interface ReuseRecord {
  token: ToolExecutionToken
  dispatch: PromiseWithResolvers<ToolExecutionResult>
  final?: ToolExecutionResult
}

/** One agent's same-step reuse table; replaced at every step start. */
interface StepReuse {
  results: Map<string, ReuseRecord>
}

/**
 * Install the guard's listeners.
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}; `thresholds` and `forceStopStreak`
 *   are re-checked fail-loud here.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery's .default() guarantees the fields are set after validation.
  const thresholds = validateThresholds(config.thresholds as number[])
  const thresholdSet = new Set(thresholds)
  const includePatterns = (config.include as string[]).map(wildcardToRegExp)
  const excludePatterns = (config.exclude as string[]).map(wildcardToRegExp)
  const argumentsPreviewChars = config.argumentsPreviewChars as number
  if (!Number.isInteger(argumentsPreviewChars) || argumentsPreviewChars < 1) {
    throw new Error(`repeat-tool-reminder: invalid argumentsPreviewChars ${argumentsPreviewChars} — must be an integer >= 1`)
  }
  const forceStopStreak = validateForceStopStreak(config.forceStopStreak as number)

  const chains = new WeakMap<Agent, Chain>()
  /** Executions whose result must carry the stop instruction, keyed at pre-execute time. */
  const pendingStop = new WeakMap<ToolExecution, UserMessage>()
  const stepReuse = new WeakMap<Agent, StepReuse>()

  /** Whether a tool participates in the chain (untracked calls are transparent: they neither count nor reset). */
  function tracked(toolName: string): boolean {
    if (includePatterns.length > 0 && !includePatterns.some(pattern => pattern.test(toolName))) return false
    return !excludePatterns.some(pattern => pattern.test(toolName))
  }

  /**
   * Decide the force stop for one attempt BEFORE its dispatch: peek the
   * would-be run length from the committed chain (pre-execute waterfalls run
   * sequentially in model order, so the peek matches the post-execute commit),
   * and at or above `forceStopStreak` mark the execution `concludeTurn` — the
   * loop's existing turn-termination interface, read when the registry
   * materializes this call's result — and remember the stop instruction for
   * the post-execute attachment. A denied or failed call at the threshold
   * cannot carry a successful conclusion, so the marker is harmless there and
   * every later repeat re-arms.
   *
   * Counting itself stays in post-execute (see {@link observe}): denied calls
   * flow through that waterfall structurally, which is what keeps a model
   * hammering a denied call inside the counted chain.
   */
  ctx.on('tools/pre-execute', async (exec, next) => {
    // A direct `ctx.tools.execute()` caller has no model to remind and no id
    // to key on; only agent-loop calls participate.
    if (exec.agent !== undefined && forceStopStreak > 0 && tracked(exec.name)) {
      const key = callKey(exec.name, exec.arguments)
      const chain = chains.get(exec.agent)
      const tentative = chain !== undefined && chain.key === key ? chain.count + 1 : 1
      if (tentative >= forceStopStreak) {
        // The registry hands listeners the live ToolRunContext behind the
        // readonly ToolExecution view; marking before dispatch is what puts
        // `concludesTurn` on THIS call's committed result.
        ;(exec as ToolRunContext).concludeTurn()
        pendingStop.set(exec, forceStopMessage(exec.name, tentative))
      }
    }
    return next()
  })

  /**
   * Advance the calling agent's chain for one attempt and return the reminder
   * to deliver, if this attempt's run length hits a configured threshold.
   * Counting happens here — in post-execute — because denied calls also flow
   * through this waterfall (`ToolRuntime.execute` routes a deny through the
   * same pipeline), and a model hammering a denied call is exactly the loop
   * worth breaking.
   */
  function observe(exec: ToolExecution): UserMessage | undefined {
    // A direct `ctx.tools.execute()` caller has no model to remind and no id
    // to key on; only agent-loop calls participate.
    if (!exec.agent) return undefined
    if (!tracked(exec.name)) return undefined
    const key = callKey(exec.name, exec.arguments)
    const chain = chains.get(exec.agent)
    const count = chain !== undefined && chain.key === key ? chain.count + 1 : 1
    chains.set(exec.agent, { key, count })
    if (!thresholdSet.has(count)) return undefined
    const text = count === thresholds[0]
      ? GENTLE_REMINDER
      : detailedReminder(exec.name, count, previewArguments(canonicalize(exec.arguments), argumentsPreviewChars))
    return createUserMessage({
      content: [{ type: 'text', text }],
      source: { ...PLUGIN_SOURCE, form: 'notice', summary: `${exec.name} × ${count}` },
    })
  }

  // Observe-and-enrich, never veto: count first (state advances regardless of
  // the downstream outcome), DELEGATE so a later listener can still block or
  // replace, then fold the reminder and any pending stop instruction onto
  // whatever came back — additionalContexts rides both decision variants, so
  // a blocked call still gets the nudge.
  ctx.on('tools/post-execute', async (exec, _result, next): Promise<PostToolDecision> => {
    const reminder = observe(exec)
    const stop = pendingStop.get(exec)
    pendingStop.delete(exec)
    const ours = stop !== undefined
      ? (reminder !== undefined ? [stop, reminder] : [stop])
      : (reminder !== undefined ? [reminder] : [])
    const downstream = await next()
    if (ours.length === 0) return downstream
    if (downstream.kind === 'block') {
      return { kind: 'block', feedback: downstream.feedback, additionalContexts: prependContext(ours, downstream.additionalContexts) }
    }
    return {
      ...downstream,
      additionalContexts: prependContext(ours, downstream.additionalContexts),
    }
  })

  // Same-step duplicate reuse at the execution entry: the FIRST dispatch of a
  // `(tool, arguments)` pair inside a step records its dispatch outcome and,
  // at `tools/result`, its frozen final outcome; every later exact duplicate
  // returns the recorded result without calling `next()`, so the body never
  // runs. Matching is exact canonical equality — near-variants, subsets, and
  // reorderings are distinct calls. The stop instruction and the duplicate
  // decision are independent: a duplicate still counts toward the repeat
  // chain (an attempt is an attempt), and a duplicate of the force-stop call
  // reuses the recorded result.
  ctx.on('tools/execute', async (exec: ToolDispatchExecution, next): Promise<ToolExecutionResult> => {
    if (exec.agent === undefined) return next()
    const reuse = stepReuse.get(exec.agent)
    if (reuse === undefined) return next()
    const key = callKey(exec.name, exec.arguments)
    const record = reuse.results.get(key)
    if (record === undefined) {
      const created: ReuseRecord = { token: exec.token, dispatch: Promise.withResolvers() }
      reuse.results.set(key, created)
      try {
        const result = await next()
        created.dispatch.resolve(result)
        return result
      } catch (error) {
        created.dispatch.reject(error)
        throw error
      }
    }
    // The frozen final outcome exists only after the first call committed, so
    // an in-flight duplicate reuses its dispatch result; `dispatch` rejects
    // exactly when the first call's scheduler failed, propagating the same
    // failure instead of fabricating a second outcome.
    const recorded = record.final ?? await record.dispatch.promise
    const note = createUserMessage({
      content: [{ type: 'text', text: DUPLICATE_NOTE }],
      source: { ...PLUGIN_SOURCE, form: 'notice', summary: `${exec.name} (duplicate reuse)` },
    })
    return { ...recorded, additionalContexts: [note, ...recorded.additionalContexts ?? []] }
  })

  // Record the authoritative frozen outcome for same-step reuse. Only the
  // first execution of a key writes (`token` identity); duplicates and
  // pipeline paths that never entered `tools/execute` (denials, aborts before
  // dispatch) find no record or a foreign token and leave the table alone.
  ctx.on('tools/result', (exec, result): undefined => {
    if (exec.agent === undefined) return
    const reuse = stepReuse.get(exec.agent)
    const record = reuse?.results.get(callKey(exec.name, exec.arguments))
    if (record !== undefined && record.token === exec.token) record.final = result
  })

  // A user interjection changes the context; repetition across it is not a
  // loop. Pure reset hook: always delegates (attaching nothing, vetoing
  // nothing). Every step also starts with an empty reuse table — "same step"
  // is exactly one step's window.
  ctx.on('agent/pre-step', ({ agent, messages }, next): Promise<PreStepDecision> => {
    if (messages.some(message => message.source.kind === 'user')) chains.delete(agent)
    stepReuse.set(agent, { results: new Map() })
    return next()
  })
}
