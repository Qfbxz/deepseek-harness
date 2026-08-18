# Agent Note: Session-friction fixes from the petro-agent incident review

Status: implemented

## Problem

An exported DPOS session recorded a full afternoon of recurring harness friction across 24 turns: 11 self-classified error families, several of which kept re-firing after cures. Four of them live in harness source: the most frequent model-authored failure was a missing or blank tool description (5+ recurrences; for bash it kept firing on nested `tools.bash({command})` calls inside run_code programs, killing the whole program); grep and read failures read as internal faults and prompted blind retries; and a program-body parse failure arrived as a bare `Expected ',', got '<eof>'` with zero context. The remaining families were already fixed at HEAD (the rc.6 bare `Symbol()` scheduler split), environment-side (the ~/.dsh profile hoist incident), or model-discipline-only (JS syntax slips inside inline programs — structural immunity there is the write-file-first convention, a user-space pattern, not harness code).

## Decision

1. **run_code and bash descriptions are optional** (packages/core/tools, packages/shell/tool-bash). Both schemas mark the parameter optional; `presentCall` derives the label from the payload itself (run_code: first meaningful program line, `deriveRunCodeTitle`; bash: first command line, `deriveBashDescription` — both exported for replay determinism); run_code SDK instruction text names the parameter optional-but-expected. The old whitespace-rejection tests are replaced by omission coverage. Workflow's `meta.description` stays required: it is the workflow's identity record, not a UI label.
2. **Actionable grep failures** (tool-fs-search). A missing search target keeps the rg stderr excerpt but appends what to do (check the path against the session workspace, then retry); SEARCH_ABORTED names the remedy (narrow pattern / add include / scope path) instead of a bare abort string; an invalid regex names the escape remedy (metacharacters intended literally need escaping), so an alternation carrying raw arithmetic self-corrects on the next call.
3. **Read-absence and offset guidance** (tool-fs read-target, read-render). A `read` of a nonexistent file appends the recovery rule to `FS_NOT_FOUND`: verify the path against the session workspace, or — when the task slice calls for creating that document — `write` it directly (a fresh write is `createIfAbsent` under the observation policy and needs no prior read). An `offset` past EOF names the valid range and the move (re-read with offset ≤ N, or from the top) instead of a bare count — a stale offset against a shrunken or misremembered spill file self-corrects in one call. The create-intent judgment rule itself is agent discipline: read-first is for modifying existing files only.
4. **Parse-failure hint in run_code diagnostics** (code-runtime-worker-thread). A program-body SyntaxError reports its message plus a remediation hint (fix the syntax, or move complex logic into a file written first); the stack of a synthetic function body is dropped since its frames carry no location. The type-strip entry point (`stripTypeScriptTypes`, whose amaro SyntaxError likewise carries no line or column) appends the same hint plus a best-effort location: a scan names the opening line of an unterminated string or template literal, the dominant shape of these failures.

Locale-tiered token formatting and the two-row composer-dock stats strip stay unshipped on this branch: the two-row dock route was replaced by the single-row ellipsis-plus-tooltip StatsLine, and the HEAD-shaped components do not take the `activeLocale` seat. Both return with the next dock-band change.

## Alternatives considered

- **Keep descriptions required and improve the error text.** The failure still costs a round-trip and models cannot always supply the field under token pressure; deriving the label removes the failure class instead of describing it.
- **Derive labels in the UI layer only.** The label would depend on render-time state and the session log would no longer determine what the model saw; derivation at presentation-from-args keeps model-visible ⟺ logged.
- **Re-throw parse errors with a source-mapped position.** The stripper gives no offset to map; a linear scan already names the unclosed literal's line without coupling to amaro internals.

## Consequences

A call with no description shows its first command/program line in the UI header instead of a curated summary — acceptable for a label the command itself already echoes. Search and read failures now carry their next action, converting blind retries into single corrected calls. Parse failures self-diagnose: the model can tell broken program text from a broken tool call and act on the named line.

## Testing

- pnpm vitest run: code-mode/ts-types/py-types (152), tool-fs-search (146), tool-fs (321), code-runtime suites (116, including the unterminated-literal location pair), chat-stats + context-meter (29).
- pnpm run typecheck clean.
- pnpm run test:gui: 3757 passed; the two goal.snapshot failures are pre-existing on master (SQLite ExperimentalWarning in stderr), verified red under `git stash` on pristine 99f6f02fec, untouched here.