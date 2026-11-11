import { appendFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'

/** One line per answerer consultation — the snapshot's "how many prompts" metric. */
const CONSULTATION_MARKER = 'wp8-answerer-consultations.txt'

/**
 * WP8 cache-scenario interaction fixture: asks through the real
 * `tools/pre-execute` gate before every `todo_write` call and grants through
 * the real `approval/request` waterfall, recording one consultation line per
 * granted ask — the count the session approval cache must hold at one for two
 * identical calls.
 */
export const name = 'wp8-approval-fixture-cache'
export const inject = ['approval']

export function apply(ctx: Context): void {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (exec.name !== 'todo_write') return next()
    return { kind: 'ask', reason: 'wp8 fixture asks before every todo_write call' }
  })
  ctx.on('approval/request', (req: ApprovalRequest): Promise<ApprovalOutcome> => {
    appendFileSync(CONSULTATION_MARKER, `${req.callId ?? 'unknown-call'}\n`)
    return Promise.resolve('allowed-once')
  })
}
