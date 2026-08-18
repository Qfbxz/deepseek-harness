# Agent Note: The composer trailing row carries the priority-winner context panel

Status: implemented

## Problem

The goal strip, queue panel, and todo strip each rendered as a standalone full-width card stacked in the composer context dock below the input. During an active session the goal — the fact the user most needs in view — sat a full card-height below the input row, and with a goal present the queue and todo were pushed entirely out of the viewport fold. The tool row between the primary Send button and the card's right edge was dead slack.

## Decision

A new session-scoped list slot `conversation.input.send-after` mounts at that trailing seat. The three panels register into one shared cell (`id: 'occupant'`) at ascending priority — goalbar (5) > queue (10) > todo (15) — and the slot renderer shows only the priority winner, so the row carries at most one panel and degrades through the chain as goals/queues/todos come and go. The InputBar wraps the slot in a `flex: 1 1 0` container (`.sendAfter`) that grows into the row's remaining width; each panel's CSS module adds a `[data-send-after]` attribute-bridge rule that drops its standalone-card width caps, so the same DOM renders in both modes. The dock registrations remain untouched — the panels keep their stacked-card mounts when they lose the priority cell.

## Alternatives considered

- **Three separate trailing cells side by side.** Three panels at row width crowd the Send button and force width arbitration between unrelated concerns; one winner keeps the row legible and each panel's collapse behavior stays its own decision.
- **A store for the active panel.** The winner is derivable from registration priority plus goal/queue presence — data the entries already own. A store would duplicate that fact and need its own invalidation wiring across three packages.
- **Portal-based rendering to escape the bar.** The panel needs the bar's width constraint to size its content (the goal text truncates against the row's slack); a portal would have to re-derive that constraint.

## Consequences

Only the highest-priority present panel rides the row: with an active goal the queue and todo fall back to their dock cards — the exact ordering users expressed (goal in view during runs; queue when idle). The attribute selector bridge (`[data-send-after]`) is the one cross-module CSS coupling and is deliberately a stable attribute, not another module's hashed class. The slot's `priority` semantics are the slot system's standard ordering field, so no renderer change was needed.

## Testing

`pnpm run test:gui` (client + host packages, 272 files / 3757 tests) green with the feature mounted; the goalbar, queue, and todo suites pin their dock registrations, and the conversation skeleton suite pins the composer row render including the trailing seat.
