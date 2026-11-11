import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/** The scripted bash commands in call order: prefix grant, prefix hit, forbidden shape. */
const COMMANDS = ['echo alpha', 'echo beta', 'rm -rf wp8-forbidden-target'] as const
/** Final-answer marker the snapshot asserts. */
const FINAL_TEXT = 'WP8_PREFIX_OK'

/**
 * Scripted conversation for the WP8 prefix scenario: `echo alpha` (asks, and
 * the fixture answerer persists the `echo` prefix), `echo beta` (different
 * arguments the persisted prefix must answer without a prompt), and an
 * `rm -rf` call whose persistence attempt the service must refuse and whose
 * ask the fixture then rejects — the call never executes.
 */
export async function* prefixStream(options: GenerateOptions): AsyncIterable<StreamChunk> {
  const toolResults = options.messages.flatMap(message => message.content)
    .filter(block => block.type === 'tool-result').length
  if (toolResults < COMMANDS.length) {
    const command = COMMANDS[toolResults] as string
    const id = CallId(`wp8-prefix-call-${toolResults + 1}`)
    const args = JSON.stringify({ command })
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name: 'bash', argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'bash', arguments: args } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
    return
  }
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text: FINAL_TEXT }
  yield { type: 'block-end', index: 0, block: { type: 'text', text: FINAL_TEXT } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** Keyless adapter claiming the composition's `deepseek-official` route. */
class PrefixMockAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return prefixStream(options)
  }
}

export const name = 'wp8-prefix-mock-llm'
export const inject = ['llm']

/** Register the keyless prefix-scenario adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['deepseek-official'], new PrefixMockAdapter())
}
