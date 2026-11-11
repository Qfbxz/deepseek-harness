# Agent Note: Subagent-parallel twin replay determinism

Status: implemented

English | [中文](2026-11-10-subagent-parallel-twin-replay.zh.md)

## Problem

The authored `subagent-parallel` snapshot scenario failed intermittently across runs. Its golden pinned a crossed completion record — the result for the first parent call carrying `BETA` and the second carrying `ALPHA` — which the replay run reproduced only when two concurrent scheduling races landed the way the golden had recorded them:

- **`dsh-llm-replay` binds child scripts by first-call order** (the [subagent-snapshot-replay note](2026-06-22-subagent-snapshot-replay.md)). Two subagents delegated from one assistant step race for the first model call, so either live child could claim the script recorded for the other. `loadSessionScripts` orders the recorded child scripts deterministically (header `createdAt`, then id), but the live binding order is event-loop timing (`XXX(concurrent-subagents)`).
- **The harvester orders children by `createdAt`.** Two children created in the same millisecond tie, and the tiebreak compares freshly random session ids (`a.id.localeCompare(b.id)`), so which produced log lands at fixture position 1 versus 2 is a coin flip.

The WP6 era made the two delegations distinct (`ALPHA` vs `BETA`) to keep the [same-step duplicate reuse](../feature/2026-11-10-wp6-methodology-prompt.md) from collapsing them into one child. Distinct delegations made both races observable: with crossed binding the parent's first call received the other child's answer, and with a swapped harvest order the child fixtures compared against each other's content. The scenario was green only when both races reproduced the recorded orientation.

## Decision

Restore the twin contract the [parallel-delegations note](../feature/2026-08-09-parallel-subagent-delegations.md) prescribes — only interchangeable twins replay race-free — while still spawning two live children:

- **The two delegations are byte-identical twins** (`description`, `prompt`, and an explicit `run_in_background: false`). Explicit is required, not stylistic: the acp-agent composition runs the delegation tool with `backgroundMode: continuable`, so an omitted `run_in_background` defaults to a background continuable child that returns a durable id instead of its result.
- **The scenario boots a dedicated overlay** (`subagent-parallel.cordis.yml` and its `*cordis.snapshot.yml` replay counterpart) that disables the `repeat-tool-reminder` guard for this scenario only. That guard's same-step duplicate reuse serves an exact `(tool, canonical arguments)` duplicate from the first call's recorded result, so byte-identical twins would otherwise collapse back to one child. The guard injects no system-prompt section and registers no tools, so the overlay composes the default header class byte-for-byte and stays under text-turn's pin.
- **Determinism does the rest.** The agent-loop scheduler commits parallel tool results in model order, so the parent log is `tool/call, tool/call, tool/result, tool/result` with both results `BETA` regardless of which child settles first. The children's transcripts are identical except normalized-away values (session ids, message UUIDs, timestamps), so both the binding race and the harvest order race became unobservable.

The golden was re-recorded through `DSH_SNAPSHOT=refresh` (keyless replay write-back) with the committed header identities, event times, and message UUIDs restored by position afterwards, so the diff carries only the intended semantic change.

## Alternatives considered

**Force a stable completion order through script length or pacing.** Rejected: binding happens at the first model call, before any script length can matter, and the harvest tiebreak is random session ids. Pacing changes which child finishes first, not which child binds which script.

**Order-independent assertions for the two child logs.** Rejected: the shared suite compares each harvested log against its fixture by position. Reordering or set-comparing two rows for one scenario is a scenario-specific normalizer in shared test infrastructure and blurs what the positional comparison proves for every other scenario.

**Fix the infrastructure: an explicit first-call ordinal in `dsh-llm-replay` plus a deterministic harvest tiebreak.** The real cure named by `XXX(concurrent-subagents)`, but it is shared replay/harness behavior every scenario depends on, far beyond a scenario stability repair. Deferred until a scenario genuinely needs distinct concurrent children; until then the twin contract is the documented rule.

## Consequences

- The scenario still exercises two live parallel children in one step and still proves the assembled app's `tool/call, tool/call, tool/result, tool/result` parent transcript and `PARENT_DONE` reply. It can no longer prove which parent call received which child's answer — that mapping is inherently nondeterministic under replay binding.
- Twin child messages are fingerprint-ambiguous, so `stabilizeFixtureMessageIds` cannot carry their committed UUIDs through a refresh: any future `DSH_SNAPSHOT=refresh` re-randomizes the twin children's message ids. Comparisons stay green because the normalizer scrubs every UUID, but byte-stable ids require the same positional restore the re-record used.
- The repeat guard keeps full coverage in its dedicated `repeat-tool-reminder` scenario; this overlay disables it for one composition only, and the header-uniformity guard live-verifies that the overlay still composes the pinned default header.
