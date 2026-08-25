# Agent Note: One MCP connection attempt must be operator-bounded

Status: implemented

English | [中文](2026-08-25-mcp-client-connect-timeout.zh.md)

## Problem

Plugin activation awaits the first connection attempt, and each reconnect attempt awaits itself, with no bound owned by this package. The MCP SDK bounds each individual request at 60s, but a server that accepts the spawn and then stays silent holds activation for that full budget per attempt — and a Host boot that waits on the plugin tree inherits the delay. The reconnect attempt budget also cannot drain against an attempt that never settles. Operators had no field to tighten any of this per server.

## Decision

`connectTimeoutMs` (default 30000, positive finite, at most `MAX_TIMER_DELAY_MS`) bounds one connection attempt — the initialize handshake plus the initial tool synchronization — and every reconnect attempt. `resolveConnectTimeoutMs` is the explicit resolve step, so programmatic construction that bypasses Schemastery fails the plugin instance at load, mirroring `resolveReconnectPolicy`. The attempt body races a deadline promise; the losing attempt's late settlement is inert because the existing `isCurrent` guards in the attempt continuation and the serialized sync queue skip a generation the failure path already replaced. A timed-out attempt closes its generation and feeds the reconnect budget exactly like a rejected connect.

## Alternatives considered

**Rely on the SDK's per-request timeout.** Rejected: it bounds each request, not the attempt, leaves no operator control, and still costs the activation path the full 60s per attempt.

**Bound only the initial attempt.** Rejected: a hung reconnect attempt wedges the supervisor's loop forever, making `maxAttempts` decorative; attempts are symmetric, so one bound covers both.

## Consequences

- Activation is bounded by one attempt deadline; a silent server costs at most `connectTimeoutMs` before the failure path takes over.
- The reconnect budget drains against hung servers, so the existing give-up path terminates.
- A slow-but-legitimate server whose cold start exceeds the bound now fails fast; operators raise `connectTimeoutMs` for that server instead of the previous unbounded wait.

## Testing

`packages/mcp/mcp-client/tests/reconnect.spec.ts` covers a hung initial connect draining the budget to give-up, a hung initial synchronization failing at the bound, `failOnStartupError` rejecting activation on a timeout, and `resolveConnectTimeoutMs` defaulting, explicit, and out-of-range rejection including fail-loud `apply`.
