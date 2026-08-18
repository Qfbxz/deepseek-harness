# Agent Note: Tool call labels survive a missing description

Status: implemented

## Problem

`run_code` and `bash` declared `description` as a required string and rejected an empty one at execution. Models under context pressure omit or blank it — field observations show the same session failing five-plus times with `missing required property "description"` or `invalid description: expected a non-empty string`, each a wasted round-trip that carries no signal about the task itself. Inside `run_code` the blast radius compounds: one nested `tools.bash({command})` without a `description` fails the whole program.

## Decision

The parameter is optional in both schemas, and presentation derives the call label when it is omitted or blank: the first meaningful line of the program (`deriveRunCodeTitle`) or of the command (`deriveBashDescription`), comment marker stripped, capped at 60 characters. Both helpers are pure exports, so replay of logged args reproduces the label exactly. The empty-string rejection tests are replaced by omission-path coverage. `workflow`'s `meta.description` stays required: it is the workflow's identity record, not a display label.

## Alternatives considered

- **Keep it required and improve the error text.** The failure still costs a round-trip and the model cannot always supply the field (nested calls written under token pressure). Deriving the label removes the failure class instead of describing it.
- **Derive inside the UI layer only.** The label then depends on render-time state; the session log would no longer determine what the model saw. Derivation at presentation-from-args keeps `model-visible ⟺ logged`.

## Consequences

A call with no description shows its first command/program line in the UI header instead of a curated summary — acceptable for a label the command itself already echoes (the terminal card titles by command anyway). Model-authored descriptions, when present, always win.

## Testing

`packages/shell/tool-bash` and `packages/core/tools` suites pin both directions: omission produces the derived label, a provided description passes through unchanged. Snapshot coverage of the assembled transcript exercises the tool declarations the model receives.
