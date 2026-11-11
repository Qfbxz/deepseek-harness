# Agent Note: llm-pi-ai countTokens against compatible engines

Status: implemented

English | [中文](2026-11-11-llm-pi-ai-count-tokens.zh.md)

## Problem

The provider token counter ([WP5](2026-11-10-wp5-provider-token-counter.md)) delivered the seam — `LlmAdapter.countTokens?` and compaction-basic's consumption — but deliberately deferred the adapter-side declarations, and both shipping adapters stayed undeclared, so every deployment still priced context pressure with the character estimator. The cross-harness parity program's strata integration ([proposal](../../proposed/feature/2026-11-08-cross-harness-parity-program.md)) needs the opposite on its engine routes: the strata worker exposes a count operation per wire protocol (`POST /v1/messages/count_tokens` on its Anthropic side, `POST /v1/chat/completions/count_tokens` on its OpenAI side), and its context-budget work keys off `adapter.countTokens !== undefined` to switch from density-corrected estimates to provider-reported counts. The open question this note answers: where a multi-protocol adapter declares the capability when each protocol carries a different count endpoint, and what a failed count does at the adapter layer.

## Decision

**`PiAiAdapter` declares `countTokens()`, and the protocol is the declaration.** The adapter maps exactly two wire protocols to a count endpoint, addressed at the same host the stream request uses: `anthropic-messages` through `POST {baseURL}/v1/messages/count_tokens` and `openai-completions` through `POST {baseURL}/chat/completions/count_tokens`. Both accept the protocol's native prompt envelope and answer `{"input_tokens": N}`, so `ctx.llm.countTokens()` returns the provider tokenizer's price of the complete request envelope — system, tools, and messages — on those routes. A model on any other protocol fails `COUNT_UNAVAILABLE` before any network I/O. There are no new Config fields: the capability is declared adapter-wide, per WP5's decision that the declaration is the switch, and a protocol outside the mapping table is the documented per-model absence.

**The count prices what the stream request would carry.** The interrogation converts through the same history conversion a stream call takes (`toPiCountContext`, sharing `toPiContext`'s internals), resolves the same credential, and merges the same headers. The wire conversion mirrors pi-ai's own per-protocol request shapes with the compat switches that shape the prompt — `supportsDeveloperRole`, `requiresAssistantAfterToolResult`, `requiresThinkingAsText`, and `requiresToolResultName` on the OpenAI side, `allowEmptySignature` on the Anthropic side — including replayed-thinking placement (the signature-named field on OpenAI, signed/redacted/degraded-to-text blocks on Anthropic), consecutive-tool-result grouping, and tool-result image handling. Request-only fields no tokenizer prices (sampling, cache-control markers, chat-template kwargs, deferred-tool references) are omitted.

**Failure semantics stay at the WP5 consumer contract.** One count is one POST with no retry. Every endpoint failure — unmapped protocol, transport error, timeout, non-2xx, or a response without a non-negative safe-integer `input_tokens` — throws `LlmError('COUNT_UNAVAILABLE')` naming the cause; compaction-basic's existing catch is the single warning and the fallback to the character estimate. The adapter method cannot return `undefined` for a failure: the seam types a declared adapter's return as `Promise<number>` and `LlmRuntime.countTokens()` validates it at that boundary, so a descriptive throw is the only seam-legal signal, and it is what WP5's acceptance tests already pin. A count the caller's signal aborts rethrows as `ABORTED` like a stream's. The profile `timeoutMs` bounds the count request alongside the caller's signal, and an image-carrying envelope resolves the durable attachment service exactly as a stream does.

## Alternatives considered

**Returning `undefined` from the adapter on endpoint failure.** Rejected: impossible at this seam — the optional method's return type is `Promise<number>`, `LlmRuntime.countTokens()` turns a non-integer into `INVALID_TOKEN_COUNT`, and a swallowed `undefined` would produce a misleading diagnostic plus a second warning beside the consumer's own. The throw-based contract delivers the same observable outcome WP5 pinned: one warning, estimate fallback, breaker untouched.

**A per-route or per-protocol Config switch for counting.** Rejected: WP5 decided "no new Config fields; the capability declaration is the switch", and a switch a deployment must set per route would silently leave routes uncounted by default. The mapping table is fixed code; a protocol without a count endpoint is a fact of that protocol, not a setting.

**Calling pi-ai's own wire-conversion functions.** Unavailable: pi-ai exports only its streaming entry points; `convertMessages` and the Anthropic builders are module-private. The count-scoped conversion in this package mirrors those shapes switch for switch and is pinned by fixture tests against both protocols.

**Counting a reduced body (text-only, like a spill marker's counter).** Rejected: the seam's request carries system, tools, and messages, and a count that ignores tool schemas and replayed history would under-price exactly the sessions compaction budgets for — the divergence WP5 exists to remove.

## Testing

- `packages/llm/llm-pi-ai/tests/count-tokens.spec.ts` pins, per protocol mode: the endpoint path, native body shape, and auth header of a declared count; the bare envelope without system or tools; compat-switch renderings (`developer` role, result bridging, thinking-as-text, named tool results, empty signatures); replayed signed, redacted, and signatureless thinking on both sides; durable-image conversion through the attachment store; single-attempt failures (404, transport, unreadable and invalid counts, timeout) throwing `COUNT_UNAVAILABLE`; the unmapped-protocol refusal before network I/O; upfront and mid-flight aborts; degraded-replay counting; and keyless routes sending no credential header.
- `pnpm run test:snapshot` stays green: the `token-counter` and `token-counter-absent` headless scenarios and the `compaction-recovery` sentinel (`shadowedTokenCount: 266`) are unchanged, and the fixture-adapter scenarios do not route through this adapter.
- `packages/compaction/compaction-basic/tests/compaction-basic.spec.ts` pins the consuming side unchanged: a declared count that throws warns once, falls back to the estimate, and never advances the breaker.

## Consequences

- Deployments whose engines expose either count endpoint — strata's worker on both, Anthropic- and OpenAI-compatible gateways that mirror the real APIs — get trigger decisions at true provider density; every other protocol keeps the character estimator with no configuration change.
- Each pressure-path compaction attempt pays up to three count POSTs plus one per convergence retry, single-attempt, on the counting route; on a local engine that is latency only.
- The count conversion tracks pi-ai's request shapes by mirrored code, not by calling it: a pi-ai upgrade that changes a protocol's prompt rendering needs the mirrored conversion updated, and the fixture tests naming exact bodies are the drift signal.
- The seam is unchanged; `dsh-llm`, `token-meter`, and compaction-basic needed no edits. The DeepSeek adapter remains undeclared pending its provider's count operation.
