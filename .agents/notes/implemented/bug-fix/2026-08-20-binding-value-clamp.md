# Agent Note: run_code clamps oversized binding results before they reach the program

Status: implemented

## Problem

A binding call whose tool returns a huge payload — a 50 KB bash stdout, a giant file read — flowed into the run's completion value unbounded. The outer output ledger then overflowed and the run surfaced as an opaque abort: the model saw a failed `run_code` with no usable diagnostic, retried blind, and hit the same wall. The dispatch bridge settled every sub-call with the raw `result.value`, so nothing between the tool and the ledger bounded the size.

## Decision

Clamp each binding result at the dispatch bridge settle site (`packages/core/tools/src/code-mode.ts`): `clampBindingValue` caps one string at `BINDING_VALUE_MAX_CHARS = 24_000` chars, appending an explicit `…[truncated N of M chars]` marker; arrays and objects clamp per-element/key recursively, preserving the JSON shape. The value the program receives — and therefore anything it derives into the completion value — is bounded per binding call.

## Alternatives considered

- **Clamp the whole completion value once at the end.** A program can fold many binding results into one giant aggregate; per-binding clamping bounds the input rather than the final render, and keeps the truncation marker attached to the exact call that produced it.
- **Reject oversized results as errors.** The tool succeeded and its side effects stand; an error invites retry, while a truncated value with an explicit marker lets the program proceed and re-read narrowly.
- **Raise the ledger budget instead.** Moves the failure, does not remove it; the runaway payload still crosses the worker boundary.

## Consequences

- A binding returning more than 24 000 chars reaches the program truncated with an explicit marker; the run completes instead of aborting opaquely.
- The durable sub-call log and tool renders keep the tool's own content (the log listener may already replace it with a preview and locator); the clamp applies only to the value carried into the program's completion path.
- Runtime copies of the shipped npm package carry the fix through `runtime-patches/replay-discard-diagnostic.mjs` (patch 12, watchdog entry `p12-discard-diagnostic`); the watchdog replays it automatically after any global dsh reinstall.
