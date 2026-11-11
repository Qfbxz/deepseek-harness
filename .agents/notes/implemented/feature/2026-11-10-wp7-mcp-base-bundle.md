# Agent Note: WP7 MCP base-bundle registry mount

Status: implemented

English | [中文](2026-11-10-wp7-mcp-base-bundle.zh.md)

## Problem

[gap G6, item W8](../../proposed/feature/2026-11-08-cross-harness-parity-program.md): `@deepseek-ai/dsh-mcp-client` existed, but [the base bundle](../../../../packages/bundle/base/cordis.patch.yml) carried no row for it, so a default profile could not attach an MCP server. The rosters note ([2026-07-31-even-out-shipped-tool-rosters](2026-07-31-even-out-shipped-tool-rosters.md)) had shipped the plugin as a CLI dependency precisely because a shipped row would have to name a third-party server and spawn it on every launch, and it named the missing layer: a bridge that reads a user's server list and mounts one client per entry.

## Decision

**The base profile mounts the MCP capability as one dormant registry row.** [`@deepseek-ai/dsh-mcp-client/registry`](../../../../packages/mcp/mcp-client/README.md#registry-entry) is a namespace plugin whose `Config` is `{ servers: Config[] }` with `servers` defaulting to `[]`; the base patch carries it as row `mcp` with the empty default, so no server process starts and no `mcp__*` tool joins the catalog until a later patch layer replaces `servers`. Each entry is one complete `mcp-client` config and activates as a child instance with the plugin's existing connection, discovery, and reconnect semantics; `failOnStartupError: false` keeps connection failure a per-entry choice instead of a boot failure. No server list is hardcoded anywhere in the shipped composition.

**Registry misconfiguration fails loud at load.** An entry that fails the mcp-client config schema rejects the child's config validation, a duplicated `serverName` inside the registry is caught by an up-front registry check that names both entry indices, and both failures propagate through the awaited child mount to the row — a broken composition never boots a partially mounted fleet. The empty default plus loud load-time failure are the program's pinned A9 semantics.

Deployment surface: replace the `mcp` row's `config` in a profile or home patch layer (a patch replaces the row's whole `config`), or keep inserting per-server `mcp-client` rows as before — the [`examples/mcp-memory`](../../../../examples/mcp-memory/README.md) overlays are unchanged and remain a second mounting path. HMR reloads the registry row as one unit — editing it disconnects and remounts every server — instead of per-server hot swap.

## Alternatives considered

**Per-server rows in the base patch.** Rejected: a shipped patch cannot carry a fleet without hardcoding server names or empty slot rows, and each new server would need a bundle change instead of one config replacement.

**A default-on sample server.** Rejected for the reason the rosters note already recorded: any shipped `command` names and spawns a third-party child process on every user's machine, outside `ctx.shell` and the Web sandbox policy. The empty registry keeps the no-spawn rule while making the capability mountable.

**A dedicated `@deepseek-ai/dsh-mcp-registry` package.** Rejected: the registry is composition of one capability, not a second seam; the subpath-entry precedent (`dsh-tool-subagent-control/list-agents`) keeps it beside the plugin it mounts.

**Validation only through the child instances.** Partially adopted: each entry's schema validation and startup failures come from the child, so the schema exists in one place; the registry adds only the duplicate-`serverName` check, whose error must name both indices and which the per-instance namespace reservation across separate rows cannot express within one row.

## Testing

- `packages/mcp/mcp-client/tests/registry.spec.ts` pins the empty default, the clean empty mount, the duplicate-`serverName` rejection with both indices, the schema-invalid entry rejection, and a valid entry whose doomed spawn folds its startup failure into the registry activation.
- `packages/bundle/base/tests/base.spec.ts` pins exactly one `mcp` row (the registry entry with `servers: []`), no direct `mcp-client` row, and the bundle manifest declaring `@deepseek-ai/dsh-mcp-client`.
- The keyless headless snapshots (`examples/headless-agent/tests/wp7-mcp.snapshot.ts`) drive the product headless profile: `--dump-config` shows the dormant row; a duplicated-`serverName` overlay and a schema-invalid overlay each fail the boot at load with the registry's error; the fixture overlay patches the row with a dependency-free stdio MCP server, and a real `mcp__fixture__add` call round-trips through the assembled profile into the durable session log.
- `DEEPSEEK_API_KEY` was absent in the WP7 execution environment (the process environment and the root `.env` were checked for the name only), so the roadmap's with-key fixture-server e2e round did not run; the snapshot round above drives the same wire path keylessly through the scripted model adapter.

## Consequences

- The dormant row costs nothing: no process, no tool schemas, no request bytes. Token and KV-cache effects begin only when a deployment supplies servers, and they are the mcp-client plugin's own documented effects.
- Deployments that configure stdio servers introduce child processes outside `ctx.shell` and the Web sandbox policy — the caveat the rosters note recorded now applies only when a server list names one.
- [2026-07-31-even-out-shipped-tool-rosters](2026-07-31-even-out-shipped-tool-rosters.md) is partially superseded and stays active: its "MCP is a dependency, not a row" fact is stale now that the base bundle carries the dormant row, and the bridge it anticipated as missing is this registry; its decision — no named server, no default spawn — is preserved and enforced by the empty default. Both notes cross-link.
- The registry `Config` is documented in the package README, not in the [config catalog](../../../../docs/config-catalog.md): the generator catalogs each package's `src/index.ts` entry, and the registry lives behind the `./registry` subpath, mirroring `dsh-tool-subagent-control/list-agents`.
- The `SessionEventMap` is unchanged: the registry contributes tools through the existing `ctx.tools` registration path, and everything model-visible — tool schemas, calls, results — logs through existing events.
- Supersession check: a search of the active tree found no other note owning the base-bundle MCP mount decision; the mcp-client plugin ([2026-07-07](2026-07-07-mcp-client-plugin.md)), auto-reconnect ([2026-08-06](2026-08-06-mcp-client-auto-reconnect.md)), and memory-overlay ([2026-07-31](2026-07-31-third-party-memory-mcp-examples.md)) notes remain current and untouched. The [2026-11-08 program proposal](../../proposed/feature/2026-11-08-cross-harness-parity-program.md) remains the owning decision record for W8.
