# Agent Note: An omitted binding argument record is the empty object

Status: implemented

## Problem

Every tool call from a run_code program crosses the worker boundary through a binding wrapper that snapshots its argument record as lossless JSON before posting. A call that omits every optional parameter — `tools.job_list()`, `tools.get_goal()` — passes `undefined` as the record, and the snapshot of `undefined` is `undefined`. The wrapper read that as "not representable" and rejected the call with `binding arguments must be lossless JSON` before any request reached the host: a zero-argument call on an all-optional schema was impossible to express, and the error text pointed at JSON lossiness instead of at the omission.

## Decision

The binding wrapper normalizes the argument record first: `args === undefined ? {} : args`. The empty object is the lossless-JSON form of "no parameters supplied", so it snapshots, crosses the wire, and reaches the host function as `{}` — matching every all-optional schema (`Record<string, JsonValue>` with no required key). After the normalization, `undefined` from the snapshot again means exactly one thing: a value JSON cannot represent (functions, cycles, symbols, `-0`, non-finite numbers), which still rejects with the same message.

## Alternatives considered

- **Fix at each zero-arg call site** (`tools.job_list({})`). Pushes a wrapper artifact into every program that calls an all-optional tool; the model has no reason to know the record is required syntactically when the schema says nothing is.
- **Teach the snapshot to encode undefined as null.** Confuses "absent" with the JSON value `null` on the wire; a host function distinguishing `args.x === undefined` from `args.x === null` would see the wrong one.

## Consequences

Zero-argument calls on all-optional schemas now work from run_code programs; schemas with required fields are unaffected (their absence still fails host-side validation with the precise missing-property message). The wrapper-level contract "snapshot `undefined` means not representable" is restored to a single meaning.

## Testing

`packages/code-runtime` suites (117 tests): the new bootstrap case pins that an omitted record resolves the call and posts the decoded empty object, while the existing lossy-value cases still reject.