/**
 * Host side of dsh-desktop-chrome: window chrome is all client-side; this
 * half serves ONE route — POST /dsh-local/import-session — which converts an
 * uploaded Claude Code / Codex / native-dsh session log into a dsh session
 * under $DSH_HOME/sessions and returns the new session id, so the web UI can
 * jump straight into the imported conversation.
 *
 * Dependency-free (node builtins only), matching the modlens plugin style.
 * @module dsh-desktop-chrome
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { constants as zstdConstants, gunzipSync, inflateRawSync, zstdCompress, zstdDecompressSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'

/** The deployment's default model route, for imported assistant messages. */
function defaultModelRoute() {
  try {
    const settings = readFileSync(join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'settings.yaml'), 'utf8')
    const provider = settings.match(/agent-default-model:\s*\n\s*provider:\s*(\S+)/)?.[1] ?? 'deepseek-official'
    const model = settings.match(/agent-default-model:\s*\n\s*provider:\s*\S+\s*\n\s*model:\s*(\S+)/)?.[1] ?? 'deepseek-v4-flash'
    return { provider, model }
  } catch {
    return { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'desktop-chrome'

// ── dsh session-store path encoding (mirrors dsh-session-persistence-jsonl) ──

const SAFE = /^[A-Za-z0-9._-]$/

function encodeChars(raw) {
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && SAFE.test(ch)) out += ch
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

function projectKey(cwd) {
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i += 1) {
    const ch = String.fromCharCode(cwd.charCodeAt(i))
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else {
      separatorRun = false
      const code = cwd.charCodeAt(i)
      readable += ch !== '~' && SAFE.test(ch) ? ch : '~' + code.toString(16).toUpperCase().padStart(4, '0')
    }
  }
  // the store encodes the cwd as if it carried a trailing separator, then
  // wraps with dashes (verified on-disk: /Users/x → --Users-x--,
  // /a/DPOS → --a-DPOS--)
  if (!readable.endsWith('-')) readable += '-'
  return '-' + readable + '-'
}

// ── minimal ZIP reader (store + deflate) for native dsh archives ────────────

function unzip(buffer) {
  const files = []
  // find End of Central Directory
  let eocd = -1
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 65558; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('zip: end of central directory not found')
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.slice(offset + 46, offset + 46 + nameLength).toString('utf8')
    if (localOffset >= 0 && buffer.readUInt32LE(localOffset) === 0x04034b50) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26)
      const localExtraLength = buffer.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + localNameLength + localExtraLength
      const data = buffer.slice(dataStart, dataStart + compressedSize)
      if (method === 0) files.push({ name, data })
      else if (method === 8) files.push({ name, data: inflateRawSync(data) })
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  return files
}

// ── dsh event assembly ───────────────────────────────────────────────────────

class DshEvents {
  constructor(cwd, sessionId, createdAt) {
    this.cwd = cwd
    this.id = sessionId
    this.createdAt = createdAt
    this.seq = -1
    this.time = createdAt
    this.modelRoute = defaultModelRoute()
    this.lines = []
    // the session header carries no seq/time; seq starts at 0 on the next line
    this.lines.push(JSON.stringify({ type: 'session', version: 0, id: sessionId, createdAt, cwd, delegationDepth: 0 }))
    this.push({ type: 'permission/preset', data: { preset: 'danger-full-access' } })
    this.push({ type: 'sandbox/mode', data: { mode: 'danger-full-access' } })
    this.push({ type: 'approval/policy', data: { policy: 'never' } })
  }

  push(event) {
    this.seq += 1
    if (Number.isFinite(event.time)) this.time = event.time
    else this.time += 1
    // an explicit `time: undefined` on the event would override the base
    // timestamp and JSON.stringify would drop the field — strip it first
    const { time: eventTime, ...rest } = event
    this.lines.push(JSON.stringify({ seq: this.seq, time: this.time, ...rest }))
    return this
  }

