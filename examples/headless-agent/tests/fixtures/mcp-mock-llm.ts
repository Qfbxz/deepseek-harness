import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

const HIGH = ReasoningEffortId('high')

/** Keyless adapter for the WP7 MCP snapshot: one `mcp__fixture__add` call, then a final answer. */
class McpMockAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      reasoning: {
        efforts: [{ id: HIGH, name: 'High' }],
        defaultEffort: HIGH,
      },
    }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const toolResult = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    if (toolResult === undefined) {
      const args = JSON.stringify({ a: 2, b: 3 })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: CallId('mcp-smoke-call'), name: 'mcp__fixture__add', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('mcp-smoke-call'), name: 'mcp__fixture__add', arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 3 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    const toolText = toolResult.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    const reply = `MCP_FIXTURE_ROUNDTRIP_OK: mcp__fixture__add(2, 3) => ${toolText.trim()}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 5 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'mcp-mock-llm'
export const inject = ['llm']

/** Register the keyless `mcp-mock` adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['mcp-mock'], new McpMockAdapter())
}
