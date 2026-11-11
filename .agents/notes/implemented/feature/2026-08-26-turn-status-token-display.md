# Agent Note: TurnStatus live token display: billed input + output, locale-driven label

Status: implemented

English | [中文](2026-08-26-turn-status-token-display.zh.md)

## Problem

The turn status was the only token surface showing nothing, while StatsLine (session totals) and the turn footer (output-only tokens/s) each told half the story: during a running turn the user could not see what the model was consuming.

## Decision

The running-turn status row in `ChatView` shows settled per-turn token usage — `↑{billed input} ↓{output} · {decode tps}` — beside the activity label, and the previously hardcoded `Deep diving...` label moved to the `conversation` namespace as `turn.status` (zh `生成中…`, en `Generating…`). The display follows the Claude Code convention: the input side sums the three disjoint billing buckets (`inputTokens + cacheReadTokens + cacheWriteTokens` — cached tokens still occupy the context and dominate under prompt caching), so the figure stays comparable across steps; output is provider completion tokens (thinking included). The tps figure reuses the settled footer's decode-rate definition (outputTokens / decodeMs of the latest step) instead of a wall-clock delta. `runningTurnUsage` folds the open turn's assistant nodes from the legacy compatibility projection (`s.chat.legacy.nodes`) — the same stable domain nodes StatsLine reads, with guaranteed `turn`/`usage` fields. Usage lands per completed `assistant/message`, so totals step forward per step; the in-flight step joins on completion. The stat renders only once `output > 0`, keeping the pre-first-step row clean.

## Alternatives considered

**A wall-clock tps delta.** Rejected: it silently averages tool time into the denominator; the decode-rate definition (outputTokens / decodeMs of the latest step) matches the settled footer's figure.

**A live per-token count for the in-flight step.** Rejected: chunk events carry no usage, so a live per-token count is not possible without estimating; usage lands per completed `assistant/message` and the in-flight step joins on completion.

**Reading the view-layer node store with guessed `node.location.turn` / `node.data.usage` paths.** Rejected (tried in an earlier in-flight draft): those paths do not exist on `ChatConversationViewNode` and silently yield 0; the legacy compatibility projection (`s.chat.legacy.nodes`) is the stable source with guaranteed `turn`/`usage` fields.

## Consequences

- The status row's running figure uses the Claude Code input convention, so it stays comparable with the settled footer's totals.
- The hardcoded `Deep diving...` string is gone; the label resolves through the real dictionary, and tests pin the zh label via `makeTranslate(zh, …)`.
