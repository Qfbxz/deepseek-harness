# Agent Note: Restored clamp and optional-description in code-mode (merge casualties)

Status: implemented

English | [中文](2026-08-26-code-mode-merge-casualty-restore.zh.md)

## Problem

Two code-mode behaviors existed only as tests and fleet-runtime replays, not in source: `clampBindingValue` (commit `01cc9ed3b8`, patch 12) caps one binding result at 24k chars at the dispatch settle site so a huge tool payload cannot overflow the output ledger into an opaque abort, and optional `description` + `deriveRunCodeTitle` (commit `feec4b49a9`, patch 2) keeps a missing or blank description from failing the call — presentation derives the label from the first meaningful program line. The clamp was dropped when merges `b2f23f88ad`/`a135df8be6` took the official side of conflicting hunks; the description fix never merged into `zoubo` at all. In both cases the tests survived and ran red (2 failures; the clamp test at `code-mode.spec.ts:1553`), while the runtime copies kept both behaviors via fleet replays (p2/p12), so only source and tests disagreed.

## Decision

`packages/core/tools/src/code-mode.ts` regains both fixes. Both restorations apply the original diffs verbatim against current source (anchors unchanged). The p12 replay was additionally rewritten for rc.2: the runtime reads the bundled `lib/index.js` (code-mode inlined), so the old `lib/types/code-mode.js` target was a no-op; the replay is now a self-contained multi-target payload (global/profiles-root/web-local).

## Alternatives considered

**Re-derive the fixes as fresh code instead of applying the original diffs.** Rejected: the original diffs still apply verbatim against current source with unchanged anchors, so verbatim application restores the exact fleet-tested behavior instead of reintroducing it through new edits.

**Carry the fixes only as fleet replays and leave source without them.** Rejected: the runtime copies already kept both behaviors via replays (p2/p12), so patch-only would leave source and tests permanently disagreed and expose every future merge to the same casualty; source owning the behavior is what the surviving tests pin.

## Consequences

- Source and tests agree again: the two red tests (including the clamp test at `code-mode.spec.ts:1553`) pass against restored source.
- The p12 replay now works against rc.2's bundled `lib/index.js` as a self-contained multi-target payload (global/profiles-root/web-local) instead of the no-op `lib/types/code-mode.js` target.
- Package suite 391/391, tool-bash 86/86, tsc clean.
