import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/** The identical arguments both scripted todo_write calls carry. */
const ARGS = JSON.stringify({ todos: [{ content: 'WP8 cache scenario', status: 'pending' }] })
/** Final-answer marker the snapshot asserts. */
const FINAL_TEXT = 'WP8_CACHE_OK'

/**
 * Scripted conversation for the WP8 cache scenario: two IDENTICAL todo_write
 * calls (fresh call ids, equal arguments), then a final answer. The second
 * call must be served by the session approval cache, not by a second prompt.
 */
export async function* cacheStream(options: GenerateOptions): AsyncIterable<StreamChunk> {
  const toolResults = options.messages.flatMap(message => message.content)
    .filter(block => block.type === 'tool-result').length
  if (toolResults < 2) {
    const id = CallId(toolResults === 0 ? 'wp8-cache-call-1' : 'wp8-cache-call-2')
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name: 'todo_write', argumentsDelta: ARGS }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'todo_write', arguments: ARGS } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
    return
  }
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text: FINAL_TEXT }
  yield { type: 'block-end', index: 0, block: { type: 'text', text: FINAL_TEXT } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** Keyless adapter claiming the composition's `deepseek-official` route. */
class CacheMockAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return cacheStream(options)
  }
}

export const name = 'wp8-cache-mock-llm'
export const inject = ['llm']

/** Register the keyless cache-scenario adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['deepseek-official'], new CacheMockAdapter())
}
