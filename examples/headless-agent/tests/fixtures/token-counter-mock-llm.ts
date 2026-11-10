import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmCountTokensRequest,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/** Provider route the WP5 token-counter scenarios route to: the base composition's own route, claimed while llm-deepseek is disabled. */
export const TOKEN_COUNTER_PROVIDER = 'deepseek-official'
/** Context capacity both scenario adapters report. */
export const TOKEN_COUNTER_CONTEXT_WINDOW = 20_200

/** Scripted summary the fixture replays for the compaction call. */
const SUMMARY_TEXT = 'COUNTER_CHECKPOINT: the request premise is preserved.'
/** Final-answer marker the snapshot asserts. */
const FINAL_TEXT = 'TOKEN_COUNTER_OK'

/**
 * Scripted conversation: the first call asks for `todo_write`, the auxiliary
 * compaction call (`purpose: 'compaction'`) returns the short summary, and the
 * post-compaction call answers in text.
 */
export async function* counterStream(options: GenerateOptions): AsyncIterable<StreamChunk> {
  if (options.purpose === 'compaction') {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: SUMMARY_TEXT }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: SUMMARY_TEXT } }
    yield { type: 'finish', reason: { kind: 'stop' } }
    return
  }
  const toolResult = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
  if (toolResult === undefined) {
    const args = JSON.stringify({ todos: [{ content: 'Prove the provider token counter', status: 'pending' }] })
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id: CallId('counter-call'), name: 'todo_write', argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('counter-call'), name: 'todo_write', arguments: args } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
    return
  }
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text: FINAL_TEXT }
  yield { type: 'block-end', index: 0, block: { type: 'text', text: FINAL_TEXT } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** Exact-model metadata both scenario adapters share. */
export function counterResolveModel(provider: string, model: string): LlmResolvedModelInfo {
  return { provider, id: model, name: model, context: { contextWindow: TOKEN_COUNTER_CONTEXT_WINDOW } }
}

/** Fixed fixture tokenizer density: near the ~2.09 chars/token measured on real agent traffic, twice the estimator's 4. */
const REPORTED_CHARS_PER_TOKEN = 2

class TokenCounterMockAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve(counterResolveModel(provider, model))
  }

  override countTokens(_provider: string, _model: string, request: LlmCountTokensRequest): Promise<number> {
    const systemChars = request.system?.length ?? 0
    const toolsChars = request.tools === undefined ? 0 : JSON.stringify(request.tools).length
    const messagesChars = request.messages.reduce((total, message) => total + JSON.stringify(message).length, 0)
    return Promise.resolve(Math.ceil((systemChars + toolsChars + messagesChars) / REPORTED_CHARS_PER_TOKEN))
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return counterStream(options)
  }
}

export const name = 'token-counter-mock-llm'
export const inject = ['llm']

/** Register the keyless `deepseek-official` adapter with the counting capability. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter([TOKEN_COUNTER_PROVIDER], new TokenCounterMockAdapter())
}
