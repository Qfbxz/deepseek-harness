# dsh-desktop-shell

Minimal Electron shell for the official DeepSeek Harness Web Host — built as the
"clean" alternative to the fork's `@deepseek-ai/dsh-desktop` (`apps/desktop/`,
673 MB, vendored runtime + community plugins).

## What it does

- Spawns `dsh --profile web` (PATH lookup) and parses the canonical readiness
  line `dsh web: http://127.0.0.1:<port>` to learn the loopback URL.
- Attaches to an already-running dsh web on 3080/3000/4096/5173 instead of
  double-spawning when one exists.
- Loads the URL into a sandboxed BrowserWindow with a single validated IPC
  channel backing `window.dshDesktop.windowCommand("minimize"|"maximize"|"close")`
  — the same bridge shape that `desktop-chrome` (in `../personal-plugins/`)
  consumes for the QQ98 retro titlebar.
- Kills the spawned host on quit.

Total: ~150 lines of JavaScript. No vendored runtime. No bundled community
plugins — the official profile manages them via `dshmarket`.

## Requirements

- `@deepseek-ai/dsh` on PATH (official npm CLI; `npm i -g @deepseek-ai/dsh@latest`).
- Node ≥ 22.19 (matches the harness engines range).

## Run

```sh
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
npm start
```

`ELECTRON_MIRROR` avoids the GitHub-binary hang on this network. The first
install downloads Electron (~150 MB) via the mirror.

## Package (mac-arm64, ad-hoc)

```sh
npm run package:mac
```

Produces `dist/mac-arm64/DeepSeek Harness Shell.app`. Ad-hoc signed
(`identity: null`), no notarization — local use only.

## Plugin compatibility

- **`personal-plugins/dsh-desktop-chrome`** — uses
  `window.dshDesktop.windowCommand` for the QQ98 retro titlebar min/max/close
  buttons. Works unchanged; the plugin's `if (bridge !== undefined)` guard
  lets it degrade to decorative buttons when the bridge is absent (e.g. in a
  plain browser tab).
- **`personal-plugins/dsh-bocha-status`** — host route `/dsh-local/bocha-balance`
  is served by the dsh web process itself, so it works without any shell help.