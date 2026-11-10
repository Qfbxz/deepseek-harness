# Agent Note: WP5 provider-declared token counter

Status: implemented

English | [中文](2026-11-10-wp5-provider-token-counter.zh.md)

## Problem

The cross-harness parity program ([gap G4, item W6](../../proposed/feature/2026-11-08-cross-harness-parity-program.md)) measured that the harness prices context pressure with a fixed character heuristic — four characters per token plus structural overhead — while an engine tokenizer measured real agent traffic at about 2.09 characters per token: one session cost the engine 59,048 tokens against the harness's 31,794. Every budget and compaction trigger built on that estimate fires at roughly half the true pressure. The proposal also left two design questions open, and implementation required their answers first: which package owns the character estimator, and where a provider-declared counting capability mounts.

## Decision

**Estimator ownership is pinned to `packages/llm/token-meter`.** `estimate.ts` is the single heuristic module (fixed density plus structural overhead), and the `ctx.tokenMeter.measure()`/`estimateMessage()` service face is the only way consumers price content. No consumer imports the estimator directly; every pricing decision stays inside the meter.

**Counting mounts on the llm capability as an optional adapter method.** `LlmAdapter` declares `countTokens?(provider, model, request, signal?): Promise<number>` with no base implementation — the same default-absent pattern as `providerRetryPolicy()`. `LlmRuntime.countTokens()` forwards to the route's adapter and returns `undefined` when the adapter leaves the capability undeclared: absence is a fact callers price around, never an error. The runtime validates the adapter's return at that wire boundary — a non-negative safe integer or `LlmError` `INVALID_TOKEN_COUNT` — mirroring the exact-model metadata validation. The request type `LlmCountTokensRequest` carries `messages`, optional `system`, and optional `tools`, so the count can cover a complete request envelope. The shipping DeepSeek and pi-ai adapters deliberately do not declare the capability yet; declaring support is a provider-side decision recorded under Alternatives.

**Consumption wires through compaction-basic, which already injects both services.** When the routed adapter declares counting, every threshold decision on the pressure path — the initial check, the remeasure after model-free pruning, and each convergence remeasure inside the retry loop — fetches a fresh provider count for the current envelope (logged header's system and tools plus the fully derived surface messages) and passes it into `measure()`. A failed count warns and falls back to the character estimate; a count the cancellation signal already won rethrows; count failures never advance the consecutive-failure breaker, because they are pricing-input failures, not compaction attempts. The overflow path needs no count (its range selection reads per-node prices only), manual `compactNow()` has no threshold, and region preparation, stability checks, and `shadowedTokenCount` keep their per-node heuristic prices — so retention selection and the compaction-recovery sentinel values are independent of the counter.

**The measurement gains a third baseline state, `reported`.** A caller-supplied count covers the exact measured envelope at this boundary, so `measure()` anchors on it directly with no signed surface delta, overriding both the usage and estimated anchors; `surfaceTokens`, `nodes`, and `logRevision` are untouched. Meter-side re-validation of the count would re-check a typed same-process value the wire boundary already validated, so the meter trusts its parameter.

**No new Config fields.** The capability declaration is the switch: an adapter declares `countTokens` exactly when its provider offers a count endpoint, so deployments enable the behavior by choosing adapters, not by tuning compaction-basic. The extra provider round trips are inherent to using the capability.

## Alternatives considered

**Route A — the meter injects llm and queries counts itself.** Rejected: `measure()` is synchronous while a provider count is an asynchronous round trip, so self-querying would force an async measurement API or speculative prefetch during replay folding, reshaping the meter's pure log-replay guarantee for every consumer.

**Carrying the capability on `LlmResolvedModelInfo`.** Rejected: exact-model metadata is a detached identity/capacity answer with no request content; a request-content operation cannot live there.

**Declaring counts on the real DeepSeek/pi-ai adapters now.** Deferred: provider-side support (for example a `count_tokens` endpoint) is a separate adapter decision; the keyless counter-mock fixtures prove the full path until then.

**Fetching the count only at the initial measurement.** Rejected: the post-prune and convergence remeasures would then compare against character estimates while the trigger used the reported count — with divergent densities (the measured 2.09 case) the same surface flips between above-threshold and below-threshold across the two pricing regimes, so compaction aborts or retries on inconsistent numbers.

**Re-validating the count inside the meter.** Rejected: the only untrusted crossing is the adapter wire return, which `LlmRuntime.countTokens()` already validates; adding a second check for typed same-process callers duplicates the boundary.

## Testing

- `packages/llm/llm/tests/service.spec.ts` pins undeclared-absence (`undefined`, `NO_ADAPTER`), forwarding of provider/model/request/signal, and the invalid-return table (`INVALID_TOKEN_COUNT`).
- `packages/llm/token-meter/tests/token-meter.spec.ts` pins the `reported` baseline (direct anchor, zero delta, untouched surface fields, frozen baseline) and its override of a live usage anchor.
- `packages/compaction/compaction-basic/tests/compaction-basic.spec.ts` pins a content-proportional fixture counter crossing a threshold the estimate stays below, one-summary convergence on the fresh post-compaction count, the estimate-preserving undeclared control, the failed-count fallback (estimate, warn, breaker untouched), and the cancellation rethrow.
- The keyless headless scenarios `examples/headless-agent/tests/snapshots/token-counter/` and `.../token-counter-absent/` replay through the assembled one-shot app: the fixture adapter counts the real envelope at 2 chars/token (first count 9896, post-compaction count 9420) against the 0.5 × 19000 = 9500 threshold, so only the reported count triggers the committed compaction (`shadowedTokenCount: 377`, heuristic node pricing as before), while the identical undeclared run compacts nothing. The compaction-recovery sentinel `shadowedTokenCount: 266` and the web seeded-history/stats-paged-history figures are unchanged.

## Consequences

- Deployments with a counting adapter get trigger decisions at true provider density; deployments without one behave byte-for-byte as before, because `undefined` leaves every measurement path untouched.
- Each pressure-path compaction attempt pays up to three count round trips (initial, post-prune, post-compaction) plus one per convergence retry to a counting provider — latency on a local engine, cheap uncached requests on remote count endpoints.
- A reported count is a point-in-time anchor: surface mutation after the count is not repriced against it until the next count or a matching usage anchor, which is why every mutating step in the pressure path re-counts.
- `TokenMeasurementBaseline` gained the `reported` kind; the generated cordis API catalogs and the subsystems pages were regenerated in the same change.
- `recallable-compaction` keeps owning rollback, in-session history recall, and cache-aware chunking; the projected-usage projection keeps its own provider-usage anchor semantics ([that note](../architecture/2026-07-29-projected-token-usage-and-request-context.md) stays the owner of the occupancy figures).
