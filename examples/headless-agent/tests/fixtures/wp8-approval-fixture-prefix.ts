import { appendFileSync, writeFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'

/** Where the recorded forbidden-persist refusal lands for the snapshot to read. */
const REFUSAL_MARKER = 'wp8-forbidden-prefix-refusal.txt'
/** One line per answerer consultation — the snapshot's "how many prompts" metric. */
const CONSULTATION_MARKER = 'wp8-answerer-consultations.txt'
/** Written only if the forbidden persistence unexpectedly succeeds — the snapshot treats its presence as a failure. */
const BUG_MARKER = 'wp8-forbidden-prefix-BUG-succeeded.txt'

/**
 * WP8 prefix-scenario interaction fixture: asks through the real
 * `tools/pre-execute` gate before every `bash` call that starts with `echo `
 * or `rm `, records one consultation line per answered ask, persists the
 * `echo` command prefix through the public service API on the first grant,
 * and attempts the forbidden `rm -rf` persistence whose service refusal this
 * fixture records before rejecting the call.
 */
export const name = 'wp8-approval-fixture-prefix'
export const inject = ['approval']

export function apply(ctx: Context): void {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (exec.name !== 'bash') return next()
    const command = commandOf(exec.arguments)
    if (!(command.startsWith('echo ') || command.startsWith('rm '))) return next()
    return { kind: 'ask', reason: `wp8 fixture asks before: ${command}` }
  })
  ctx.on('approval/request', (req: ApprovalRequest): Promise<ApprovalOutcome> => {
    appendFileSync(CONSULTATION_MARKER, `${req.callId ?? 'unknown-call'}\n`)
    const command = commandOf(req.arguments)
    if (command.startsWith('echo ')) {
      ctx.approval.persistPrefix(req.agent, req.toolName, ['echo'])
      return Promise.resolve('allowed-once')
    }
    if (command.startsWith('rm ')) {
      try {
        ctx.approval.persistPrefix(req.agent, req.toolName, ['rm', '-rf'])
        writeFileSync(BUG_MARKER, 'the forbidden persist unexpectedly succeeded\n')
      } catch (error) {
        writeFileSync(REFUSAL_MARKER, `${error instanceof Error ? error.message : String(error)}\n`)
      }
      return Promise.resolve('rejected')
    }
    return Promise.resolve('allowed-once')
  })
}

/** The `command` string member of a request's or execution's arguments. */
function commandOf(args: unknown): string {
  const command = (args as { command?: unknown } | undefined)?.command
  return typeof command === 'string' ? command : ''
}
