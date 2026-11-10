import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, CallId  } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as RepeatToolGuard from '@deepseek-ai/dsh-repeat-tool-reminder'
import type { Config } from '@deepseek-ai/dsh-repeat-tool-reminder'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const testToolSignal = new AbortController().signal

/**
 * Behavior suite for the repeat-tool-call guard: chain semantics (identical /
 * different-tracked / untracked-transparent / per-agent / resets), threshold
 * escalation incl. the `thresholds[0]` gentle-text rule, canonicalization,
 * fold-onto-downstream-decision, and fail-loud config validation — all driven
 * through a real agent loop against a scripted mock adapter (no network).
 */

/** Boot the core spine + the guard; the caller registers adapters and extra listeners. */
async function harness(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(RepeatToolGuard, config)
  ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'p', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
  ctx.tools.register(defineContentToolFixture({ name: 'other', description: 'o', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => { const d = ctx.on('agent/status', ({ agent: s, status: st }) => { if (s === agent && st === 'idle') { d(); resolve() } }) })
}

/** Every injected-context user message in the agent's log, flattened to joined text + source for terse assertions. */
function reminders(agent: Agent): { text: string; source: unknown }[] {
  return [...agent.session.events]
    .filter((e): e is SessionEvent<'user/message'> => e.type === 'user/message' && e.data.source.kind !== 'user')
    .map(e => ({
      text: e.data.content.map(block => block.type === 'text' ? block.text : '').join('|'),
      source: e.data.source,
    }))
}

// The reminder is a `notice`-form context; its summary names the repeated
// call so a reader sees it without expanding the row.
const guardSource = (tool: string, count: number) => ({
  kind: 'plugin',
  plugin: 'repeat-tool-reminder',
  form: 'notice',
  summary: `${tool} × ${count}`,
})

describe('threshold escalation', () => {
  it('reminds gently at the first default threshold (3) and in detail at the second (5)', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([
      ...Array.from({ length: 5 }, (_, i) => toolCallResponse(`c${i}`, 'probe', { q: 'same' })),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const found = reminders(agent)
    expect(found).toHaveLength(2)
    expect(found[0]!.text).toContain('repeating the exact same tool call')
    expect(found[0]!.source).toEqual(guardSource('probe', 3))
    expect(found[1]!.text).toContain('consecutive_calls: 5')
    expect(found[1]!.text).toContain('- tool: probe')
    expect(found[1]!.text).toContain('{"q":"same"}')
    expect(found[1]!.source).toEqual(guardSource('probe', 5))
  })

  it('keys the gentle text to thresholds[0], not the literal 3', async () => {
    const ctx = await harness({ thresholds: [4, 2] }) // unsorted on purpose: normalized ascending
    const adapter = new MockAdapter([
      ...Array.from({ length: 4 }, (_, i) => toolCallResponse(`c${i}`, 'probe', {})),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const found = reminders(agent)
    expect(found).toHaveLength(2)
    expect(found[0]!.text).toContain('repeating the exact same tool call') // gentle at 2
    expect(found[1]!.text).toContain('consecutive_calls: 4') // detailed at 4
  })
})

describe('chain semantics', () => {
  it('caps the detailed reminder arguments at argumentsPreviewChars (detection still keys on the full string)', async () => {
    const ctx = await harness({ thresholds: [2, 3], argumentsPreviewChars: 24 })
    const bigPayload = 'x'.repeat(400)
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', { body: bigPayload }),
      toolCallResponse('c2', 'probe', { body: bigPayload }),
      toolCallResponse('c3', 'probe', { body: bigPayload }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const found = reminders(agent)
    expect(found).toHaveLength(2) // gentle at 2, detailed at 3 — full-key matching survived the cap
    const detailed = found[1]!.text
    expect(detailed).toContain('- arguments: {"body":"xxxxxxxxxxxxxx') // 24-char head
    expect(detailed).toContain('… (+387 more chars)')
    expect(detailed).not.toContain(bigPayload)
  })

  it('a different tracked call resets the chain', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', { q: 1 }),
      toolCallResponse('c2', 'probe', { q: 1 }),
      toolCallResponse('c3', 'other', {}), // tracked, different → reset
      toolCallResponse('c4', 'probe', { q: 1 }),
      toolCallResponse('c5', 'probe', { q: 1 }),
      toolCallResponse('c6', 'probe', { q: 1 }), // 3rd consecutive AFTER the reset
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(reminders(agent)).toHaveLength(1)
  })

  it('excluded calls are transparent: they neither count nor reset', async () => {
    const ctx = await harness({ exclude: ['other'] })
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', { q: 1 }),
      toolCallResponse('c2', 'other', {}), // excluded → invisible to the chain
      toolCallResponse('c3', 'probe', { q: 1 }),
      toolCallResponse('c4', 'other', {}),
      toolCallResponse('c5', 'probe', { q: 1 }), // 3rd consecutive probe
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const found = reminders(agent)
    expect(found).toHaveLength(1)
    expect(found[0]!.text).toContain('repeating the exact same tool call')
  })

  it('include patterns track only matching tools (wildcard star)', async () => {
    const ctx = await harness({ include: ['pro*'] })
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'other', {}),
      toolCallResponse('c2', 'other', {}),
      toolCallResponse('c3', 'other', {}), // 3 identical, but untracked
      toolCallResponse('c4', 'probe', {}),
      toolCallResponse('c5', 'probe', {}),
      toolCallResponse('c6', 'probe', {}), // 3 identical, tracked
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const found = reminders(agent)
    expect(found).toHaveLength(1)
    expect(found[0]!.text).toContain('repeating the exact same tool call')
  })

  it('escapes regex metacharacters in patterns (a dot matches only a literal dot)', async () => {
    const ctx = await harness({ exclude: ['pr.be'] }) // would match 'probe' as a regex; must not as a wildcard
    const adapter = new MockAdapter([
      ...Array.from({ length: 3 }, (_, i) => toolCallResponse(`c${i}`, 'probe', {})),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(reminders(agent)).toHaveLength(1) // probe was NOT excluded
  })

  it('canonicalization ignores property order, deeply', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', { a: 1, nested: { x: [1, 2], y: null } }),
      toolCallResponse('c2', 'probe', { nested: { y: null, x: [1, 2] }, a: 1 }),
      toolCallResponse('c3', 'probe', { a: 1, nested: { x: [1, 2], y: null } }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(reminders(agent)).toHaveLength(1) // all three canonicalize identically
  })

  it('keys chains per agent: one agent repeating never trips another', async () => {
    const ctx = await harness()
    ctx.llm.registerAdapter(['mock-a'], new MockAdapter([
      toolCallResponse('a1', 'probe', { q: 1 }),
      toolCallResponse('a2', 'probe', { q: 1 }),
      textResponse('done'),
    ]))
    ctx.llm.registerAdapter(['mock-b'], new MockAdapter([
      toolCallResponse('b1', 'probe', { q: 1 }),
      toolCallResponse('b2', 'probe', { q: 1 }),
      toolCallResponse('b3', 'probe', { q: 1 }),
      textResponse('done'),
    ]))
    const agentA = ctx.agentLoop.create(SessionId('a'), { provider: 'mock-a', model: 'model-a' })
    const agentB = ctx.agentLoop.create(SessionId('b'), { provider: 'mock-b', model: 'model-b' })
    agentA.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    agentB.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await Promise.all([waitForIdle(ctx, agentA), waitForIdle(ctx, agentB)])

    expect(reminders(agentA)).toHaveLength(0) // 2 repeats < 3, despite B's 3 in the same registry
    expect(reminders(agentB)).toHaveLength(1)
  })

  it('a new user prompt resets the chain', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', { q: 1 }),
      toolCallResponse('c2', 'probe', { q: 1 }),
      textResponse('turn one done'),
      toolCallResponse('c3', 'probe', { q: 1 }), // without the reset this would be the 3rd
      textResponse('turn two done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(reminders(agent)).toHaveLength(0)
  })

  it('drops an agent chain on disposal', async () => {
    const ctx = await harness({ thresholds: [2] })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('c1', 'probe', { q: 1 }),
      textResponse('done'),
      toolCallResponse('c2', 'probe', { q: 1 }), // same id, fresh agent: count 1, not 2
      textResponse('done'),
    ]))
    // Loop agents are torn down by disposing the scope that created them
    // (the loop.spec pattern): a child plugin fiber owns `first`.
    let first!: Agent
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      first = inner.agentLoop.create(SessionId('reused'), { provider: 'mock', model: 'mock' })
    }, { inject: ['agentLoop'] }))
    first.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, first)
    await fiber.dispose()
    await first.whenIdle()

    const second = ctx.agentLoop.create(SessionId('reused'), { provider: 'mock', model: 'mock' })
    second.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, second)

    expect(reminders(second)).toHaveLength(0)
  })

  it('counts denied calls: hammering a denied tool still draws the reminder', async () => {
    const ctx = await harness({ thresholds: [2] })
    ctx.on('tools/pre-execute', async () => ({ kind: 'deny' as const, reason: 'sealed' }))
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', { q: 1 }),
      toolCallResponse('c2', 'probe', { q: 1 }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(reminders(agent)).toHaveLength(1)
  })

  it('ignores direct executes with no agent (they neither crash nor advance any chain)', async () => {
    const ctx = await harness({ thresholds: [2] })
    const direct = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('d1'), name: 'probe', arguments: { q: 1 } })
    expect(direct.isError).toBe(false)

    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('c1', 'probe', { q: 1 }), // if the direct call had counted, this would be #2
      textResponse('done'),
    ]))
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(reminders(agent)).toHaveLength(0)
  })
})

