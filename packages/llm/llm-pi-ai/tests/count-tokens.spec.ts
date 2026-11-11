import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId, AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage, LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { LlmCountTokensRequest } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { closeMockServers, mockServer } from './mock-server.ts'

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeMockServers()
})

beforeEach(() => {
  vi.stubEnv('PI_TEST_KEY', 'test-key')
})

const IMAGE_REF: ImageAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png',
  bytes: 1,
  width: 1,
  height: 1,
}

class FrozenAttachmentStore extends AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits = {
    maxImageBytes: 1,
    maxImagesPerMessage: 1,
    maxMessageImageBytes: 1,
    maxImagePixels: 1,
    maxImageDimension: 2000,
    mediaTypes: ['image/png'],
  }

  validateImage(_input: SaveImageAttachment): Promise<void> {
    return Promise.reject(new Error('not used'))
  }

  saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    return Promise.reject(new Error('not used'))
  }

  readImage(value: ImageAttachmentRef): Promise<StoredImageAttachment> {
    return Promise.resolve({ ref: value, data: Uint8Array.of(1) })
  }
}

async function mount(providers: Record<string, PiAiProviderProfile>, attachments = false): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, { providers })
  if (attachments) await ctx.plugin(FrozenAttachmentStore)
  return ctx
}

const TOOLS = [{ name: 'search', description: 'find things', parameters: { type: 'object' } }]

const envelope = (messages: LlmCountTokensRequest['messages']): LlmCountTokensRequest => ({
  system: 'be brief',
  tools: TOOLS,
  messages,
})

const user = (text: string) => createUserMessage({
  content: [{ type: 'text', text }],
  source: { kind: 'plugin', plugin: 'test' },
})

const anthropicRoute = (baseURL: string, overrides: Partial<PiAiProviderProfile> = {}): Record<string, PiAiProviderProfile> => ({
  acme: { apiKeyEnv: 'PI_TEST_KEY', api: 'anthropic-messages', baseURL, models: [{ id: 'a-model' }], ...overrides },
})

const openaiRoute = (baseURL: string, overrides: Partial<PiAiProviderProfile> = {}): Record<string, PiAiProviderProfile> => ({
  gateway: {
    apiKeyEnv: 'PI_TEST_KEY',
    api: 'openai-completions',
    baseURL,
    models: [{ id: 'g-model' }],
    ...overrides,
  },
})

