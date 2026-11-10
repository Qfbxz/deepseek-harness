# Agent Note: WP8 session approval cache and prefix rules

Status: implemented

English | [中文](2026-11-10-wp8-approval-cache-prefix-rules.zh.md)

## Problem

[Gap G7, item W9](../../proposed/feature/2026-11-08-cross-harness-parity-program.md): [user-approval](../../../../packages/interaction/user-approval/src/index.ts) asked on every escalation. Codex caches approvals for the session and offers persistable command-prefix rules with explicit counterexamples — a `python3` prefix must never be persistable, and `rm` and heredoc shapes are named as forbidden. The proposal left the persistence scope (session memory versus across restart) as an open question.

## Decision

**The seam resolves repeat asks itself, under the `ask` policy and ahead of any answerer dispatch.** The session approval cache keys an ask by its normalized request shape — exact tool name plus canonical arguments (`approvalShapeKey`): strings trim and collapse whitespace runs, quoting, letter case, and array order stay significant, object member order does not, and `undefined` members drop like JSON. A shape approved once in a session resolves `allowed-once` without prompting again; `cacheMaxEntries` (default 512, non-negative integer, `0` disables, validated at construction) bounds each session's cache with oldest-entry eviction and refresh-on-hit. `persistPrefix(agent, toolName, tokens)` stores a tool-scoped rule that answers later asks for that tool whose `command` argument begins with exactly `tokens`.

**Forbidden shapes are a fixed safety invariant, refused at the write path.** A `persistPrefix` call is refused with an executable reason — and stores nothing — when its tokens contain a heredoc operator, contain a bare forbidden command anywhere (including behind value-taking fronts such as `timeout 10 rm`), resolve to no concrete command after the pass-through wrappers (`sudo`, `env` with assignments, `nohup`, `command`, `time`) are unwrapped, or resolve to a command extending a multi-character forbidden name (`python3.11`, `rmdir`; the single-letter `R` member never prefix-matches). `forbiddenPrefixReason` exposes the same verdict so answerers can filter the options they offer. The list is not a `Config` field: no deployment can widen it, because a persisted `python3 -c` rule would pre-approve arbitrary code.

**Scope: session memory only.** The cache and rules die with the process; cross-restart persistence stays a separate future decision (the proposal's open question), which also keeps the `SessionEventMap` unchanged — every resolved ask still appends its `approval/asked` + `approval/decided` audit pair, so replay shows every decision while nothing new enters the wire format. The dsh-tools executor now passes the call's parsed arguments on `ApprovalRequest`; an ask without them — the sandbox escalation channel, structurally — stays outside the cache and never matches a rule, so the service never auto-approves what it cannot see. The `'never'` policy still rejects deterministically ahead of both reducers.

## Alternatives considered

**Deriving arguments from the session log by `callId`.** Rejected: scanning the log for the streamed tool call is an indirect second source for data the asker already holds, and the audit event intentionally stays argument-free.

**Caching in the tools executor.** Rejected: the seam owns approval decisions — the `'never'` gate already lives inside `request()` precisely because listener order cannot be trusted to enforce policy — and an executor-side cache would not govern future non-tool askers.

**Durable prefix rules (a `SessionEventMap` member + replay fold).** Deferred with the scope decision: it would add a wire-format member and SDK expected-output churn for a grant lifetime the parity evidence does not require; session memory matches Codex's session-scoped cache.

**Config-gating the forbidden list.** Rejected as a misconfiguration-vector: "destructive shapes are never persistable" is a security invariant, and the repository rule keeps security invariants fixed.

## Testing

- `packages/interaction/user-approval/tests/approval-cache.spec.ts` pins the key-normalization classes (whitespace collapse, quoting/case/array-order significance, member-order indifference, tool-name sensitivity), cache behavior (hit without consultation plus the audited pair, rejection/cancel/unavailable non-caching, per-session isolation, eviction, LRU refresh, `0` disables, construction validation, `'never'` precedence, arguments-less bypass), and prefix rules (tool-scoped matching, token validation, duplicate idempotence, every forbidden form — bare forbidden tokens anywhere, heredocs, value-taking fronts, family spellings such as `python3.11`/`rmdir`, and wrapper-only rules — refused with nothing stored, session scoping, `'never'` precedence).
- The keyless snapshots (`examples/headless-agent/tests/wp8-approval-cache.snapshot.ts`) drive the assembled one-shot headless app: two identical `todo_write` calls produce two audited pairs but exactly one answerer consultation (the recorded consultation marker), and the prefix scenario persists `["echo"]` through the public API, answers the different-shaped `echo beta` without a prompt, and records the service's executable refusal of the forbidden `["rm","-rf"]` persistence before rejecting that ask so the command never executes.

## Consequences

- Same-shape work interrupts once per session; the durable audit stream stays complete, so replay and the invariant machinery see every resolved ask.
- The subsystem page's old "deliberately omits tool arguments" fact is replaced: `arguments` is present but serves only cache/rule matching — answerers still render the streamed call through `callId`.
- No bundled answerer surfaces an "always allow this prefix" option yet; `persistPrefix` is a public Consumer extension point and the README records the gap.
- The sandbox escalation channel keeps re-prompting by design; extending it with arguments is a separate decision.
- The config-catalog entry for the new `cacheMaxEntries` field was hand-applied (en/zh) per the WP2/WP4 precedent because the generator stays blocked by the pre-existing dshmarket breakage; it is pending machine re-check.
- Supersession check: a search of the active tree found no note owning approval caching or prefix rules; [approval-seam](2026-07-06-approval-seam.md) and [sandbox](2026-07-06-sandbox.md) remain current and untouched, and the [2026-11-08 program proposal](../../proposed/feature/2026-11-08-cross-harness-parity-program.md) remains the owning decision record for W9. This note resolves that proposal's approval-scope open question (session memory now, restart persistence deferred).
