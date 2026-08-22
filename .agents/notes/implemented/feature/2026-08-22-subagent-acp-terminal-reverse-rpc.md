# Agent Note: ACP terminal reverse-RPC in subagent-acp

Status: implemented

English | [中文](2026-08-22-subagent-acp-terminal-reverse-rpc.zh.md)

## Problem

The ACP backend advertised `clientCapabilities: {}` on purpose — its child was assumed to self-serve shell and file access in its own process ([ACP backend Agent Note](2026-06-22-acp-subagent-backend.md)). Children that instead route tool execution through the client break under that assumption: `kimi acp` executes its shell tools via the ACP `terminal/*` reverse-RPC family and, when the capability is absent, fails every such tool with "ACP terminal capability is unavailable". The deployment `dsh-frostfin` (DSH agent loop replaced by Kimi Code over ACP) is exactly that child.

## Alternatives considered

- **Patch the child to self-serve** — rejected: it is a third-party adapter (`kimi acp`); the client-serving shape is its supported execution path.
- **Advertise `fs.*` too** — rejected: the same kimi adapter self-serves file access when `fs` is unadvertised (observed: `fs/read_text_file`/`fs/write_text_file` are invoked only when the client advertises them). Advertising would move file I/O across the wire for no need.
- **A package-local `child_process` executor** — rejected: [`run.ts`](../../../../packages/subagent/subagent-acp/src/run.ts) already routes the child through the `dsh-subprocess` seam for scrub, tree-scoped teardown, and service-owned lifetime; terminal commands must ride the same seam.

## Decision

Opt-in config `terminal` (default `false`, preserving the documented self-serve behavior) in `@deepseek-ai/dsh-subagent-acp`. When enabled, `initialize` advertises `clientCapabilities.terminal` and the run's ACP client serves `terminal/create · output · wait_for_exit · kill · release` through a per-run `AcpTerminalPool` ([terminal.ts](../../../../packages/subagent/subagent-acp/src/terminal.ts)):

- `create` validates the request at the wire boundary, spawns via the seam (`stdin: 'ignore'`, stdout/stderr each a bounded `SubprocessCollect` tail of the effective `outputByteLimit` — config `terminalOutputByteLimit`, default 1 MB, request value overriding), and mints an opaque id.
- `output` returns the merged snapshot — stdout tail then stderr tail, snapshot order — clamped to the terminal's byte limit at UTF-8 character boundaries, with `truncated` from the clamp or either reader's lossy flag, and the settled `{exitCode, signal}` once exited.
- `wait_for_exit` resolves the seam's `done`; a spawn-level failure keeps the terminal valid with the failure text as output and exit code 127 (real-shell not-found semantics).
- `kill` calls the seam's tree-scoped `terminate()` and keeps the id valid; `release` additionally deletes it (unknown ids answer resource-not-found). Run disposal terminates every live terminal tree and awaits the seam's exit proof before the child ladder runs.

## Verification

`tests/terminal.spec.ts` covers the clamp (multibyte boundary), wire-boundary validation, the spawn spec (collect dispositions, env, cwd default), merged/clamped snapshots, kill/release id semantics, spawn-failure mapping, and `releaseAll`. End-to-end: `dsh-frostfin` with `terminal: true` runs a Kimi Code child whose shell tools execute through the pool; without the flag the same child reproduces the "ACP terminal capability is unavailable" failure.
