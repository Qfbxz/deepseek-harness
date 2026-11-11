# Agent Note: WP3 truncation honesty — one sized truncation notice for pruned tool results

Status: implemented

English | [中文](2026-11-10-wp3-truncation-honesty.zh.md)

## Problem

The cross-harness parity program ([gap G3](../../proposed/feature/2026-11-08-cross-harness-parity-program.md)) measured that the pruner cut an oversized tool result to a head, the marker `\n\n[... tool result middle pruned ...]\n\n`, and a tail: the text stated the cut but neither the original size, the kept sizes, nor a next step, so the model reasoned over a hole of unknown size with no recovery path. The compared harnesses answer this: Kimi appends an actionable next step to its cap notice, and Codex reports `original_token_count` in structured tool output. The same opaque marker rode on pruned error results, so a cut error text was also dishonest about its own size.

## Decision

The pruner emits one truncation notice, built by `truncationNotice(originalChars, headChars, tailChars)` in `@deepseek-ai/dsh-compaction-tool-result-pruner`: `[truncated] original N chars -> kept head X + tail Y; re-read specific ranges to page through the middle`, framed by blank lines, with `N`, `X`, and `Y` the actual Unicode code-point counts. Every pruned result — success or error — carries this one form; the builder is the only producer, so no second notification form exists.

**The pruner is the landing point for truncated error text.** The unified tool-error wrap (`Error: ${message}` in `dsh-tools`) performs no truncation: it wraps whatever message the tool raised. The only mechanism that cuts model-facing tool-error text is this pruner, and error results flow through the same `pruneContent` path as success results, so the shared builder is the whole convention and `packages/core/tools` needs no change. The package tests pin the verbatim notice on both an `isError: true` result and a success result.

**Config validation budgets the notice width.** `headChars + TRUNCATION_NOTICE_MAX_CHARS + tailChars` must be at most `thresholdChars`, where `TRUNCATION_NOTICE_MAX_CHARS` is the notice length with every value at `Number.MAX_SAFE_INTEGER` — the widest digit count a code-point count can reach. A budget too tight for the notice fails at plugin construction, and a configuration that was valid under the shorter static marker (for example `thresholdChars: 100, headChars: 20, tailChars: 10`) now fails at load. The shipped defaults (`8192/4096/1024`) clear the bound by a wide margin.

**No new Config fields.** The notice format is a fixed convention, not a deployment-varying value, so the repository rule against hardcoded tunables does not apply to it; the character budgets that do vary by deployment remain validated `Config` fields.

## Alternatives considered

**Keeping the static marker and appending the notice after the tail.** Rejected — that keeps two notification forms in one result, and a notice outside the middle would escape the emitted-size budget arithmetic that guarantees one-pass convergence.

**Budgeting the notice at a fixed digit width below `Number.MAX_SAFE_INTEGER`.** Rejected — a larger original size would then emit a notice wider than the validated budget, turning a data fact into a loud prune-time failure instead of a load-time configuration verdict.

**Extending the same suffix to the shell tools' notices.** Deferred — `[output truncated; full output: …]` in `dsh-tool-bash` and the `<response clipped>` notes in the persistent shells announce a spill file or scrollback loss, not a head/tail cut, and their presentation layers parse those markers; converging them is a separate decision outside this program's WP3 landing.

**A Config switch for the notice format.** Rejected — the format is a fixed convention, so a switch would fork the model-visible contract per deployment without a consumer.

## Testing

- `packages/compaction/compaction-tool-result-pruner/tests/tool-result-pruner.spec.ts` pins the verbatim notice with actual sizes on success and `isError: true` results, the one-pass convergence, the notice-width validation bound, and the load-time rejection of budgets that were valid under the shorter marker.
- The keyless headless scenario `examples/headless-agent/tests/snapshots/compaction-prune/` replays an oversized bash result through the assembled app: the persisted log and stream carry the `compaction/prune` shadow price, the replacement `tool/result` with the verbatim notice, and the compaction envelope, and the retried request sees the pruned replacement.

## Consequences

- The model sees the size of what was cut and the recovery step, and `compaction-basic`'s summarizer reads the same notice on the pruned surface.
- Pruner budgets below the notice bound fail at plugin construction; the default composition and every shipped profile clear it.
- A pruned replacement carries slightly more text than the static marker did; the emitted size stays within `thresholdChars`, so pressure math and one-pass convergence hold.
- The existing `compaction-recovery` snapshot is unchanged: its shadowed node is a user message and its tool result is never oversized. The `shadowedTokenCount` values pinned by the new `compaction-prune` scenario price the pruned replacement through the shared estimator and are stable for this notice text.
