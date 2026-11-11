import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { CallId, createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { MockAdapter, maxTokensResponse, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as mock from './scripted-provider.ts'
import * as tool from '../src/index.ts'

/**
 * WP2 subagent report floor: a `completed` foreground report below
 * `minReportChars` costs bounded continuation round-trips in the child's own
 * conversation and the longest result reaches the parent. Every delegation
 * test drives the REAL spawn provider and child loop; only the configured
 * model boundary is scripted.
 */

const SHORT_REPORT = 'Found it: the widget lives in src/widget.ts.'

const SHORT_A = 'The widget factory initializes lazily and caches one instance in module scope. '
  + 'Configuration flows from the deployment settings file at startup, and overrides apply per request.'

const SHORT_B = 'Configured at startup; overrides apply per request.'

const LONG_REPORT = 'FLOOR_RAISED_REPORT: The widget factory initializes lazily and caches one instance in module '
  + 'scope. Configuration flows from the deployment settings file at startup; overrides apply per request. The '
  + 'delegation boundary keeps intermediate steps in the child session, so the parent receives only this final '
  + 'report. The floor continuation reuses the child conversation, and the longer message replaces the short one.'

/** The pinned model-facing fragment of the floor continuation demand. */
const FLOOR_PROMPT_FRAGMENT = 'complete final report in one message'

const testToolSignal = new AbortController().signal

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A minimal parent Agent passed through to the provider request. */
function fakeAgent(id = 'floor-parent'): Agent {
  return { id: SessionId(id) } as unknown as Agent
}

/** Drive the real spawn stack for one foreground delegation with a scripted model. */
async function floorSetup(script: StreamChunk[][], toolConfig: Partial<tool.Config> = {}) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-tool-subagent-floor-'))
  roots.push(root)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(tool, { provider: 'spawn', ...toolConfig })
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = ctx.agentLoop.create(SessionId('floor-parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent, adapter }
}

/** Delegate once in the foreground and wait for the parent turn to settle. */
async function delegate(parent: Agent): Promise<void> {
  parent.followup(createUserMessage({
    content: [{ type: 'text', text: 'Delegate the widget report to a subagent, then summarize it.' }],
    source: { kind: 'user' },
  }))
  await parent.whenIdle()
}

function toolResultText(events: readonly SessionEvent[]): string {
  const result = events.findLast((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
  if (result === undefined) throw new Error('no tool/result event in the parent log')
  return result.data.message.content
    .flatMap(block => block.type === 'tool-result' ? block.content : [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

function finalAssistantText(events: readonly SessionEvent[]): string {
  const message = events.findLast(event => event.type === 'assistant/message')
  if (message === undefined) throw new Error('no assistant/message event in the parent log')
  return (message.data.message.content as { type: string; text?: string }[])
    .filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .join('')
}

describe('dsh-tool-subagent report floor', () => {
  it('continues a short completed report exactly once and returns the longer result', async () => {
    const { parent, adapter } = await floorSetup([
      toolCallResponse('call-floor-1', 'subagent', { description: 'widget report', prompt: 'Research the widget.' }),
      textResponse(SHORT_REPORT),
      textResponse(LONG_REPORT),
      textResponse('FLOOR_PARENT_DONE'),
    ])
    await delegate(parent)

    // Parent call, child report call, exactly one continuation call, parent final call.
    expect(adapter.requests).toHaveLength(4)
    // The continuation demand rode the child conversation as its next user turn.
    const continuationMessages = JSON.stringify(adapter.requests[2]?.messages ?? [])
    expect(continuationMessages).toContain(FLOOR_PROMPT_FRAGMENT)
    // The parent received the raised report, never the short original.
    expect(toolResultText(parent.session.events)).toBe(LONG_REPORT)
    expect(finalAssistantText(parent.session.events)).toBe('FLOOR_PARENT_DONE')
  })

  it('returns a long completed report without any continuation', async () => {
    const { parent, adapter } = await floorSetup([
      toolCallResponse('call-floor-2', 'subagent', { description: 'widget report', prompt: 'Research the widget.' }),
      textResponse(LONG_REPORT),
      textResponse('FLOOR_PARENT_DONE'),
    ])
    await delegate(parent)

    expect(adapter.requests).toHaveLength(3)
    expect(toolResultText(parent.session.events)).toBe(LONG_REPORT)
    expect(finalAssistantText(parent.session.events)).toBe('FLOOR_PARENT_DONE')
  })

  it('floorContinuationAttempts: 0 keeps the short report unchanged', async () => {
    const { parent, adapter } = await floorSetup([
      toolCallResponse('call-floor-3', 'subagent', { description: 'widget report', prompt: 'Research the widget.' }),
      textResponse(SHORT_REPORT),
      textResponse('FLOOR_PARENT_DONE'),
    ], { floorContinuationAttempts: 0 })
    await delegate(parent)

    expect(adapter.requests).toHaveLength(3)
    expect(toolResultText(parent.session.events)).toBe(SHORT_REPORT)
  })

  it('a continuation that does not complete cleanly keeps the completed report and stops spending attempts', async () => {
    const { parent, adapter } = await floorSetup([
      toolCallResponse('call-floor-4', 'subagent', { description: 'widget report', prompt: 'Research the widget.' }),
      textResponse(SHORT_REPORT),
      // The continuation turn hits the token ceiling: unclean, so its partial
      // text is discarded and no further attempt is spent on the broken turn.
      maxTokensResponse(SHORT_B),
      textResponse('FLOOR_PARENT_DONE'),
    ], { floorContinuationAttempts: 3 })
    await delegate(parent)

    // Parent call, child report, one unclean continuation, parent final — the
    // two remaining attempts were not spent.
    expect(adapter.requests).toHaveLength(4)
    expect(toolResultText(parent.session.events)).toBe(SHORT_REPORT)
    expect(finalAssistantText(parent.session.events)).toBe('FLOOR_PARENT_DONE')
  })

  it('spends up to the attempt budget and keeps the longest result', async () => {
    const { parent, adapter } = await floorSetup([
      toolCallResponse('call-floor-5', 'subagent', { description: 'widget report', prompt: 'Research the widget.' }),
      textResponse(SHORT_A),
      // Not longer than the collected report: kept as SHORT_A, budget continues.
      textResponse(SHORT_B),
      // Second attempt clears the floor: replaces the report.
      textResponse(LONG_REPORT),
      textResponse('FLOOR_PARENT_DONE'),
    ], { floorContinuationAttempts: 2 })
    await delegate(parent)

    expect(adapter.requests).toHaveLength(5)
    expect(toolResultText(parent.session.events)).toBe(LONG_REPORT)
  })

  it('a run without a published local child keeps its short report', async () => {
    // The scripted provider returns `localAgent: undefined`, the shape of an
    // out-of-process provider: the floor has no continuation channel and the
    // completed report reaches the parent unchanged.
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    await mock.mountScriptedProvider(ctx, { name: 'mock', reply: SHORT_REPORT })
    await ctx.plugin(tool, { provider: 'mock' })

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('call-floor-nolocal'),
      name: 'subagent',
      arguments: { description: 'd', prompt: 'p' },
      agent: fakeAgent(),
    })
    expect(result.isError).toBe(false)
    expect(result.content.filter(block => block.type === 'text').map(block => block.text).join('')).toBe(SHORT_REPORT)
  })
})

describe('dsh-tool-subagent report floor configuration', () => {
  async function setup(toolConfig: tool.Config) {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    return ctx.plugin(tool, toolConfig)
  }

  it.each([
    { label: 'a string', value: '200' as unknown as number },
    { label: 'NaN', value: Number.NaN },
    { label: 'positive infinity', value: Number.POSITIVE_INFINITY },
    { label: 'negative infinity', value: Number.NEGATIVE_INFINITY },
    { label: 'a negative integer', value: -1 },
    { label: 'a fractional number', value: 1.5 },
    { label: 'negative zero', value: -0 },
    { label: 'an unsafe integer', value: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects minReportChars=$label when the plugin loads', async ({ value }) => {
    await expect(setup({ provider: 'mock', minReportChars: value })).rejects.toThrow()
  })

  it.each([
    { label: 'a string', value: '1' as unknown as number },
    { label: 'NaN', value: Number.NaN },
    { label: 'positive infinity', value: Number.POSITIVE_INFINITY },
    { label: 'negative infinity', value: Number.NEGATIVE_INFINITY },
    { label: 'a negative integer', value: -1 },
    { label: 'a fractional number', value: 0.5 },
    { label: 'negative zero', value: -0 },
    { label: 'an unsafe integer', value: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects floorContinuationAttempts=$label when the plugin loads', async ({ value }) => {
    await expect(setup({ provider: 'mock', floorContinuationAttempts: value })).rejects.toThrow()
  })

  it('validates both fields when apply() is invoked directly without Schemastery', () => {
    const ctx = new Context()
    expect(() => {
      tool.apply(ctx, { provider: 'unused', minReportChars: -5 })
    }).toThrow('`minReportChars` must be a non-negative safe integer')
    expect(() => {
      tool.apply(ctx, { provider: 'unused', floorContinuationAttempts: 1.5 })
    }).toThrow('`floorContinuationAttempts` must be a non-negative safe integer')
  })
})
