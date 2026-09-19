/**
 * dsh-bestharness-ui — host half
 *
 * 职责（最小面，只读聚合 + 一个 loopback 端点）：
 * 1. 惰性折叠 live 会话事件流里的 usage 样本（dsh-usage-all 同款生产验证模式，
 *    O(new events)，不监听易漂移的 session/event 形状）。
 * 2. 注册 /api/bh-ui/live exact 路由（win over /api prefix handler），
 *    自带 peer-socket loopback fence（同 usage-all：非 GET 405、非本机 403）。
 *
 * 聚合口径（与 Claude Code Spinner 对齐，但用真实 usage 而非 /4 估算）：
 * - turnTokens  : 当前 turn 内各 step usage.outputTokens 之和（遇 turn/start 归零）。
 * - totalTokens : 会话累计 outputTokens。
 * - lastUsageAt : 最后一个 usage 样本的墙钟时间（client 用于停滞渐红判定）。
 * - 在跑工具数（runningTools）: tool/call 后未见配对 tool/result 的数量（client 停滞判定的宽限依据）。
 *
 * 3. 注册 /clear 命令（commands registry）——让斜杠菜单可见 /clear（compact 同款注册面）。
 *    行为主路径在 client 拦截（新建+切换走官方按钮）；host handler 是降级提示：
 *    用户看到该提示 = 页面尚未加载新 client bundle（Electron 不自动刷新），提示刷新。
 *
 * 负优化防护：全部只读聚合 + 一个只读端点 + 一个纯提示命令；无监听注册，无定时器。
 */

export const name = 'bestharness-ui'
export const inject = ['webServer']

const LIVE_PATH = '/api/bh-ui/live'

// ---------------------------------------------------------------- loopback fence（usage-all 同款）
function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false
  const a = address.toLowerCase()
  if (a === '::1') return true
  const ipv4 = a.startsWith('::ffff:') ? a.slice(7) : a
  const octets = ipv4.split('.')
  return octets.length === 4 && octets[0] === '127' && octets.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}
function hostNameOf(value) {
  if (typeof value !== 'string') return null
  const host = value.trim().toLowerCase()
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    if (close <= 1) return null
    const suffix = host.slice(close + 1)
    if (suffix !== '' && !/^:\d+$/.test(suffix)) return null
    return host.slice(1, close)
  }
  const first = host.indexOf(':')
  const last = host.lastIndexOf(':')
  if (first !== last) return host
  if (last === -1) return host.replace(/\.$/, '')
  if (!/^\d+$/.test(host.slice(last + 1))) return null
  return host.slice(0, last).replace(/\.$/, '')
}
function rejectForeignCaller(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: false, error: 'method-not-allowed' }))
    return true
  }
  const peer = req.socket?.remoteAddress
  const name = hostNameOf(req.headers.host)
  const hostOk = name === 'localhost' || isLoopbackAddress(name)
  if (isLoopbackAddress(peer) && hostOk) return false
  res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ ok: false, error: 'forbidden' }))
  return true
}

// ---------------------------------------------------------------- usage 折叠
function freshState() {
  return { consumed: 0, turnTokens: 0, replyTokens: 0, turnOutputTokens: 0, totalTokens: 0, lastUsageAt: 0, openTools: 0, maxTurn: 0, stepOut: new Map(), stepFull: new Map(), turns: new Map(), todos: null, lastTool: null, todoAt: 0, turnStartedAt: 0 }
}