describe('fold onto the downstream decision', () => {
  it('folds the reminder onto a downstream block and keeps its feedback', async () => {
    const ctx = await harness({ thresholds: [2] })
    ctx.on('tools/post-execute', async () => ({
      kind: 'block' as const,
      feedback: [{ type: 'text' as const, text: 'nope' }],
      additionalContexts: [createUserMessage({
        content: [{ type: 'text' as const, text: 'downstream-ctx' }], source: { kind: 'plugin' as const, plugin: 'test' },
      })],
    }))
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', { q: 1 }),
      toolCallResponse('c2', 'probe', { q: 1 }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const found = reminders(agent)
    expect(found).toHaveLength(3)
    // Only the repeated call adds guard context; downstream source fields survive.
    expect(found[0]!.text).toBe('downstream-ctx')
    expect(found[0]!.source).toEqual({ kind: 'plugin', plugin: 'test' })
    expect(found[1]!.text).toContain('repeating the exact same tool call')
    expect(found[1]!.source).toEqual(guardSource('probe', 2))
    expect(found[2]).toEqual({ text: 'downstream-ctx', source: { kind: 'plugin', plugin: 'test' } })
    // The block's feedback reached the tool result unchanged.
    const results = [...agent.session.events].filter((e): e is SessionEvent<'tool/result'> => e.type === 'tool/result')
    expect(results.every(r => r.data.message.content[0].isError)).toBe(true)
    expect(results[1]!.data.message.content[0].content).toEqual([{ type: 'text', text: 'nope' }])
  })

  it('preserves a downstream canonical value replacement while folding', async () => {
    const ctx = await harness({ thresholds: [2] })
    ctx.on('tools/post-execute', async () => ({
      kind: 'accept' as const,
      value: [{ type: 'text' as const, text: 'replaced' }],
    }))
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', { q: 1 }),
      toolCallResponse('c2', 'probe', { q: 1 }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const found = reminders(agent)
    expect(found).toHaveLength(1)
    expect(found[0]!.text).toContain('repeating the exact same tool call')
    const results = [...agent.session.events].filter((e): e is SessionEvent<'tool/result'> => e.type === 'tool/result')
    expect(results[1]!.data.message.content[0].content).toEqual([{ type: 'text', text: 'replaced' }])
  })
})

describe('config validation fails loud', () => {
  async function spine(): Promise<Context> {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    return ctx
  }

  it('rejects an empty thresholds list', async () => {
    const ctx = await spine()
    await expect(ctx.plugin(RepeatToolGuard, { thresholds: [] })).rejects.toThrow(/must not be empty/)
  })

  it('rejects a threshold below 2', async () => {
    const ctx = await spine()
    await expect(ctx.plugin(RepeatToolGuard, { thresholds: [1, 3] })).rejects.toThrow(/integer >= 2/)
  })

  it('rejects a non-integer threshold', async () => {
    const ctx = await spine()
    await expect(ctx.plugin(RepeatToolGuard, { thresholds: [2.5] })).rejects.toThrow(/integer >= 2/)
  })

  it('rejects duplicate thresholds', async () => {
    const ctx = await spine()
    await expect(ctx.plugin(RepeatToolGuard, { thresholds: [3, 3] })).rejects.toThrow(/duplicates/)
  })

  it('rejects a non-positive or fractional argumentsPreviewChars', async () => {
    const ctx = await spine()
    await expect(ctx.plugin(RepeatToolGuard, { argumentsPreviewChars: 0 })).rejects.toThrow(/argumentsPreviewChars/)
    const ctx2 = await spine()
    await expect(ctx2.plugin(RepeatToolGuard, { argumentsPreviewChars: 12.5 })).rejects.toThrow(/argumentsPreviewChars/)
  })

  it('rejects a negative or fractional forceStopStreak', async () => {
    const ctx = await spine()
    await expect(ctx.plugin(RepeatToolGuard, { forceStopStreak: -1 })).rejects.toThrow(/forceStopStreak/)
    const ctx2 = await spine()
    await expect(ctx2.plugin(RepeatToolGuard, { forceStopStreak: 12.5 })).rejects.toThrow(/forceStopStreak/)
  })

  it('accepts forceStopStreak 0 (the disable value)', async () => {
    const ctx = await spine()
    await expect(ctx.plugin(RepeatToolGuard, { forceStopStreak: 0 })).resolves.toBeDefined()
  })
})

describe('force stop', () => {
  /** Every committed dispatch result's `concludesTurn`, captured downstream of the guard. */
  function captureConclusions(ctx: Context): boolean[] {
    const conclusions: boolean[] = []
    ctx.on('tools/post-execute', async (_exec, result, next) => {
      conclusions.push(result.concludesTurn === true)
      return next()
    })
    return conclusions
  }

  it('force-stops at the configured streak: marks the call, injects the stop instruction, and ends the turn', async () => {
    const ctx = await harness({ thresholds: [2], forceStopStreak: 3 })
    const conclusions = captureConclusions(ctx)
    const adapter = new MockAdapter([
      toolCallResponse('c0', 'probe', { q: 'same' }),
      toolCallResponse('c1', 'probe', { q: 'same' }),
      toolCallResponse('c2', 'probe', { q: 'same' }),
      textResponse('SUMMARY_AFTER_FORCE_STOP'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const found = reminders(agent)
    expect(found).toHaveLength(2) // gentle reminder at 2, force stop at 3
    expect(found[0]!.text).toContain('repeating the exact same tool call')
    expect(found[1]!.text).toContain('停止工具调用，改用文字总结当前进展与结论')
    expect(found[1]!.text).toContain('(Force stop: 3 consecutive identical calls to probe.)')
    expect(found[1]!.source).toEqual({
      kind: 'plugin',
      plugin: 'repeat-tool-reminder',
      form: 'notice',
      summary: 'probe × 3 force-stop',
    })
    // The threshold call is the one marked; earlier calls carry no marker.
    expect(conclusions).toEqual([false, false, true])
    // Exactly one summary request after the force stop: the turn ended through
    // the ordinary conclusion path once the instruction was delivered.
    expect(adapter.requests).toHaveLength(4)
    expect(JSON.stringify(adapter.requests[3]!.messages)).toContain('停止工具调用')
    const turnEnd = agent.session.events.findLast(e => e.type === 'turn/end')
    expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason).toEqual({ kind: 'completed' })
  })

  it('forceStopStreak 0 keeps only the reminder ladder (no stop instruction, no marker)', async () => {
    const ctx = await harness({ thresholds: [2], forceStopStreak: 0 })
    const conclusions = captureConclusions(ctx)
    const adapter = new MockAdapter([
      toolCallResponse('c0', 'probe', { q: 'same' }),
      toolCallResponse('c1', 'probe', { q: 'same' }),
      toolCallResponse('c2', 'probe', { q: 'same' }),
      textResponse('model chose to stop'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const found = reminders(agent)
    expect(found).toHaveLength(1)
    expect(found[0]!.text).toContain('repeating the exact same tool call')
    expect(JSON.stringify(agent.session.events)).not.toContain('停止工具调用')
    expect(conclusions).toEqual([false, false, false])
    expect(adapter.requests).toHaveLength(4)
  })

  it('fires at the default streak of 12 below the default ladder', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([
      ...Array.from({ length: 12 }, (_, i) => toolCallResponse(`c${i}`, 'probe', { q: 'same' })),
      textResponse('summarized at the default force stop'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const found = reminders(agent)
    expect(found).toHaveLength(4) // 3, 5, 8 ladder + force stop at 12
    expect(found[0]!.text).toContain('repeating the exact same tool call')
    expect(found[1]!.text).toContain('consecutive_calls: 5')
    expect(found[2]!.text).toContain('consecutive_calls: 8')
    expect(found[3]!.text).toContain('停止工具调用，改用文字总结当前进展与结论')
    expect(found[3]!.text).toContain('(Force stop: 12 consecutive identical calls to probe.)')
    expect(adapter.requests).toHaveLength(13)
  })
})

describe('same-step duplicate reuse', () => {
  /** Chunk entry streaming two tool calls in ONE assistant message. */
  function twoCallResponse(
    id1: string, name1: string, args1: object,
    id2: string, name2: string, args2: object,
  ): ReturnType<typeof toolCallResponse> {
    const chunks: ReturnType<typeof toolCallResponse> = []
    let index = 0
    for (const [id, name, args] of [[id1, name1, args1], [id2, name2, args2]] as const) {
      const callId = CallId(id)
      const argumentsJson = JSON.stringify(args)
      chunks.push(
        { type: 'block-start', index, blockType: 'tool-call' },
        { type: 'tool-call-delta', index, id: callId, name, argumentsDelta: argumentsJson },
        { type: 'block-end', index, block: { type: 'tool-call', id: callId, name, arguments: argumentsJson } },
      )
      index += 1
    }
    chunks.push(
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    )
    return chunks
  }

  /** Harness variant with a counted tool whose body the test controls. */
  async function countingHarness(config: Config = {}, isConcurrencySafe?: (args: unknown) => boolean) {
    const ctx = await harness(config)
    let executions = 0
    ctx.tools.register(defineContentToolFixture({
      name: 'counting',
      description: 'c',
      parameters: { q: { type: 'json' } },
      ...(isConcurrencySafe === undefined ? {} : { isConcurrencySafe: (): boolean => isConcurrencySafe({}) }),
      async execute() {
        executions += 1
        return [{ type: 'text', text: `run ${executions}` }]
      },
    }))
    return { ctx, executions: () => executions }
  }

  it('reuses the recorded result for an exact same-step duplicate without re-executing', async () => {
    const { ctx, executions } = await countingHarness()
    const adapter = new MockAdapter([
      twoCallResponse('d1', 'counting', { q: 7 }, 'd2', 'counting', { q: 7 }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(executions()).toBe(1)
    const results = [...agent.session.events].filter((e): e is SessionEvent<'tool/result'> => e.type === 'tool/result')
    expect(results).toHaveLength(2)
    expect(results[0]!.data.message.content[0].content).toEqual([{ type: 'text', text: 'run 1' }])
    // The duplicate carries the recorded content plus the pinned annotation
    // as injected context, model-visible on the next request.
    expect(JSON.stringify(agent.session.events)).toContain('duplicate of an earlier call in this step; recorded result reused')
    expect(JSON.stringify(adapter.requests[1]!.messages)).toContain('duplicate of an earlier call in this step; recorded result reused')
    // Both calls are logged attempts: the repeat chain advanced across both
    // (two identical attempts), though the default ladder only speaks at 3/5/8.
    const found = reminders(agent)
    expect(found).toHaveLength(1)
    expect(found[0]!.source).toEqual({
      kind: 'plugin',
      plugin: 'repeat-tool-reminder',
      form: 'notice',
      summary: 'counting (duplicate reuse)',
    })
  })

  it('does not dedupe calls whose arguments are not exactly equal (same step)', async () => {
    const { ctx, executions } = await countingHarness()
    const adapter = new MockAdapter([
      twoCallResponse('d1', 'counting', { q: 7 }, 'd2', 'counting', { q: 8 }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(executions()).toBe(2)
    expect(JSON.stringify(agent.session.events)).not.toContain('duplicate of an earlier call in this step')
  })

  it('does not dedupe the same arguments across steps', async () => {
    const { ctx, executions } = await countingHarness()
    const adapter = new MockAdapter([
      toolCallResponse('s1', 'counting', { q: 7 }),
      toolCallResponse('s2', 'counting', { q: 7 }), // next step: identical call runs again
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(executions()).toBe(2)
    expect(JSON.stringify(agent.session.events)).not.toContain('duplicate of an earlier call in this step')
  })

  it('canonicalizes deep property order before matching (order-only variants are duplicates)', async () => {
    const { ctx, executions } = await countingHarness()
    const adapter = new MockAdapter([
      twoCallResponse('d1', 'counting', { a: 1, nested: { x: 2, y: 3 } }, 'd2', 'counting', { nested: { y: 3, x: 2 }, a: 1 }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(executions()).toBe(1)
    expect(JSON.stringify(agent.session.events)).toContain('duplicate of an earlier call in this step')
  })

  it('reuses without racing an in-flight parallel duplicate', async () => {
    const { ctx, executions } = await countingHarness({}, () => true)
    const adapter = new MockAdapter([
      twoCallResponse('p1', 'counting', { q: 'parallel' }, 'p2', 'counting', { q: 'parallel' }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(executions()).toBe(1)
    const results = [...agent.session.events].filter((e): e is SessionEvent<'tool/result'> => e.type === 'tool/result')
    expect(results).toHaveLength(2)
    expect(JSON.stringify(agent.session.events)).toContain('duplicate of an earlier call in this step')
  })

  it('propagates the first call scheduler failure to an in-flight duplicate instead of fabricating a result', async () => {
    const { ctx, executions } = await countingHarness({}, () => true)
    ctx.on('tools/execute', async (exec, next) => {
      if (exec.name === 'counting') throw new Error('wrapper exploded')
      return next()
    })
    const adapter = new MockAdapter([
      twoCallResponse('p1', 'counting', { q: 'parallel' }, 'p2', 'counting', { q: 'parallel' }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(executions()).toBe(0)
    const results = [...agent.session.events].filter((e): e is SessionEvent<'tool/result'> => e.type === 'tool/result')
    expect(results).toHaveLength(2)
    expect(results.every(r => r.data.message.content[0].isError)).toBe(true)
    expect(JSON.stringify(agent.session.events)).toContain('wrapper exploded')
  })
})
