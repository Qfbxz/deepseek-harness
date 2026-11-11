/**
 * Provider token-count endpoint mapping for the pi-ai adapter.
 *
 * Two of the wire protocols a route can speak carry a count operation the
 * adapter can address with the same endpoint host and credential the stream
 * request takes: `anthropic-messages` counts through `POST {baseUrl}/
 * v1/messages/count_tokens` and `openai-completions` through
 * `POST {baseUrl}/chat/completions/count_tokens`. Both accept the protocol's
 * native prompt envelope and answer `{"input_tokens": N}` under the provider's
 * own tokenizer. A model on any other protocol has no count endpoint here:
 * `countEndpointPlan()` returns `undefined` and the adapter refuses the count
 * rather than guessing.
 *
 * The wire conversion mirrors what the respective pi-ai API implementation
 * sends for the same history — the count is only meaningful when it prices the
 * prompt a real request would carry — minus the fields no tokenizer prices
 * (cache-control markers, deferred-tool references, request options).
 *
 * @module dsh-llm-pi-ai/count-tokens
 */

import type {
  Api,
  AssistantMessage,
  Context as PiContext,
  ImageContent,
  Model,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
} from '@earendil-works/pi-ai'

/** The protocol count endpoints this adapter maps, keyed by pi-ai API name. */
const COUNT_PATHS: Readonly<Record<string, string>> = {
  'anthropic-messages': 'v1/messages/count_tokens',
  'openai-completions': 'chat/completions/count_tokens',
}

/** One ready-to-send count interrogation of one exact model's endpoint. */
export interface CountEndpointPlan {
  /** Absolute count-endpoint URL for the model. */
  readonly url: string
  /** Complete request headers: deployment, model, auth, and content typing. */
  readonly headers: Record<string, string>
  /** The protocol-native request body. */
  readonly body: unknown
}

/** One settled count attempt: the reported tokens, or why there is no count. */
export type CountAttempt = { tokens: number } | { reason: string }

/** One error's message, with its cause chain when `fetch` collapsed the detail. */
function describe(error: unknown): string {
  /* v8 ignore next -- fetch and Response.json reject with Error instances only; the arm prices exotic throwables */
  if (!(error instanceof Error)) return String(error)
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message
}

/** Anthropic count-body message. */
type AnthropicMessage = { role: 'user' | 'assistant'; content: unknown }

/** Anthropic count-body assistant content block. */
type AnthropicAssistantBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

/** OpenAI count-body message. */
type OpenAiMessage = {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool'
  content: string | unknown[] | null
  name?: string
  tool_call_id?: string
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
} & Record<string, unknown>

/** The compat switches the OpenAI count conversion reads; every other switch prices nothing. */
type OpenAiCountCompat = Pick<
  NonNullable<Model<'openai-completions'>['compat']>,
  'supportsDeveloperRole' | 'requiresAssistantAfterToolResult' | 'requiresThinkingAsText' | 'requiresToolResultName'
>

/** Join the text blocks of one pi-ai message the way pi-ai's own conversion does. */
function joinText(blocks: readonly (TextContent | ImageContent)[]): string {
  return blocks.filter((block): block is TextContent => block.type === 'text').map(block => block.text).join('\n')
}

/**
 * Anthropic content for one tool result: a plain string while it carries only
 * text, a block list once an image joins, exactly like the stream conversion.
 */
function anthropicToolResultContent(result: ToolResultMessage): unknown {
  const images = result.content.filter((block): block is ImageContent => block.type === 'image')
  if (images.length === 0) return joinText(result.content)
  return [
    ...result.content.filter((block): block is TextContent => block.type === 'text')
      .map(block => ({ type: 'text', text: block.text })),
    ...images.map(image => ({
      type: 'image',
      source: { type: 'base64', media_type: image.mimeType, data: image.data },
    })),
  ]
}

