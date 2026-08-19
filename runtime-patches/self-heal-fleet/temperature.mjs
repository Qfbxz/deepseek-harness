/**
 * Force per-model `temperature` onto every agent LLM request: an `agent/request`
 * waterfall listener that rewrites the resolved `LlmCallConfig` after the rest
 * of the chain (model selection, presets) has run. One global default plus
 * optional per-model overrides (`models: {"<model>": t}` or
 * `{"<provider>/<model>": t}`; the qualified key wins). Providers whose wire
 * API drops `temperature` (pi-ai omits it when thinking is enabled or compat
 * disallows it) ignore it silently.
 * 2026-08-18 重建（profile 重置后丢失）；用户要求：所有模型温度一律 0.2。
 * @module dsh-local/agent-temperature
 */
import z from '@deepseek-ai/schemastery'
export const name = 'agent-temperature'
export const Config = z.object({
  temperature: z.number().min(0).max(2).default(0.2),
  models: z.dict(z.number().min(0).max(2)),
})
export function temperatureFor(config, provider, model) {
  const models = config.models ?? {}
  return models[`${provider}/${model}`] ?? models[model] ?? config.temperature ?? 0.2
}
export function apply(ctx, config = {}) {
  ctx.on('agent/request', async (_payload, next) => {
    const resolved = await next()
    return { ...resolved, temperature: temperatureFor(config, resolved.provider, resolved.model) }
  })
}