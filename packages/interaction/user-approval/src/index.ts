/**
 * Service Definition for the approval capability seam, covering requests, cancellation, audit, per-session policy, and the
 * session-scoped interruption reducers (approval cache and persisted prefix rules). Missing answerers fail closed; grants
 * apply only to the requested action.
 * @module @deepseek-ai/dsh-user-approval
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type CallId } from '@deepseek-ai/dsh-llm'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import type { Scoped } from '@deepseek-ai/dsh-scope'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'

declare module '@deepseek-ai/cordis' {
  interface Context {
    approval: ApprovalService
  }

  interface Events {
    /**
     * Ask composed answerers for one decision. Return an outcome to claim the
     * request or call `next()`; failure yields the fail-closed default.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
     * @param req - the pending decision (agent, tool identity, reason, signal).
     * @mode waterfall
     */
    'approval/request'(this: Scoped<ApprovalService>, req: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * An approval question was put to the answerer chain — log-only audit
     * (like `hook/*`; NOT a surface event, carries no `surfaceOp`). `id` pairs
     * it with the `approval/decided` that always follows; `toolName` is the
     * tool the question is about, `callId` the exact tool call when the asker
     * had one, `reason` the asker's human-readable explanation (e.g. a hook's
     * permission-decision reason).
     */
    'approval/asked': {
      id: ApprovalRequestId
      toolName: string
      callId?: CallId
      reason?: string
    }
    /**
     * The outcome of a prior `approval/asked` (same `id`) — log-only audit.
     * Exactly one per ask, appended when the outcome is known: a decision, a
     * cancellation, or the fail-closed `'unavailable'`.
     */
    'approval/decided': {
      id: ApprovalRequestId
      outcome: ApprovalOutcome
    }
    /**
     * The session's approval policy was switched — log-only, durable,
     * replayable, never in the model transcript (the model learns the policy
     * from the runtime-context snapshot and live switch notices). The LAST
     * such event is the session's override ({@link effectiveApprovalPolicy}).
     * `source: 'delegation'` marks an override seeded into a child; an absent
     * source is a runtime switch.
     */
    'approval/policy': {
      policy: ApprovalPolicy
      /** Marks an override seeded into a child at delegation. */
      source?: 'delegation'
    }
  }
}

import { ApprovalRequestId } from './types.ts'
import type { ApprovalOutcome } from './types.ts'

export { ApprovalRequestId } from './types.ts'
export type { ApprovalOutcome } from './types.ts'

/** Every {@link ApprovalOutcome}, for runtime normalization of answerer returns. */
const OUTCOMES: readonly ApprovalOutcome[] = ['allowed-once', 'rejected', 'cancelled', 'unavailable']

/**
 * A session's approval policy — what happens to an {@link ApprovalService}
 * ask BEFORE any interactive answerer sees it:
 *
 * - `'ask'` (the default) — delegate to the composed answerers; with none
 *   composed the chain falls through to the fail-closed `'unavailable'`.
 * - `'never'` — never prompt anyone: every ask resolves `'rejected'`
 *   deterministically. The strict headless stance (CI, unattended runs) and
 *   the policy whose outcome is knowable without asking.
 */
export type ApprovalPolicy = 'ask' | 'never'

/** Every {@link ApprovalPolicy}, for option advertisement and runtime validation of untrusted policy strings. */
export const APPROVAL_POLICIES: readonly ApprovalPolicy[] = ['ask', 'never']

/** Model-facing statement for the deterministic `'never'` policy. */
const NEVER_SENTENCE = 'Approval prompts are disabled in this session: actions that require approval are rejected automatically — do not request sandbox escalation (do not set `sandbox_permissions`).'
/** Model-facing statement for an interactive policy that may still fail closed. */
const ASK_SENTENCE = 'Approval policy: ask. Operations that require approval may ask through the configured answerers; without an available answerer, the request fails closed.'

