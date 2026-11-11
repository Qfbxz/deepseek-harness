# kimi-acp-host — a kimi ACP host implementing every reverse RPC

English | [中文](README.zh.md)

A zero-dependency Node script (≥18): launches `kimi acp` as a subprocess, drives it over stdio with NDJSON JSON-RPC, and implements **every client-side method** the kimi adapter uses. In one session, `Bash`/`Grep`/`Glob` failed with `ACP terminal capability is unavailable` precisely because the host neither declared `clientCapabilities.terminal = true` in `initialize` nor implemented the terminal method family; this host supplies both.

## Run

```sh
node kimi-acp-host/host.mjs --cwd /path/to/repo
# 可选: --kimi /path/to/kimi (或环境变量 KIMI_BIN)
#       --approve ask|always|reject   (默认 ask)
```

Complete the `kimi` login in a terminal first (same for the Paseo scenario), then start this host.

Inside the REPL: plain input is `session/prompt`; `/cancel` interrupts the current turn; `/permission always` switches policy mid-run; `/new` starts a new session; `/exit` quits. Ctrl-C first cancels a pending permission question → otherwise sends `session/cancel` → then exits.

## Method coverage (agent → host reverse RPC)

| Wire method | Implementation |
| --- | --- |
| `session/update` | Streaming render: agent/user/thought chunks, tool_call(_update), plan(_update/_removed), usage, mode, session_info |
| `session/request_permission` | Three policies: `ask` numbered question / `always` automatic allow_once / `reject` automatic denial; a cancelled request answers `cancelled` per the spec |
| `fs/read_text_file` | Supports 1-based `line` + `limit` |
| `fs/write_text_file` | Writes straight to disk |
| `terminal/create` | Local spawn, merged stdout+stderr capture, `outputByteLimit` (default 1 MB) truncating from the head at UTF-8 character boundaries with `truncated` set; a spawn failure records exit 127 with real-shell semantics |
| `terminal/output` | Returns the current output plus the optional `exitStatus` immediately |
| `terminal/wait_for_exit` | Parks until exit, returns `{exitCode, signal}` |
| `terminal/kill` | SIGTERM, escalating to SIGKILL after 2 s; the terminalId stays valid |
| `terminal/release` | Kills first, then invalidates |
| `elicitation/create` · `elicitation/complete` | UNSTABLE, best-effort: form asks field by field / url prints the link; `complete` is a notification no-op |
| Everything else (`mcp/connect` etc.) | Answers JSON-RPC `-32601`; the kimi adapter converts http/stdio/sse MCP itself and never sends these |

`initialize` declares `protocolVersion: 1` and `clientCapabilities: { terminal: true, fs: { readTextFile: true, writeTextFile: true } }` — exactly the switch that unlocks kimi's shell/file tools under ACP.

## Known limits

- No automated tests inside this repository (the authoring environment had no shell). Smoke test: `node kimi-acp-host/host.mjs --cwd /tmp`, type "run ls -la", and `terminal/create` should execute under this host and return output.
- After Ctrl-C cancels a permission question, the next typed line is swallowed once by the parked readline question (the answer is dropped); typing one more line restores normal behavior.
- Reference spec: the method table in this repository's `node_modules/@agentclientprotocol/sdk` (0.25.1) `dist/schema/index.d.ts` and the field definitions in `types.gen.d.ts`; the kimi-side capability matrix lives in the official kimi-acp reference page.
