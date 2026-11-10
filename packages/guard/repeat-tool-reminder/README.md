# @deepseek-ai/dsh-repeat-tool-reminder

English | [中文](README.zh.md)

An advisory loop-breaker, not a model-facing tool: it never appears in the tool list, never vetoes or rewrites a call, and adds exactly three behaviors — it watches each agent's stream of tool calls and counts runs of consecutive calls to the same tool with identical canonicalized arguments; at configured run lengths it injects an escalating advisory reminder telling the model to stop repeating itself, re-read the last result, and either change approach or conclude; and at `forceStopStreak` it force-stops the turn, serving exact same-step duplicates from their recorded results along the way. The decision (retry differently, gather more evidence, or finish) stays with the model below the force stop: a legitimately repeated call is delayed by nothing and blocked by nothing. Decision record: [the repeat-tool-reminder Agent Note](../../../.agents/notes/archived/feature/2026-07-08-repeat-tool-guard.md) and [the WP1 loop-hygiene Agent Note](../../../.agents/notes/implemented/feature/2026-11-10-wp1-loop-hygiene.md).

## Config

```yaml
- id: repeat-tool-reminder
  name: '@deepseek-ai/dsh-repeat-tool-reminder'
  config:
    thresholds: [3, 5, 8]        # default; consecutive counts that trigger a reminder
    include: []                  # tool-name patterns to track; empty ⇒ all tools
    exclude: [todo_write]        # tool-name patterns transparent to the chain
    argumentsPreviewChars: 500   # default; cap on arguments quoted in the detailed reminder
    forceStopStreak: 12          # default; consecutive count that force-stops the turn, 0 disables
```

`thresholds` fails loud at plugin load: an empty list, a non-integer, a value below 2, or a duplicate throws, never a silent fall-back to defaults; `argumentsPreviewChars` equally rejects anything but an integer >= 1, and `forceStopStreak` rejects anything but a non-negative integer (`0` disables the force stop and keeps only the reminder ladder). The list is normalized to ascending order; the FIRST threshold delivers a short generic nudge, every later threshold delivers the detailed form naming the tool, the run length, and the canonical arguments — head-truncated at `argumentsPreviewChars` with an omitted-count marker, so a looping `write`/`edit` payload cannot ride into the next request unbounded (the chain key always compares the FULL canonical string; the cap bounds the reminder, never the detection).

`include`/`exclude` entries support `*` wildcards and are predicates over whatever tools exist at call time, not references to registry entries — a pattern matching no currently registered tool is NOT an error (`exclude: [mcp_*]` stays valid in a deployment that loads no MCP tools), unlike `toolOrder`'s referent check.

## Chain semantics

The chain key is `(tool name, canonical arguments)` — canonicalization is a deep key-sort plus `JSON.stringify`, so argument objects differing only in property order count as identical. A call identical to the previous tracked call increments the agent's consecutive counter; a different tracked call resets it to 1.

- **Untracked calls are transparent to the chain.** A call excluded by `include`/`exclude` neither increments nor resets the counter, so `grep X → todo_write → grep X` still counts as two consecutive `grep X` when `todo_write` is excluded. This is what makes exclusion useful: bookkeeping tools interleaved into a loop must not launder it.
- **Denied calls count.** Detection sits on `tools/post-execute`, which also runs for calls a `tools/pre-execute` listener denied — a model hammering a denied call is exactly the loop worth breaking.
- **Calls without an agent are ignored.** A direct `ctx.tools.execute()` caller has no model to remind and no live agent object to key on.
- **Per-agent keying.** The tool registry is context-level and subagents interleave through the same waterfall, so a `WeakMap<Agent, Chain>` keys each chain by the live agent object; one agent's repetition never trips another's reminder. A user prompt (`agent/pre-step`) resets the submitting agent's chain, and object lifetime bounds the weak entry without a disposal listener.
- **In-memory only.** A session resumed from persistence starts with a fresh chain — the guard is a heuristic nudge, not a logged invariant, later reminders are the accepted cost.

## Force stop

At `forceStopStreak` (default 12, `0` disables) the guard force-stops the turn. The decision is made at `tools/pre-execute`, before the threshold call dispatches: the guard peeks the would-be run length from the committed chain, and at or above the streak marks the execution `concludeTurn` — the loop's existing turn-termination interface, read when the registry materializes that call's result — so the turn ends through the ordinary conclusion path once the instruction is delivered. The instruction itself rides the same channel as the reminders (the result's `additionalContexts`, delivered as an injected `user/message` after the step's results), so the model sees exactly one more request carrying `停止工具调用，改用文字总结当前进展与结论` plus the identifying run length, then the turn closes.

