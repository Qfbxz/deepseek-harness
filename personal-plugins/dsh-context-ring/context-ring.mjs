/**
 * context-ring entry — loads the two halves (host API + client palette UI).
 * cordis.patch.yml points here; this file re-exports host apply (webServer
 * route) and separately boots the client module when running in a browser.
 * @module dsh-local/context-ring
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

let hostApply
try {
  const host = await import('./context-ring-host.mjs')
  hostApply = host.apply
} catch { hostApply = () => {} }

export const inject = ['webServer']
export const name = 'dsh-context-ring'
export const Config = Object

export function apply(ctx, config = {}) {
  const disposeHost = hostApply(ctx, config) || (() => {})
  return () => disposeHost()
}

// browser half: the web client loader imports "./client" of THIS entry file
export { apply as client } from './context-ring-client.mjs'
