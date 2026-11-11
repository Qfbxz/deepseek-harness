# 用户审批

[English](approval.md) | 中文

[dsh-user-approval](../../packages/interaction/user-approval) 的用户审批 seam 回答一个问题：这个具体操作是否可以继续？它拥有共享的请求/结果词汇、`ctx.approval` 分发服务、`approval/request` 应答者 waterfall（瀑布式事件）、仅记录日志的审计事件对，以及按会话的 `ask`/`never` 策略。UI 通道可以提供人类应答者；[ACP（Agent Client Protocol）自动化桥接层](../../packages/acp/acp)为其拥有的 agent（智能体）提供一次性机器决策。调用方如 [dsh-tools](../../packages/core/tools) 和 [dsh-tool-bash](../../packages/shell/tool-bash) 消费闭合的结果，除非结果为 `allowed-once`，否则一律拒绝。

源码：[`packages/interaction/user-approval/src/index.ts`](../../packages/interaction/user-approval/src/index.ts)

## 标识与结果

每个请求都会获得一个全新的 `ApprovalRequestId`。该品牌类型将 `approval/asked` 与 `approval/decided` 审计事件配对，同时不会让审批 id 与工具调用 id 或 agent/会话 id 互换。

```ts type-equiv
/**
 * Pairs one `approval/asked` audit event with its `approval/decided`.
 * Service-issued (one fresh id per {@link ApprovalService.request} call).
 */
type ApprovalRequestId = Branded<'ApprovalRequestId'>
```

`ApprovalOutcome` 是闭合的，且失败时拒绝。`allowed-once` 仅授权所询问的那一个操作；调用方对 `rejected`、`cancelled` 和 `unavailable` 均执行拒绝。缺失、不负责该请求、抛异常或不合规的应答者会产生 `unavailable`，而非放行。

```ts type-equiv
/**
 * Closed approval outcomes: a one-shot grant, explicit rejection, withdrawn
 * request, or unavailable answerer. Callers fail closed on `unavailable`.
 */
type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
```

## 按会话策略

`ApprovalPolicy` 决定在交互式应答者运行之前发生什么。`ask` 委托给组合的应答者链，链的无应答默认值为 `unavailable`；`never` 确定性地返回 `rejected`，不分发任何应答者。生效值为会话日志中最后一条 `approval/policy` 事件，回退到服务配置。`setApprovalPolicy(session, policy)` 是唯一的写入路径，因此回放能重建覆盖值。

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

两种策略都会将各自完整的当前含义贡献给缓存安全的运行时上下文快照。带来源的 `user/message` 是持久化且模型可见的输入；审批状态变化时，会在保留的历史后追加一份新的完整快照，而不改写请求头中的系统提示词。

## 审批请求

`ApprovalRequest` 以足够精确的方式标识 agent 和工具操作，以便路由和审计该问题。`callId` 让应答者把提示附加到已流式输出的工具调用上，而非渲染另一份可能漂移的副本；`arguments` 只服务于服务自身的缓存与前缀规则匹配，不带它的请求对两者都不可见。

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

## 会话审批缓存与前缀规则

在 `ask` 策略下，服务会在分发任何应答者之前自行解析一部分请求。会话审批缓存按归一化请求形态为请求建键——精确工具名加上规范化参数：字符串去除首尾空白并折叠连续空白，引号、大小写与数组顺序保持敏感，对象成员顺序不敏感，`undefined` 成员按 JSON 语义丢弃。同一形态在会话内获批一次后，后续请求直接以 `allowed-once` 解析，不再提示；`cacheMaxEntries` 按会话限制缓存容量，`0` 关闭缓存。`persistPrefix(agent, toolName, tokens)` 存储更窄的授权：该工具后续 `command` 参数恰好以 `tokens` 开头的请求由规则直接应答。遇到禁止形态的持久化请求会抛出且不落任何规则：token 含 heredoc 操作符、任何位置含裸的禁止命令（包括 `timeout 10 rm` 一类带值前置形态）、剥离直通包装命令后未解析出具体命令、或解析出的命令是多字符禁止名的扩展（`python3.11`、`rmdir`）时都会拒绝；禁止清单是固定安全不变量，任何配置都无法放宽。规则只存于会话内存，不跨重启；不带 `arguments` 的请求（例如沙箱提权通道）在缓存之外、也永不匹配规则；`never` 策略仍在两者之前确定性地拒绝。

## 分发与审计

`ctx.approval.request(req)` 要求发起请求的会话处于一个尚未结束的轮次内。它追加 `approval/asked`，获取一个结果，追加对应的 `approval/decided`，然后以该结果完成。`never` 策略在服务内部、waterfall 分发之前强制执行，因此即使后来以 `prepend` 注册的应答者也无法绕过它。应答者在负责处理该请求时返回结果，否则调用 `next()` 委托；第一个应答占据唯一的决策槽位。

审计事件仅写入日志，不进入模型 transcript（文本记录）。模型可见的行为是调用方派生的工具结果与当前运行时上下文快照。服务 dispose（资源释放）时会移除其上下文贡献；应答者监听器独立地通过 effect 绑定到其所属插件。

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