  turn(turn, event) { return this.push({ type: 'turn/' + event, data: { turn, ...(event === 'end' ? { reason: { kind: 'stop' } } : {}) } }) }
  step(turn, step, event) { return this.push({ type: 'step/' + event, data: { turn, step } }) }

  user(content, time) {
    // surfaceOp is an event-top-level marker (sibling of type/seq), not data
    return this.push({ type: 'user/message', time, surfaceOp: 'append', data: {
      content: Array.isArray(content) ? content : [{ type: 'text', text: String(content) }],
      source: { kind: 'user' },
      role: 'user',
      id: randomUUID(),
    } })
  }

  assistant(content, turn, step, time) {
    return this.push({ type: 'assistant/message', time, surfaceOp: 'append', data: { turn, step, message: {
      role: 'assistant',
      content,
      source: { kind: 'model', ...this.modelRoute },
      id: randomUUID(),
    } } })
  }

  toolCall(callId, name, args, turn, step, time) {
    return this.push({ type: 'tool/call', time, data: { turn, step, callId, name, arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}) } })
  }

  toolResult(callId, text, turn, step, time) {
    return this.push({ type: 'tool/result', time, surfaceOp: 'append', data: { turn, step, message: {
      source: { kind: 'tool', callId },
      role: 'user',
      id: randomUUID(),
      content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text: String(text ?? '') }] }],
    } } })
  }

  text() { return this.lines.join('\n') + '\n' }
}

// ── Claude Code → dsh ────────────────────────────────────────────────────────

function convertClaude(lines, cwd, sessionId) {
  const entries = []
  for (const line of lines) {
    let d
    try { d = JSON.parse(line) } catch { continue }
    if (d && typeof d === 'object' && typeof d.cwd === 'string' && cwd === undefined) cwd = d.cwd
    if (!d || typeof d !== 'object' || (d.type !== 'user' && d.type !== 'assistant')) continue
    // meta injections and subagent sidechains are not main-thread conversation
    if (d.isMeta === true || d.isSidechain === true) continue
    entries.push(d)
  }
  const events = new DshEvents(cwd ?? homedir(), sessionId, entries[0]?.timestamp ?? Date.now())
  let turn = 0
  let step = 0
  let pendingTools = [] // tool_use blocks awaiting their results

  const flushTurn = () => { if (turn > 0) { events.step(turn, step, 'end'); events.turn(turn, 'end') } }

  for (const entry of entries) {
    const time = Number.isFinite(entry.timestamp) ? entry.timestamp : undefined
    const content = entry.message?.content
    if (entry.type === 'user') {
      const blocks = Array.isArray(content) ? content : [{ type: 'text', text: String(content ?? '') }]
      const toolResults = blocks.filter((b) => b.type === 'tool_result')
      const textBlocks = blocks.filter((b) => b.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '')
      if (toolResults.length > 0 && pendingTools.length > 0) {
        for (const result of toolResults) {
          const text = typeof result.content === 'string' ? result.content
            : Array.isArray(result.content) ? result.content.map((c) => c.text ?? '').join('\n') : ''
          events.toolResult(result.tool_use_id ?? 'call_import', text, turn, step, time)
        }
        continue
      }
      if (textBlocks.length === 0) continue
      flushTurn()
      turn += 1
      step = 1
      events.turn(turn, 'start')
      events.step(turn, step, 'start')
      events.user(textBlocks.map((b) => ({ type: 'text', text: b.text })), time)
    } else if (entry.type === 'assistant') {
      // assistant content may be a bare string in some Claude versions
      const blocks = Array.isArray(content) ? content : (typeof content === 'string' ? [{ type: 'text', text: content }] : [])
      const out = []
      pendingTools = []
      for (const block of blocks) {
        if (block.type === 'thinking' && typeof block.thinking === 'string') out.push({ type: 'reasoning', text: block.thinking })
        if (block.type === 'text' && typeof block.text === 'string') out.push({ type: 'text', text: block.text })
        if (block.type === 'tool_use') pendingTools.push(block)
      }
      if (out.length > 0) events.assistant(out, turn, step, time)
      for (const tool of pendingTools) {
        events.toolCall(tool.id ?? 'call_import', tool.name, JSON.stringify(tool.input ?? {}), turn, step, time)
      }
    }
  }
  flushTurn()
  const title = events.lines.length > 4 ? firstUserText(events) : undefined
  return { events, cwd: events.cwd, stats: { turns: turn, steps: step, lastTime: events.time, title } }
}

