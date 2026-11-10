# Agent Note: WP1 loop hygiene — force stop, same-step dedup, and the turn tool-call budget

Status: implemented

English | [中文](2026-11-10-wp1-loop-hygiene.zh.md)

## Problem

A source-level comparison of sibling coding-agent harnesses ([the cross-harness parity program](../../proposed/feature/2026-11-08-cross-harness-parity-program.md), gaps G1) measured three loop-hygiene mechanisms this harness lacked. The repeat-tool-reminder guard injected reminders at consecutive same-argument counts 3, 5, and 8, but nothing force-stopped the turn, so a model that kept repeating past the ladder ran unbounded (bounded only by whatever the host did). Nothing reused a recorded result when one step contained an exact duplicate call, so a model emitting the same call twice in one assistant message paid a second real execution. No package enforced a per-turn tool-call budget, so tool calls or steering could extend a turn indefinitely.

## Decision

Three mechanisms close the gap. All deployment-varying values are validated `Config` fields; misconfiguration throws at plugin load.

**Force stop (`forceStopStreak`, default 12, `0` disables) lives in `repeat-tool-reminder`.** When the committed repeat chain reaches the streak, the guard marks the threshold call `concludeTurn` at `tools/pre-execute` — the loop's existing turn-termination interface, read when the registry materializes that call's result — and the pinned instruction `停止工具调用，改用文字总结当前进展与结论` rides the existing reminder channel (`additionalContexts`, delivered as an injected `user/message`). The loop therefore ends the turn through its ordinary conclusion path after the model has seen the instruction; no loop branch was added. Counting stays in post-execute, so denied calls keep counting structurally; a call denied or failed exactly at the streak cannot carry a successful conclusion, so every later repeat re-arms the force stop and the first successful commit at or after the streak ends the turn. The decision is made before dispatch (pre-execute waterfalls run sequentially in model order, so the pre-dispatch peek matches the committed count).

**Same-step duplicate reuse lives in `repeat-tool-reminder`.** Within one step — reset at every `agent/pre-step` — the first execution of a `(tool, canonical arguments)` pair records its dispatch outcome and, at `tools/result`, its frozen final outcome; an exact duplicate returns the recorded result from the `tools/execute` entry without calling the body, annotated with `duplicate of an earlier call in this step; recorded result reused` as injected context. Matching is exact structural equality through the chain's canonicalization: reordered objects are duplicates; near-variants, subsets, and different values execute normally. An in-flight duplicate reuses the first call's dispatch result instead of racing the body, and the first call's scheduler failure propagates rather than fabricating a second outcome. Duplicates still advance the repeat chain: an attempt is an attempt.

**Turn tool-call budget (`maxToolCallsPerTurn`, default 200, `0` disables) lives in `agent-loop`.** The scheduler admits at most that many model-issued calls per turn, counting calls another policy denied or cancellation skipped. A batch that crosses the budget is sliced: admitted calls run, unstarted calls are committed with `TOOL_CALL_BUDGET_EXHAUSTED` error results so replay stays valid, and a once-per-turn injected `agent-loop` context message names the exhausted budget to the model. The slice returns `concluded`, so the turn ends through the ordinary conclusion path once the notice is delivered; later over-budget steps skip their calls without repeating the notice. No new session event was needed — the notice is ordinary injected context, so model visibility and the durable log stay identical by construction. The budget is fixed at plugin start and deliberately outside the settings section; `agent-spine-demo` forwards the field so composed deployments can set it.

## Alternatives considered

**Block the threshold call instead of concluding the turn.** A post-execute `block` turns the result into an error and keeps the turn open — the model would face an error result and could keep calling, which is the loop the mechanism exists to break. Concluding via the existing `concludesTurn` interface ends the turn while still delivering the instruction.

**Count the chain in pre-execute.** Advancing the chain where the force stop is decided would remove the peek, but counting would then depend on listener order (a pre-execute listener that denies ahead of the guard would hide the call), while post-execute counting sees every deny structurally. The sequential pre-dispatch peek keeps both properties.

**Return the final result to an in-flight duplicate.** Waiting for the first call's `tools/result` before answering a racing duplicate deadlocks when the scheduler fails and skips finalize. The dispatch-result reuse resolves on the body's settle and accepts the narrow window where a later post-execute policy rewrites the outcome the duplicate saw.

**A new session event for the budget crossing.** The event would duplicate what an injected `user/message` already records; the injected-context channel is logged, source-attributed, and reconstructable, so a new `SessionEventMap` member would add surface without adding information.

**Hardcoded thresholds.** Rejected by the repository rule: every threshold is a validated `Config` field with a load-time check.

## Testing

- `packages/guard/repeat-tool-reminder/tests/repeat-tool-reminder.spec.ts` pins the force stop (mark, instruction, turn end, default streak of 12), `forceStopStreak: 0` keeping only the ladder, same-step dedup for exact and reordered arguments, non-dedup for different arguments and cross-step repeats, the parallel in-flight reuse, failure propagation to an in-flight duplicate, and the negative and fractional `forceStopStreak` rejections.
- `packages/core/agent-loop/tests/budget.spec.ts` pins the disabled budget, the mid-turn cut with committed skip results and the once-per-turn notice, the sticky close after the notice step, the parallel-batch slice, the direct-construction validation rejections, and the default of 200.
- The keyless headless scenarios `examples/headless-agent/tests/snapshots/loop-repeat/` and `examples/headless-agent/tests/snapshots/loop-budget/` replay 12 identical `todo_write` calls and a budget-4 five-call task through the assembled one-shot app, pinning the 3/5/8 ladder, the force-stop message, the budget event, and the text summary that closes each turn.

## Consequences

- A repeating model now faces a bounded escalation: reminders at 3/5/8, a force stop at 12, and at most 200 admitted calls per turn by default. The force stop costs the model one final request carrying the instruction; the budget costs one synthetic result per skipped call.
- Exact same-step duplicates stop paying a second execution, and the model can tell the reuse apart by the annotation. Programs in Code Mode get the same rule: a program calling one tool twice with identical arguments in one step reads the recorded result.
- The guard is no longer purely advisory: `forceStopStreak` is a bounded enforcement path, still config-scoped and still expressed through the loop's ordinary conclusion semantics rather than a veto.
- The rename-ledger rationale for the 2026-07-08 `repeat-tool-guard` → `repeat-tool-reminder` rename ("does not block or enforce a guard decision") described the plugin at rename time and predates this force stop; the name and the [archived reminder decision](../../archived/feature/2026-07-08-repeat-tool-guard.md) remain historical records.
