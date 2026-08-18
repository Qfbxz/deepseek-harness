# 2026-08-16 Session-friction fixes from the petro-agent incident review

## Context

An exported DPOS session (dsh-session-session-b5b7304a) recorded a full
afternoon of recurring harness friction across 24 turns: 11 self-classified
error families, several of which kept re-firing after "cures". This change
fixes the four that live in harness source. The remaining families were
either already fixed at HEAD (the rc.6 bare `Symbol()` scheduler split, now
`Symbol.for` with a regression spec in core/tools), environment-side (the
~/.dsh profile hoist incident), or model-discipline-only (JS syntax slips
inside inline programs — structural immunity there is the sh.mjs module
pattern, a user-space convention, not harness code).

## Changes

1. **run_code and bash descriptions are optional** (packages/core/tools,
   packages/shell/tool-bash). A missing or blank `description` no longer
   fails the call with `missing required property "description"` — the most
   frequent model-authored failure in the session (5+ recurrences), and for
   bash it kept firing on nested `tools.bash({command})` calls inside run_code
   programs. Both schemas mark the parameter optional; `presentCall` derives
   the label from the payload itself (run_code: first meaningful program line,
   `deriveRunCodeTitle`; bash: first command line, `deriveBashDescription` —
   both exported for replay determinism); run_code SDK instruction text
   (ts-types/py-types) names the parameter optional-but-expected. The old
   whitespace-rejection tests are replaced by omission coverage. Workflow's
   `meta.description` stays required: it is the workflow's identity record,
   not a UI label.

2. **Locale-tiered token formatting** (ui-conversation). `formatTokens`
   takes the active locale: zh renders the wan/yi scale (5,600 / 8.6 万 /
   321 万 / 3.11 亿 — the units the surrounding copy already uses), en keeps
   K/M/B and now rolls to B at a billion instead of padding M (the
   session's 310.95M-class totals). The language flows from the
   registrations' `ctx.locale` closures through `activeLocale` inject
   callbacks (composer bar + stats dock), matching the slots rule that
   inject returns plain callbacks. ContextMeter threads the same seat for
   its occupancy figures.

3. **Actionable grep failures** (tool-fs-search). A missing search target
   keeps the rg stderr excerpt but appends what to do (check the path
   against the session workspace, then retry); SEARCH_ABORTED names the
   remedy (narrow pattern / add include / scope path) instead of a bare
   abort string; an invalid regex now names the escape remedy (metacharacters
   intended literally need \\+ \\* \\(), so an alternation carrying raw
   arithmetic self-corrects on the next call. All previously read as internal
   faults and prompted blind retries in the session.

4. **Read-absence and offset guidance** (tool-fs read-target, read-render). A `read` of a file that does not exist now appends the recovery rule to `FS_NOT_FOUND`: verify the path against the session workspace, or — when the task slice calls for creating that document — `write` it directly (a fresh write is `createIfAbsent` under the observation policy and needs no prior read). An `offset` past EOF now names the valid range and the move (re-read with offset ≤ N, or from the top) instead of a bare count — a stale offset against a shrunken or misremembered spill file self-corrects in one call. The create-intent judgment rule itself is agent discipline: read-first is for modifying existing files only.

5. **Parse-failure hint in run_code diagnostics**
   (code-runtime-worker-thread). A program-body SyntaxError now reports its
   message plus a remediation hint (fix the syntax, or move complex logic
   into a file written first); the stack of a synthetic function body is
   dropped since its frames carry no location. Previously
   `Expected ',', got '<eof>'` arrived with zero context.

Also: the composer dock footer wraps dock entries in a `statsBand` column
with a 2px gap, so stacked plugin strips (shipped stats rows + market
plugins like dsh-usage-stats) stay visibly separate instead of reading as
one wall of figures — the session's jammed stats text.

## Verification

- pnpm vitest run: code-mode/ts-types/py-types (152), tool-fs-search (146), tool-fs (321),
  code-runtime suites (114), chat-stats + context-meter (29).
- pnpm run typecheck clean.
- pnpm run test:gui: 3789 passed; 2 pre-existing failures on HEAD
  (chat-branch-tails cache-hit string, ui-theme scrollbar rebind in
  community/dsh-git-graph) — verified red under `git stash`, untouched
  here.
