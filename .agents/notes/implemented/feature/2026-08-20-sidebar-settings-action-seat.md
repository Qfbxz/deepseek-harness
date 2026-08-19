# Agent Note: Sidebar settings row gains a dedicated action seat

Status: implemented

## Problem

Every sidebar footer action stacked above the Settings button, one full-width row per button in practice: occupants ship aggressive geometry (inline `width:100%`, `flex:1` layers, and one inline-styles the shell's `footerActions` container to `column`), so a 256px column spent four rows on five buttons. Entries that semantically belong beside Settings — auto-memory's 「记忆」 — had no seat: `sidebar.settings` is `kind: 'single'` (ui-settings owns it), so a second registrant cannot join it.

## Decision

- Declare a new list hole `sidebar.settings.action` (same owner props as `sidebar.footer.action`: the column `wide` flag), rendered inside `settingsArea` before the Settings trigger. The settings row lays out as a right-aligned flex row; the trigger sizes to content there instead of filling the row.
- `footerActions` becomes a wrapping row with `justify-content: space-between` — the shell's row policy, enforced with scoped `!important` against occupant inline styles (width, flex, and the container direction an occupant inline-styles to `column`). This is a documented exception to "each occupant owns its button geometry": inside the footer, row packing wins.
- The collapsed rail keeps the vertical stack (column direction, centered).

## Alternatives considered

- **Register beside Settings via `sidebar.settings`.** Single-kind slot; a second registrant is a contract violation, not a workaround.
- **DOM-reparent the button into the settings row.** React reconciliation wipes or crashes on the next render.
- **Keep the stack and only shrink buttons.** The inline `width:100%`/`flex:1`/`column` combination defeats non-important shell rules; four rows for five buttons stays.

## Consequences

- The foot renders in 2–3 rows: one wrapping action row (plus overflow lines), then `[action…] Settings` compact on the right.
- auto-memory's button rides the new seat with a brain icon through `runtime-patches/replay-auto-memory-settings-row.mjs` (patch 15); the repo-built ui-sidebar bundle re-syncs over official installs via `replay-ui-sidebar-settings-action.mjs` (patch 16) until upstream ships the hole.
- Occupants that later want the settings row register into `sidebar.settings.action`; nothing else changes for existing `sidebar.footer.action` registrants beyond the row packing.
