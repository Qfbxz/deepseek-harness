/** Configuration resolution for deterministic tool-result pruning. */

import { deepFreeze } from '@deepseek-ai/dsh-llm'
import type { ResolvedConfig, ToolResultPruneConfig } from './types.ts'

/** Blank-line padding framing the truncation notice inside the retained text flow. */
const NOTICE_PAD = '\n\n'

/**
 * Build the fixed truncation notice substituted for one removed middle span.
 * The notice names the original size, the kept head and tail sizes, and the
 * paging next step, so the model sees what was cut and how to recover it.
 * @param originalChars - original text size of the pruned content, in Unicode code points.
 * @param headChars - retained leading code points.
 * @param tailChars - retained trailing code points.
 * @returns the notice framed by blank lines.
 */
export function truncationNotice(originalChars: number, headChars: number, tailChars: number): string {
  return `${NOTICE_PAD}[truncated] original ${originalChars} chars -> kept head ${headChars} + tail ${tailChars}; re-read specific ranges to page through the middle${NOTICE_PAD}`
}

/**
 * Notice width at the widest realistic digit count (`Number.MAX_SAFE_INTEGER`
 * per value). Config validation budgets this bound, so every emitted notice
 * fits the emitted-size contract whatever the original size is.
 */
export const TRUNCATION_NOTICE_MAX_CHARS = codePointLength(
  truncationNotice(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
)

/** Low-friction defaults for coding-agent tool output. */
export const DEFAULTS: ResolvedConfig = deepFreeze({
  thresholdChars: 8192,
  headChars: 4096,
  tailChars: 1024,
})

const CONFIG_KEYS: ReadonlySet<string> = new Set([
  'thresholdChars',
  'headChars',
  'tailChars',
])

/**
 * Count Unicode code points without splitting surrogate pairs.
 * @param text - text to measure.
 * @returns the Unicode code-point count.
 */
export function codePointLength(text: string): number {
  return Array.from(text).length
}

/**
 * Resolve and validate pruning budgets.
 * @param config - raw plugin configuration.
 * @returns a detached deeply immutable configuration.
 */
export function resolveConfig(config: ToolResultPruneConfig = {}): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Error(
        `ToolResultPruneConfig: unknown key "${key}" `
        + '(allowed: thresholdChars, headChars, tailChars)',
      )
    }
  }

  const resolved: ResolvedConfig = {
    thresholdChars: config.thresholdChars ?? DEFAULTS.thresholdChars,
    headChars: config.headChars ?? DEFAULTS.headChars,
    tailChars: config.tailChars ?? DEFAULTS.tailChars,
  }
  assertPositiveInteger('thresholdChars', resolved.thresholdChars)
  assertNonNegativeInteger('headChars', resolved.headChars)
  assertNonNegativeInteger('tailChars', resolved.tailChars)

  const emittedChars = resolved.headChars + TRUNCATION_NOTICE_MAX_CHARS + resolved.tailChars
  if (emittedChars > resolved.thresholdChars) {
    throw new Error(
      `ToolResultPruneConfig: headChars + truncation notice + tailChars (${emittedChars}) `
      + `must be at most thresholdChars (${resolved.thresholdChars})`,
    )
  }
  return deepFreeze(structuredClone(resolved))
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`ToolResultPruneConfig: ${name} (${value}) must be a positive integer`)
  }
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`ToolResultPruneConfig: ${name} (${value}) must be a non-negative integer`)
  }
}
