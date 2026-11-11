/** Turn tool-call budget (`maxToolCallsPerTurn`): admission, skip results, notice, and config validation. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, CallId } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, TurnEndReason } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'

import AgentLoop, { TOOL_CALL_BUDGET_EXHAUSTED } from '@deepseek-ai/dsh-agent-loop'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'

async function harness(adapter: MockAdapter, loopConfig: Record<string, unknown> = {}) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [], ...loopConfig })
  ctx.llm.registerAdapter(['mock'], adapter)
  let executions = 0
  ctx.tools.register(defineContentToolFixture({
    name: 'counting',
    description: 'counted tool',
    parameters: {},
    async execute() {
      executions += 1
      return [{ type: 'text', text: `run ${executions}` }]
    },
  }))
  return { ctx, executions: () => executions }
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

/** Chunk entry streaming `count` parallel-safe tool calls in ONE assistant message. */
function multiCallResponse(name: string, count: number): StreamChunk[] {
  const chunks: StreamChunk[] = []
  for (let index = 0; index < count; index++) {
    const callId = CallId(`m${index}`)
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'tool-call-delta', index, id: callId, name, argumentsDelta: '{}' },
      { type: 'block-end', index, block: { type: 'tool-call', id: callId, name, arguments: '{}' } },
    )
  }
  chunks.push(
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  )
  return chunks
}

function results(agent: Agent) {
  return [...agent.session.events].filter((e): e is import('@deepseek-ai/dsh-session').SessionEvent<'tool/result'> => e.type === 'tool/result')
}

function budgetNotices(agent: Agent) {
  return agent.session.events.filter((e): e is import('@deepseek-ai/dsh-session').SessionEvent<'user/message'> =>
    e.type === 'user/message'
    && e.data.source.kind === 'plugin'
    && e.data.source.plugin === 'agent-loop')
}

describe('turn tool-call budget', () => {
  it('maxToolCallsPerTurn 0 disables the budget: every call runs, no notice', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'counting', {}),
      toolCallResponse('c2', 'counting', {}),
      toolCallResponse('c3', 'counting', {}),
      textResponse('done'),
    ])
    const { ctx, executions } = await harness(adapter, { maxToolCallsPerTurn: 0 })
    const agent = ctx.agentLoop.create(SessionId('budget-off'), { provider: 'mock', model: 'mock' })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    expect(executions()).toBe(3)
    expect(results(agent)).toHaveLength(3)
    expect(results(agent).every(r => !r.data.message.content[0].isError)).toBe(true)
    expect(budgetNotices(agent)).toHaveLength(0)
    expect(JSON.stringify(agent.session.events)).not.toContain('Tool-call budget exhausted')
  })

  it('cuts the batch at the budget, commits skipped results, and ends the turn with a model-visible notice', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'counting', {}),
      toolCallResponse('c2', 'counting', {}),
      toolCallResponse('c3', 'counting', {}),
      textResponse('summarized after the budget event'),
    ])
    const { ctx, executions } = await harness(adapter, { maxToolCallsPerTurn: 2 })
    const agent = ctx.agentLoop.create(SessionId('budget-cut'), { provider: 'mock', model: 'mock' })

    const reasons: TurnEndReason[] = []
    ctx.on('session/event', (_s, event) => { if (event.type === 'turn/end') reasons.push(event.data.reason) })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    expect(executions()).toBe(2)
    const committed = results(agent)
    expect(committed).toHaveLength(3)
    const skipped = committed[2]!
    expect(skipped.data.message.content[0].isError).toBe(true)
    expect(skipped.data.error?.code).toBe(TOOL_CALL_BUDGET_EXHAUSTED)
    expect(JSON.stringify(skipped.data.message.content[0])).toContain('tool-call budget of 2')
    expect(budgetNotices(agent)).toHaveLength(1)
    expect(JSON.stringify(budgetNotices(agent)[0]?.data)).toContain('Tool-call budget exhausted')
    expect(JSON.stringify(budgetNotices(agent)[0]?.data)).toContain('maxToolCallsPerTurn')
    // The model saw the reason: the summary request derives the skipped result
    // and the notice.
    expect(adapter.requests).toHaveLength(4)
    const finalMessages = JSON.stringify(adapter.requests[3]!.messages)
    expect(finalMessages).toContain('Tool-call budget exhausted')
    expect(finalMessages).toContain('tool call not executed')
    expect(reasons).toEqual([{ kind: 'completed' }])
  })

  it('notifies once per turn and skips later over-budget steps without repeating the notice', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'counting', {}),
      toolCallResponse('c2', 'counting', {}),
      toolCallResponse('c3', 'counting', {}),
    ])
    const { ctx, executions } = await harness(adapter, { maxToolCallsPerTurn: 1 })
    const agent = ctx.agentLoop.create(SessionId('budget-once'), { provider: 'mock', model: 'mock' })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    expect(executions()).toBe(1)
    const committed = results(agent)
    expect(committed).toHaveLength(3)
    expect(committed.filter(r => r.data.error?.code === TOOL_CALL_BUDGET_EXHAUSTED)).toHaveLength(2)
    expect(budgetNotices(agent)).toHaveLength(1)
    // The notice step made one more tool-calling attempt (#3, skipped); the
    // sticky conclusion then closed the turn with an empty queue — no fourth
    // model call.
    expect(adapter.requests).toHaveLength(3)
  })

  it('slices a parallel batch at the budget: admitted calls run, the rest are skipped', async () => {
    const adapter = new MockAdapter([
      multiCallResponse('counting', 3),
      textResponse('done'),
    ])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [], maxToolCallsPerTurn: 2 })
    ctx.llm.registerAdapter(['mock'], adapter)
    let executions = 0
    ctx.tools.register(defineContentToolFixture({
      name: 'counting',
      description: 'parallel-safe tool',
      parameters: {},
      isConcurrencySafe: () => true,
      async execute() {
        executions += 1
        return [{ type: 'text', text: `run ${executions}` }]
      },
    }))
    const agent = ctx.agentLoop.create(SessionId('budget-parallel'), { provider: 'mock', model: 'mock' })

    send(agent, 'go')
    await waitForIdle(ctx, agent)

    expect(executions).toBe(2)
    const committed = results(agent)
    expect(committed).toHaveLength(3)
    expect(committed[2]!.data.error?.code).toBe(TOOL_CALL_BUDGET_EXHAUSTED)
    expect(budgetNotices(agent)).toHaveLength(1)
  })

  it('rejects a negative or fractional maxToolCallsPerTurn before publication', () => {
    expect(() => new AgentLoop(new Context(), { agents: [], maxToolCallsPerTurn: -1 }))
      .toThrow('maxToolCallsPerTurn must be a non-negative integer (0 disables the budget)')
    expect(() => new AgentLoop(new Context(), { agents: [], maxToolCallsPerTurn: 1.5 }))
      .toThrow('maxToolCallsPerTurn must be a non-negative integer (0 disables the budget)')
  })

  it('defaults the budget to 200', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const { ctx } = await harness(adapter)
    expect(ctx.agentLoop.config.maxToolCallsPerTurn).toBe(200)
  })
})
