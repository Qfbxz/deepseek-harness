# Agent Note: Desktop shell dispatches window IPC through a module-level handler and a destroyed-window guard

Status: implemented

English | [中文](2026-08-18-desktop-shell-window-ipc-destroyed-crash.zh.md)

## Problem

The `dsh-desktop-window` IPC channel — the backing for the QQ98 titlebar buttons in `personal-plugins/dsh-desktop-chrome` — was registered inside `wireWindowCommands(window)`, called once per `createWindow()`. `ipcMain.on` registers a process-lifetime listener, so every reopened window stacked another listener, each closing over its own `BrowserWindow`. On macOS the shell stays resident with no windows after the last one closes, and the Dock-icon `activate` path reopens a window — so the second registration is a normal flow, not an edge case. The first titlebar click after a reopen dispatched through the previous listener, whose captured window was already destroyed; touching a destroyed `BrowserWindow` throws `TypeError: Object has been destroyed`, which is fatal in the Electron main process and surfaced as an Uncaught Exception dialog pointing at `main.js:188`.

Three adjacent defects shared the same lifecycle blind spot: the attach probe accepted any TCP listener (a Vite/Next dev server on 3000/5173 produced a blank window and an unreachable real backend), concurrent `activate` events raced two `acquireUrl()` calls into spawning two `dsh --profile web` hosts (the probe in both runs completes before either child listens, so both spawn, and `child` retains only the last reference), and a host that died on its own left a dead `child` reference behind.

## Decision

The IPC handler is registered exactly once at module scope and resolves its target through `activeWindow()` — `win` filtered by `isDestroyed()` — so a destroyed window is unreachable from any dispatch, including `second-instance` and `activate`. Window opening converges into `ensureWindow()`, guarded by an `opening` flag: concurrent activations join the in-flight attempt instead of starting a second acquire-and-open. The attach probe sends a minimal `HEAD /` request and requires an `HTTP/` status line back, and probes only port 3080 (the dsh default). On macOS the last closed window leaves the app and a spawned host resident and `activate` reopens the window; elsewhere the last closed window quits the app and tears down the host. A host exit clears the `child` reference, and the readiness-failure error carries the child's stderr tail.

## Alternatives considered

- **Unbind the per-window listener on `webContents` `closed`.** Works, but every window-creation site must own the pairing and a missed unbind reproduces the crash silently. One module-level listener over an accessor removes the class instead of managing its instances; the single-window shell has no per-window dispatch need.
- **Validate a dsh-specific route in the probe.** Rejected as over-fitting: requiring an HTTP status line already excludes non-HTTP listeners (databases, SSH tunnels) — the actual blank-window sources — while staying agnostic to the web host's route inventory.
- **Quit the app when `activate` cannot reacquire a URL.** Rejected: under resident-app semantics a transient failure should leave the app retryable from the Dock, not exit it; the first-launch path (`whenReady`) keeps quit-on-failure.

## Consequences

The single listener cannot dispatch per-window customizations — irrelevant while the shell is single-window, and the preload bridge contract is unchanged. An HTTP server that rejects `HEAD` without a status line is treated as absent and the shell spawns its own; the dsh web host answers `HEAD /` with a status line, and the 1.5-second probe timeout bounds the wait for anything that stays silent. The macOS residency keeps a spawned host running while no window exists — the cost of instant Dock reopen — and the explicit Cmd-Q quit path kills it.

## Testing

`desktop-shell` sits outside the `packages/` vitest surface; verification is `node --check` on the assembled main script, extraction of the built `app.asar` to confirm the shipped handler matches the source, and the manual crash path: close the window, reopen via Dock, then click each titlebar button. Before the fix the first click after reopen raises the uncaught-exception dialog; after it, the buttons act on the live window.
