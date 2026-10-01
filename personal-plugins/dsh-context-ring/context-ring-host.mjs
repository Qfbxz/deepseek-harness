/**
 * dsh-local/context-ring — ContextMeter ring color by usage percent.
 * Dual-half: host serves /api/context-ring/config (loopback-fenced); client
 * shows a palette panel (swatch pickers + threshold sliders) in the sidebar.
 * Config authority: the host settings service (namespace `context-ring`) —
 * the GUI settings card, the sidebar palette, and ring behavior all read and
 * write the same scope; nothing is persisted in this plugin any more.
 * @module dsh-local/context-ring
 */
import * as DshSettings from '@deepseek-ai/dsh-settings'
const settingsNamespace = DshSettings.settingsNamespace
import z from '@deepseek-ai/schemastery'

export const inject = ['webServer']
export const name = 'dsh-context-ring'
export const RING_SETTINGS = settingsNamespace ? settingsNamespace('context-ring') : null
const SettingsSchema = z.object({
  warnAt: z.number().step(5).min(0).max(100).default(50).volatile(),
  dangerAt: z.number().step(5).min(0).max(100).default(80).volatile(),
  warnColor: z.string().default('#f59e0b').volatile(),
  dangerColor: z.string().default('#ef4444').volatile(),
})
export const Config = SettingsSchema

const DEFAULTS = { warnAt: 50, dangerAt: 80, warnColor: '#f59e0b', dangerColor: '#ef4444' }
const KEYS = Object.keys(DEFAULTS)

function loopback(req) {
  const a = req.socket.remoteAddress
  if (a !== '127.0.0.1' && a !== '::1' && a !== '::ffff:127.0.0.1') return false
  return true
}

export function apply(ctx, config = {}) {
  // volatile 字段在 apply 的 config 参里是分层占位({} 或 {base,user})——剥成标量
  const peel = (v) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v
    if ('user' in v || 'base' in v) return v.user !== undefined ? v.user : v.base
    return undefined
  }
  const seeded = {}
  for (const k of KEYS) { const v = peel(config && config[k]); if (v !== undefined) seeded[k] = v }
  let current = { ...DEFAULTS, ...seeded }
  let scope = null
  let settingsSvc = null

  // 设置服务 = 唯一数据源：GUI 设置卡与调色板 POST 都写 scope，行为读 scope
  ctx.inject(['settings'], (sctx) => {
    settingsSvc = sctx.settings
    if (!(RING_SETTINGS && sctx.settings && typeof sctx.settings.register === 'function')) {
      // 0.2.0: settingsNamespace 已删——config 由 loader 按 Config schema 装配,写走 mutate
      return
    }
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
            if (scope === null) {
              if (settingsSvc && typeof settingsSvc.mutate === 'function') {
                await settingsSvc.mutate('context-ring', Object.entries(patch).map(([k, v]) => ({ op: 'set', path: [k], value: v })))
                current = { ...current, ...patch }
                return send(200, { ok: true, config: current })
              }
              return send(503, { ok: false, error: 'settings not ready' })
            }
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
