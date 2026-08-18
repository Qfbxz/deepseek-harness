# Agent Note: run_code parse failures carry a remediation hint and the unclosed-literal line

Status: implemented

## Problem

A program body that fails to parse reaches the model as a bare message: `Expected ',', got '<eof>'` from the type-strip phase, or a V8 `SyntaxError` whose stack holds only synthetic-function frames. Neither carries a line or column, so the model cannot tell broken program text from a broken tool call and retries blind — observed repeatedly within single sessions.

## Decision

Both parse surfaces now append context. The strip entry (`stripTypeScriptTypes`, whose amaro `SyntaxError` has no location) appends the shared remediation hint plus a best-effort scan: `unclosedLiteralHint` tracks quote/comment state through the program and names the opening line of an unterminated string or template literal — the dominant shape, where one unclosed quote swallows the rest of the body. The worker-side `prepareException` reports the message plus the hint for `SyntaxError` and drops the synthetic stack, whose frames say nothing.

## Alternatives considered

- **Re-throw with a source-mapped position.** The stripper gives no offset to map; embedding line tables would couple this package to amaro internals for a hint a linear scan already provides.
- **Return the whole program in the error.** The program is already in the failing tool call; echoing it doubles the payload to say what one named line says.

## Consequences

The scan is heuristic: a string opened and closed across a regex-looking construct can misstate the opening line, but never masks the original message — the hint appends, the V8 text stays first. Comment and escape states are tracked; bracket imbalance without an open literal still reports without a location, which the hint's remediation path (write the file first, keep the body minimal) covers.

## Testing

`packages/code-runtime` suites pin both surfaces: the strip-phase cases assert the unterminated string and template-literal opening lines and the hint suffix; `bootstrap.spec` covers the worker-side hint and stack drop.