/** Anthropic assistant content blocks, mirroring the stream conversion's thinking rules. */
function anthropicAssistantBlocks(
  message: AssistantMessage,
  allowEmptySignature: boolean,
): AnthropicAssistantBlock[] {
  const blocks: AnthropicAssistantBlock[] = []
  for (const block of message.content) {
    switch (block.type) {
      case 'text':
        if (block.text.trim().length > 0) blocks.push({ type: 'text', text: block.text })
        break
      case 'thinking':
        if (block.redacted === true) {
          blocks.push({ type: 'redacted_thinking', data: block.thinkingSignature ?? '' })
          break
        }
        if (block.thinking.trim().length === 0) break
        if (block.thinkingSignature === undefined || block.thinkingSignature.trim().length === 0) {
          // A replayed block that lost its signature cannot re-enter Anthropic
          // as thinking; the stream conversion degrades it to plain text unless
          // the model's compat accepts an empty signature.
          blocks.push(allowEmptySignature
            ? { type: 'thinking', thinking: block.thinking, signature: '' }
            : { type: 'text', text: block.thinking })
          break
        }
        blocks.push({ type: 'thinking', thinking: block.thinking, signature: block.thinkingSignature })
        break
      case 'toolCall':
        blocks.push({ type: 'tool_use', id: block.id, name: block.name, input: block.arguments })
        break
      // no default: AssistantMessage content is pi-ai's closed union; a new
      // member is a compile error here, exactly like stream.ts's event switch.
    }
  }
  return blocks
}

/** The Anthropic count body for one pi-ai context. */
function anthropicCountBody(model: Model<'anthropic-messages'>, context: PiContext): Record<string, unknown> {
  const messages: AnthropicMessage[] = []
  for (let index = 0; index < context.messages.length; index += 1) {
    const message = context.messages[index]
    /* v8 ignore next 2 -- a dense array under `index < length` cannot yield undefined; the check narrows the indexed read */
    if (message === undefined) break
    if (message.role === 'user') {
      if (typeof message.content === 'string') {
        if (message.content.trim().length > 0) messages.push({ role: 'user', content: message.content })
      } else {
        // A block-array user message always carries an image (text-only
        // history joins to a string upstream), so the filtered list is never
        // empty and whitespace text never reaches the endpoint.
        const blocks = message.content
          .filter(block => block.type === 'text' ? block.text.trim().length > 0 : true)
          .map(block => block.type === 'text'
            ? { type: 'text', text: block.text }
            : {
              type: 'image',
              source: { type: 'base64', media_type: block.mimeType, data: block.data },
            })
        messages.push({ role: 'user', content: blocks })
      }
      continue
    }
    if (message.role === 'assistant') {
      const blocks = anthropicAssistantBlocks(message, model.compat?.allowEmptySignature === true)
      if (blocks.length > 0) messages.push({ role: 'assistant', content: blocks })
      continue
    }
    // Consecutive tool results share one user message, the way the stream
    // conversion groups them for Anthropic.
    const results: Record<string, unknown>[] = []
    let groupEnd = index
    while (groupEnd < context.messages.length) {
      const next = context.messages[groupEnd]
      /* v8 ignore next 2 -- a dense array under `groupEnd < length` cannot yield undefined; the check narrows the indexed read */
      if (next === undefined || next.role !== 'toolResult') break
      results.push(anthropicToolResult(next))
      groupEnd += 1
    }
    index = groupEnd - 1
    messages.push({ role: 'user', content: results })
  }
  return {
    model: model.id,
    ...context.systemPrompt === undefined ? {} : { system: context.systemPrompt },
    messages,
    ...context.tools === undefined || context.tools.length === 0 ? {} : {
      tools: context.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      })),
    },
  }
}

/** One converted `tool_result` block; the `unknown` value carries the block shape. */
function anthropicToolResult(message: ToolResultMessage): Record<string, unknown> {
  return {
    type: 'tool_result',
    tool_use_id: message.toolCallId,
    content: anthropicToolResultContent(message),
    is_error: message.isError,
  }
}

