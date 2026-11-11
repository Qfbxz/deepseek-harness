# Agent Note: The root dsh-root build entry is existence-guarded and the micromark-util-types split is deduped

Status: implemented

English | [中文](2026-11-11-dsh-root-tsdown-entry-dead-glob.zh.md)

## Problem

The root workspace package `@deepseek-ai/dsh-root` is bookkeeping-only: it has no `src/`, no `exports`, no `files`, no git history for `src/` or `lib/types/`, and zero importers of any subpath anywhere in the repository. Its build entry in `tsdown.config.ts` nevertheless requested `lib/types/{index,invariant,startup}.js`. Those three files existed only as stale artifacts of unknown origin inside one working copy. Two events exposed the latent breakage on 2026-11-11: the version bump to 0.2.3-rc.1 surfaced the missing `startup.js` (the glob resolved two of three before), and the first physically synced install materialized the lockfile's long-standing `micromark-util-types` split (20 snapshot uses at 2.0.3 against two exact 2.0.2 pins), which failed the Host type check in `packages/client/ui-primitives/src/markdown/parse.ts` with incompatible `micromark-util-types` 2.0.2/2.0.3 declarations. A reverse engineering pass confirmed there is no repository source, generator, or emitter for the root artifacts — the same latent state exists upstream, where the sole historical consumer is the upstream-only `scripts/build-exe-for-ssh-helper.ts` exe build — so restoring artifacts was not an option; the build had to become deterministic without them.

## Decision

The root entry in `tsdown.config.ts` is existence-guarded: `index.js`, `invariant.js`, and `startup.js` are bundled into the `dsh-root` member when present on disk and the member is skipped (empty entry, the same shape the Client face already uses) when absent. The lockfile is deduped so every `micromark-util-types` resolution is 2.0.3; the two exact 2.0.2 pins collapse and the physical duplicate disappears on the next install. Upstream keeps the throwing glob and its own latent stale-artifact dependency; per owner instruction this note and the fix are recorded locally and not submitted upstream.

## Alternatives considered

**Restore the artifacts or a generator for them.** Rejected: there is nothing to restore — no upstream sources exist, no generator exists, and inventing stub artifacts recreates the exact undeclared-state dependency that broke.

**Align the glob with upstream's two-name form (`index,startup`).** Rejected: it still throws on a clean checkout for the same reason; upstream parity would preserve the defect rather than remove it.

**Leave the dependency and document the stale artifacts as required local state.** Rejected: every freshly cloned or re-synced install fails `pnpm run typecheck`, the pre-push hook, and `doc-typecheck` for a reason no checkout can reproduce or repair.

## Consequences

`pnpm run typecheck`, the pre-push typecheck job, and `doc-typecheck` now pass on a clean checkout with no root `lib/` at all; the host build stops failing at entry resolution and the client face is untouched. When a future producer of root `lib/types` artifacts appears (for example restoring an SSH-helper exe build), the entries bundle again without configuration changes. The upstream latent defect is recorded here only; resyncs from upstream must not reintroduce the throwing glob. The dedupe resolves `micromark-util-types` to 2.0.3 everywhere, so code typed against the exact 2.0.2 pin must follow 2.0.3 declarations; the single remaining physical 2.0.2 store entry is unreferenced and disappears on the next prune.
