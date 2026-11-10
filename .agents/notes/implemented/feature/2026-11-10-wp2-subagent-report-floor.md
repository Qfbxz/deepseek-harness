# Agent Note: WP2 subagent report floor — bounded continuation for short child reports

Status: implemented

English | [中文](2026-11-10-wp2-subagent-report-floor.zh.md)

## Problem

The cross-harness parity program ([gaps G2](../../proposed/feature/2026-11-08-cross-harness-parity-program.md)) measured that delegation returned the child's final message unchecked: a subagent that answered a research or analysis task in one sentence handed that sentence to the parent as the delegation's whole result. The compared harness with the strongest record here (Kimi Code CLI, working copy `kimi/src/kimi_cli/subagents/runner.py`) forces one continuation round when a child's final reply is under 200 characters, demanding technical detail, findings, and everything the parent needs, and returns the longer message. This harness had no floor, so every short child report silently spent the parallel exploration the delegation tool exists for.

## Decision

The report floor lives in `tool-subagent`. All deployment-varying values are validated `Config` fields; misconfiguration throws at plugin load — through the Schemastery schema on the loader path and through `resolveReportFloor` on a direct `apply()` call.

**`minReportChars` (default 200, Unicode code points) and `floorContinuationAttempts` (default 1, `0` disables) gate the foreground one-shot result path** — the only path where this tool returns the child's report as the call's result: one-shot mode's foreground default, and continuable mode's explicit `run_in_background: false`. A `completed` report shorter than the floor costs up to `attempts` continuation round-trips; the longest collected report is what reaches the parent.

**The continuation channel is the child's own conversation, already published on the run.** `SubagentRun.localAgent` exposes the exact in-process child, and the demand is its next FIFO turn through the same `Agent.followup()` / `whenIdle()` / session-log read the one-shot driver uses for the initial prompt — no provider-interface change, no new loop branch, and no new `SessionEventMap` member: the demand is an ordinary logged user message in the child's durable session, and the parent sees only the final report as the tool result, so model visibility and the log stay identical by construction. The demand asks for one complete replacement report covering the technical details and implementation specifics, detailed findings and analysis, and everything important the delegating agent needs. A continuation turn that fails to run or does not end `completed` keeps the report collected so far and stops spending attempts — the floor is a quality lift over an already-`completed` delegation, and its failure must not fail the delegation. A run without a published local child (out-of-process providers) has no continuation channel and returns the report unchanged.

## Alternatives considered

**Applying the floor to the one-shot background job outcome.** Rejected for this change: the job's outcome mapping lives in the seam's `settleRun`, so injecting a floor-selected output would either duplicate that mapping or add a parameter to a seam helper. The background route has its own recovery story — the parent collects through `job_output` and can re-delegate.

**Applying the floor to continuable background children.** Rejected: the settlement notice is the continuation manager's delivery, fired at Activation teardown, and a short closing message there would mean either fighting that lifecycle or waking a settling child for another round. `send_message` is the existing model-facing continuation channel for those children.

**A provider capability flag gating the floor.** Rejected — it would change the subagent provider interface; `localAgent` presence already distinguishes the runs that can continue from the runs that cannot.

**A second fresh delegation seeded with the short answer.** Rejected: it answers a different child and pays a second full prompt to reconstruct context the first child already holds.

**Hardcoded thresholds.** Rejected by the repository rule: both values are validated `Config` fields with load-time checks.

## Testing

- `packages/subagent/tool-subagent/tests/report-floor.spec.ts` drives the real spawn provider and child loop with a scripted model: exactly one continuation for a short report with the longer result returned, no continuation for a long report, `floorContinuationAttempts: 0` keeping a short report, an unclean continuation discarding its partial text and stopping the budget, the attempt budget bounding repeated rounds with the longest result winning, a `localAgent: undefined` run keeping its short report, and load-time rejection of invalid values for both fields.
- The keyless headless scenarios `examples/headless-agent/tests/snapshots/subagent-floor-short/`, `subagent-floor-long/`, and `subagent-floor-disabled/` replay a foreground `subagent_fork` delegation through the assembled one-shot app, pinning the raised report in the parent stream, the single continuation demand in the child's persisted log, and the unchanged short report when the floor is off.

## Consequences

- Every in-process foreground delegation now has a report quality floor. The cost is one provider round trip per short report — prefill time on local engines — bounded by `floorContinuationAttempts` and settable to `0`.
- The floor counts Unicode code points, not estimated tokens: 200 code points carry more information in CJK than in Latin text, so the floor is conservative for CJK reports. A token-based floor belongs with the program's provider-declared token counter and is deferred there.
- Out-of-process providers (ACP) keep short reports unchanged; the skip is documented configuration behavior, not an error.
- The floor never downgrades a result: the returned report is the longest collected, and every failure path keeps the already-`completed` answer.