/** The OpenAI count body for one pi-ai context, mirroring the stream conversion's compat rules. */
function openAiCountBody(model: Model<'openai-completions'>, context: PiContext): Record<string, unknown> {
  const compat: OpenAiCountCompat = model.compat ?? {}
  const messages: OpenAiMessage[] = []
  if (context.systemPrompt !== undefined) {
    const role = model.reasoning && compat.supportsDeveloperRole === true ? 'developer' : 'system'
    messages.push({ role, content: context.systemPrompt })
  }
  // The previous message's pi-ai role, exactly what the stream conversion's
  // bridge check reads.
  let lastRole: 'user' | 'toolResult' | 'assistant' | undefined
  for (let index = 0; index < context.messages.length; index += 1) {
    const message = context.messages[index]
    /* v8 ignore next 2 -- a dense array under `index < length` cannot yield undefined; the check narrows the indexed read */
    if (message === undefined) break
    // The synthetic bridge keeps tool results and the next user message apart
    // for gateways that refuse that adjacency.
    if (compat.requiresAssistantAfterToolResult === true && lastRole === 'toolResult' && message.role === 'user') {
      messages.push({ role: 'assistant', content: 'I have processed the tool results.' })
    }
    if (message.role === 'user') {
      const content = typeof message.content === 'string'
        ? message.content
        : message.content.map(block => block.type === 'text'
          ? { type: 'text', text: block.text }
          : { type: 'image_url', image_url: { url: `data:${block.mimeType};base64,${block.data}` } })
      if (content.length > 0) {
        messages.push({ role: 'user', content })
        lastRole = 'user'
      }
      continue
    }
    if (message.role === 'assistant') {
      const assistant = openAiAssistantMessage(message, compat)
      // An assistant replay with neither text nor calls is dropped, exactly
      // like the stream conversion drops it for providers that refuse empty
      // assistant messages.
      if (assistant !== null) {
        messages.push(assistant)
        lastRole = 'assistant'
      }
      continue
    }
    // Consecutive tool results share the tool-message run, and an image inside
    // a result becomes an attached user message after the run, because OpenAI
    // tool messages carry text only.
    const images: { type: 'image_url'; image_url: { url: string } }[] = []
    let groupEnd = index
    while (groupEnd < context.messages.length) {
      const result = context.messages[groupEnd]
      /* v8 ignore next 2 -- a dense array under `groupEnd < length` cannot yield undefined; the check narrows the indexed read */
      if (result === undefined || result.role !== 'toolResult') break
      messages.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        ...(compat.requiresToolResultName === true ? { name: result.toolName } : {}),
        content: joinText(result.content),
      })
      if (model.input.includes('image')) {
        for (const block of result.content) {
          if (block.type === 'image') {
            images.push({ type: 'image_url', image_url: { url: `data:${block.mimeType};base64,${block.data}` } })
          }
        }
      }
      groupEnd += 1
    }
    index = groupEnd - 1
    if (images.length > 0) {
      if (compat.requiresAssistantAfterToolResult === true) {
        messages.push({ role: 'assistant', content: 'I have processed the tool results.' })
      }
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: 'Attached image(s) from tool result:' }, ...images],
      })
      lastRole = 'user'
    } else {
      lastRole = 'toolResult'
    }
  }
  return {
    model: model.id,
    messages,
    ...context.tools === undefined || context.tools.length === 0 ? {} : {
      tools: context.tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
    },
  }
}

/**
 * One OpenAI assistant message: text, replayed thinking under its compat rule,
 * and tool calls. `null` when the replay carries nothing an OpenAI-compatible
 * endpoint could read, which the caller drops like the stream conversion does.
 */
function openAiAssistantMessage(message: AssistantMessage, compat: OpenAiCountCompat): OpenAiMessage | null {
  const textParts = message.content
    .filter((block): block is TextContent => block.type === 'text')
    .map(block => ({ type: 'text', text: block.text }))
    .filter(part => part.text.trim().length > 0)
  const text = textParts.map(part => part.text).join('')
  const thinking = message.content.filter((block): block is ThinkingContent => block.type === 'thinking')
    .filter(block => block.thinking.trim().length > 0)
  const toolCalls = message.content.filter((block): block is ToolCall => block.type === 'toolCall')
  // The stream conversion starts the content at '' under the bridge compat
  // because some providers refuse null content outright.
  const result: OpenAiMessage = {
    role: 'assistant',
    content: compat.requiresAssistantAfterToolResult === true ? '' : null,
  }
  if (thinking.length > 0) {
    if (compat.requiresThinkingAsText === true) {
      // Plain text, no tags: the stream conversion keeps the model from
      // mimicking thinking markup, and the count prices the same text.
      const thinkingText = thinking.map(block => block.thinking).join('\n\n')
      result.content = [{ type: 'text', text: thinkingText }, ...textParts]
    } else {
      if (text.length > 0) result.content = text
      // The stream conversion files replayed thinking under the field the
      // first block's signature names, so the count prices the same field.
      const signature = thinking[0]?.thinkingSignature
      if (signature !== undefined && signature.length > 0) {
        result[signature] = thinking.map(block => block.thinking).join('\n')
      }
    }
  } else if (text.length > 0) {
    result.content = text
  }
  if (toolCalls.length > 0) {
    result.tool_calls = toolCalls.map(call => ({
      id: call.id,
      type: 'function' as const,
      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
    }))
  }
  const content = result.content
  const hasContent = content !== null && content.length > 0
  return hasContent || result.tool_calls !== undefined ? result : null
}