/** 增量折叠一段事件（形状容错：chunk.usage / assistant.message.usage / turn,step 顶层字段都试；turn:step 去重防双计）。 */
function foldEvents(state, events) {
  for (const ev of events) {
    if (ev === null || typeof ev !== 'object') continue
    const t = ev.type ?? ev.data?.type
    const d = ev.data ?? ev
    if (t === 'turn/start' || t === 'turn/start-seed') {
      state.turnTokens = 0
      state.replyTokens = 0
      state.turnOutputTokens = 0
      state.stepOut.clear()
      state.stepFull.clear()
      state.turnStartedAt = Date.now()
      state.openTools = 0
      state.maxTurn = Math.max(state.maxTurn, d.turn ?? 0)
      if (d.turn !== undefined && !state.turns.has(d.turn)) state.turns.set(d.turn, { tok: 0, steps: 0 })
    } else if (t === 'assistant/chunk' || t === 'assistant/message') {
      const usage = d?.chunk?.usage ?? d?.usage ?? ev.usage
      // 口径修正（2026-08-25 用户实证"严重造假"）：此前只计 outputTokens，
      // 而 input+cacheRead 通常占真实消耗 90%+（usage-all rollup.js 同源口径）。
      // 全量 = inputTokens + outputTokens + cacheReadTokens，任一>0 即有效样本。
      const num = (v) => (typeof v === 'number' && v > 0 ? v : 0)
      const stepTokens = num(usage?.inputTokens) + num(usage?.outputTokens) + num(usage?.cacheReadTokens)
      if (usage && stepTokens > 0) {
        // usage 为 step 内累计值且流式中多次上报（实测 0→0→102→…）：
        // 每 chunk 覆盖该 step 最新量，总量按增量推进——首 chunk 去重会扔掉
        // 全部增长，速度永远算不出（2026-08-25 tokens/s 无值根因）。
        const tn = d.turn ?? state.maxTurn
        const key = tn + ':' + d.step
        const prevOut = state.stepOut.get(key) ?? 0
        const prevFull = state.stepFull.get(key) ?? 0
        const out = num(usage?.outputTokens)
        state.turnOutputTokens += out - prevOut
        state.turnTokens += stepTokens - prevFull
        state.totalTokens += stepTokens - prevFull
        state.stepOut.set(key, out)
        state.stepFull.set(key, stepTokens)
        state.replyTokens = stepTokens
        state.turns.set(tn, state.turnTokens)
        state.lastUsageAt = Date.now()
      }
    } else if (t === 'tool/call') {
      // 只数 call/result 配对；code-dispatch-start 无独立减计数事件，计入会泄漏虚高
      state.openTools += 1
      if (typeof d.name === 'string' && d.name !== '') state.lastTool = d.name
    } else if (t === 'tool/result') {
      state.openTools = Math.max(0, state.openTools - 1)
    } else if (t === 'todo/write') {
      // Claude currentTodo 语义素材：保存最新列表（渲染期再选活动项）+ 时间戳（陈旧判定）
      if (Array.isArray(d.todos)) { state.todos = d.todos; state.todoAt = Date.now() }
    }
  }
}

