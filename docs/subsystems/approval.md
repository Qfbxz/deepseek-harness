# User Approval

English | [中文](approval.zh.md)

The user-approval seam of [dsh-user-approval](../../packages/interaction/user-approval) answers one question: may this specific action proceed? It owns the shared request/outcome vocabulary, the `ctx.approval` dispatch service, the `approval/request` answerer waterfall, the log-only audit pair, and the per-session `ask`/`never` policy. UI channels may provide human answerers; the [ACP automation bridge](../../packages/acp/acp) provides one-shot machine decisions for its own agents. Callers such as [dsh-tools](../../packages/core/tools) and [dsh-tool-bash](../../packages/shell/tool-bash) consume the closed outcome and fail closed unless it is `allowed-once`.

Source: [`packages/interaction/user-approval/src/index.ts`](../../packages/interaction/user-approval/src/index.ts)

## Identity and outcome

Every request receives a fresh `ApprovalRequestId`. The brand pairs the `approval/asked` and `approval/decided` audit events without making approval ids interchangeable with tool-call or agent/session ids.

```ts type-equiv
/**
 * Pairs one `approval/asked` audit event with its `approval/decided`.
 * Service-issued (one fresh id per {@link ApprovalService.request} call).
 */
type ApprovalRequestId = Branded<'ApprovalRequestId'>
```

`ApprovalOutcome` is closed and fail-closed. `allowed-once` grants only the asked-about action; callers deny on `rejected`, `cancelled`, and `unavailable`. A missing, non-owning, throwing, or non-conforming answerer becomes `unavailable` rather than opening the gate.

```ts type-equiv
/**
 * Closed approval outcomes: a one-shot grant, explicit rejection, withdrawn
 * request, or unavailable answerer. Callers fail closed on `unavailable`.
 */
type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
```

## Per-session policy

`ApprovalPolicy` determines what happens before interactive answerers run. `ask` delegates to the composed answerer chain, whose no-answer default is `unavailable`; `never` deterministically returns `rejected` without dispatching any answerer. The effective value is the last `approval/policy` event in the session log, falling back to the service config. `setApprovalPolicy(session, policy)` is the single write path, so replay reconstructs the override.

```ts type-equiv
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
type ApprovalPolicy = 'ask' | 'never'
```

Both policies contribute their complete current meaning to the cache-safe runtime-context snapshot. The sourced `user/message` is the durable model-visible input; changing approval state appends a new full snapshot after retained history without rewriting the request header's system prompt.

## Approval request

`ApprovalRequest` identifies the agent and tool action closely enough to route and audit the question. `callId` lets an answerer attach the prompt to the already-streamed tool call instead of rendering a second copy that could drift; `arguments` rides along only for the service's own cache and prefix-rule matching, and an ask without it stays outside both.

```ts type-equiv
/**
 * Readonly same-process permission question. `callId` links to an already
 * presented tool call, so arguments are not duplicated for PRESENTATION;
 * `arguments` rides along only for the service's session approval cache and
 * prefix-rule matching (an answerer renders the streamed call, never this
 * copy). An ask without `arguments` cannot hit the cache or a prefix rule —
 * the service refuses to auto-approve what it cannot see.
 */
interface ApprovalRequest {
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
```

## Session approval cache and prefix rules

Under the `ask` policy the service resolves some asks itself before dispatching any answerer. The session approval cache keys an ask by its normalized request shape — exact tool name plus canonical arguments, where strings trim and collapse whitespace runs, quoting, letter case, and array order stay significant, object member order does not, and `undefined` members drop like JSON. A shape approved once in a session resolves `allowed-once` without prompting again; `cacheMaxEntries` bounds the cache per session and `0` disables it. `persistPrefix(agent, toolName, tokens)` stores a narrower grant that answers later asks for that tool whose `command` argument begins with exactly `tokens`. A persistence request for a forbidden shape throws and stores nothing: the refusal fires when the tokens contain a heredoc operator, contain a bare forbidden command anywhere (including behind value-taking fronts such as `timeout 10 rm`), resolve to no concrete command after the pass-through wrappers are unwrapped, or resolve to a command extending a multi-character forbidden name (`python3.11`, `rmdir`); the forbidden list is a fixed safety invariant no configuration can widen. Rules live in session memory and do not survive restart; asks without `arguments` — the sandbox escalation channel, for example — stay outside the cache and never match a rule, and the `never` policy still rejects deterministically ahead of both.

## Dispatch and audit

`ctx.approval.request(req)` requires the requesting session to be inside an open turn. It appends `approval/asked`, obtains one outcome, appends the matching `approval/decided`, and resolves with that outcome. The `never` policy is enforced inside the service before waterfall dispatch, so even an answerer registered later with `prepend` cannot bypass it. Answerers return an outcome when they own the request or call `next()` to delegate; the first answer occupies the single decision slot.

The audit events are log-only and do not enter the model transcript. Model-visible behavior is the caller's derived tool result plus the current runtime-context snapshot. Service disposal removes its context contribution; answerer listeners are independently effect-bound to their owning plugins.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxapproval--approvalservice"></a>

### `ctx.approval` — `ApprovalService`

Approval service that applies session policy before answerers and logs every ask/outcome pair to the requesting session. Within the `'ask'` policy it short-circuits the ask when a persisted prefix rule matches or when the same normalized request shape was already approved this session, so a repeated shape interrupts once. It exposes deterministic policy changes to the model through the runtime-context snapshot and switch notices.

```ts cordis-catalog
/**
 * Switch one live agent's policy and queue the transition for its next model
 * step. Session initialization uses {@link setApprovalPolicy} directly
 * because there is no previously visible policy to change.
 * @param agent - the live agent whose policy is changing.
 * @param policy - the new effective policy.
 */
setPolicy(agent: Agent, policy: ApprovalPolicy): void

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
persistPrefix(agent: Agent, toolName: string, tokens: readonly string[]): void

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
async request(req: ApprovalRequest): Promise<ApprovalOutcome>

/**
 * Read the session override without applying the configured default.
 * @param session - session whose log supplies the override.
 * @returns the last logged policy, or `undefined` without one.
 */
overrideOf(session: Session): ApprovalPolicy | undefined
```

Types: [Agent](core.md) · [Session](session.md)

Source: [`packages/interaction/user-approval/src/index.ts:380`](../../packages/interaction/user-approval/src/index.ts)

<a id="approval-events"></a>

### `approval/*` events

<a id="approvalrequest--waterfall"></a>

#### `approval/request` — waterfall

Ask composed answerers for one decision. Return an outcome to claim the request or call `next()`; failure yields the fail-closed default. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.

```ts cordis-catalog
/**
 * Ask composed answerers for one decision. Return an outcome to claim the
 * request or call `next()`; failure yields the fail-closed default.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @param req - the pending decision (agent, tool identity, reason, signal).
 * @mode waterfall
 */
'approval/request'(this: Scoped<ApprovalService>, req: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>
```

Types: [Scoped](scope.md)

Source: [`packages/interaction/user-approval/src/index.ts:31`](../../packages/interaction/user-approval/src/index.ts)
<!-- END GENERATED cordis-surface -->
