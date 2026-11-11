# Agent Note: Code-mode binding calls reject positional primitives and name lossy properties

Status: implemented

English | [中文](2026-08-28-code-mode-binding-argument-diagnostics.zh.md)

## Problem

A model calling `tools.x("name")` with a positional primitive reached the host's object check and failed with an opaque message, or hung when the host never replied. A lossless-JSON rejection said only that arguments were not lossless JSON — `{ id: undefined }` left the model to guess which property was at fault, so the same call repeated.

## Decision

`makeNamespaces` rejects positional primitives before posting, with a message naming the received type, a bounded preview, and the corrective form `tools.${name}({ … })`. Functions, dates, arrays, and objects keep the existing path so lossless-JSON semantics and their tests are unchanged. On the lossless rejection, `describeLossyProperties` lists up to eight top-level properties whose values a JSON snapshot cannot carry (`undefined`, functions, throwing getters), with a `+N more` suffix beyond eight; it stays empty when nothing diagnostic can be said.

## Alternatives considered

**Wrap a single positional primitive into the object form and proceed.** Rejected: guessing the model's intent repeats the failure this note records — opaque rejections left the model guessing; the message teaches the corrective form `tools.${name}({ … })` instead.

**Reject every non-lossless-JSON argument shape uniformly.** Rejected: functions, dates, arrays, and objects keep the existing path so lossless-JSON semantics and their tests are unchanged; only the positional-primitive case is new.

**Leave the lossless-JSON rejection generic.** Rejected: `{ id: undefined }` told the model only that arguments were not lossless JSON, so it repeated the same call; `describeLossyProperties` names up to eight offending top-level properties, staying empty when nothing diagnostic can be said.

## Consequences

- Correctable failures now carry their fix in the message; observed in the wild as the positional-argument pitfall recorded for `run_code` users.
- The p3 self-heal patch (`replay-worker-binding-omitted-args`) is retired: the source now owns the `args === undefined ? {}` normalization it used to inject.
- Two new bootstrap spec cases pin the positional hint and the lossy-property diagnosis.