export function apply(ctx) {
  const cache = new Map() // sessionId -> state

  const snapshot = () => {
    const out = {}
    const live = ctx.get('sessions')
    if (live !== undefined && typeof live.list === 'function') {
      for (const session of live.list()) {
        if (!session?.id) continue
        let st = cache.get(session.id)
        if (st === undefined) {
          st = freshState()
          cache.set(session.id, st)
        }
        const count = Array.isArray(session.events) ? session.events.length : 0
        if (count < st.consumed) {
          // 日志收缩（重启恢复成压缩摘要）：游标失效，整段重折
          Object.assign(st, freshState())
        }
        if (st.consumed < count) {
          foldEvents(st, session.events.slice(st.consumed))
          st.consumed = count
        }
        // activeTask：第一个 in_progress，无则第一个非 completed（Claude currentTodo 语义）
        let activeTask = null
        if (Array.isArray(st.todos)) {
          const pick = st.todos.find((x) => x && x.status === 'in_progress') ?? st.todos.find((x) => x && x.status && x.status !== 'completed')
          if (pick && typeof pick.content === 'string') activeTask = pick.content
        }
        out[session.id] = {
          turn: st.maxTurn,
          turnStartedAt: st.turnStartedAt || 0,
          replyTokens: st.replyTokens || 0,
          turnOutputTokens: st.turnOutputTokens || 0,
          turnTokens: st.turnTokens,
          totalTokens: st.totalTokens,
          lastUsageAt: st.lastUsageAt,
          openTools: st.openTools,
          turns: Object.fromEntries(st.turns),
          activeTask,
          todoAt: st.todoAt,
          lastTool: st.openTools > 0 ? st.lastTool : null,
        }
      }
    }
    return out
  }

  // /clear 进斜杠菜单（可见性）。行为在 client 拦截；此处 handler 仅作降级提示。
  try {
    ctx.inject(['commands'], (cctx) => {
      cctx.effect(() => cctx.commands.register({
        name: 'clear',
        description: '新建会话并切换（原会话保留可回溯）— Claude /clear 语义',
        handler: () => ({
          kind: 'success',
          text: '/clear 已由 bestharness-ui 接管：client 拦截未生效说明页面还是旧 bundle——刷新页面（Cmd+R / Ctrl+R）后，输入 /clear 回车即可新建会话并切换；或点侧边栏「+ 新建会话」。',
        }),
      }), 'bestharness-ui: clear command')
    }, 'bestharness-ui: commands')
  } catch (e) {
    ctx.logger?.warn?.('bestharness-ui: commands service unavailable, /clear menu entry skipped: ' + String(e?.message ?? e))
  }
  // history ring buffer（实时动态图表数据源）：每 2s 采样活跃会话
  // {t, turn, total, tools}，每会话 180 点（6 分钟窗口），live 随 history 返回。
  const history = new Map()
  ctx.effect(() => {
    const timer = setInterval(() => {
      const sessions = snapshot()
      for (const [id, s] of Object.entries(sessions)) {
        let h = history.get(id)
        if (h === undefined) { h = []; history.set(id, h) }
        h.push({ t: Date.now(), turn: s.turnTokens, total: s.totalTokens, tools: s.openTools })
        if (h.length > 180) h.splice(0, h.length - 180)
      }
      const liveIds = new Set(Object.keys(sessions))
      for (const id of history.keys()) if (!liveIds.has(id)) history.delete(id)
    }, 2000)
    return () => clearInterval(timer)
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: LIVE_PATH,
    handler: (req, res) => {
      if (rejectForeignCaller(req, res)) return
      try {
        const sessions = snapshot()
        const now = Date.now()
        // 当前视图会话优先：client 带 sessionId 时只回报该会话的活跃数据，
        // 空闲则 top=null（client 清空数字与任务文本）。全局 top 会把后台
        // 仍在跑的会话、或 openTools 泄漏（tool/call 未配对 result，如被
        // 中断的运行）的僵尸会话，永久钉在别的会话的状态条上——切换会话
        // 也不换，正是 2026-08-25 "✶ ↓ 14.5k tok 复现-面板出现瞬间A" 根因。
        const want = new URL(req.url, 'http://x').searchParams.get('sessionId') ?? ''
        let top = null
        if (want !== '' && sessions[want] !== undefined) {
          const s = sessions[want]
          if (s.openTools > 0 || now - s.lastUsageAt < 120_000) top = { id: want, ...s }
        } else {
          for (const [id, s] of Object.entries(sessions)) {
            // top 的新鲜度门槛：无在跑工具且 120s 无新 token 的会话不参与——
            // 否则最后一轮攒了大 token 的空闲会话永远霸占 spinner（切换会话
            // 也不换，因为 top 是全局最高而非当前视图）。全空闲时 top 为 null，
            // client 收到 null 清空数字与任务文本。
            if (s.openTools <= 0 && now - s.lastUsageAt >= 120_000) continue
            if (top === null || s.turnTokens > top.turnTokens) top = { id, ...s }
          }
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        const hist = {}
        for (const [id, pts] of history) hist[id] = pts
        res.end(JSON.stringify({ ok: true, now, sessions, top, history: hist }))
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'internal', message: String(err?.message ?? err) }))
      }
    },
  }), 'bestharness-ui: live route')
}
