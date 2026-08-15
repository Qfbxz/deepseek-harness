# Agent Note: Two-row composer stats strip

Status: implemented

English | [中文](2026-08-15-stats-strip-two-rows.zh.md)

## Problem

The composer stats strip rendered every group — counts, wall times, speeds, cache hit, token totals — on one `nowrap` line that elided with an ellipsis on narrow viewports. The billing figures at the tail (cache hit, input/output) were the first to disappear, and the only recovery was the delayed hover tooltip, which required noticing the clip, hovering, and waiting 500 ms. On a long session the strip routinely hid the very numbers a user checks most.

## Decision

Split the strip into two centered rows with distinct homes: step-derived activity (counts, LLM/tool durations, TTFT/throughput) on the first, billing (cache hit, input/output tokens) on the second. Rows wrap within the message column instead of clipping, so every figure stays visible at any width. With nothing ever elided, the truncation machinery — the `ResizeObserver` measurement, the clipped state, and the delayed tooltip — is deleted rather than kept dormant; an empty row does not render, so a session without billing still shows a single activity row.

## Alternatives considered

**Keep the single row and rely on the tooltip.** The tooltip made the data reachable but not visible; the strip's job is glanceable totals, and a hidden figure is a missing figure.

**Let one row wrap freely.** Wrapping alone removes the clip, but the break position depends on width and locale, so the strip's height and the billing figures' position shift unpredictably. Two fixed homes keep the layout stable and the billing row addressable.

## Consequences

The strip can occupy two 20 px lines instead of one; the composer dock reserves that space only while billing data exists. StatsLine loses its tooltip dependency and its layout-effect render pass, and the spec now asserts the two-row split directly instead of asserting tooltip behavior.
