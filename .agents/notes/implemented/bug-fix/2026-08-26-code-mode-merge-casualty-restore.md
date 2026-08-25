# 2026-08-26 — Restored clamp and optional-description in code-mode (merge casualties)

## What

`packages/core/tools/src/code-mode.ts` regained two local fixes that had left
the source tree while their tests stayed:

- `clampBindingValue` (commit `01cc9ed3b8`, patch 12): caps one binding result
  at 24k chars at the dispatch settle site so a huge tool payload cannot
  overflow the output ledger into an opaque abort.
- optional `description` + `deriveRunCodeTitle` (commit `feec4b49a9`, patch 2):
  a missing or blank description no longer fails the call; presentation derives
  the label from the first meaningful program line.

## Why

The clamp was dropped when merges `b2f23f88ad`/`a135df8be6` took the official
side of conflicting hunks; the description fix never merged into `zoubo` at
all — in both cases the tests survived and ran red (2 failures; the clamp test
at `code-mode.spec.ts:1553`). The runtime copies kept both behaviors via fleet
replays (p2/p12), so only source and tests disagreed.

## How

Both restorations apply the original diffs verbatim against current source
(anchors unchanged). The p12 replay was additionally rewritten for rc.2: the
runtime reads the bundled `lib/index.js` (code-mode inlined), so the old
`lib/types/code-mode.js` target was a no-op; the replay is now a self-contained
multi-target payload (global/profiles-root/web-local). Package suite 391/391,
tool-bash 86/86, tsc clean.