/** First user text, truncated for the session title. */
function firstUserText(events) {
  for (const line of events.lines) {
    const d = JSON.parse(line)
    if (d.type !== 'user/message') continue
    const block = d.data?.content?.[0]
    if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
      return block.text.trim().slice(0, 60)
    }
  }
  return undefined
}

// ── Codex → dsh ──────────────────────────────────────────────────────────────

function convertCodex(lines, cwd, sessionId) {
  const items = []
  for (const line of lines) {
    let d
    try { d = JSON.parse(line) } catch { continue }
    if (d?.type === 'session_meta' && typeof d.payload?.cwd === 'string' && cwd === undefined) cwd = d.payload.cwd
    if (d?.type === 'response_item' && d.payload) items.push({ payload: d.payload, time: Number.isFinite(d.timestamp) ? d.timestamp : undefined })
  }
  const events = new DshEvents(cwd ?? homedir(), sessionId, items[0]?.time ?? Date.now())
  let turn = 0
  let step = 0
  const flushTurn = () => { if (turn > 0) { events.step(turn, step, 'end'); events.turn(turn, 'end') } }
  for (const { payload, time } of items) {
    if (payload.type === 'message' && payload.role === 'user') {
      const text = (payload.content ?? []).map((c) => c.text ?? '').join('\n').trim()
      if (text === '') continue
      flushTurn()
      turn += 1
      step = 1
      events.turn(turn, 'start')
      events.step(turn, step, 'start')
      events.user([{ type: 'text', text }], time)
    } else if (payload.type === 'message' && payload.role === 'assistant') {
      const text = (payload.content ?? []).map((c) => c.text ?? '').join('\n')
      if (text !== '') events.assistant([{ type: 'text', text }], turn, step, time)
    } else if (payload.type === 'function_call') {
      events.toolCall(payload.call_id ?? 'call_import', payload.name, payload.arguments ?? '{}', turn, step, time)
    } else if (payload.type === 'function_call_output') {
      events.toolResult(payload.call_id ?? 'call_import', payload.output ?? '', turn, step, time)
    }
  }
  flushTurn()
  return { events, cwd: events.cwd, stats: { turns: turn, steps: step, lastTime: events.time, title: firstUserText(events) } }
}

// ── format detection + persistence ───────────────────────────────────────────

function detect(lines) {
  // real logs open with long metadata runs — sample the head AND the middle
  const sample = [...lines.slice(0, 60), ...lines.slice(Math.max(0, lines.length >> 1), (lines.length >> 1) + 60)].join('\n')
  if (sample.includes('"type":"session"') || sample.includes('"type": "session"')) return 'dsh'
  if (sample.includes('"response_item"') || sample.includes('"session_meta"')) return 'codex'
  if (/"type"\s*:\s*"(user|assistant)"\s*,\s*"(message|sessionId)"/.test(sample) || sample.includes('"tool_use"')) return 'claude'
  return 'unknown'
}

/** One checksummed zstd frame per JSONL line — the store's on-disk format
 * (the loader asserts the first frame is exactly the header line). */
async function compressFrame(text) {
  return await new Promise((resolve, reject) => {
    zstdCompress(Buffer.from(text, 'utf8'), { params: { [zstdConstants.ZSTD_c_checksumFlag]: 1 } }, (error, result) => {
      if (error) reject(error)
      else resolve(result)
    })
  })
}