/**
 * The session's approval-policy override: the last `approval/policy` event in
 * the log, or undefined when the session never switched (callers apply the
 * plugin's configured default). The pure fold — resume needs no catch-up
 * machinery because replaying the log IS the state.
 * @param events - session events in log order (other event types are skipped).
 * @returns the policy of the last switch event, or undefined without one.
 */
export function effectiveApprovalPolicy(events: readonly SessionEvent[]): ApprovalPolicy | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.type === 'approval/policy') return event.data.policy
  }
  return undefined
}

/**
 * Whether the log currently sits inside an open turn (a `turn/start` not yet
 * closed by a `turn/end`) — the {@link ApprovalService.request} precondition.
 * The audit pair must be turn-enclosed: the turn is the durable log's
 * commit/replay boundary, so a bare event appended between turns is
 * indistinguishable from a crash tail and silently dropped on reload.
 */
function hasOpenTurn(events: readonly SessionEvent[]): boolean {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const type = (events[index] as SessionEvent).type
    if (type === 'turn/start') return true
    if (type === 'turn/end') return false
  }
  return false
}

/**
 * Append the sole durable representation of a session policy override. Invalid
 * values throw before the log changes; consumers fold the new value on each read.
 * @param session - the session the override belongs to.
 * @param policy - the policy in effect until the next switch.
 */
export function setApprovalPolicy(session: Session, policy: ApprovalPolicy): void {
  if (!APPROVAL_POLICIES.includes(policy)) {
    throw new TypeError('approval policy must be one of "ask" or "never"')
  }
  session.append('approval/policy', { policy })
}

/**
 * Canonical form of one argument value for approval-shape comparison.
 * Strings trim and collapse whitespace runs (`"cargo  test"` ≡
 * `"cargo test"`): spacing inside one argument is presentation, not payload.
 * Quotes and letter case stay significant (quoting and case can change what a
 * command does), array order stays significant (argv order is semantic), and
 * object member order does not (JSON members are unordered). `undefined`
 * members drop like JSON, so an absent member and an `undefined` member are
 * the same shape. Everything else — numbers, booleans, null, nested
 * structures — compares exactly.
 * @param value - the raw argument value to canonicalize.
 * @returns the canonical shape used by {@link approvalShapeKey}.
 */
