# Community Packages

Source-vendored copies of third-party DeepSeek Harness plugins. They are copied
into this monorepo so a source build ships them built-in (no `dsh plugin add`
needed), and they keep their upstream `@linxin666` package names.

## Manifest

| Directory | npm name | Upstream | Version |
|---|---|---|---|
| `dsh-web-ui-all/` | `@linxin666/dsh-web-ui-all` | [zhu1090093659/dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) `packages/dsh-web-ui-all` | 0.1.12 |
| `dsh-git-graph/` | `@linxin666/dsh-client-ui-git-graph` | 同上 `packages/dsh-git-graph` | 0.1.12 |
| `dsh-task-board/` | `@linxin666/dsh-client-ui-task-board` | 同上 `packages/dsh-task-board` | 0.1.12 |
| `dsh-aionui-panel/` | `@linxin666/dsh-client-ui-aionui-panel` | 同上 `packages/dsh-aionui-panel` | 0.1.12 |
| `dsh-live-stats/` | `@linxin666/dsh-live-stats` | 同上 `packages/dsh-live-stats` | 0.1.12 |
| `dsh-pet/` | `@linxin666/dsh-pet` | 同上 `packages/dsh-pet` | 0.1.12 |
| `dsh-skins/` | `@linxin666/dsh-skins` | 同上 `packages/dsh-skins` | 0.1.12 |
| `dsh-remote-web-ui/` | `@linxin666/dsh-remote-web-ui` | 同上 `packages/dsh-remote-web-ui` | 0.1.12 |
| `dsh-ssh/` | `@linxin666/dsh-ssh` | 同上 `packages/dsh-ssh` | 0.1.12 |
| `dsh-web-ui-settings/` | `@linxin666/dsh-client-ui-web-ui-settings` | 同上 `packages/dsh-web-ui-settings` | 0.1.12 |
| `skins/*` | `@linxin666/dsh-skin-*` / `dsh-client-ui-skin-center` | 同上 `packages/skins/*` | 0.1.12 |
| `dshmarket/` | `dshmarket` | [dsh-market/dsh-market](https://github.com/dsh-market/dsh-market) | 1.0.3 |
| `dsh-find-plugin/` | `dsh-find-plugin` | [awesome-dsh-plugin/dsh-find-plugin](https://github.com/awesome-dsh-plugin/dsh-find-plugin) | 0.3.6 |

Vendored 2026-08-14 from the upstream default branch (upstream license: Apache-2.0,
see each package directory). Peer APIs (`@deepseek-ai/dsh-*`, cordis, react)
resolve from this workspace at build time.

## Updating

Re-copy the changed package directories from a fresh upstream checkout, keeping
the `@linxin666` names and this manifest in sync. The aggregate's
`cordis.patch.yml` is generated upstream by `scripts/aggregate.mjs` — copy it
as-is rather than hand-editing.
