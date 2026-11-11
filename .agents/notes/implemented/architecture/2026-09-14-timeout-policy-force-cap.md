# Agent Note: timeout-policy force cap — a never-settling tool must not hang the loop

Status: implemented

English | [中文](2026-09-14-timeout-policy-force-cap.zh.md)

## Problem

Session `session-a684330e` stalled permanently on 2026-09-14: turn 15 step 24 issued a `run_code` call whose program ran a synchronous `execSync(dotnet build …)`; the `tool/call` event was durably logged, but no `tool/result` ever appeared. Every later user message was spliced into the in-flight turn's inbox and never processed. The only recovery was killing the backend process.

The timeout-policy plugin of that build awaited `next()` unconditionally: its deadline aborts `exec.signal` cooperatively, and the wrapper only *replaces* the result when the tool promise eventually settles. A tool that never settles — because its program blocks the event loop, deadlocks, or simply ignores the signal — leaves the `await` pending forever, with no `TOOL_TIMEOUT`, no error, and no turn end. The cooperative contract also cannot fire its own timer while a synchronous `execSync` blocks the event loop.

## Decision

The wrapper keeps the cooperative path as the first resort and adds a bounded second resort:

1. Arm the deadline exactly as before and hand the fused signal to the tool.
2. When *this plugin's own* deadline fires (`timeoutOf(d.signal, TOOL_TIMEOUT)`) and the tool promise is still unsettled, start a grace timer (`forceAfterMs`, config field, default 15000 ms, `0` disables).
3. If the tool settles inside the grace window, the pre-existing replacement path applies unchanged.
4. If it does not, the wrapper returns `toolTimeoutResult(timeoutMs)` anyway; the abandoned tool promise gets a swallow-handler (dispatch normalization converts a settled execution into a result, so nothing else can surface from it).

Upstream aborts are unaffected: the grace timer is armed only for a timeout-classified abort, so the existing `TOOL_ABORTED`-preserving and nested-deadline semantics hold. The abandoned tool work is still not killed — termination remains with the capability; the cap only bounds how long the *loop* waits.

## Alternatives considered

- **Hard kill inside the wrapper** — reject/abandon the tool promise the instant the deadline fires. Rejected: it abandons tools that are mid-cleanup and would replace results the cooperative path already handles correctly; the grace period preserves every existing cooperative outcome.
- **A registry-wide default budget for tools that declare no `timeoutMs`** — rejected again here: the shipped `bash`/`read`/`write`/`edit` deliberately declare none, and a blanket budget changes behavior for tools whose owners never promised signal cooperation.
- **Fixing it only in the deployment shim** (the personal `dsh-tool-timeout` plugin that motivated this change) — rejected: the shim swaps `exec.signal` the same way but is deployment-local; the semantics belong in the enforcement home the timeout-library note designates.

## Consequences

- `apply` now takes a schemastery `Config` (`forceAfterMs`), adding `@deepseek-ai/schemastery` to the package's peer/dev dependencies; direct `ctx.plugin(timeoutPolicy)` mounts without a config object and get the 15 s default.
- Tests pin three new behaviors: force substitution after the grace window on a never-settling tool, `forceAfterMs: 0` restoring the legacy indefinite wait, and the grace-window settle keeping the normal replacement path.
- The production incident that motivated this also produced an immediate deployment shim (personal `dsh-tool-timeout` plugin, wall-clock abort of `run_code` at 180 s via the same `exec.signal` swap); this package change is the durable home of the semantics.
- Known limitation retained: tools that declare no `timeoutMs` still get no deadline; a registry-wide default remains out of scope.