function normalizeApprovalShape(value: unknown): unknown {
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ')
  if (Array.isArray(value)) return value.map(normalizeApprovalShape)
  if (value !== null && typeof value === 'object') {
    const members = Object.entries(value as Record<string, unknown>)
      .filter(([, member]) => member !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    return Object.fromEntries(members.map(([key, member]) => [key, normalizeApprovalShape(member)]))
  }
  return value
}

/**
 * The session approval cache's key for one ask: the exact tool name plus the
 * {@link normalizeApprovalShape canonical argument shape}, encoded as one
 * deterministic JSON string. Two asks share a cache entry exactly when the
 * tool name is equal and the normalized argument shapes are equal.
 * @param toolName - the tool the ask is about.
 * @param args - the ask's raw parsed arguments.
 * @returns the stable cache key string.
 */
export function approvalShapeKey(toolName: string, args: unknown): string {
  return JSON.stringify([toolName, normalizeApprovalShape(args)])
}

/** The `command` string member of an arguments object, or `undefined` when the arguments carry none. */
function commandArgumentOf(args: unknown): string | undefined {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return undefined
  const command = (args as Record<string, unknown>)['command']
  return typeof command === 'string' ? command : undefined
}

/**
 * Split one shell command into its whitespace-separated tokens for prefix
 * matching: trim, collapse runs like {@link normalizeApprovalShape}, drop
 * empties. Non-string input (arguments without a `command` member) yields no
 * tokens, so a prefix rule can never match it.
 * @param command - the raw command value from a request's arguments.
 * @returns the command's tokens in order.
 */
export function commandPrefixTokens(command: unknown): readonly string[] {
  if (typeof command !== 'string') return []
  return command.trim().split(/\s+/).filter(token => token.length > 0)
}

/**
 * Commands a prefix rule may never be persisted for. `rm` destroys without a
 * reviewing execution; the remaining names are general interpreters and
 * shells whose `-c`/stdin forms turn a standing prefix into pre-approved
 * arbitrary code. This list is a FIXED SAFETY INVARIANT, not a deployment
 * tunable: it is not a `Config` field and no configuration can widen it, so a
 * compromised or careless deployment cannot persist a `python3 -c` rule.
 */
const FORBIDDEN_PREFIX_TOKENS: readonly string[] = [
  'rm',
  'sh', 'bash', 'dash', 'zsh', 'fish', 'ksh', 'csh', 'tcsh',
  'python', 'python2', 'python3', 'pypy', 'pypy3',
  'node', 'deno', 'bun', 'perl', 'ruby', 'php', 'lua', 'osascript', 'jl', 'R',
  'pwsh', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'eval', 'exec',
]

/**
 * Wrapper tokens skipped when resolving which command a prefix rule would
 * actually stand for. Only pass-through wrappers belong here — their operand
 * IS the command — because `sudo rm …` is an `rm` rule and `env VAR=x
 * python3 …` is a `python3` rule. Value-taking fronts (`timeout 10 rm`,
 * `xargs rm`, `nice python3`) are covered by the bare-token check in
 * {@link forbiddenPrefixReason} instead, since their argument lists contain
 * the forbidden command as its own token. Fixed like the forbidden list
 * itself.
 */
const PREFIX_WRAPPER_TOKENS: readonly string[] = ['sudo', 'doas', 'env', 'nohup', 'command', 'time']

/** `NAME=value` environment assignment, which `env` consumes before its command. */
function isEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)
}

/**
 * The command a token list resolves to after skipping pass-through wrapper
 * tokens (and the `env`-style assignments between `env` and its command), or
 * `undefined` when nothing but wrappers remains.
 */
function effectiveLeadingToken(tokens: readonly string[]): string | undefined {
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index] as string
    if (token === 'env') {
      index += 1
      while (index < tokens.length && isEnvAssignment(tokens[index] as string)) index += 1
      continue
    }
    if (PREFIX_WRAPPER_TOKENS.includes(token)) {
      index += 1
      continue
    }
    return token
  }
  return undefined
}

/**
 * Why a token list may not become a persisted prefix rule, or `undefined`
 * when it is persistable. Answerers use this to filter the options they
 * offer; {@link ApprovalService.persistPrefix} enforces the same verdict at
 * the write path, so a rule can only enter the session through this check.
 *
 * The invariant covers four forms: a heredoc operator anywhere (the heredoc
 * body carries commands the prefix would not cover); a bare forbidden
 * command token anywhere, including behind value-taking fronts such as
 * `timeout 10 rm`; a rule that resolves to nothing but wrapper tokens (it
 * would stand for every wrapper invocation); and a resolved leading command
 * that extends a multi-character forbidden name (`python3.11`, `rmdir`),
 * because a standing rule for one spelling pre-approves the whole command
 * family (the single-letter `R` member never prefix-matches, or every
 * R-prefixed word would be refused).
 * @param tokens - the candidate rule's command tokens.
 * @returns the executable refusal reason, or `undefined` when persistable.
 */