async function persistSession(jsonlText, cwd, sessionId) {
  const root = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
  const dir = join(root, projectKey(cwd), encodeChars(sessionId))
  mkdirSync(dir, { recursive: true })
  const frames = []
  for (const line of jsonlText.split('\n')) {
    if (line.trim() === '') continue
    frames.push(await compressFrame(line + '\n'))
  }
  writeFileSync(join(dir, 'session.jsonl.zstd'), Buffer.concat(frames))
  return dir
}

/** Seed the session projection cache — the sidebar tree renders from these
 * projections, so an imported session without one stays invisible even when
 * attached to the workspace. Minimal rows: identity, title, stats, list meta. */
function injectProjection(sessionId, cwd, title, turns, steps, lastTime) {
  const store = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages', 'session_projcache.json')
  const cache = JSON.parse(readFileSync(store, 'utf8'))
  const sessions = cache.tables?.sessions ?? {}
  const seq = 1000
  const now = Number.isFinite(lastTime) ? lastTime : Date.now()
  sessions[sessionId] = {
    identity: { createdAt: now, cwd },
    rows: {
      sessionStats: { ver: 1, seq, val: { turns, steps, llmMs: 0, toolMs: 0, ttftMs: null, ttftSteps: 0, decodeMs: 0, decodeTokens: 0, lastTurn: turns, openStep: null, pendingCalls: {} } },
      title: { ver: 1, seq, val: title ?? '导入的会话' },
      goal: { ver: 4, seq, val: null },
      tokenUsage: { ver: 1, seq, val: null },
      contextPressure: { ver: 4, seq, val: null },
      contextBreakdown: { ver: 2, seq, val: null },
      subagentTiming: { ver: 2, seq, val: { descriptorSeen: false, settledMs: 0 } },
      subagent: { ver: 2, seq, val: {} },
      permissions: { ver: 1, seq, val: { preset: 'danger-full-access', sandbox: 'danger-full-access', approval: 'never' } },
      sessionListMetadata: { ver: 1, seq, val: { blank: false, lastPromptAt: now } },
      imageLimits: { ver: 1, seq, val: null },
      todos: { ver: 2, seq, val: null },
      plan: { ver: 1, seq, val: { active: false, wanted: null } },
    },
  }
  cache.tables = cache.tables ?? {}
  cache.tables.sessions = sessions
  writeFileSync(store, JSON.stringify(cache))
}

/** Register the import route once the web server appears. */
function registerImportRoute(ctx) {
  ctx.effect(() => ctx.inject(['webServer', 'workspaceRegistry'], (host) => {
    /** Resolve a workspace title (from the composer pill) to its path. */
    const workspacePath = (title) => {
      try {
        const record = host.workspaceRegistry.list().find((r) => r.title === title)
        return record?.path
      } catch {
        return undefined
      }
    }
    host.webServer.register({
      kind: 'exact',
      path: '/dsh-local/import-session',
      handler: async (req, res) => {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const body = Buffer.concat(chunks)
        const filename = new URL(req.url, 'http://x').searchParams.get('filename') ?? 'session.jsonl'
        try {
          // large uploads arrive gzipped (browser CompressionStream)
          const payload = body.length > 2 && body[0] === 0x1f && body[1] === 0x8b ? gunzipSync(body) : body
          const query = new URL(req.url, 'http://x').searchParams
          let targetCwd
          const wsTitle = query.get('ws')
          if (wsTitle !== null && wsTitle !== '') targetCwd = workspacePath(wsTitle)
          if (targetCwd === undefined && query.get('cwd') === 'auto') targetCwd = activeWorkspaceCwd()
          const result = await importSession(payload, filename, targetCwd)
          // attach to the workspace's session list — the sidebar is driven by
          // workspace membership, not by disk scans, so orphans stay invisible
          try {
            const registry = host.workspaceRegistry
            const entity = (await registry.resolveByPath(result.cwd)) ?? (await registry.create(result.cwd))
            await entity.attachSession(result.sessionId)
          } catch (error) {
            console.warn('[desktop-chrome] workspace attach skipped:', error?.message ?? error)
          }
          try {
            injectProjection(result.sessionId, result.cwd, result.title, result.turns, result.steps, result.lastTime)
          } catch (error) {
            console.warn('[desktop-chrome] projection inject skipped:', error?.message ?? error)
          }
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, ...result }))
        } catch (error) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }))
        }
      },
    }, 'desktop-chrome: session import route')
  }), 'desktop-chrome: session import')
}

