/**
 * dsh-usage-pro — host half.
 *
 * cc-switch-style usage statistics for DSH, without cc-switch:
 *   capture  — host "session/event" bus; fold every provider-reported usage
 *              (input/output/cacheRead/cacheWrite) per request;
 *   store    — node:sqlite (Node 22.5+ built-in; zero native deps): one
 *              request table deduped on (sessionId, seq) + daily rollups;
 *   serve    — GET /dsh-local/usage-pro/summary → today/month totals per
 *              model; the single source of truth for every display.
 */
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

export const name = 'usage-pro'

const HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const DATA_DIR = join(HOME, 'usage-pro')
mkdirSync(DATA_DIR, { recursive: true })
const db = new DatabaseSync(join(DATA_DIR, 'usage.db'))

db.exec(
  'CREATE TABLE IF NOT EXISTS requests (' +
  ' session_id TEXT NOT NULL, seq INTEGER NOT NULL, day TEXT NOT NULL,' +
  ' model TEXT NOT NULL DEFAULT \'\',' +
  ' input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,' +
  ' cache_read INTEGER NOT NULL DEFAULT 0, cache_write INTEGER NOT NULL DEFAULT 0,' +
  ' created_at INTEGER NOT NULL, PRIMARY KEY (session_id, seq))'
)
db.exec('CREATE INDEX IF NOT EXISTS idx_requests_day ON requests(day)')
db.exec(
  'CREATE TABLE IF NOT EXISTS rollups (' +
  ' day TEXT NOT NULL, model TEXT NOT NULL,' +
  ' requests INTEGER NOT NULL DEFAULT 0,' +
  ' input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,' +
  ' cache_read INTEGER NOT NULL DEFAULT 0, cache_write INTEGER NOT NULL DEFAULT 0,' +
  ' PRIMARY KEY (day, model))'
)

function dayKey(ts) { const d = new Date(ts || Date.now()); const m = String(d.getMonth() + 1).padStart(2, "0"); const day = String(d.getDate()).padStart(2, "0"); return d.getFullYear() + "-" + m + "-" + day; }


// ── diagnostics: keep raw samples for path verification
const samples = []
function sampleEvent(event) {
  try {
    const t = String(event?.type ?? '')
    if (t === 'assistant/message' || (t === 'assistant/chunk' && event?.data?.chunk?.type === 'usage')) {
      samples.push({ at: Date.now(), type: t, turn: event?.data?.turn, step: event?.data?.step, usage: t === 'assistant/message' ? event?.data?.usage : event?.data?.chunk?.usage ?? null })
      if (samples.length > 30) samples.shift()
    }
  } catch { /* diagnostics never throw */ }
}

// ── capture (authoritative field paths, verified against dsh-token-meter):
//   usage rides on TWO event types:
//     assistant/chunk + data.chunk.type === 'usage' → data.chunk.usage (stream sample)
//     assistant/message + data.usage !== undefined   → data.usage (final, most authoritative)
//   one recorded row per (session, turn, step); the finalized message wins.
const lastSample = new Map() // key: sid/turn/step → {model, usage, seen} (stream sample)
const committed = new Set()  // keys already recorded (in-memory fast path; DB PK is the guard)
const keyOf = (sid, turn, step) => sid + '/' + turn + '/' + step

/** Summary snapshot: today (per-model + totals) and month-to-date from rollups. */
function summary() {
  const today = dayKey()
  const month = today.slice(0, 7)
  const byDay = db.prepare(
    'SELECT model, requests, input_tokens, output_tokens, cache_read, cache_write FROM rollups WHERE day = ? ORDER BY input_tokens + output_tokens + cache_read DESC'
  ).all(today)
  const todayAgg = db.prepare(
    'SELECT COALESCE(SUM(requests),0) AS requests, COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o, COALESCE(SUM(cache_read),0) AS cr, COALESCE(SUM(cache_write),0) AS cw FROM rollups WHERE day = ?'
  ).get(today)
  const monthAgg = db.prepare(
    'SELECT COALESCE(SUM(requests),0) AS requests, COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o, COALESCE(SUM(cache_read),0) AS cr, COALESCE(SUM(cache_write),0) AS cw FROM rollups WHERE day LIKE ?'
  ).get(month + '%')
  return { ok: true, today: { ...todayAgg, models: byDay }, month: monthAgg }
}

