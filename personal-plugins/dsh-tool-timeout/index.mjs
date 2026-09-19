/**
 * dsh-tool-timeout — 工具级 wall-clock 超时守卫
 *
 * 卡死机理（session-a684330e，2026-09-14）：agent-loop 同步等待工具结果，
 * 工具（典型为 run_code 内跑 Playwright/长编译）不返回时 loop 永久挂起，
 * 停止按钮/Esc 的取消只在步边界生效。
 *
 * 修法（公开扩展面，不动核心）：tools/execute waterfall 交给监听器的 exec
 * 允许 wrapper 替换 exec.signal（registry 会与调用方信号融合）。本插件把
 * signal 换成自持 AbortController：调用方 abort 或 wall-clock 超时任一触发
 * 即 abort；registry 归一为规范化取消结果，工具体已观测 exec.signal 的
 * （如 run_code 会向上传播并 abandon 未决派发），loop 立即解锁。
 */
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-tool-timeout'

export const Config = z.object({
  enabled: z.boolean().default(true),
  /** run_code 超时毫秒；0 = 不限时 */
  runCodeTimeoutMs: z.number().default(180000).min(0),
  /** bash 超时毫秒；0 = 不限时（bash 已有自身超时） */
  bashTimeoutMs: z.number().default(0).min(0),
  /** 其余全部工具的兜底超时毫秒；0 = 不启用兜底 */
  defaultTimeoutMs: z.number().default(0).min(0),
})

const LIMITS_KEY = {
  run_code: 'runCodeTimeoutMs',
  bash: 'bashTimeoutMs',
}

export function apply(ctx, config) {
  const cfg = {
    enabled: config.enabled !== false,
    runCodeTimeoutMs: config.runCodeTimeoutMs ?? 180000,
    bashTimeoutMs: config.bashTimeoutMs ?? 0,
    defaultTimeoutMs: config.defaultTimeoutMs ?? 0,
  }

  ctx.on('tools/execute', async (exec, next) => {
    const key = LIMITS_KEY[exec.name]
    const limit = key ? cfg[key] : cfg.defaultTimeoutMs
    if (!cfg.enabled || !limit || limit <= 0 || !exec.signal || exec.signal.aborted) return next()

    const original = exec.signal
    const controller = new AbortController()
    const forward = () => controller.abort(original.reason)
    original.addEventListener('abort', forward, { once: true })

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort(new Error('dsh-tool-timeout: ' + exec.name + ' exceeded ' + limit + 'ms wall-clock; aborted to unblock the agent loop'))
    }, limit)

    exec.signal = controller.signal
    try {
      return await next()
    } finally {
      clearTimeout(timer)
      exec.signal = original
      original.removeEventListener('abort', forward)
      if (timedOut) {
        try { ctx.logger?.warn?.('tool-timeout aborted ' + exec.name + ' after ' + limit + 'ms') } catch { /* logger unavailable */ }
      }
    }
  })
}
