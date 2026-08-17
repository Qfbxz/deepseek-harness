/**
 * dsh-local/context-ring — ContextMeter ring color by usage percent.
 * Dual-half: host serves /api/context-ring/config (loopback-fenced, persists
 * into ~/.dsh/cordis.patch.yml and hot-applies); client shows a palette panel
 * (swatch pickers + threshold sliders) in the sidebar.
 * @module dsh-local/context-ring
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'

import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
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

const PATCH = join(dirname(fileURLToPath(import.meta.url)), 'cordis.patch.yml')
const DEFAULTS = { warnAt: 50, dangerAt: 80, warnColor: '#f59e0b', dangerColor: '#ef4444' }
const KEYS = Object.keys(DEFAULTS)
const CONFIG_LINE = /^\s+(warnAt|dangerAt|warnColor|dangerColor):/

function parseConfig(text) {
  const out = {}
  const lines = text.split('\n')
  let inBlock = false
  for (const line of lines) {
    if (line.includes('id: dsh-context-ring')) { inBlock = true; continue }
    if (inBlock && line.startsWith('- ')) break
    if (inBlock) {
      const m = line.match(/^\s+(warnAt|dangerAt|warnColor|dangerColor):\s*'?"?([^'"\s]+)'?"?\s*$/)
      if (m) out[m[1]] = m[2]
    }
  }
  return out
}

async function readCfg() {
  try { return { ...DEFAULTS, ...parseConfig(await readFile(PATCH, 'utf8')) } } catch { return { ...DEFAULTS } }
}

async function writeCfg(patch) {
  const text = await readFile(PATCH, 'utf8')
  const lines = text.split('\n')
  let inBlock = false, edited = false
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('id: dsh-context-ring')) { inBlock = true; continue }
    if (inBlock && lines[i].startsWith('- ')) break
    if (inBlock) {
      const m = lines[i].match(CONFIG_LINE)
      if (m && patch[m[1]] !== undefined) {
        const v = patch[m[1]]
        lines[i] = lines[i].replace(/:\s*.*/, typeof v === 'string' ? ": '" + v + "'" : ': ' + v)
        edited = true
      }
    }
  }
  if (edited) await writeFile(PATCH, lines.join('\n'))
  return edited
}

function loopback(req) {
  const a = req.socket.remoteAddress
  if (a !== '127.0.0.1' && a !== '::1' && a !== '::ffff:127.0.0.1') return false
  return true
}

export function apply(ctx) {
  // GUI 设置页表单：官方 settings seam（live-stats 范式）
  installSettingsSection(ctx, RING_SETTINGS, SettingsSchema, DEFAULTS, {
    setSource: () => {},
    onChange: () => { readCfg().then((c) => { current = c }).catch(() => {}) },
  })
  let current = { ...DEFAULTS }
  readCfg().then((c) => { current = c }).catch(() => {})

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
            current = next
            writeCfg(patch).catch(() => {})
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
