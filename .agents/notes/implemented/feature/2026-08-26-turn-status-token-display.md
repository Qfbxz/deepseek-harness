# 2026-08-26 — TurnStatus live token display: billed input + output, locale-driven label

## What

The running-turn status row in `ChatView` now shows settled per-turn token usage —
`↑{billed input} ↓{output} · {decode tps}` — beside the activity label, and the
previously hardcoded `Deep diving...` label moved to the `conversation` namespace
as `turn.status` (zh `生成中…`, en `Generating…`).

## Why

The turn status was the only token surface showing nothing, while StatsLine
(session totals) and the turn footer (output-only tokens/s) each told half the
story. During a running turn the user could not see what the model was
consuming. The display follows the Claude Code convention: input side sums the
three disjoint billing buckets (`inputTokens + cacheReadTokens + cacheWriteTokens`
— cached tokens still occupy the context and dominate under prompt caching), so
the figure stays comparable across steps; output is provider completion tokens
(thinking included). The tps figure reuses the settled footer's decode-rate
definition (outputTokens / decodeMs of the latest step) instead of a wall-clock
delta, which would silently average tool time into the denominator.

## How

`runningTurnUsage` folds the open turn's assistant nodes from the legacy
compatibility projection (`s.chat.legacy.nodes`) — the same stable domain nodes
StatsLine reads, with guaranteed `turn`/`usage` fields. An earlier in-flight
draft read the view-layer node store with guessed `node.location.turn` /
`node.data.usage` paths that do not exist on `ChatConversationViewNode`,
silently yielding 0. Usage lands per completed `assistant/message`, so totals
step forward per step; the in-flight step joins on completion (chunk events
carry no usage, so no live per-token count is possible without estimating).

The stat renders only once `output > 0`, keeping the pre-first-step row clean.
Tests pin the zh label through the real dictionary (`makeTranslate(zh, …)`).
