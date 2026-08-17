/**
 * Force per-model `temperature` onto every agent LLM request: an `agent/request`
 * waterfall listener that rewrites the resolved `LlmCallConfig` after the rest
 * of the chain (model selection, presets) has run. One global default plus
 * optional per-model overrides (`models: {"<model>": t}` or
 * `{"<provider>/<model>": t}`; the qualified key wins). Providers whose wire
 * API drops `temperature` (pi-ai omits it when thinking is enabled or compat
 * disallows it) ignore it silently.
 * @module dsh-local/agent-temperature
 */

import z from '@deepseek-ai/schemastery'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'agent-temperature'

/** Plugin config; `apply` re-defaults so a raw config object also works. */
export const Config = z.object({
  temperature: z.number().min(0).max(2).default(0.2),
  models: z.dict(z.number().min(0).max(2)),
})

/**
 * Pick the temperature for one resolved config: a `provider/model` qualified
 * key wins over a bare model id, and both win over the global default.
 * @param config - the plugin's config.
 * @param provider - the resolved provider route.
 * @param model - the resolved model id.
 * @returns the temperature to pin.
 */
export function temperatureFor(config, provider, model) {
  const models = config.models ?? {}
  return models[`${provider}/${model}`] ?? models[model] ?? config.temperature ?? 0.2
}

/** Pin the selected temperature on every agent request. */
export function apply(ctx, config = {}) {
  ctx.on('agent/request', async (_payload, next) => {
    const resolved = await next()
    return { ...resolved, temperature: temperatureFor(config, resolved.provider, resolved.model) }
  })
}
