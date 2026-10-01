/** Host half: 无过滤 settings 桥路由。
 * 背景：官方家族桥（@linxin666/dsh-client-ui-web-ui-settings）的 allowlist 只认
 * 家族别名表，第三方 ns（pawl/context-ring/bestharness-guard）永远被过滤。
 * 本路由直接代理 native settings 面（ns = profile 条目 id，无家族映射），
 * 线协议与家族桥对齐（describe/mutate 信封），三卡 client.mjs 的 makeScope
 * 只需换 PREFIX 即可复用全部读写逻辑。
 * 安全：仅 loopback；写操作走官方 settings 服务（revision 栅栏/冲突信封同源）。 */
export const inject = ['webServer']
export const name = 'dsh-plugin-settings-hub'

const loopback = (req) => {
  const a = req.socket?.remoteAddress ?? ''
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'
}
const json = (res, code, value) => {
  res.statusCode = code
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(value))
}
const readBody = (req) => new Promise((resolve) => {
  let data = ''
  req.on('data', (c) => { data += c })
  req.on('end', () => { try { resolve(JSON.parse(data || '{}')) } catch { resolve({}) } })
})

export function apply(ctx) {
  const settingsOf = () => {
    try { return ctx.get('settings', false) ?? ctx.settings } catch { return ctx.settings }
  }
  const view = (d) => ({
    ns: String(d.ns),
    value: d.value ?? {},
    base: d.base,
    user: d.user,
    secrets: [],
    revision: d.revision,
    entryId: String(d.ns),
  })
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-plugin-settings-hub/describe',
    handler: async (req, res) => {
      try {
        if (!loopback(req)) return json(res, 403, { ok: false, code: 'forbidden', message: 'loopback only' })
        await readBody(req)
        const settings = settingsOf()
        if (!settings || typeof settings.describe !== 'function') {
          return json(res, 200, { ok: false, code: 'internal', message: 'settings service unavailable' })
        }
        const descriptors = settings.describe({ redactSecrets: true })
        return json(res, 200, { ok: true, value: { namespaces: descriptors.map(view), writable: true } })
      } catch (e) {
        return json(res, 200, { ok: false, code: 'internal', message: String(e?.message ?? e) })
      }
    },
  }), 'settings-hub: describe')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-plugin-settings-hub/mutate',
    handler: async (req, res) => {
      try {
        if (!loopback(req)) return json(res, 403, { ok: false, code: 'forbidden', message: 'loopback only' })
        const body = await readBody(req)
        if (typeof body.ns !== 'string' || !Array.isArray(body.ops)) {
          return json(res, 200, { ok: false, code: 'settings-rejected', message: 'malformed bridge settings request' })
        }
        const settings = settingsOf()
        if (!settings || typeof settings.mutate !== 'function') {
          return json(res, 200, { ok: false, code: 'internal', message: 'settings service unavailable' })
        }
        const expected = typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined
        await settings.mutate(body.ns, body.ops, expected)
        const d = settings.describe({ redactSecrets: true }).find((c) => String(c.ns) === body.ns)
        if (!d) return json(res, 200, { ok: false, code: 'internal', message: 'namespace disposed after mutate' })
        return json(res, 200, { ok: true, value: view(d) })
      } catch (e) {
        return json(res, 200, { ok: false, code: 'settings-rejected', message: String(e?.message ?? e) })
      }
    },
  }), 'settings-hub: mutate')
}
