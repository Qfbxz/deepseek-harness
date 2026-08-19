# Agent Note: Trailing-row context panels have horizontal breathing room

Status: implemented

## Problem

The send-after slot renders its priority-winner panel inline in the composer row (right of the primary Send button, filling the row's slack). Goalbar, queue, and todo panels all drop their standalone-card width/margin in this mode (they fit the row, they do not overrule the card). What they do not do is leave space between the panel's own edge and the Send button on one side, or the card's right wall on the other — the trailing rule set `margin: 0` on the row-mode .dock, which let the bar sit flush against both walls and read as one solid line of figures.

## Decision

All three panel styles add `padding: 0 10px` to the trailing-row rule, and the goalbar adds a `margin-left: 8px` between its own first and subsequent children in the row (its child composition has two columns). The padding is the same 10px the standalone card uses as its horizontal clearance, so the row and the card share a single visual rhythm. Goalbar's child gap keeps the objective and the action surface from running together when both are present in the row.

## Alternatives considered

- **Add the padding to the .sendAfter wrapper itself.** The wrapper is owned by the conversation skeleton, not the panel; padding there would penalize a row that has no panel (empty trailing slot), and the wrapper's `flex: 1 1 0` sizing is sized by the content edge. Each panel needs its own padding, scoped to the row mode only.
- **Increase Send button margin to push panels right.** The Send button is a tool-row control, not a panel boundary; the panel belongs in its own padding lane, not crowded against an interactive control.

## Consequences

Trailing-row panels now have a 10px gap on each side, matching the standalone card's horizontal clearance. When a row-mode panel changes (goalbar grows a second column, queue adds a third), its internal `* + *` gap keeps the children from running together. The standalone-card mode is untouched (its own padding cascade is the same 10px rhythm).

## Testing

Run `pnpm run build:lib:client`; the compiled bundles carry `[data-send-after] .dock{...;padding:0 10px}` for both goal/queue and `[data-send-after] .root{...;padding:0 10px}` for todo. Visually: refresh the GUI and confirm a 10px gap on each side of the trailing panel and an 8px gap between goalbar children when both columns are visible.