function commit(sid, turn, step, model, usage) {
  const key = keyOf(sid, turn, step)
  if (committed.has(key)) return
  const input = Number(usage.inputTokens ?? 0)
  const output = Number(usage.outputTokens ?? 0)
  const cr = Number(usage.cacheReadTokens ?? 0)
  const cw = Number(usage.cacheWriteTokens ?? 0)
  if (input + output + cr + cw === 0) return
  const day = dayKey()
  try {
    const tx = db.prepare(
      'INSERT OR IGNORE INTO requests (session_id, seq, day, model, input_tokens, output_tokens, cache_read, cache_write, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(sid, turn + '-' + step, day, model || '', input, output, cr, cw, Date.now())
    if (tx.changes > 0) {
      db.prepare(
        'INSERT INTO rollups (day, model, requests, input_tokens, output_tokens, cache_read, cache_write) VALUES (?, ?, 1, ?, ?, ?, ?)' +
        ' ON CONFLICT(day, model) DO UPDATE SET requests = requests + 1, input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, cache_read = cache_read + ?, cache_write = cache_write + ?'
      ).run(day, model || '', input, output, cr, cw, input, output, cr, cw)
    }
    committed.add(key)
    if (committed.size > 5000) committed.clear() // bounded; DB PK still guards replays
  } catch { /* never throw */ }
}

export function apply(ctx) {
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args
    // (same body below; session/event is session-scoped, third-party ctx
    // receives it only through the global internal/dispatch bus)
    // DUMP_GUARD: log the first 5 raw event shapes to stderr for path diagnosis
    if (globalThis.__usageProDumped === undefined) globalThis.__usageProDumped = 0;
    if (globalThis.__usageProDumped < 5) {
      globalThis.__usageProDumped++;
      try { console.error('[usage-pro DUMP] session=' + (session && session.id) + ' event=' + JSON.stringify(event).slice(0, 300)); } catch (e) {}
    }
    sampleEvent(event)
    try {
      const sid = session?.id ?? event?.sessionId
      const type = event?.type
      if (sid === undefined) return
      const sidStr = String(sid)
      const data = event?.data ?? {}
      const turn = data.turn
      const step = data.step

      if (type === 'assistant/chunk' && data.chunk?.type === 'usage') {
        // stream sample: remember max per (turn, step); superseded by message
        const key = keyOf(sidStr, turn, step)
        const prev = lastSample.get(key)
        const u = data.chunk.usage
        if (u !== undefined && u !== null) {
          lastSample.set(key, {
            model: String(data.model ?? ''),
            usage: prev ? {
              inputTokens: Math.max(prev.usage.inputTokens ?? 0, u.inputTokens ?? 0),
              outputTokens: Math.max(prev.usage.outputTokens ?? 0, u.outputTokens ?? 0),
              cacheReadTokens: Math.max(prev.usage.cacheReadTokens ?? 0, u.cacheReadTokens ?? 0),
              cacheWriteTokens: Math.max(prev.usage.cacheWriteTokens ?? 0, u.cacheWriteTokens ?? 0),
            } : u,
            seen: Date.now(),
          })
        }
        return
      }

      if (type === 'assistant/message' && data.usage !== undefined) {
        commit(sidStr, turn, step, String(data.model ?? ''), data.usage)
        lastSample.delete(keyOf(sidStr, turn, step))
        return
      }

      // step/end without a finalized message (cancelled/failed): commit the
      // best stream sample so cancelled turns still count (cc-switch parity).
      if (type === 'step/end' && turn !== undefined) {
        const key = keyOf(sidStr, data.turn, data.step)
        const sample = lastSample.get(key)
        if (sample !== undefined) {
          commit(sidStr, data.turn, data.step, sample.model, sample.usage)
          lastSample.delete(key)
        }
      }
    } catch { /* never throw in an event handler */ }
  }, { global: true })

  ctx.inject(['webServer'], (host) => {
    host.effect(() => host.webServer.register({
      kind: 'exact',
      path: '/dsh-local/usage-pro/debug',
      handler: (req, res) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: true, inflight: lastSample.size, requests: db.prepare('SELECT COUNT(*) c FROM requests').get().c, samples }))
      },
    }), 'usage-pro: debug route')
    host.effect(() => host.webServer.register({
      kind: 'exact',
      path: '/dsh-local/usage-pro/summary',
      handler: (req, res) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(summary()))
      },
    }), 'usage-pro: summary route')
  })
}
