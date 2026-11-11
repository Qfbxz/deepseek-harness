# Agent Note: Cross-harness parity program — loop hygiene, subagent fidelity, and context honesty

Status: proposed

English | [中文](2026-11-08-cross-harness-parity-program.zh.md)

## Problem

A source-level comparison of four sibling coding-agent harnesses (Kimi Code CLI, Claude Code, Codex, and the Strata host that wraps this repository) measured seven gaps where this harness lacks the strongest mechanism in that set. The full evidence table lives in [docs/research/AGENT_HARNESS_COMPARISON.md](../../../../docs/research/AGENT_HARNESS_COMPARISON.md); this note owns the decision to close the gaps. Sibling-repository paths are read-only working-copy references in backticks, not links.

G1 — loop hygiene. [repeat-tool-reminder](../../../../packages/guard/repeat-tool-reminder/src/index.ts) injects reminders at consecutive same-argument counts 3, 5, and 8, but nothing force-stops the turn and nothing reuses the recorded result when one step contains an exact duplicate call. Kimi (working copy `kimi/src/kimi_cli/soul/toolset.py`, constants near line 153) injects the same ladder, force-stops at the 12th repeat, and serves an exact same-step duplicate from the recorded result. No package enforces a turn-level tool-call budget; Claude Code caps turns and Kimi caps steps at 1000.

G2 — subagent report fidelity. Delegation returns the child's final message unchecked. Kimi runs one bounded continuation when the report is under 200 characters (`kimi/src/kimi_cli/subagents/runner.py`), demanding technical detail, findings, and everything the parent needs.

G3 — truncation honesty. [compaction-tool-result-pruner](../../../../packages/compaction/compaction-tool-result-pruner/src/config.ts) cuts oversized tool results to a head and a tail; the notice states the cut but neither the original size nor a next step. Kimi appends "use pagination or more specific queries" to its cap notice; Codex reports `original_token_count` in structured tool output.

G4 — compaction quality and failure handling. [compaction-basic](../../../../packages/compaction/compaction-basic/src/summarizer.ts) keeps a fixed 16 percent tail and emits a sectioned checkpoint whose sections carry no keep-priority ranking; Kimi's compaction prompt ranks six retention levels (current task state, then errors and fixes, then code evolution, then older history) with KEEP/MERGE/REMOVE rules and a structured output template. A failing summarizer retries without a breaker: Claude Code stops auto-compaction after 3 consecutive failures, and a comment in its source records a session that failed 3,272 times in a row. The token estimate behind budgets and triggers is character-based; engine measurements on real agent code traffic report 2.09 characters per token, with one session diverging 59,048 (engine) versus 31,794 (harness) tokens (Strata host `apps/host/server/agent/context-budget.mjs`).

G5 — methodology layer. Harness-authored static prompt text is about 2 KB and the standard persona is one sentence, so exploration, verification, and reporting methodology is taught nowhere. Kimi teaches it in an 8-section system prompt of roughly 2,239 words; Claude Code's prompt comments carry A/B-derived numbers for individual rules (for example "29-30% FC rate vs v4's 16.7%").

G6 — MCP wiring. [packages/mcp](../../../../packages/mcp/README.md) exists, but [the base bundle](../../../../packages/bundle/base/cordis.patch.yml) does not mount it, so a default profile cannot attach an MCP server.

G7 — approval friction. [user-approval](../../../../packages/interaction/user-approval/src/index.ts) asks on every escalation. Codex caches approvals for the session and offers persistable command-prefix rules with explicit counterexamples (a `python3` prefix must never be persistable; `rm` and heredoc shapes are named as forbidden).

## Proposal

Nine work items. Every deployment-varying value is a validated `Config` field per the repository rule against hardcoded tunables; defaults are starting points for review, not decisions.