/** The cwd of the most recently written session — the workspace the user is
 * actively working in. Imports land there so they are immediately visible. */
function activeWorkspaceCwd() {
  try {
    const root = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
    let newest = null
    for (const dir of readdirSync(root, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue
      for (const sub of readdirSync(join(root, dir.name), { withFileTypes: true })) {
        if (!sub.isDirectory() || !sub.name.startsWith('session-')) continue
        const file = join(root, dir.name, sub.name, 'session.jsonl.zstd')
        try {
          const mtime = statSync(file).mtimeMs
          if (newest === null || mtime > newest.mtime) newest = { file, mtime }
        } catch { /* unreadable entry */ }
      }
    }
    if (newest === null) return undefined
    const text = zstdDecompressSync(readFileSync(newest.file)).toString('utf8')
    const header = JSON.parse(text.slice(0, text.indexOf('\n')))
    return typeof header.cwd === 'string' ? header.cwd : undefined
  } catch {
    return undefined
  }
}

/** Detect the format and persist; returns the new session identity. */
async function importSession(body, filename, targetCwd) {
  if (filename.endsWith('.zip')) {
    const files = unzip(body)
    const raw = files.find((f) => f.name.endsWith('session.jsonl.zstd'))
    if (raw !== undefined) {
      const head = JSON.parse(zstdPeekHeader(raw.data))
      const dir = await persistRaw(raw.data, head.cwd, head.id)
      return { sessionId: head.id, cwd: head.cwd, dir, format: 'dsh-zip' }
    }
    const plain = files.find((f) => f.name.endsWith('session.jsonl') || f.name.endsWith('.jsonl'))
    if (plain === undefined) throw new Error('zip contains no session log')
    const lines = plain.data.toString('utf8').split('\n').filter((l) => l.trim() !== '')
    if (detect(lines) !== 'dsh') throw new Error('zip log is not a dsh session')
    const head = JSON.parse(lines[0])
    const dir = await persistSession(lines.join('\n') + '\n', head.cwd, head.id)
    return { sessionId: head.id, cwd: head.cwd, dir, format: 'dsh-zip' }
  }
  const lines = body.toString('utf8').split('\n').filter((l) => l.trim() !== '')
  const format = detect(lines)
  if (format === 'dsh') {
    const head = JSON.parse(lines[0])
    const sessionId = 'session-' + randomUUID()
    const cwd = targetCwd ?? head.cwd
    const dir = await persistSession(lines.join('\n') + '\n', cwd, sessionId)
    return { sessionId, cwd, dir, format }
  }
  if (format === 'unknown') throw new Error('unrecognized session format (expected claude/codex/dsh jsonl or dsh zip)')
  const sessionId = 'session-' + randomUUID()
  const converted = format === 'claude'
    ? convertClaude(lines, targetCwd, sessionId)
    : convertCodex(lines, targetCwd, sessionId)
  const cwd = targetCwd ?? converted.cwd
  if (targetCwd !== undefined && converted.cwd !== targetCwd) converted.events.cwd = targetCwd
  const dir = await persistSession(converted.events.text(), cwd, sessionId)
  const stats = converted.stats ?? { turns: 0, steps: 0, lastTime: Date.now(), title: undefined }
  return { sessionId, cwd, dir, format, events: converted.events.lines.length, ...stats }
}

/** Read the first JSON line of a zstd-compressed session log. */
function zstdPeekHeader(compressed) {
  const text = zstdDecompressSync(compressed).toString('utf8')
  return text.slice(0, text.indexOf('\n'))
}

/** Nothing to apply beyond the route: all UI behavior lives client-side. */
export function apply(ctx) {
  if (typeof ctx.inject === 'function') registerImportRoute(ctx)
}