describe('PiAiAdapter countTokens capability declaration', () => {
  it('declares counting for an anthropic-messages route and counts through its endpoint', async () => {
    const server = await mockServer([{ json: { input_tokens: 990 } }])
    const ctx = await mount(anthropicRoute(server.url))

    const count = await ctx.llm.countTokens('acme', 'a-model', envelope([user('hi')]))

    expect(count).toBe(990)
    expect(server.paths).toEqual(['/v1/messages/count_tokens'])
    expect(server.requests[0]).toEqual({
      model: 'a-model',
      system: 'be brief',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'search', description: 'find things', input_schema: { type: 'object' } }],
    })
    expect(server.headers[0]?.['x-api-key']).toBe('test-key')
    expect(server.headers[0]?.['anthropic-version']).toBe('2023-06-01')
    expect(server.headers[0]?.['content-type']).toBe('application/json')
  })

  it('declares counting for an openai-completions route and counts through its endpoint', async () => {
    const server = await mockServer([{ json: { input_tokens: 321 } }])
    const ctx = await mount({ deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url } })
    const request = envelope([
      user('q'),
      createAssistantMessage({
        content: [
          { type: 'text', text: 'calling' },
          { type: 'tool-call', id: CallId('call_1'), name: 'search', arguments: '{"q":"x"}' },
        ],
        source: { provider: 'deepseek', model: 'deepseek-v4-flash' },
      }),
      createToolResultMessage({ callId: CallId('call_1'), content: [{ type: 'text', text: 'found' }], isError: false }),
    ])

    const count = await ctx.llm.countTokens('deepseek', 'deepseek-v4-flash', request)

    expect(count).toBe(321)
    expect(server.paths).toEqual(['/chat/completions/count_tokens'])
    expect(server.requests[0]).toEqual({
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'q' },
        {
          role: 'assistant',
          content: 'calling',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } }],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'found' },
      ],
      tools: [{ type: 'function', function: { name: 'search', description: 'find things', parameters: { type: 'object' } } }],
    })
    expect(server.headers[0]?.authorization).toBe('Bearer test-key')
  })

  it('omits the system and tools fields from a bare envelope on both protocols', async () => {
    const anthropicServer = await mockServer([{ json: { input_tokens: 1 } }])
    const anthropic = await mount(anthropicRoute(anthropicServer.url))
    // A whitespace-only user message and a whitespace-only assistant replay are
    // priced as nothing, exactly like the stream request would carry them.
    await expect(anthropic.llm.countTokens('acme', 'a-model', {
      messages: [
        user('   '),
        createAssistantMessage({
          content: [{ type: 'text', text: '   ' }],
          source: { provider: 'acme', model: 'a-model' },
        }),
      ],
    })).resolves.toBe(1)
    expect(anthropicServer.requests[0]).toEqual({ model: 'a-model', messages: [] })

    const openaiServer = await mockServer([{ json: { input_tokens: 2 } }])
    const openai = await mount(openaiRoute(openaiServer.url))
    await expect(openai.llm.countTokens('gateway', 'g-model', {
      messages: [
        createUserMessage({ content: [], source: { kind: 'plugin', plugin: 'test' } }),
        createAssistantMessage({
          content: [{ type: 'text', text: '   ' }],
          source: { provider: 'gateway', model: 'g-model' },
        }),
      ],
    })).resolves.toBe(2)
    expect(openaiServer.requests[0]).toEqual({ model: 'g-model', messages: [] })
  })

  it('converts replayed thinking, grouped tool results, and error flags on the anthropic mode', async () => {
    const server = await mockServer([{ json: { input_tokens: 55 } }])
    const ctx = await mount(anthropicRoute(server.url))
    const request = envelope([
      user('q'),
      createAssistantMessage({
        content: [
          { type: 'reasoning', text: 'thinking hard' },
          { type: 'text', text: 'calling' },
          { type: 'tool-call', id: CallId('call_1'), name: 'search', arguments: '{"q":"x"}' },
        ],
        source: { provider: 'acme', model: 'a-model' },
      }),
      createToolResultMessage({ callId: CallId('call_1'), content: [{ type: 'text', text: 'found' }], isError: false }),
      createToolResultMessage({ callId: CallId('call_2'), content: [{ type: 'text', text: 'more' }], isError: true }),
      user('thanks'),
    ])

    await expect(ctx.llm.countTokens('acme', 'a-model', request)).resolves.toBe(55)
    expect(server.requests[0]).toEqual({
      model: 'a-model',
      system: 'be brief',
      messages: [
        { role: 'user', content: 'q' },
        {
          role: 'assistant',
          content: [
            // Replay loses the thinking signature on a foreign message, so the
            // count degrades it to text exactly like the stream request does.
            { type: 'text', text: 'thinking hard' },
            { type: 'text', text: 'calling' },
            { type: 'tool_use', id: 'call_1', name: 'search', input: { q: 'x' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call_1', content: 'found', is_error: false },
            { type: 'tool_result', tool_use_id: 'call_2', content: 'more', is_error: true },
          ],
        },
        { role: 'user', content: 'thanks' },
      ],
      tools: [{ name: 'search', description: 'find things', input_schema: { type: 'object' } }],
    })
  })

  it('restores signed, redacted, and signatureless thinking blocks on the anthropic mode', async () => {
    const server = await mockServer([{ json: { input_tokens: 12 } }])
    const ctx = await mount(anthropicRoute(server.url))
    const request = envelope([
      createAssistantMessage({
        content: [
          { type: 'reasoning', text: 'signed' },
          { type: 'reasoning', text: 'hidden' },
          { type: 'reasoning', text: 'unsealed' },
          { type: 'reasoning', text: 'lost' },
          { type: 'reasoning', text: '   ' },
          { type: 'text', text: 'done' },
        ],
        source: {
          provider: 'acme',
          model: 'a-model',
          replayState: {
            response: {
              kind: 'pi-ai',
              version: 2,
              api: 'anthropic-messages',
              provider: 'acme',
              model: 'a-model',
              stopReason: 'stop',
            },
            blocks: [
              { type: 'reasoning', thinkingSignature: 'sig-abc' },
              { type: 'reasoning', thinkingSignature: 'opaque', redacted: true },
              { type: 'reasoning', redacted: true },
              { type: 'reasoning', thinkingSignature: '   ' },
              { type: 'reasoning' },
              { type: 'text' },
            ],
          },
        },
      }),
    ])

    await expect(ctx.llm.countTokens('acme', 'a-model', request)).resolves.toBe(12)
    expect(server.requests[0]).toMatchObject({
      system: 'be brief',
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'signed', signature: 'sig-abc' },
            { type: 'redacted_thinking', data: 'opaque' },
            { type: 'redacted_thinking', data: '' },
            { type: 'text', text: 'lost' },
            { type: 'text', text: 'done' },
          ],
        },
      ],
    })
  })

  it('keeps a signatureless thinking block when the model compat accepts empty signatures', async () => {
    const server = await mockServer([{ json: { input_tokens: 3 } }])
    const ctx = await mount(anthropicRoute(server.url, {
      models: [{ id: 'a-model', compat: { allowEmptySignature: true } }],
    }))
    const request = envelope([
      createAssistantMessage({
        content: [{ type: 'reasoning', text: 'unsigned' }],
        source: { provider: 'acme', model: 'a-model' },
      }),
    ])

    await expect(ctx.llm.countTokens('acme', 'a-model', request)).resolves.toBe(3)
    expect(server.requests[0]).toMatchObject({
      messages: [{ role: 'assistant', content: [{ type: 'thinking', thinking: 'unsigned', signature: '' }] }],
    })
  })

  it('files replayed thinking under its signature-named field on the openai mode', async () => {
    const server = await mockServer([{ json: { input_tokens: 4 } }])
    const ctx = await mount({ deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url } })
    const request = envelope([
      createAssistantMessage({
        content: [
          { type: 'reasoning', text: 'deep thought' },
          { type: 'text', text: 'answer' },
        ],
        source: {
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          replayState: {
            response: {
              kind: 'pi-ai',
              version: 2,
              api: 'openai-completions',
              provider: 'deepseek',
              model: 'deepseek-v4-flash',
              stopReason: 'stop',
            },
            blocks: [{ type: 'reasoning', thinkingSignature: 'reasoning_content' }, { type: 'text' }],
          },
        },
      }),
    ])

    await expect(ctx.llm.countTokens('deepseek', 'deepseek-v4-flash', request)).resolves.toBe(4)
    expect(server.requests[0]).toMatchObject({
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'assistant', content: 'answer', reasoning_content: 'deep thought' },
      ],
    })
  })

  it('folds thinking into text when the openai compat requires it', async () => {
    const server = await mockServer([{ json: { input_tokens: 5 } }])
    const ctx = await mount(openaiRoute(server.url, { compat: { requiresThinkingAsText: true } }))
    const request = envelope([
      createAssistantMessage({
        content: [
          { type: 'reasoning', text: 'deep thought' },
          { type: 'text', text: 'answer' },
        ],
        source: { provider: 'gateway', model: 'g-model' },
      }),
    ])

    await expect(ctx.llm.countTokens('gateway', 'g-model', request)).resolves.toBe(5)
    expect(server.requests[0]).toMatchObject({
      messages: [
        { role: 'system', content: 'be brief' },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'deep thought' }, { type: 'text', text: 'answer' }],
        },
      ],
    })
  })

  it('uses the developer role when the openai compat asks for it on a reasoning model', async () => {
    const server = await mockServer([{ json: { input_tokens: 6 } }])
    const ctx = await mount({
      deepseek: {
        apiKeyEnv: 'PI_TEST_KEY',
        baseURL: server.url,
        modelOverrides: { 'deepseek-v4-flash': { compat: { supportsDeveloperRole: true } } },
      },
    })

    await expect(ctx.llm.countTokens('deepseek', 'deepseek-v4-flash', envelope([user('hi')]))).resolves.toBe(6)
    expect(server.requests[0]).toMatchObject({
      messages: [{ role: 'developer', content: 'be brief' }, { role: 'user', content: 'hi' }],
    })
  })

  it('bridges tool results to the next user message and names results under the openai compat', async () => {
    const server = await mockServer([{ json: { input_tokens: 7 } }])
    const ctx = await mount(openaiRoute(server.url, {
      compat: { requiresAssistantAfterToolResult: true, requiresToolResultName: true },
    }))
    const request = envelope([
      user('q'),
      createAssistantMessage({
        content: [{ type: 'tool-call', id: CallId('call_1'), name: 'search', arguments: '{"q":"x"}' }],
        source: { provider: 'gateway', model: 'g-model' },
      }),
      createToolResultMessage({ callId: CallId('call_1'), content: [{ type: 'text', text: 'found' }], isError: false }),
      user('thanks'),
    ])

    await expect(ctx.llm.countTokens('gateway', 'g-model', request)).resolves.toBe(7)
    expect(server.requests[0]).toMatchObject({
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'q' },
        // The compat starts assistant content at '' instead of null, and the
        // synthetic bridge keeps the results apart from the next user message.
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } }],
        },
        { role: 'tool', tool_call_id: 'call_1', name: 'search', content: 'found' },
        { role: 'assistant', content: 'I have processed the tool results.' },
        { role: 'user', content: 'thanks' },
      ],
    })
  })

  it('converts durable images through the attachment store on the openai mode', async () => {
    const server = await mockServer([{ json: { input_tokens: 8 } }])
    const ctx = await mount(openaiRoute(server.url, {
      models: [{ id: 'g-model', input: ['text', 'image'] }],
      compat: { requiresAssistantAfterToolResult: true },
    }), true)
    const request = envelope([
      createUserMessage({
        content: [
          { type: 'text', text: 'q' },
          { type: 'image', attachment: IMAGE_REF },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
      createAssistantMessage({
        content: [{ type: 'tool-call', id: CallId('call_1'), name: 'search', arguments: '{}' }],
        source: { provider: 'gateway', model: 'g-model' },
      }),
      createToolResultMessage({
        callId: CallId('call_1'),
        content: [
          { type: 'text', text: 'found' },
          { type: 'image', attachment: IMAGE_REF },
        ],
        isError: false,
      }),
      user('thanks'),
    ])

    await expect(ctx.llm.countTokens('gateway', 'g-model', request)).resolves.toBe(8)
    expect(server.requests[0]).toMatchObject({
      messages: [
        { role: 'system', content: 'be brief' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'q' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AQ==' } },
          ],
        },
        { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: 'found' },
        { role: 'assistant', content: 'I have processed the tool results.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Attached image(s) from tool result:' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AQ==' } },
          ],
        },
        { role: 'user', content: 'thanks' },
      ],
    })
  })

  it('carries tool-result images inside the tool_result blocks on the anthropic mode', async () => {
    const server = await mockServer([{ json: { input_tokens: 9 } }])
    const ctx = await mount(anthropicRoute(server.url), true)
    const request = envelope([
      createUserMessage({
        content: [
          { type: 'text', text: 'q' },
          { type: 'text', text: '   ' },
          { type: 'image', attachment: IMAGE_REF },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
      createToolResultMessage({
        callId: CallId('call_1'),
        content: [
          { type: 'text', text: 'found' },
          { type: 'image', attachment: IMAGE_REF },
        ],
        isError: false,
      }),
    ])

    await expect(ctx.llm.countTokens('acme', 'a-model', request)).resolves.toBe(9)
    expect(server.requests[0]).toMatchObject({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'q' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AQ==' } },
          ],
        },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'call_1',
            content: [
              { type: 'text', text: 'found' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AQ==' } },
            ],
            is_error: false,
          }],
        },
      ],
    })
  })

  it('authenticates an OAuth-style anthropic credential with bearer auth', async () => {
    vi.stubEnv('PI_TEST_KEY', 'sk-ant-oat-test-token')
    const server = await mockServer([{ json: { input_tokens: 2 } }])
    const ctx = await mount(anthropicRoute(server.url))

    await expect(ctx.llm.countTokens('acme', 'a-model', envelope([user('hi')]))).resolves.toBe(2)
    expect(server.headers[0]?.authorization).toBe('Bearer sk-ant-oat-test-token')
    expect(server.headers[0]?.['x-api-key']).toBeUndefined()
  })

  it('counts an unauthenticated route without an authorization header', async () => {
    const server = await mockServer([{ json: { input_tokens: 2 } }])
    const ctx = await mount({
      gateway: { api: 'openai-completions', baseURL: server.url, models: [{ id: 'g-model' }] },
    })

    await expect(ctx.llm.countTokens('gateway', 'g-model', envelope([user('hi')]))).resolves.toBe(2)
    expect(server.headers[0]?.authorization).toBeUndefined()
  })

  it('counts an unauthenticated anthropic route without key headers', async () => {
    const server = await mockServer([{ json: { input_tokens: 2 } }])
    const ctx = await mount({
      acme: { api: 'anthropic-messages', baseURL: server.url, models: [{ id: 'a-model' }] },
    })

    await expect(ctx.llm.countTokens('acme', 'a-model', envelope([user('hi')]))).resolves.toBe(2)
    expect(server.headers[0]?.['x-api-key']).toBeUndefined()
    expect(server.headers[0]?.authorization).toBeUndefined()
  })

  it('drops a signature-only openai thinking replay and keeps an unsigned one beside its text', async () => {
    const server = await mockServer([{ json: { input_tokens: 11 } }])
    const ctx = await mount({ deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url } })
    const request = envelope([
      createAssistantMessage({
        content: [{ type: 'reasoning', text: 'deep thought' }],
        source: {
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          replayState: {
            response: {
              kind: 'pi-ai',
              version: 2,
              api: 'openai-completions',
              provider: 'deepseek',
              model: 'deepseek-v4-flash',
              stopReason: 'stop',
            },
            blocks: [{ type: 'reasoning', thinkingSignature: 'reasoning_content' }],
          },
        },
      }),
      createAssistantMessage({
        content: [
          { type: 'reasoning', text: 'plain thought' },
          { type: 'text', text: 'answer' },
        ],
        source: { provider: 'deepseek', model: 'deepseek-v4-flash' },
      }),
    ])

    await expect(ctx.llm.countTokens('deepseek', 'deepseek-v4-flash', request)).resolves.toBe(11)
    expect(server.requests[0]).toMatchObject({
      messages: [
        { role: 'system', content: 'be brief' },
        // A thinking-only replay with a signature carries no countable content
        // and no calls, so the message is dropped like the stream request drops it.
        { role: 'assistant', content: 'answer' },
      ],
    })
  })

  it('attaches tool-result images without the bridge when the openai compat is off', async () => {
    const server = await mockServer([{ json: { input_tokens: 12 } }])
    const ctx = await mount(openaiRoute(server.url, { models: [{ id: 'g-model', input: ['text', 'image'] }] }), true)
    const request = envelope([
      user('q'),
      createAssistantMessage({
        content: [{ type: 'tool-call', id: CallId('call_1'), name: 'search', arguments: '{}' }],
        source: { provider: 'gateway', model: 'g-model' },
      }),
      createToolResultMessage({
        callId: CallId('call_1'),
        content: [
          { type: 'text', text: 'found' },
          { type: 'image', attachment: IMAGE_REF },
        ],
        isError: false,
      }),
    ])

    await expect(ctx.llm.countTokens('gateway', 'g-model', request)).resolves.toBe(12)
    expect(server.requests[0]).toMatchObject({
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'q' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: 'found' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Attached image(s) from tool result:' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AQ==' } },
          ],
        },
      ],
    })
  })

  it('reports one failed count attempt and throws the cause for the caller to price around', async () => {
    const server = await mockServer([{ status: 404, body: 'no route' }])
    const ctx = await mount({ deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url } })

    await expect(ctx.llm.countTokens('deepseek', 'deepseek-v4-flash', envelope([user('hi')])))
      .rejects.toMatchObject({ code: 'COUNT_UNAVAILABLE', message: expect.stringContaining('HTTP 404') })
    // One round trip, no retry storm.
    expect(server.paths).toHaveLength(1)
  })

  it('reports a transport failure as an unavailable count', async () => {
    const server = await mockServer([])
    const url = server.url
    await closeMockServers()
    const ctx = await mount({ deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: url } })

    await expect(ctx.llm.countTokens('deepseek', 'deepseek-v4-flash', envelope([user('hi')])))
      .rejects.toMatchObject({ code: 'COUNT_UNAVAILABLE', message: expect.stringContaining('fetch failed') })
  })

  it('reports a response without a usable count as unavailable', async () => {
    const server = await mockServer([
      { json: { hello: 'world' } },
      { json: { input_tokens: 1.5 } },
      { json: { input_tokens: -3 } },
      { rawBody: 'not-json{' },
    ])
    const ctx = await mount({ deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url } })

    await expect(ctx.llm.countTokens('deepseek', 'deepseek-v4-flash', envelope([user('hi')])))
      .rejects.toMatchObject({ code: 'COUNT_UNAVAILABLE', message: expect.stringContaining('input_tokens') })
    await expect(ctx.llm.countTokens('deepseek', 'deepseek-v4-flash', envelope([user('hi')])))
      .rejects.toMatchObject({ code: 'COUNT_UNAVAILABLE', message: expect.stringContaining('input_tokens') })
    await expect(ctx.llm.countTokens('deepseek', 'deepseek-v4-flash', envelope([user('hi')])))
      .rejects.toMatchObject({ code: 'COUNT_UNAVAILABLE', message: expect.stringContaining('input_tokens') })
    await expect(ctx.llm.countTokens('deepseek', 'deepseek-v4-flash', envelope([user('hi')])))
      .rejects.toMatchObject({ code: 'COUNT_UNAVAILABLE', message: expect.stringContaining('unreadable count response body') })
    // Four round trips for four counts, one attempt each.
    expect(server.paths).toHaveLength(4)
  })

  it('honors the profile timeout on a stalled count endpoint', async () => {
    const server = await mockServer([{ json: { input_tokens: 1 }, delayMs: 5_000 }])
    const ctx = await mount({
      deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url, timeoutMs: 25 },
    })

    await expect(ctx.llm.countTokens('deepseek', 'deepseek-v4-flash', envelope([user('hi')])))
      .rejects.toMatchObject({ code: 'COUNT_UNAVAILABLE', message: expect.stringMatching(/timeout/i) })
    await closeMockServers()
  })

  it('refuses a protocol without a count endpoint before any network I/O', async () => {
    const server = await mockServer([{ json: { input_tokens: 1 } }])
    const ctx = await mount({ openai: { apiKeyEnv: 'PI_TEST_KEY', baseURL: `${server.url}/v1` } })

    await expect(ctx.llm.countTokens('openai', 'gpt-4.1', envelope([user('hi')])))
      .rejects.toMatchObject({
        code: 'COUNT_UNAVAILABLE',
        message: expect.stringContaining('no count endpoint'),
      })
    expect(server.requests).toEqual([])
  })

  it('rethrows an already-aborted count before any network I/O', async () => {
    const server = await mockServer([{ json: { input_tokens: 1 } }])
    const ctx = await mount({ deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url } })
    const controller = new AbortController()
    controller.abort()

    await expect(ctx.llm.countTokens('deepseek', 'deepseek-v4-flash', envelope([user('hi')]), controller.signal))
      .rejects.toMatchObject({ code: 'ABORTED' })
    expect(server.requests).toEqual([])
  })

  it('rethrows a count the caller aborts mid-flight as aborted', async () => {
    const server = await mockServer([{ json: { input_tokens: 1 }, delayMs: 300 }])
    const ctx = await mount({ deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url } })
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 10)

    await expect(ctx.llm.countTokens('deepseek', 'deepseek-v4-flash', envelope([user('hi')]), controller.signal))
      .rejects.toMatchObject({ code: 'ABORTED' })
    expect(server.paths).toEqual(['/chat/completions/count_tokens'])
    await closeMockServers()
  })

  it('applies the profile timeout alongside a live caller signal', async () => {
    const server = await mockServer([{ json: { input_tokens: 1 }, delayMs: 300 }])
    const ctx = await mount({
      deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url, timeoutMs: 25 },
    })
    const controller = new AbortController()

    await expect(ctx.llm.countTokens('deepseek', 'deepseek-v4-flash', envelope([user('hi')]), controller.signal))
      .rejects.toMatchObject({ code: 'COUNT_UNAVAILABLE', message: expect.stringMatching(/timeout/i) })
    await closeMockServers()
  })

  it('degrades an unusable assistant replay to provider-neutral history and still counts', async () => {
    const server = await mockServer([{ json: { input_tokens: 10 } }])
    const ctx = await mount({ deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url } })
    const warns: string[] = []
    ctx.logger.warn = ((message: string) => void warns.push(message)) as typeof ctx.logger.warn
    const request = envelope([
      createAssistantMessage({
        content: [{ type: 'text', text: 'half of a broken replay' }],
        source: { provider: 'deepseek', model: 'deepseek-v4-flash', replayState: { bogus: true } },
      }),
    ])

    await expect(ctx.llm.countTokens('deepseek', 'deepseek-v4-flash', request)).resolves.toBe(10)
    expect(warns.some(message => message.includes('unusable replay state'))).toBe(true)
    expect(server.requests[0]).toMatchObject({
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'assistant', content: 'half of a broken replay' },
      ],
    })
  })

  it('refuses an image envelope without the durable attachment service', async () => {
    const server = await mockServer([{ json: { input_tokens: 1 } }])
    const ctx = await mount({ deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url } })
    const request = envelope([
      createUserMessage({
        content: [{ type: 'image', attachment: IMAGE_REF }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])

    await expect(ctx.llm.countTokens('deepseek', 'deepseek-v4-flash', request))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    expect(server.requests).toEqual([])
  })
})