| Item | Landing | Change |
| --- | --- | --- |
| W1 | `packages/guard/repeat-tool-reminder` | force stop at `forceStopStreak` (default 12) and same-step dedup: an exact duplicate call inside one step returns the recorded result without re-execution |
| W2 | `packages/core/agent-loop` | turn tool-call budget `maxToolCallsPerTurn` (default 200, `0` disables) ending the turn with a system-visible budget event |
| W3 | `packages/subagent/tool-subagent` | report floor `minReportChars` (default 200) with one bounded continuation attempt `floorContinuationAttempts` (default 1) demanding technical detail |
| W4 | `packages/compaction/compaction-tool-result-pruner` | truncation notice gains original size, kept size, and a next-step sentence; same suffix convention for tool error truncation |
| W5 | `packages/compaction/compaction-basic` | summarizer output gains a keep-priority ranking (current task state > errors and fixes > files and code > user messages > older history) and a consecutive-failure breaker `maxConsecutiveFailures` (default 3) that stops auto-compaction and surfaces the error |
| W6 | `packages/core/agent-loop` + `packages/compaction` | provider-declared token counter: when the provider exposes a token-count operation (the Strata worker exposes `count_tokens`), budgets and compaction triggers use reported counts; the character estimator remains the fallback |
| W7 | `packages/core/system-prompt` + preset guidance sections | an optional methodology section (budget: 300 words) teaching explore-before-conclude, nested-instruction-file checks, verify-before-claim, and path citations, plus a uniform "when not to use" + bad-patterns subsection convention for each tool's prompt guidance |
| W8 | `packages/bundle/base/cordis.patch.yml` | mount the MCP capability in the base profile behind config with an empty registry by default; misconfiguration fails loud at load |
| W9 | `packages/interaction/user-approval` | a session-scoped approval cache keyed by normalized request shape, and persistable prefix rules with documented forbidden shapes (`rm`, heredoc, generic interpreters) |

Acceptance per item: W1 and W2 add keyless snapshot coverage showing the reminder ladder, the force-stop system message, and the budget event; a unit test pins same-step dedup to exact argument equality. W3 adds snapshot coverage for a short report (continuation fires once) and a long report (no continuation). W4 and W5 update the summarizer and pruner output snapshots; the breaker unit test stops after exactly `maxConsecutiveFailures`. W6 keeps provider behavior unchanged without a counter and switches to reported counts with one. W7 is snapshot-visible in the assembled transcript and respects the prompt word budget. W8 passes hygiene gates and shows the empty registry in the base profile. W9 adds unit tests for cache-key normalization and prefix-rule persistence plus snapshot coverage of the reduced interruption flow. Each item lands with its own Agent Note and the checks named in the root instructions.

## Relationship to existing proposals

[Recallable compaction](2026-07-06-recallable-compaction.md) owns rollback, in-session history recall, and cache-aware chunking; this program deliberately excludes those and defers to that note. A search of the active proposal tree found no note covering the reminder force stop, the report floor, the truncation suffix convention, the approval cache, or the token-counter injection, so this note supersedes nothing.

## Alternatives considered

Host-side adoption only (each embedded host reimplements the mechanisms): rejected — it forks prompt contracts and subagent mechanics per host, and the Strata measurements show hosts already patch around harness behavior to compensate. Moving per-tool guidance into tool descriptions (the Kimi model, about 1.2 KB per tool): deferred — the current documented stance keeps cross-call guidance in the prompt, so W7 standardizes the convention prompt-side and the migration is a separate future decision. Hardcoded thresholds: rejected by the Config-field rule.

## Acceptance criteria

The program is done when the acceptance matrix in [docs/research/EXECUTION_GOAL_AND_ACCEPTANCE.md](../../../../docs/research/EXECUTION_GOAL_AND_ACCEPTANCE.md) marks all eight work packages green with command-level evidence in every cell, and that document's gate-4 final audit — completeness, regression, out-of-scope, and documentation — reports zero red items. That document owns the per-package acceptance standard; this note does not restate it.

## Risks

The prompt budget is contested on local windows: the Strata integration measures the web profile's system prompt plus tool definitions near 29K of a 32K window (`integrations/harness/profile/cordis.patch.yml` in the Strata working copy), so W7 stays at or under 300 words and reminder text stays short. The force stop can cut legitimate retries of flaky tools: dedup matches exact arguments only, and the stop message instructs a written summary instead of further calls. The report floor costs one provider round trip per short report, which is prefill time on local engines: `floorContinuationAttempts` defaults to 1 and can be set to 0. A character-counted floor skews for CJK text, where 200 characters carry more information than 200 English characters.

## Open questions

Should the force-stop default be 12 (Kimi) or higher for long autonomous runs? Should the report floor count characters or estimated tokens, given CJK density? Should per-tool guidance migrate into tool descriptions in a later decision, or stay prompt-side permanently? Is the approval cache session-scoped only, or do persisted prefix rules need it to survive restart? Which package owns the character estimator today, and does W6 belong behind the llm capability as a provider-declared capability — the owning package was not identified while writing this note and must be pinned during design.
