import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId , createMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import SessionStore, {
  Session,
  SessionId,
} from '@deepseek-ai/dsh-session'
import type { SurfaceEvent } from '@deepseek-ai/dsh-session'
import * as SessionInvariant from '@deepseek-ai/dsh-session/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import ToolResultPruner, {
  codePointLength,
  DEFAULTS,
  resolveConfig,
  TRUNCATION_NOTICE_MAX_CHARS,
  truncationNotice,
} from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import type { ToolResultPruneConfig } from '@deepseek-ai/dsh-compaction-tool-result-pruner'

const MODEL = 'test-model'
const SMALL: ToolResultPruneConfig = {
  thresholdChars: 200,
  headChars: 4,
  tailChars: 3,
}
/** The verbatim notice the pruner must emit for a 300-char input at SMALL budgets. */
const NOTICE_300 = '\n\n[truncated] original 300 chars -> kept head 4 + tail 3; re-read specific ranges to page through the middle\n\n'

function service(config: ToolResultPruneConfig = SMALL): ToolResultPruner {
  const ctx = new Context()
  // Service constructors self-register, so `ctx.tokenMeter` resolves for the
  // shadow-price pricing without a full plugin boot.
  void new TokenMeter(ctx)
  return new ToolResultPruner(ctx, config)
}

/** Pricing oracle mirroring the service's estimator for expectations. */
const METER = new TokenMeter(new Context())

