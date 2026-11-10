/** Shared agent-loop scheduler defaults.
 * @module dsh-agent-loop/constants
 */

/** Default maximum in-flight parallel-safe calls per agent step. */
export const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10

/** Default per-turn tool-call admission budget; `0` disables the budget. */
export const DEFAULT_MAX_TOOL_CALLS_PER_TURN = 200

/** Canonical error code for a model call skipped by the turn tool-call budget. */
export const TOOL_CALL_BUDGET_EXHAUSTED = 'TOOL_CALL_BUDGET_EXHAUSTED'
