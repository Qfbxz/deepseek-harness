# Agent Note: WP4 compaction retention priority and consecutive-failure breaker

Status: implemented

English | [中文](2026-11-10-wp4-compaction-priority-and-breaker.zh.md)

## Problem

The cross-harness parity program ([gap G4](../../proposed/feature/2026-11-08-cross-harness-parity-program.md)) measured two compaction gaps in `dsh-compaction-basic`. The summarizer emitted a sectioned checkpoint whose sections carry no keep-priority ranking, so a forced shrink had no rule for what to drop first; Kimi ranks six retention levels and gives each section KEEP/MERGE/REMOVE rules. And a failing summarizer retried forever: every automatic attempt warned and continued, so a dead summarization endpoint turned into an unbounded failure loop on every step — the comparison cites a Claude Code comment recording 3,272 consecutive compaction failures in one session, stopped by a breaker after 3.

## Decision

**The compaction instruction now ranks retention and gives every section shrink rules, without changing the checkpoint's section structure.** The instruction — the final user message of the auxiliary summary call — gained one retention-priority ranking, current task state (`## Current Work`, `## Next Step`, `## Pending Jobs`), then errors and fixes, then files and code (`## Files and Code`, `## Key Technical Concepts`), then user messages (`## Primary Request and Intent`), then earlier history (`## Critical Context`), plus one MUST KEEP / MERGE / REMOVE line per section and a rule that higher-ranked content is never dropped to preserve lower-ranked content. Every section header, section order, and the framing tags are untouched, so existing checkpoints and their consumers stay compatible.

**Automatic compaction now stops after `maxConsecutiveFailures` (default 3) consecutive failed attempts, per session.** The breaker counts failures of the one automatic entry point, `compactIfNeeded`, so both trigger paths — step-boundary pressure through `agent/pre-step` and overflow recovery through `agent/request-error` — feed the same streak. On the Nth consecutive failure the engine logs an error naming the breaker, the count, the recovery path, and the last failure; from then on every automatic attempt for that session returns `null` without attempting, so the Nth failure is the last attempt. The session stays usable: the pressure listener keeps admitting steps, overflow recovery keeps preserving the original provider error, and user input flows.

Counting semantics, pinned by tests:

- A failure is a thrown `compactIfNeeded` attempt that is neither a `TargetPressureConfigError` (load-time misconfiguration with its own once-per-target warning; it cannot succeed by retrying) nor a loss the cancellation signal already won (user intent, not a compaction failure).
- The count is per `Session` on the engine, so one broken session does not stop compaction for siblings sharing the engine.
- Any successful compaction transaction on the session clears the count: automatic pressure or overflow success through `compactRegion`, or a successful manual `compactNow()`. A `null` result (nothing needed, or pruning alone cleared pressure) neither counts nor resets.
- `maxConsecutiveFailures: 0` disables the breaker: automatic compaction is attempted on every trigger regardless of earlier failures. The value is a validated `Config` field — Schemastery `z.number().step(1).min(0)` on the loader path, `resolveConfig` non-negative-integer validation on direct apply — and every other value fails plugin load.

**Manual compaction is deliberately outside the breaker.** `compactNow()` does not consult the streak and its failures do not advance it — a manual attempt is a user-driven action that surfaces its own `ManualCompactionError` — but a committed manual transaction clears the streak, which is the documented recovery path for a tripped session without restarting it.

## Alternatives considered

**A literal throw at the trip on the pressure path.** Rejected — the pre-step listener deliberately catches operational failures so a compaction problem never blocks the turn; throwing would end the step and violate the session-stays-usable requirement. The visible error is the error-level log plus the durable `compaction/end` error record each failure already leaves; overflow recovery additionally keeps surfacing the original provider error.

**Resetting the streak only on automatic success.** Rejected — with the breaker tripped, automatic compaction never runs, so an automatic-only reset would make the trip permanent for the session lifetime. A successful manual compaction proves the summarizer works again and is the natural self-heal.

**Counting manual failures too.** Rejected — manual failures surface directly to the user who triggered them, and counting them would let a user experiment trip the automatic breaker.

**Per-model `maxConsecutiveFailures` overrides in `modelPolicies`.** Rejected — the breaker guards the summarizer, which may route to a different provider than the conversation; a session-scoped top-level value matches the per-session counting semantics without a second merge path.

**Ranking sections by reordering or trimming them.** Rejected — the eight-section checkpoint structure is consumed downstream and pinned by snapshots; the ranking plus per-section directives teach the shrink rule without moving anything.

## Testing

- `packages/compaction/compaction-basic/tests/compaction-basic.spec.ts` pins the trip at exactly the configured N (and at the shipped default 3), the single trip error naming breaker, limit, and recovery path, the no-fourth-attempt gate on both trigger paths through the real listeners, the reset on automatic and manual success, the manual exemption (manual failures stay outside the streak), `maxConsecutiveFailures: 0`, cancellation and target-configuration exclusions, the config-validation table, and the resolved default.
- `packages/compaction/compaction-basic/tests/snapshots/compaction-instruction.snapshot.txt` pins the full instruction text verbatim.
- The keyless headless scenarios `examples/headless-agent/tests/snapshots/compaction-breaker/` and `.../compaction-priority/` replay through the assembled one-shot app: the breaker transcript pins three failed brackets, zero summaries, the fourth tool step without an attempt, and the completed turn; the priority transcript's checkpoint echoes fragments of the live instruction back through `{{fromRequest:…}}` placeholders, which fail the replay loudly if the assembled request stopped carrying the ranking or the directives.

## Consequences

- A dead summarization endpoint now costs at most `maxConsecutiveFailures` attempts per session instead of one failure per step for the session's lifetime, and the stop is visible instead of a warn-per-step stream.
- The trip leaves the session without automatic pressure relief: an over-budget session keeps over-budget until a manual `compactNow()` succeeds or the session ends. That is the trade the breaker exists for — the alternative was an unbounded retry loop.
- The instruction grew by the ranking block and eight directive lines, a small fixed cost on every auxiliary summary call's uncached suffix.
- `recallable-compaction` stays the owner of rollback, in-session history recall, and cache-aware chunking; none of that moved here. [Queued manual compaction](2026-07-30-queued-manual-compaction.md) keeps owning the manual compaction lifecycle; this note only adds the breaker exemption and the manual-success reset to its caller contract.
