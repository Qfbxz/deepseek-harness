import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  TOKEN_COUNTER_CONTEXT_WINDOW,
  TOKEN_COUNTER_PROVIDER,
  counterResolveModel,
  counterStream,
} from './token-counter-mock-llm.ts'

/**
 * The same scripted route with the counting capability left undeclared: the
 * WP5 control scenario proves the character estimate alone stays below the
 * same threshold the declared case crosses.
 */
class TokenCounterAbsentAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve(counterResolveModel(provider, model))
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return counterStream(options)
  }
}

export const name = 'token-counter-absent-mock-llm'
export const inject = ['llm']
export { TOKEN_COUNTER_CONTEXT_WINDOW }

/** Register the keyless `deepseek-official` adapter without `countTokens`. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter([TOKEN_COUNTER_PROVIDER], new TokenCounterAbsentAdapter())
}