function appendToolStep(
  session: Session,
  turn: number,
  call: string,
  content: ContentBlock[],
  extra: Record<string, unknown> = {},
): number {
  const callId = CallId(call)
  session.append('turn/start', {
    turn,
  })
  session.append('step/start', { turn, step: 1 })
  session.append('assistant/message', {
    turn,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'tool-call', id: callId, name: 'bash', arguments: '{}' }],
      source: {
        kind: 'model',
        ...{ provider: MODEL, model: MODEL },
      },
    }),
  }, { surfaceOp: 'append' })
  session.append('tool/call', { turn, step: 1, callId, name: 'bash', arguments: '{}' })
  const result = session.append('tool/result', {
    turn,
    step: 1,
    message: createToolResultMessage({ callId, content, isError: false }),
    ...extra,
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
  return result.seq
}

describe('tool-result pruning configuration', () => {
  it('resolves detached immutable defaults and partial overrides', () => {
    const raw = { thresholdChars: 300, headChars: 20, tailChars: 10 }
    const resolved = resolveConfig(raw)
    raw.headChars = 1
    expect(resolved).toEqual({ thresholdChars: 300, headChars: 20, tailChars: 10 })
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(DEFAULTS).toEqual({ thresholdChars: 8192, headChars: 4096, tailChars: 1024 })
    expect(Object.isFrozen(DEFAULTS)).toBe(true)
  })

  it('sizes the validation bound at the widest notice the convention can emit', () => {
    const widest = Number.MAX_SAFE_INTEGER
    expect(TRUNCATION_NOTICE_MAX_CHARS).toBe(codePointLength(truncationNotice(widest, widest, widest)))
    expect(TRUNCATION_NOTICE_MAX_CHARS).toBeGreaterThan(codePointLength(truncationNotice(1, 1, 1)))
  })

  it('rejects stale keys, invalid scalars, and an output budget above threshold', () => {
    const bad = [
      [{ thresholdChars: 0 }, /thresholdChars .* positive integer/],
      [{ headChars: -1 }, /headChars .* non-negative integer/],
      [{ tailChars: 1.5 }, /tailChars .* non-negative integer/],
      [{ thresholdChars: 160, headChars: 20, tailChars: 10 }, /headChars \+ truncation notice \+ tailChars/],
      // Valid before the notice carried sizes: the budget now includes the
      // notice width, so tight legacy budgets fail loud at load.
      [{ thresholdChars: 100, headChars: 20, tailChars: 10 }, /headChars \+ truncation notice \+ tailChars/],
      [{ threshold: 10 }, /unknown key "threshold"/],
    ] as Array<[unknown, RegExp]>
    for (const [config, pattern] of bad) {
      expect(() => resolveConfig(config as ToolResultPruneConfig)).toThrow(pattern)
    }
  })

  it('accepts a budget sized exactly at the widest-notice bound', () => {
    const bound = TRUNCATION_NOTICE_MAX_CHARS
    expect(resolveConfig({ thresholdChars: bound + 30, headChars: 20, tailChars: 10 }))
      .toEqual({ thresholdChars: bound + 30, headChars: 20, tailChars: 10 })
    expect(() => resolveConfig({ thresholdChars: bound + 29, headChars: 20, tailChars: 10 }))
      .toThrow(/headChars \+ truncation notice \+ tailChars/)
  })
})

describe('ToolResultPruner content transform', () => {
  it('measures text code points only and skips content within threshold', () => {
    const prune = service()
    const blocks = [
      { type: 'text', text: 'a😀b' },
      { type: 'reasoning', text: 'not measured' },
    ] satisfies ContentBlock[]
    expect(prune.measureContent(blocks)).toBe(3)
    expect(prune.pruneContent(blocks)).toBeNull()
    expect(codePointLength('a😀b')).toBe(3)
  })

  it('keeps configured head and tail without splitting surrogate pairs', () => {
    const prune = service()
    const result = prune.pruneContent([{ type: 'text', text: '😀'.repeat(210) }])
    expect(result).toEqual([{
      type: 'text',
      text: `${'😀'.repeat(4)}${truncationNotice(210, 4, 3)}${'😀'.repeat(3)}`,
    }])
    expect(prune.measureContent(result!)).toBeLessThanOrEqual(200)
    expect(result![0]).toMatchObject({ type: 'text' })
    expect((result![0] as { text: string }).text).not.toContain('\uFFFD')
  })

  it('emits the verbatim notice with original and kept sizes on a success result', () => {
    const prune = service()
    const result = prune.pruneContent([{ type: 'text', text: 'x'.repeat(300) }])
    expect(result).toEqual([{ type: 'text', text: `xxxx${NOTICE_300}xxx` }])
    expect(prune.measureContent(result!)).toBeLessThanOrEqual(200)
  })

  it('preserves non-text blocks and their relative ordering across removed text', () => {
    const prune = service()
    const reasoning: ContentBlock = { type: 'reasoning', text: 'private-rich-block' }
    const call: ContentBlock = {
      type: 'tool-call',
      id: CallId('nested'),
      name: 'nested',
      arguments: '{}',
    }
    const result = prune.pruneContent([
      { type: 'text', text: 'A'.repeat(220) },
      reasoning,
      { type: 'text', text: 'B'.repeat(30) },
      call,
      { type: 'text', text: 'C'.repeat(60) },
    ])
    expect(result).toEqual([
      { type: 'text', text: `AAAA${truncationNotice(310, 4, 3)}` },
      reasoning,
      call,
      { type: 'text', text: 'CCC' },
    ])
    expect(prune.measureContent(result!)).toBeLessThanOrEqual(200)
  })

  it('supports zero-sized head and tail while still shrinking', () => {
    const prune = service({
      thresholdChars: 200,
      headChars: 0,
      tailChars: 0,
    })
    const result = prune.pruneContent([{ type: 'text', text: 'x'.repeat(300) }])
    expect(result).toEqual([{ type: 'text', text: truncationNotice(300, 0, 0) }])
    expect(prune.measureContent(result!)).toBe(codePointLength(truncationNotice(300, 0, 0)))
    expect(prune.measureContent(result!)).toBeLessThanOrEqual(200)
  })
})

describe('ToolResultPruner session transaction', () => {
  it('prunes a stable snapshot, preserves all data, and cites the replaced result', () => {
    const session = Session.create(SessionId('preserve'))
    const originalSeq = appendToolStep(session, 1, 'one', [{
      type: 'text',
      text: 'x'.repeat(300),
    }], {
      isError: true,
      error: { name: 'ExitError', code: 'EXIT_1' },
      meta: { diff: ['a', 'b'] },
      futureField: { nested: true },
    })
    session.append('turn/start', {
      turn: 2,
    })

    const result = service().pruneSession(session)
    expect(result.pruned).toHaveLength(1)
    expect(result.charsRemoved).toBeGreaterThan(0)
    const entry = result.pruned[0]!
    expect(entry).toMatchObject({ originalSeq, callId: CallId('one'), charsBefore: 300 })
    expect(entry.charsAfter).toBeLessThanOrEqual(200)

    const original = session.events[originalSeq]!
    const replacement = session.events[entry.replacementSeq]! as SurfaceEvent
    expect(original).toMatchObject({
      type: 'tool/result',
      data: {
        message: {
          content: [{
            type: 'tool-result',
            content: [{ type: 'text', text: 'x'.repeat(300) }],
          }],
        },
      },
    })
    // Error results carry the same suffix convention as success results: the
    // identical notice, with the error envelope fields preserved untouched.
    expect((replacement.data as { message: { content: { content: ContentBlock[] }[] } }).message.content[0]!.content)
      .toEqual([{ type: 'text', text: `xxxx${NOTICE_300}xxx` }])
    expect(replacement).toMatchObject({
      type: 'tool/result',
      data: {
        turn: 1,
        step: 1,
        isError: true,
        message: {
          source: { kind: 'tool', callId: CallId('one') },
        },
        error: { name: 'ExitError', code: 'EXIT_1' },
        meta: { diff: ['a', 'b'] },
        futureField: { nested: true },
      },
      surfaceOp: { op: 'replace', start: originalSeq, end: originalSeq },
      sourceEventSeqs: [originalSeq],
    })
    expect(session.surface.nodes).not.toContain(originalSeq)

    // Shadow-price protocol: the metering event sits directly before the
    // replacement and prices the shadowed node with the shared estimator.
    if (original.type !== 'tool/result') throw new Error('original is not a tool/result')
    expect(session.events[entry.replacementSeq - 1]).toMatchObject({
      type: 'compaction/prune',
      data: {
        shadowedRange: { start: originalSeq, end: originalSeq },
        shadowedSeqs: [originalSeq],
        shadowedTokenCount: METER.estimateMessage(original.data.message),
      },
    })
  })

  it('emits the same verbatim notice on a non-error result', () => {
    const session = Session.create(SessionId('success-suffix'))
    appendToolStep(session, 1, 'ok', [{ type: 'text', text: 'x'.repeat(300) }])
    session.append('turn/start', {
      turn: 2,
    })

    const result = service().pruneSession(session)
    const replacement = session.events[result.pruned[0]!.replacementSeq]! as SurfaceEvent
    expect((replacement.data as { message: { content: { content: ContentBlock[] }[] } }).message.content[0]!.content)
      .toEqual([{ type: 'text', text: `xxxx${NOTICE_300}xxx` }])
  })

  it('prunes multiple results, skips short ones, and converges in one pass', () => {
    const session = Session.create(SessionId('multiple'))
    appendToolStep(session, 1, 'a', [{ type: 'text', text: 'A'.repeat(300) }])
    appendToolStep(session, 2, 'b', [{ type: 'text', text: 'short' }])
    appendToolStep(session, 3, 'c', [{ type: 'text', text: 'C'.repeat(250) }])
    session.append('turn/start', {
      turn: 4,
    })
    const prune = service()
    const first = prune.pruneSession(session)
    const second = prune.pruneSession(session)
    expect(first.pruned.map(entry => entry.callId)).toEqual([CallId('a'), CallId('c')])
    expect(first.charsRemoved).toBe(
      first.pruned.reduce((sum, entry) => sum + entry.charsBefore - entry.charsAfter, 0),
    )
    expect(second).toEqual({ pruned: [], charsRemoved: 0 })
  })

  it('replays to the identical pruned model messages', () => {
    const session = Session.create(SessionId('replay'))
    appendToolStep(session, 1, 'a', [{ type: 'text', text: 'A'.repeat(300) }])
    session.append('turn/start', {
      turn: 2,
    })
    service().pruneSession(session)
    const replay = Session.create(session.id, [...session.events])
    expect(replay.deriveMessages()).toEqual(session.deriveMessages())
    expect(replay.surface.replaceGeneration).toBe(session.surface.replaceGeneration)
  })

  it('runs under real invariants between closed steps but not outside a turn', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(SessionInvariant)
    await ctx.plugin(TokenMeter)
    const prune = new ToolResultPruner(ctx, SMALL)
    const session = ctx.sessions.create(SessionId('invariants'))
    appendToolStep(session, 1, 'a', [{ type: 'text', text: 'A'.repeat(300) }])
    expect(() => prune.pruneSession(session)).toThrow(/outside any open turn/)
    session.append('turn/start', {
      turn: 2,
    })
    expect(() => prune.pruneSession(session)).not.toThrow()
  })
})
