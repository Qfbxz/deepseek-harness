# Agent Note: The Think row follows the streaming tail and folds when it settles

Status: implemented

## Problem

The reasoning disclosure row (`ReasoningRow`) started collapsed and opened only on a click. While a block is the streaming tail the reasoning is being written right now, yet the row sat folded behind its summary line — the model's live thinking was invisible exactly when it is most relevant, and the first interaction of every block was a click the user should not need.

## Decision

The row is a phase follower with a manual override that lasts only for the current phase: `expanded = override ?? running`. While the block streams, the row expands and the summary tracks the latest line; when the block settles, the row collapses to its summary line. A click pins the user's choice until the running phase flips, then auto-following resumes — so folding a streaming block keeps it folded for that block's remainder, and the next block opens on its own. The phase flip resets the override in a `useEffect` keyed on `running`, not at click time, so the pin survives arbitrarily many rerenders within the phase.

## Alternatives considered

- **Pin the manual toggle for the row's whole life** (the earlier shape this replaced). A fold made during one block then silently ate the auto-expansion of every later block; users reported the row "never opens again".
- **Expand on hover instead of on phase.** Hover is unavailable on touch and hides the feature; the streaming tail is a state of the data, not of the pointer.

## Consequences

Settled rows remain folded to one summary line, unchanged from before; only the streaming tail behaves differently. The override is `boolean | null` in component state — no store, since the fact is per-row and dies with the row.

## Testing

The rewritten spec pins the full phase chain: expanded while streaming, a manual fold pinned through the rest of the streaming phase with the summary following the latest line, the phase flip clearing the override back to the settled fold, and the settled summary restoring the first line.
