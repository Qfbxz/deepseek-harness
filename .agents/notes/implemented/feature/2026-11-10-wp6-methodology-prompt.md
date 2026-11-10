# Agent Note: WP6 methodology prompt section and when-not-to-use guidance

Status: implemented

English | [中文](2026-11-10-wp6-methodology-prompt.zh.md)

## Problem

The cross-harness parity program ([gap G5, item W7](../../proposed/feature/2026-11-08-cross-harness-parity-program.md)) measured that this harness teaches no methodology: the static prompt was about 2 KB, the persona is one sentence, and exploration, verification, and reporting discipline is taught nowhere, on the assumption that the model already knows how to work. The same comparison found the sibling harnesses attach a "when not to use" statement plus bad-pattern counterexamples to every tool, while this harness's per-tool prompt guidance carries only positive instructions — the exact gap that shows up when a model other than the shipping one meets the prompt.

## Decision

**A methodology section is a harness-level built-in, on by default.** `dsh-system-prompt` registers `harness:methodology` at order 10 — after the persona, before tool guidance — teaching the four contract rules: explore before concluding; read the AGENTS.md at a subdirectory's root before working there; verify before claiming, and say what was not run; cite code as `path:line`. `includeMethodology` (default `true`) turns the section off; `methodology` replaces the fixed text for deployments authoring their own rules; `methodologyMaxWords` (default `300`, integer 1–10000) caps the resolved text. The word count runs at plugin construction: a count above the cap throws and names the count, so budget drift fails the boot loudly instead of growing the prompt silently. The default-on decision follows the `includeHarnessIdentity` precedent — fixed harness-owned prompt furniture ships enabled, and a compatibility or window-constrained deployment (the Strata 29K/32K profile is the named case) disables it with one patch row.

**Every standard-preset tool guidance section carries a `When not to use:` statement with one or two bad patterns.** The guidance sections of `read`, `write`, `edit`, `glob`, `grep`, `bash`, `pwsh`, background `jobs`, `web_search`, `web_fetch`, `goal`, `workflow`, `ralph`, and `subagent` (one template covers spawn and fork) gained the marker; sections whose text already stated the rule restructure so the marker sentence closes the section instead of duplicating it. `ask_user_question` gains its first cross-call section (order 117) carrying the inspect-don't-ask rule. `todo_write`, the skill loader, and the subagent-control tools keep no section — their one-call descriptions already own those contracts, and inventing sections for them would spend prompt bytes without a cross-call habit to teach. The convention stays prompt-side: the program's deferred decision about migrating guidance into tool descriptions is untouched.

**The assembled-prompt increment is measured, not asserted.** Diffing each refreshed ACP `system-prompt*.expected.md` golden against its base-commit version and counting only the added methodology and `When not to use:` bytes (absorbed pre-existing staleness excluded):

```sh
git worktree add /tmp/wp6-base d05842d98a   # then diff goldens between the two trees
```

The standard composition (`text-turn/system-prompt.expected.md`) gained **1481 bytes**; the largest refreshed golden (`subagent-child-question-rejection`, whose composition adds the ask-user section) gained **1616 bytes** — both inside the ≤2 KB contract. At the measured ~2.09 characters per token that is roughly 700 tokens per request, which the Strata-style constrained profiles recover by setting `includeMethodology: false`.

## Alternatives considered

**Plugin default off, enabled by a base-bundle row.** Rejected: G5 is a harness-level gap, and a bundle-row default would still leave every composition that mounts `dsh-system-prompt` directly — the harness's public seam — without methodology. The identity section is the precedent for default-on harness furniture.

**Authoring the rules into tool descriptions.** Rejected here: the program explicitly defers guidance-into-descriptions migration, and cross-call habits have an owner in the prompt sections.

**A fixed 300-word constant without authorable text.** Rejected: a cap over an uneditable constant can never fire, so `methodologyMaxWords` would be dead config; making the text a Config field is what makes the budget a real check.

**New guidance sections for `todo_write`, the skill loader, and subagent control.** Deferred: no cross-call habit is currently missing from their descriptions, and every new section spends per-request bytes.

## Testing

- `packages/core/system-prompt/tests/system-prompt.spec.ts` pins the default rendered text verbatim, the order-10 slot between persona and tool guidance, `includeMethodology: false`, a deployment-authored replacement, the 301-word over-budget rejection at load, a raised cap, schema and constructor rejection of an invalid cap, and the empty-text rejection.
- `packages/shell/tool-bash`, `packages/fs/tool-fs`, `packages/workflow/tool-ralph`, and the agent-spine-demo suites pin the section lists and the restructured guidance text; the demo bundle forwards `includeMethodology`/`methodology`/`methodologyMaxWords` and its compatibility-deployment test turns the section off.
- The threshold-calibrated fixtures that must not inherit unrelated prompt weight disable the section explicitly: the compaction-loop-repro harness and the minimal JSON-RPC composition (whose deployed prompt is exactly the configured persona) set `includeMethodology: false`; the WP5 token-counter scenario restates the agent-spine row with it off and re-calibrates its crafted envelope to the 20200-token window (probe-measured first count 10543 against the 0.5 × 20200 = 10100 threshold), keeping the one-compaction choreography.
- The full keyless snapshot suite replays green: 136 passed, 2 skipped, 0 failed. The ACP goldens carry both the new section and the new subsections; the refreshed `stream-json` scenarios stay prompt-blind (`{{system}}` normalization), so their diffs are confined to content-shape staleness.

## Consequences

- Every enabled deployment pays ~1.5 KB of system prompt per request. Window-constrained deployments disable the section by patch; the word cap bounds authored replacements but not the guidance-subsection convention.
- The snapshot refresh surface: 20 ACP system-prompt goldens plus the headless and JSON-RPC scenario fixtures carry the WP6 lines (1481 bytes each in the standard composition) and absorbed pre-existing staleness from the unrefreshed f5617203e6 era — the glob/grep guidance paragraphs and the bash-description/subagent-persistence shapes — about 3 KB across the goldens. The suite went from 83 baseline failures (ACP 78, headless subagent-diagnostic/subagent-inheritance/headless-profile, JSON-RPC SDK, session-fixture-layout) to zero.
- `subagent-parallel` needed a fixture adaptation, not a refresh: its scripted parent issued two identical delegations in one step, which the WP1 same-step dedup now serves from the recorded result (verified identical on the base worktree before changing anything), so the scenario now scripts ALPHA and BETA delegations and keeps exercising two live parallel children.
- `subagent-diagnostic` needed a one-line harness correction: the parent-log lookup matched a bare substring that also appears in the child log's `parentSession` field, so it now matches the session-head id.
- `subagent-child-question-rejection` stopped sharing `text-turn`'s system-prompt golden: its composition inserts `tool-ask-user`, so its parent prompt now carries the ask-user section and the scenario owns its golden.
- The conventional order bands gain the `10` methodology slot; [the prompt-ownership note](../architecture/2026-07-05-prompt-variables-and-tool-guidance-ownership.md) records the band fact and is otherwise unchanged — per-tool semantics stay in descriptions, cross-call habits in sections. The `SessionEventMap` is unchanged: the section is prompt furniture, not a logged event.
- Supersession check: no active note owns methodology prompt content or a guidance-section convention; the 2026-07-05 ownership note is extended (one band fact) and cross-linked, not superseded; the 2026-11-08 program proposal remains the owning decision record for W7.