/**
 * The count-endpoint plan for one exact model, or `undefined` when its wire
 * protocol has no count endpoint this adapter maps.
 * @param model - the resolved model descriptor carrying protocol, endpoint, and headers.
 * @param deploymentHeaders - the route's deployment headers with Harness attribution merged.
 * @param apiKey - the route's resolved credential, when it names one.
 * @param context - the pi-ai context whose prompt the count prices.
 * @returns the plan to send, or `undefined` for an unmapped protocol.
 */
export function countEndpointPlan(
  model: Model<Api>,
  deploymentHeaders: Readonly<Record<string, string>>,
  apiKey: string | undefined,
  context: PiContext,
): CountEndpointPlan | undefined {
  const path = COUNT_PATHS[model.api]
  if (path === undefined) return undefined
  const base = model.baseUrl.replace(/\/+$/, '')
  const headers: Record<string, string> = {
    ...model.headers,
    ...deploymentHeaders,
    accept: 'application/json',
    'content-type': 'application/json',
  }
  if (model.api === 'anthropic-messages') {
    headers['anthropic-version'] = '2023-06-01'
    if (apiKey !== undefined && apiKey.startsWith('sk-ant-oat')) headers.authorization = `Bearer ${apiKey}`
    else if (apiKey !== undefined && apiKey.length > 0) headers['x-api-key'] = apiKey
    return { url: `${base}/${path}`, headers, body: anthropicCountBody(model as Model<'anthropic-messages'>, context) }
  }
  if (apiKey !== undefined && apiKey.length > 0) headers.authorization = `Bearer ${apiKey}`
  return { url: `${base}/${path}`, headers, body: openAiCountBody(model as Model<'openai-completions'>, context) }
}

/**
 * One count round trip: a single POST, no retry. An aborted caller signal
 * rethrows; every other failure — transport error, timeout, non-2xx, or a
 * response whose `input_tokens` is not a non-negative safe integer — resolves
 * with a reason the caller reports and prices around.
 * @param plan - the ready-to-send count interrogation.
 * @param signal - the caller's cancellation signal.
 * @param timeoutMs - optional request timeout on top of the signal.
 * @returns the reported count, or the failure reason.
 */
export async function requestCount(
  plan: CountEndpointPlan,
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): Promise<CountAttempt> {
  const upstream = signal === undefined
    ? timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs)
    : timeoutMs === undefined ? signal : AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
  let response: Response
  try {
    response = await fetch(plan.url, {
      method: 'POST',
      headers: plan.headers,
      body: JSON.stringify(plan.body),
      signal: upstream ?? null,
    })
  } catch (error: unknown) {
    if (signal?.aborted) throw error
    // fetch collapses transport failures into a bare `fetch failed`; the cause
    // carries the actual reason (ECONNREFUSED and friends).
    return { reason: describe(error) }
  }
  if (!response.ok) {
    return { reason: `HTTP ${response.status}` }
  }
  let parsed: unknown
  try {
    parsed = await response.json()
  } catch (error: unknown) {
    return { reason: `unreadable count response body: ${describe(error)}` }
  }
  const tokens = (parsed as Record<string, unknown> | null)?.input_tokens
  if (typeof tokens !== 'number' || !Number.isSafeInteger(tokens) || tokens < 0) {
    return { reason: 'count response carried no non-negative integer input_tokens' }
  }
  return { tokens }
}
