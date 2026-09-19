# Agent Note: Turn status is activity-only; tokens live on StatsLine alone

Status: implemented

English | [中文](2026-08-28-turn-status-single-token-surface.zh.md)

Reverses the token-display half of [2026-08-26-turn-status-token-display](2026-08-26-turn-status-token-display.md); that note's locale-key migration and activity-label work remain in force.

## Problem

After 2026-08-26 the running-turn status row showed settled token usage while the composer's StatsLine showed session totals. Both surfaces restated overlapping figures, and the duplicate-token cleanup line (commit 3e9200935 and its predecessors) kept having to reconcile two renderers for one fact.

## Decision

The status row carries only the phase label and the elapsed-time clock. Every token figure — running or settled — belongs to StatsLine as the single token surface, and StatsLine hides its speed/usage groups while a turn runs (commit 4d0389fc3), so nothing repeats mid-turn.

Removed with the display: the `RunningTurnUsage` fold over legacy assistant nodes, `nonNegTokens`, the `turnStatusGlyph` pulse animation, and the `turn.statusTokensBoth` / `turn.statusTokensOut` locale keys in both languages.

## Consequences

- Tests assert the status row contains no `tokens` text while running.
- The clock keeps `label-tertiary` so any numeric readout near it shares StatsLine's color.
- A future live token figure must extend StatsLine, not the status row.
