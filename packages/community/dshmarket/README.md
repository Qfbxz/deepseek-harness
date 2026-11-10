# @deepseek-ai/dsh-market

Plugin market for the web profile: the host half mounts the `/dsh-market/*` HTTP routes (`registry`, `installed`, `status`, `logs`, `updates`, `update`, `setup-pnpm`, `uninstall`, `install`) on `ctx.webServer`, and the browser half declared under `dsh.client` renders the Settings → Plugin Market card against them.

The catalog comes from the curated awesome-dsh-plugin registry — live fetch first, an in-memory cache for an hour, and the bundled `data/registry-snapshot.json` snapshot when offline. `install` accepts same-origin POSTs only and executes a shell command for sources present in the curated registry; an installed plugin mounts through a hot directory and goes live after a page refresh. `update` and `uninstall` enforce the same curated-source restriction, `setup-pnpm` offers the one-click pnpm setup when the component is missing, and `logs` exports a sanitized plain-text install log with home paths and credential shapes masked.

## Model Experience

None, as the market mounts browser-facing HTTP routes and a UI card; no prompt, tool schema, or model-visible registration passes through it.

#### KV Cache effect

None; the market neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Install executes a shell command** — safety rests on the same-origin POST check plus the curated-registry source allowlist; a compromised browser session on the market origin can install any curated plugin into the running web profile.
- **The market card never reaches model context** — plugin metadata, install progress, and exported logs stay in the browser; nothing here reports installed-plugin state into a session.
