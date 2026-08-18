/**
 * dsh-local/context-ring — ContextMeter ring color by usage percent.
 * Dual-half: host serves /api/context-ring/config (loopback-fenced); client
 * shows a palette panel (swatch pickers + threshold sliders) in the sidebar.
 * Config authority: the host settings service (namespace `context-ring`) —
 * the GUI settings card, the sidebar palette, and ring behavior all read and
 * write the same scope; nothing is persisted in this plugin any more.
 * @module dsh-local/context-ring
 */
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

export const inject = ['webServer']
export const name = 'dsh-context-ring'
export const RING_SETTINGS = settingsNamespace('context-ring')
const SettingsSchema = z.object({
  warnAt: z.number().step(5).min(0).max(100).default(50),
  dangerAt: z.number().step(5).min(0).max(100).default(80),
  warnColor: z.string().default('#f59e0b'),
  dangerColor: z.string().default('#ef4444'),
})
export const Config = SettingsSchema

const DEFAULTS = { warnAt: 50, dangerAt: 80, warnColor: '#f59e0b', dangerColor: '#ef4444' }
const KEYS = Object.keys(DEFAULTS)

function loopback(req) {
  const a = req.socket.remoteAddress
  if (a !== '127.0.0.1' && a !== '::1' && a !== '::ffff:127.0.0.1') return false
  return true
}

export function apply(ctx) {
  let current = { ...DEFAULTS }
  let scope = null

  // 设置服务 = 唯一数据源：GUI 设置卡与调色板 POST 都写 scope，行为读 scope
  ctx.inject(['settings'], (sctx) => {
    scope = sctx.settings.register(RING_SETTINGS, SettingsSchema, { base: DEFAULTS })
    const sync = () => { current = { ...DEFAULTS, ...scope.get() } }
    sync()
    ctx.effect(() => scope.watch(sync), 'context-ring: settings sync')
  }, 'context-ring: settings')

  ctx.effect(() => {
    const route = {
      kind: 'exact', path: '/api/context-ring/config',
      handler: async (req, res) => {
        if (!loopback(req)) { res.writeHead(403); res.end('{}'); return }
        const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
        if (req.method === 'GET') return send(200, { ok: true, config: current })
        if (req.method === 'POST') {
          let raw = ''
          for await (const c of req) raw += c
          try {
            const body = JSON.parse(raw)
            const patch = {}
            for (const k of KEYS) if (body[k] !== undefined) patch[k] = body[k]
            const next = { ...current, ...patch }
            if (!(Number(next.warnAt) >= 0 && Number(next.warnAt) <= 100) || !(Number(next.dangerAt) >= 0 && Number(next.dangerAt) <= 100)) return send(400, { ok: false, error: 'thresholds must be 0-100' })
            if (!/^#[0-9a-fA-F]{6}$/.test(String(next.warnColor)) || !/^#[0-9a-fA-F]{6}$/.test(String(next.dangerColor))) return send(400, { ok: false, error: 'colors must be #rrggbb' })
            if (scope === null) return send(503, { ok: false, error: 'settings not ready' })
            await scope.update(patch)
            current = { ...current, ...patch }
            return send(200, { ok: true, config: current })
          } catch { return send(400, { ok: false, error: 'invalid json' }) }
        }
        return send(405, { ok: false })
      },
    }
    const d = ctx.webServer.register(route)
    return () => d()
  }, 'context-ring: route')
}
