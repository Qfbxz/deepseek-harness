# Agent Note: Thrown program objects serialize structurally in run_code failure diagnostics

Status: implemented

## Problem

A run_code program that throws a plain object — `throw { code: 499 }` — surfaced to the model as:

```
Error: code run failed (exception): [object Object]
```

The model cannot self-correct from that literal: it cannot tell a misparsed tool envelope from a rejected binding from a typo, so it retries blind and hits the same wall. The leak had three layers, and only the deepest was the source:

1. **Worker serialization (the root)**: `prepareException` in `bootstrap.ts` rendered non-string thrown values with `String(detail)`, collapsing every plain object to `[object Object]`. This happens inside the worker thread; by the time the host receives the DoneMessage the value is already a flat string, so no host-side fix can intervene.
2. **Host throw site (defense in depth)**: the `CodeRunFailedError` throw in `code-mode.ts` interpolated `result.error.message` directly. Harmless when the message is a string, but any non-worker path that hands it an object leaks the same way.
3. **Propagation**: the worker ships the flattened string to the host, which forwards it verbatim.

A host-only fix was verified insufficient: after patching the host throw site the leak persisted, because the flattening happens in layer 1.

## Decision

Serialize thrown objects losslessly at the layer that flattens them, with a matching defense at the host throw site:

- `bootstrap.ts` gains `renderThrownValue(detail)`: objects go through `JSON.stringify`; a circular reference falls back to `util.inspect` (which marks cycles as `<Circular>`); everything else uses `String()`. `prepareException` uses it for non-string details.
- `code-mode.ts` gains an exported `errorMessage(error)` helper with the same shape discipline (Error.message, then object `.message`, then JSON, then inspect), and the `CodeRunFailedError` throw site routes through it.

A non-string thrown value now reaches the model as readable JSON — `{"code":499}` instead of `[object Object]` — restoring the self-correction loop the structured `isError` contract promises.

## Alternatives considered

- **Fix only the host throw site.** Verified insufficient: the flattening happens in the worker before the host ever sees the value.
- **Return the thrown object as structured JSON in the failure envelope.** Widens the DoneMessage wire contract for a case a bounded string already serves; the byte caps in `prepareFailure` bound the diagnostic correctly.
- **Keep `String()` but special-case the literal.** `String(obj)` never throws, so a try/catch fallback cannot catch it; masking the one literal hides the shape instead of rendering it.

## Consequences

- `throw { code: 499, detail: { reason: 'x' } }` now reports `Error: code run failed (exception): {"code":499,"detail":{"reason":"x"}}`.
- A thrown object with a failing `toString` renders through `inspect` instead of the old unreachable `program threw an unrenderable value` fallback (the corresponding bootstrap assertion was updated with the behavior).
- Runtime copies of the shipped npm package carry the same fix through `runtime-patches/replay-object-throw-serialization.mjs` (idempotent, snapshots into `backups/`); replay it after any global dsh reinstall, same as patches 1–4.
- Source changes also unblocked the host build: `protocol.ts` exports `CallMessage` and `bootstrap.spec.ts` uses it (`posted` array typing, non-null namespace access), which cleared two pre-existing baseline TS errors that had deadlocked `tsc -b`.

## Testing

- `packages/code-runtime/code-runtime-worker-thread` bootstrap suite: 29/29 (the unrenderable-value assertion updated to the new inspect-based rendering).
- `packages/core/tools` code-mode suite: 92/92, including two new tests pinning `errorMessage`'s four-step shape discipline and the `CodeRunFailedError` message-field string invariant.
- Both packages together: 500/500.
- End-to-end in the live harness: `throw { code: 499, detail: { reason: 'synthetic-object-throw' } }` returns the full JSON in the failure text.