export function forbiddenPrefixReason(tokens: readonly string[]): string | undefined {
  const heredocToken = tokens.find(token => token.startsWith('<<'))
  if (heredocToken !== undefined) {
    return `prefix rule [${tokens.join(' ')}] contains the heredoc operator ${JSON.stringify(heredocToken)}: the heredoc body carries commands the prefix would not cover, so heredoc shapes are never persistable — approve this call once instead`
  }
  const bareToken = tokens.find(token => FORBIDDEN_PREFIX_TOKENS.includes(token))
  if (bareToken !== undefined) {
    return `prefix rule [${tokens.join(' ')}] contains the forbidden command "${bareToken}": it cannot stand as a rule because it would pre-approve future invocations without review — approve each call individually`
  }
  const leading = effectiveLeadingToken(tokens)
  if (leading === undefined) {
    return `prefix rule [${tokens.join(' ')}] resolves to no concrete command: a wrapper-only rule would stand for every wrapper invocation, so it is never persistable — approve each call individually`
  }
  const family = FORBIDDEN_PREFIX_TOKENS.find(member => member.length >= 2 && leading.startsWith(member))
  if (family !== undefined) {
    return `prefix rule [${tokens.join(' ')}] resolves to the command "${leading}", in the "${family}" command family: such rules are never persistable because they would pre-approve future invocations without review — approve each call individually`
  }
  return undefined
}

/**
 * Readonly same-process permission question. `callId` links to an already
 * presented tool call, so arguments are not duplicated for PRESENTATION;
 * `arguments` rides along only for the service's session approval cache and
 * prefix-rule matching (an answerer renders the streamed call, never this
 * copy). An ask without `arguments` cannot hit the cache or a prefix rule —
 * the service refuses to auto-approve what it cannot see.
 */
export interface ApprovalRequest {
  /**
   * The agent on whose behalf the question is asked. Routes the question (a
   * UI answerer only answers for agents it owns) and receives the audit
   * events on its session log.
   */
  readonly agent: Agent
  /** The tool the question is about (presentation and audit). */
  readonly toolName: string
  /**
   * The exact tool call being decided, when the asker has one — lets a UI
   * attach the prompt to the tool call it already streamed.
   */
  readonly callId?: CallId
  /**
   * The call's parsed arguments, when the asker has them — the raw shape the
   * {@link approvalShapeKey} normalizes for the session approval cache and
   * that {@link ApprovalService.persistPrefix} prefix rules match against.
   * Omitting it keeps the ask cache-transparent and rule-invisible.
   */
  readonly arguments?: unknown
  /** The asker's human-readable explanation of WHY it is asking. */
  readonly reason?: string
  /**
   * Aborting withdraws the question: the request settles `'cancelled'`
   * immediately and a late answer from a still-pending answerer is discarded.
   */
  readonly signal?: AbortSignal
}

/** Plugin config. All optional — `static Config` supplies the defaults. */
export interface Config {
  /**
   * The deployment's default {@link ApprovalPolicy} for sessions without an
   * `approval/policy` override — `'ask'` delegates to the composed answerers
   * (fail-closed with none); `'never'` auto-rejects every ask without
   * prompting (the deterministic CI/unattended stance).
   */
  readonly policy?: ApprovalPolicy
  /**
   * Session approval-cache capacity (default 512): the maximum distinct
   * approved request shapes retained per session. When an ask's normalized
   * shape was already approved this session, the service resolves
   * `'allowed-once'` without consulting any answerer. `0` disables the cache
   * (every ask re-prompts). The forbidden-shape refusal for prefix rules is
   * NOT configurable — it is a fixed safety invariant.
   */
  readonly cacheMaxEntries?: number
}

/**
 * One persisted command-prefix rule: asks for `toolName` whose `command`
 * argument begins with exactly `tokens` resolve `'allowed-once'` without
 * consulting any answerer. Rules are tool-scoped so a rule granted for the
 * bash tool never silently governs another tool that happens to carry a
 * `command` string.
 */
interface PrefixRule {
  readonly toolName: string
  readonly tokens: readonly string[]
}

/**
 * Approval service that applies session policy before answerers and logs every
 * ask/outcome pair to the requesting session. Within the `'ask'` policy it
 * short-circuits the ask when a persisted prefix rule matches or when the
 * same normalized request shape was already approved this session, so a
 * repeated shape interrupts once. It exposes deterministic policy changes to
 * the model through the runtime-context snapshot and switch notices.
 */