Counting stays in post-execute, so the deny-counting guarantee above is structural; the pre-execute peek is sequential in model order and matches the committed count. A call denied or failed AT the threshold cannot carry a successful conclusion (`concludesTurn` exists only on success), so the stop instruction still rides that result and every later repeat of the same chain stays above the streak and re-arms the force stop — the first successful commit at or after the threshold ends the turn. Same-step duplicates (below) still advance the chain, so an attempt is an attempt.

## Same-step duplicate reuse

Inside one step — from `agent/pre-step` to `step/end` — the first execution of a `(tool, canonical arguments)` pair records its result, and a second call with the SAME key returns the recorded result at the execution entry (`tools/execute`) without calling the body. Matching is exact structural equality via the chain's canonicalization: deep property order is normalized, so reordered objects are duplicates, while near-variants, subsets, and different values are distinct calls that execute normally. The reused result carries the annotation `duplicate of an earlier call in this step; recorded result reused` as injected context, model-visible on the next request, and the duplicate still advances the repeat chain. An in-flight duplicate (the same batch still executing the first call) reuses its dispatch result rather than racing the body, and a scheduler failure of the first call propagates to the duplicate instead of fabricating a second outcome. Denials, aborts before dispatch, and other pipeline paths that never reach `tools/execute` are neither recorded nor reused.

## Reminder delivery

Reminders ride the post-execute decision's `additionalContexts` (source `{kind: 'plugin', plugin: 'repeat-tool-reminder'}`), never a `content` replacement: the `tool/result` event stays the tool's own output for audit. The loop buffers the context and appends it as an injected `user/message` after the step's tool results, which the session renders as a plain synthetic user message — so the reminder is model-visible, source-attributed, and reconstructable from the session log with no new session event. The guard always delegates via `next()` and prepends its reminder to the downstream decision's context array (both variants — a blocked call still gets the nudge); every entry retains its own source and metadata. The force-stop instruction and the duplicate-reuse annotation travel the same channel with the same source.

## Model Experience

### First-threshold context message

#### What the model sees

At the first configured consecutive-repeat threshold, that agent receives the reminder below. No tool schema or normal-call text is added.

##### First-threshold reminder

```markdown
You are repeating the exact same tool call with identical arguments. Carefully analyze the previous result before calling again: if the task is not complete, try a different approach or different arguments instead of repeating the call.
```

#### Token effect

Zero tokens before the threshold. The reminder is retained history for that agent.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Later-threshold context message

#### What the model sees

A later threshold receives the detailed reminder template below. A capped argument preview ends exactly `… (+<omitted> more chars)`.

##### Later-threshold reminder

```markdown
Repeated tool call detected:
- tool: <toolName>
- consecutive_calls: <count>
- arguments: <canonicalArguments>
The repeated calls are not making progress. Do not call this tool with these exact arguments again. Inspect the latest result and choose a different action, different arguments, or finish the task if enough evidence has been gathered.
```

#### Token effect

Each reminder is retained history; `argumentsPreviewChars` bounds its data-dependent argument text, while agents keep independent counters.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Force-stop context message

#### What the model sees

At `forceStopStreak` (default 12) the agent receives the force-stop message below, then the turn ends after that instruction is delivered.

##### Force-stop message

```markdown
停止工具调用，改用文字总结当前进展与结论
(Force stop: <count> consecutive identical calls to <toolName>.)
```

#### Token effect

One fixed message per force stop; the turn ends after it is delivered.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Duplicate-reuse annotation

#### What the model sees

A second exact `(tool, arguments)` call inside one step receives the first call's recorded result plus the annotation below on the next request.

##### Duplicate-reuse annotation

```markdown
duplicate of an earlier call in this step; recorded result reused
```

#### Token effect

One fixed annotation per reused duplicate; the reused result content is shared with the original call's result.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Exact-match detection only** — canonicalization is a deep key-sort, so near-identical variants (a tweaked path, extra whitespace inside a value) evade the chain and are not duplicates; fuzzy matching is rejected pending evidence of need.
- **Compaction does not reset chains** — a chain spanning a compaction checkpoint keeps counting.
- **In-flight duplicates reuse the dispatch result** — a duplicate racing the first call in the same parallel batch reuses the first call's pre-policy dispatch result; only after the first call commits does a reuse carry the final (post-policy) outcome.
- **Code Mode sub-dispatches reuse under the same rule** — a `run_code` program calling one tool twice with identical arguments in one step gets the recorded result on the second call; programs needing a fresh read change the arguments or span steps.
- **No subagent chain-sharing** — chains and reuse tables stay isolated per agent; a parent and its subagent repeating the same call never combine.
- **Legitimate idempotent polling still draws nudges** past the thresholds — the pressure valves are `thresholds`/`exclude`/`forceStopStreak` config.
- **Past the highest threshold the reminder ladder goes silent** — reminders fire only at exact configured counts; the force stop at `forceStopStreak` is the bound beyond the ladder.
