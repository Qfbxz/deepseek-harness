# Agent Note: Tool scheduler symbol shares one identity across duplicate package copies

Status: implemented

English | [中文](2026-08-15-scheduler-symbol-cross-copy-identity.zh.md)

## Problem

Profile-installed plugins declare `@deepseek-ai/dsh-*` packages as npm dependencies, so `dsh plugin add` materializes a second physical copy of those packages under `~/.dsh/profiles/<profile>/node_modules/` alongside the copy baked into the desktop host. A dependency-layout change (for example a lockfile rebuild) can surface this closure at any time; nothing in the profile layer prevents it.

`TOOL_RUNTIME_SCHEDULER` was a per-module `Symbol()`. Two module copies therefore hold two distinct symbols with the same description. When a composition resolves `dsh-agent-loop` from one copy and the `tools` service from the other, `ctx.tools[TOOL_RUNTIME_SCHEDULER]` reads `undefined`, and `startCall` fails on `.prepare` — every tool call in that context dies with `Cannot read properties of undefined (reading 'prepare')`, reported as `UNKNOWN` on the turn. In the incident that surfaced this, all subagent tool calls failed this way while the main conversation kept working, because only the subagent compositions crossed the two copies.

## Decision

Register the scheduler through the global symbol registry: `Symbol.for('@deepseek-ai/dsh-tools.scheduler')`. The registry key is the package-documented name, so any copy of any version that applies the same registration interoperates, independent of how many copies pnpm materializes or which one a given composition resolves. Deduplicating the copies themselves (workspace aliasing, host-only resolution) is a packaging-policy change with its own failure modes; identity-level registration fixes the cross-copy contract without touching dependency layout.

## Alternatives considered

- **Deduplicate the physical copies** (workspace aliasing, host-only resolution). A packaging-policy change with its own failure modes; identity-level registration fixes the cross-copy contract without touching dependency layout.
- **A string key on the service object.** String keys collide with public method names and lose the symbol's non-enumerable, non-string safety; a registry symbol keeps both while still being copy-independent.

## Consequences

Any copy of any version that applies the same registration interoperates, independent of how many copies pnpm materializes or which one a given composition resolves. The registry key `@deepseek-ai/dsh-tools.scheduler` is now a published contract: renaming it later breaks cross-version interop between mixed copies, so it is package-documented and stable.

## Verification

`tests/scheduler-symbol.spec.ts` pins the contract: the exported symbol equals `Symbol.for` under the documented key, which is the registry's guarantee that every copy applying the same registration shares one identity. The incident reproduction — a profile closure with its own `dsh-tools` copy driving subagent tool calls — went from universal `reading 'prepare'` failures to clean execution after the host copy registered through the global registry.