export class ApprovalService extends Service {
  static Config: z<Config> = z.object({
    policy: z.union(['ask', 'never'] as const).default('ask'),
    cacheMaxEntries: z.number().default(512),
  })

  /** Validated cache capacity: `0` disables the cache entirely. */
  private readonly cacheMaxEntries: number

  /** Session-scoped approved-shape cache, insertion-ordered for eviction and refresh. */
  private readonly approvedShapes = new WeakMap<Session, Map<string, true>>()

  /** Session-scoped persisted prefix rules, keyed for exact-duplicate suppression. */
  private readonly prefixRules = new WeakMap<Session, Map<string, PrefixRule>>()

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'approval')
    const cacheMaxEntries = config.cacheMaxEntries ?? 512
    if (!Number.isInteger(cacheMaxEntries) || cacheMaxEntries < 0) {
      throw new TypeError('approval cacheMaxEntries must be a non-negative integer (0 disables the cache)')
    }
    this.cacheMaxEntries = cacheMaxEntries

    const effective = (agent: Agent): ApprovalPolicy => this.effectivePolicy(agent.session)

    // The complete current value travels after retained history, so switching
    // policy does not rewrite the stable system-prompt cache prefix.
    ctx.inject(['systemPrompt'], (scope: Context) => {
      scope.systemPrompt.context({
        name: 'approval:policy',
        order: 115,
        text: (context) => {
          const agent = context.agent
          // A bare assemble() (tests, diagnostics) has no session to state.
          if (agent === undefined) return ''
          const policy = effective(agent)
          return policy === 'never' ? NEVER_SENTENCE : ASK_SENTENCE
        },
      })
    })
  }

  /**
   * Switch one live agent's policy and queue the transition for its next model
   * step. Session initialization uses {@link setApprovalPolicy} directly
   * because there is no previously visible policy to change.
   * @param agent - the live agent whose policy is changing.
   * @param policy - the new effective policy.
   */
  setPolicy(agent: Agent, policy: ApprovalPolicy): void {
    const previous = this.effectivePolicy(agent.session)
    if (previous === policy) return
    setApprovalPolicy(agent.session, policy)
    agent.inject(createUserMessage({
      content: [{
        type: 'text',
        text: `The approval policy changed from "${previous}" to "${policy}" (changed by the user).`,
      }],
      source: { kind: 'plugin', plugin: 'user-approval' },
    }))
  }

  /**
   * Persist one command-prefix rule for the agent's session: later asks for
   * `toolName` whose `command` argument begins with exactly `tokens` resolve
   * `'allowed-once'` without consulting any answerer. Rules live in session
   * memory only — they do not survive restart — and an exact duplicate
   * persists as the same rule. The forbidden-shape refusal is unconditional:
   * `rm`, heredoc, and general-interpreter shapes (see
   * {@link forbiddenPrefixReason}) throw before any rule is stored, and the
   * check is not configurable because it is a fixed safety invariant.
   * @param agent - the agent whose session the rule governs.
   * @param toolName - the tool whose asks the rule may answer.
   * @param tokens - the exact leading command tokens, each a non-empty string.
   * @throws TypeError when `tokens` is empty or carries an empty/non-string token.
   * @throws Error with the {@link forbiddenPrefixReason} text when the shape is forbidden.
   */
  persistPrefix(agent: Agent, toolName: string, tokens: readonly string[]): void {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      throw new TypeError('a prefix rule needs at least one command token')
    }
    for (const token of tokens) {
      if (typeof token !== 'string' || token.trim().length === 0) {
        throw new TypeError('every prefix-rule token must be a non-empty string')
      }
    }
    const trimmed = tokens.map(token => token.trim())
    const forbidden = forbiddenPrefixReason(trimmed)
    if (forbidden !== undefined) throw new Error(forbidden)
    const rules = this.prefixRules.get(agent.session) ?? new Map<string, PrefixRule>()
    rules.set(JSON.stringify([toolName, trimmed]), { toolName, tokens: trimmed })
    this.prefixRules.set(agent.session, rules)
  }

  /**
   * Ask the composed answerers to decide one readonly same-process request.
   * The service borrows the request, agent, session, and live signal directly.
   * The request requires an open turn because the audit pair must be enclosed
   * by the durable log's commit/replay boundary; an idle ask rejects before
   * appending anything. Under the `'ask'` policy, a matching persisted prefix
   * rule or a shape already approved this session resolves `'allowed-once'`
   * without dispatching any answerer; otherwise the answerer phase always
   * produces an outcome: an aborted signal yields `'cancelled'`, a missing or
   * throwing answerer yields `'unavailable'` (fail closed), and a rogue
   * non-vocabulary return value is normalized to `'unavailable'`. A failure
   * that prevents either audit append from committing still rejects because
   * returning an unlogged decision would violate the pair. Session contains
   * post-commit observer failures, so an authoritative append cannot reject
   * the request or suppress its matching audit event.
   * @param req - the pending decision (agent, tool identity, arguments, reason, signal).
   * @returns the closed outcome; `'allowed-once'` is the only grant.
   * @throws when no turn is open or either audit event fails before the session
   *   append commit point.
   */
  async request(req: ApprovalRequest): Promise<ApprovalOutcome> {
    const session = req.agent.session
    if (!hasOpenTurn(session.events)) {
      throw new Error(
        'approval.request() outside an open turn: the approval/asked + approval/decided audit pair '
        + 'must be turn-enclosed (a bare event between turns is crash-tail garbage on reload). '
        + 'Ask from inside the turn that needs the decision.',
      )
    }
    const id = ApprovalRequestId(randomUUID())
    session.append('approval/asked', {
      id,
      toolName: req.toolName,
      ...req.callId !== undefined ? { callId: req.callId } : {},
      ...req.reason !== undefined ? { reason: req.reason } : {},
    })
    const outcome = await this.decide(req, session)
    if (outcome === 'allowed-once') this.recordApprovedShape(session, req)
    session.append('approval/decided', { id, outcome })
    return outcome
  }

  /**
   * The session's effective policy: its own `approval/policy` fold, else the
   * configured default (the schema already defaulted an omitted policy to
   * `'ask'`; the `??` only narrows the optional-input TYPE).
   * @param session - the exact accepted session whose policy applies.
   * @returns the policy every ask for this session resolves under right now.
   */
  private effectivePolicy(session: Session): ApprovalPolicy {
    return this.overrideOf(session) ?? this.config.policy ?? 'ask'
  }

  /**
   * Read the session override without applying the configured default.
   * @param session - session whose log supplies the override.
   * @returns the last logged policy, or `undefined` without one.
   */
  overrideOf(session: Session): ApprovalPolicy | undefined {
    return effectiveApprovalPolicy(session.events)
  }

  /**
   * Dispatch the waterfall, contained and raced against the request signal.
   * @param req - the borrowed public request.
   * @param session - the request agent's session used for policy lookup.
   * @returns the normalized closed outcome.
   */
  private async decide(req: ApprovalRequest, session: Session): Promise<ApprovalOutcome> {
    const signal = req.signal
    if (signal?.aborted) return 'cancelled'
    // The 'never' policy is decided HERE, before any dispatch: a listener
    // registered with `prepend: true` after this service mounts would sit
    // ahead of any gate LISTENER, so a listener-shaped gate cannot keep the
    // documented promise that 'never' rejects deterministically regardless
    // of registration order — only the service's own request path can.
    if (this.effectivePolicy(session) === 'never') return 'rejected'
    // A standing prefix rule or an already-approved shape IS the session's
    // answer: like the 'never' gate above, the short-circuit lives inside
    // request() so no listener order can bypass it. The audit pair around
    // this outcome still lands, so replay shows every resolved ask.
    if (this.prefixAllows(session, req)) return 'allowed-once'
    if (this.shapeWasApproved(session, req)) return 'allowed-once'
    // Enter the promise chain BEFORE dispatching: a listener that throws
    // SYNCHRONOUSLY (before its first await) must land in the same rejection
    // path as an async one — `Promise.resolve(call())` would let it escape
    // the containment into the caller.
    const answer: Promise<ApprovalOutcome> = Promise.resolve().then(
      () => this.ctx.waterfall(
        scopeTarget(this, req.agent), 'approval/request', req,
        () => Promise.resolve<ApprovalOutcome>('unavailable'),
      ),
    ).then(
      // Normalize a rogue (non-vocabulary) answerer return to the fail-closed
      // outcome instead of leaking it into callers' closed-union switches.
      outcome => OUTCOMES.includes(outcome) ? outcome : 'unavailable',
      // A throwing answerer must fail the QUESTION closed, not the caller's
      // tool call open — the seam contains its callbacks.
      () => 'unavailable',
    )
    if (signal === undefined) return answer
    return await new Promise<ApprovalOutcome>((resolve) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort)
        resolve('cancelled')
      }
      signal.addEventListener('abort', onAbort, { once: true })
      void answer.then((outcome) => {
        signal.removeEventListener('abort', onAbort)
        // After an abort won the race this resolve is a settled-promise no-op:
        // the late answer is discarded by construction.
        resolve(outcome)
      })
    })
  }

  /**
   * Whether a persisted prefix rule answers this request: the rule's tool
   * matches, the arguments carry a `command` string, and the command begins
   * with exactly the rule's tokens. Requests without arguments never match —
   * the service refuses to auto-approve what it cannot see.
   */
  private prefixAllows(session: Session, req: ApprovalRequest): boolean {
    if (req.arguments === undefined) return false
    const rules = this.prefixRules.get(session)
    if (rules === undefined) return false
    const tokens = commandPrefixTokens(commandArgumentOf(req.arguments))
    if (tokens.length === 0) return false
    for (const rule of rules.values()) {
      if (rule.toolName !== req.toolName) continue
      if (rule.tokens.every((token, index) => tokens[index] === token)) return true
    }
    return false
  }

  /**
   * Whether this exact normalized shape was already approved in the session.
   * Asks without arguments stay outside the cache, so structurally blind
   * askers (for example the sandbox escalation channel) can never inherit an
   * approval from a different concrete call.
   */
  private shapeWasApproved(session: Session, req: ApprovalRequest): boolean {
    if (this.cacheMaxEntries === 0 || req.arguments === undefined) return false
    return this.approvedShapes.get(session)?.has(approvalShapeKey(req.toolName, req.arguments)) ?? false
  }

  /**
   * Record one approved shape for the session cache (called only for
   * `'allowed-once'` outcomes). Refreshing an existing entry moves it to the
   * newest position; beyond {@link Config.cacheMaxEntries} the oldest entry
   * is evicted.
   */
  private recordApprovedShape(session: Session, req: ApprovalRequest): void {
    if (this.cacheMaxEntries === 0 || req.arguments === undefined) return
    const key = approvalShapeKey(req.toolName, req.arguments)
    let entries = this.approvedShapes.get(session)
    if (entries === undefined) {
      entries = new Map()
      this.approvedShapes.set(session, entries)
    }
    entries.delete(key)
    entries.set(key, true)
    while (entries.size > this.cacheMaxEntries) {
      const oldest = entries.keys().next()
      /* v8 ignore next 3 -- a size above a positive capacity implies a non-empty map */
      if (oldest.done === true) break
      entries.delete(oldest.value)
    }
  }
}

export default ApprovalService
