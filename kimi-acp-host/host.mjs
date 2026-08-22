#!/usr/bin/env node
/**
 * kimi-acp-host — a complete ACP client (host) for `kimi acp`.
 *
 * Spawns `kimi acp` as a child process, speaks JSON-RPC 2.0 over
 * newline-delimited JSON on stdio, and implements every client-side
 * reverse-RPC method the kimi adapter uses:
 *
 *   session/update                (notification) stream renderer
 *   session/request_permission    approval / elicitation of tool calls
 *   fs/read_text_file             file reads with line/limit support
 *   fs/write_text_file            file writes
 *   terminal/create               spawn a command, capture output
 *   terminal/output               current output + exit status
 *   terminal/wait_for_exit        wait for command exit
 *   terminal/kill                 kill without releasing
 *   terminal/release              kill + free resources
 *   elicitation/create            form/URL elicitation (UNSTABLE, best effort)
 *   elicitation/complete          (notification) no-op
 *
 * The initialize request advertises `clientCapabilities.terminal = true`
 * and `fs.readTextFile` / `fs.writeTextFile`, which is what unblocks the
 * agent's shell/file tools under ACP (otherwise the agent fails every
 * command with "ACP terminal capability is unavailable").
 *
 * Zero dependencies. Node >= 18.  Run: node host.mjs --cwd /some/repo
 */
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { readFile, writeFile } from 'node:fs/promises'

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { cwd: process.cwd(), kimi: process.env.KIMI_BIN ?? 'kimi', approve: 'ask' }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--cwd') out.cwd = argv[++i]
    else if (a === '--kimi') out.kimi = argv[++i]
    else if (a === '--approve') {
      const v = argv[++i]
      if (v !== 'ask' && v !== 'always' && v !== 'reject') {
        throw new Error(`--approve must be ask|always|reject, got ${v}`)
      }
      out.approve = v
    } else if (a === '--help' || a === '-h') {
      out.help = true
    } else {
      throw new Error(`unknown argument: ${a}`)
    }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  console.log(`Usage: node host.mjs [--cwd DIR] [--kimi PATH] [--approve ask|always|reject]

  --cwd DIR       working directory for the agent session (default: cwd)
  --kimi PATH     kimi executable (default: $KIMI_BIN or "kimi")
  --approve MODE  permission policy: ask (default) | always (auto-allow) | reject

Slash commands in the REPL: /cancel /new /permission /exit`)
  process.exit(0)
}

const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'

// ---------------------------------------------------------------------------
// Terminal manager — backs terminal/create · output · wait_for_exit · kill · release
// ---------------------------------------------------------------------------

const DEFAULT_OUTPUT_BYTE_LIMIT = 1_000_000

class Terminal {
  constructor(id, { command, args: argv = [], cwd, env, outputByteLimit }) {
    this.id = id
    this.limit = outputByteLimit ?? DEFAULT_OUTPUT_BYTE_LIMIT
    this.chunks = []
    this.total = 0
    this.truncated = false
    this.exit = null // { exitCode: number|null, signal: string|null } once exited
    this.waiters = []
    const envObj = { ...process.env }
    for (const { name, value } of env ?? []) envObj[name] = value
    try {
      this.proc = spawn(command, argv, { cwd: cwd ?? args.cwd, env: envObj })
    } catch (err) {
      // A terminal that failed to spawn is still a terminal: it has output
      // (the error) and an exit status, matching real-shell behaviour.
      this.proc = null
      this.push(Buffer.from(`kimi-acp-host: failed to start ${command}: ${err.message}\n`))
      this.setExit({ exitCode: 127, signal: null })
      return
    }
    this.proc.on('error', (err) => {
      this.push(Buffer.from(`kimi-acp-host: ${err.message}\n`))
      if (this.exit === null) this.setExit({ exitCode: 127, signal: null })
    })
    this.proc.stdout?.on('data', (c) => this.push(c))
    this.proc.stderr?.on('data', (c) => this.push(c))
    this.proc.on('exit', (code, signal) => {
      this.setExit({ exitCode: code, signal: signal ?? null })
    })
  }

  push(chunk) {
    this.chunks.push(chunk)
    this.total += chunk.length
    // Truncate from the beginning at a UTF-8 character boundary.
    while (this.total > this.limit && this.chunks.length > 1) {
      this.total -= this.chunks[0].length
      this.chunks.shift()
      this.truncated = true
    }
    if (this.total > this.limit) {
      let buf = this.chunks[0]
      let cut = buf.length - this.limit
      while (cut < buf.length && (buf[cut] & 0xc0) === 0x80) cut += 1
      if (cut > 0) this.truncated = true
      buf = buf.subarray(cut)
      this.chunks[0] = buf
      this.total = buf.length
    }
  }

  setExit(status) {
    this.exit = status
    for (const w of this.waiters.splice(0)) w(status)
  }

  outputView() {
    return {
      output: Buffer.concat(this.chunks).toString('utf8'),
      truncated: this.truncated,
      exitStatus: this.exit,
    }
  }

  waitForExit() {
    if (this.exit !== null) return Promise.resolve(this.exit)
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  kill() {
    if (!this.proc || this.exit !== null) return
    this.proc.kill('SIGTERM')
    setTimeout(() => {
      if (this.exit === null) this.proc?.kill('SIGKILL')
    }, 2000).unref()
  }
}

class TerminalManager {
  constructor() {
    this.map = new Map()
    this.seq = 0
  }

  create(params) {
    const id = `term-${++this.seq}`
    this.map.set(id, new Terminal(id, params))
    return id
  }

  get(id) {
    const t = this.map.get(id)
    if (t === undefined) {
      const err = new Error(`terminal not found: ${id}`)
      err.jsonRpcCode = -32002 // resource not found
      throw err
    }
    return t
  }

  release(id) {
    const t = this.get(id)
    t.kill()
    this.map.delete(id)
  }

  releaseAll() {
    for (const id of [...this.map.keys()]) this.release(id)
  }
}

const terminals = new TerminalManager()

// ---------------------------------------------------------------------------
// JSON-RPC connection to the agent (NDJSON over stdio)
// ---------------------------------------------------------------------------

class AgentConnection {
  constructor(proc) {
    this.proc = proc
    this.nextId = 1
    this.pending = new Map() // id → { resolve, reject }
    this.buffer = ''
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk) => this.receive(chunk))
  }

  receive(chunk) {
    this.buffer += chunk
    for (;;) {
      const nl = this.buffer.indexOf('\n')
      if (nl < 0) return
      const line = this.buffer.slice(0, nl).trim()
      this.buffer = this.buffer.slice(nl + 1)
      if (line === '') continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        process.stderr.write(`${DIM}[acp] non-JSON line from agent: ${line.slice(0, 200)}${RESET}\n`)
        continue
      }
      this.dispatch(msg)
    }
  }

  dispatch(msg) {
    if (msg.method !== undefined && (msg.id === undefined || msg.id === null)) {
      handleAgentNotification(msg.method, msg.params).catch(report)
      return
    }
    if (msg.method !== undefined) {
      handleAgentRequest(msg.id, msg.method, msg.params).catch(report)
      return
    }
    const waiter = this.pending.get(msg.id)
    if (waiter === undefined) return
    this.pending.delete(msg.id)
    if (msg.error) waiter.reject(Object.assign(new Error(msg.error.message), { jsonRpcCode: msg.error.code, data: msg.error.data }))
    else waiter.resolve(msg.result)
  }

  send(obj) {
    this.proc.stdin.write(`${JSON.stringify(obj)}\n`)
  }

  request(method, params) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method, params) {
    this.send({ jsonrpc: '2.0', method, params })
  }

  respond(id, result) {
    this.send({ jsonrpc: '2.0', id, result })
  }

  respondError(id, code, message) {
    this.send({ jsonrpc: '2.0', id, error: { code, message } })
  }
}

let agent = null // set after spawn

function report(err) {
  process.stderr.write(`${DIM}[acp] handler error: ${err.message}${RESET}\n`)
}

// ---------------------------------------------------------------------------
// Client-side reverse-RPC implementations (agent → host)
// ---------------------------------------------------------------------------

async function handleAgentRequest(id, method, params) {
  try {
    const result = await routeClientMethod(method, params ?? {})
    agent.respond(id, result ?? {})
  } catch (err) {
    agent.respondError(id, err.jsonRpcCode ?? -32603, err.message)
  }
}

async function routeClientMethod(method, params) {
  switch (method) {
    case 'session/request_permission':
      return requestPermission(params)
    case 'fs/read_text_file': {
      const { path, line, limit } = params
      let content = await readFile(path, 'utf8')
      if (line !== undefined && line !== null) {
        const lines = content.split('\n')
        const start = Math.max(1, line) - 1
        content = lines.slice(start, limit !== undefined && limit !== null ? start + limit : undefined).join('\n')
      } else if (limit !== undefined && limit !== null) {
        content = content.split('\n').slice(0, limit).join('\n')
      }
      return { content }
    }
    case 'fs/write_text_file': {
      const { path, content } = params
      await writeFile(path, content, 'utf8')
      return {}
    }
    case 'terminal/create': {
      const terminalId = terminals.create(params)
      return { terminalId }
    }
    case 'terminal/output': {
      const t = terminals.get(params.terminalId)
      const view = t.outputView()
      return { output: view.output, truncated: view.truncated, exitStatus: view.exitStatus ?? null }
    }
    case 'terminal/wait_for_exit': {
      const t = terminals.get(params.terminalId)
      return await t.waitForExit()
    }
    case 'terminal/kill': {
      terminals.get(params.terminalId).kill()
      return {}
    }
    case 'terminal/release': {
      terminals.release(params.terminalId)
      return {}
    }
    case 'elicitation/create':
      return elicit(params)
    case 'elicitation/complete':
      throw methodNotImplemented(method)
    case 'session/update':
      return renderUpdate(params.update ?? {})
    default:
      throw methodNotImplemented(method)
  }
}

function methodNotImplemented(method) {
  const err = new Error(`method not found: ${method}`)
  err.jsonRpcCode = -32601
  return err
}

async function handleAgentNotification(method, params) {
  // session/update arrives as a notification from the SDK's notify path when
  // the agent batches; the request path is handled in routeClientMethod.
  if (method === 'session/update') {
    await renderUpdate((params ?? {}).update ?? {})
    return
  }
  if (method === 'elicitation/complete') return // nothing to clean up
  process.stderr.write(`${DIM}[acp] unhandled notification: ${method}${RESET}\n`)
}

// ---------------------------------------------------------------------------
// session/update rendering
// ---------------------------------------------------------------------------

async function renderUpdate(update) {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      if (update.content?.type === 'text') process.stdout.write(update.content.text)
      break
    case 'agent_thought_chunk':
      if (update.content?.type === 'text' && update.content.text.trim() !== '') {
        process.stdout.write(`${DIM}${update.content.text}${RESET}`)
      }
      break
    case 'user_message_chunk':
      break
    case 'tool_call':
      console.log(`${BOLD}▸ ${update.title}${RESET} ${DIM}[${update.kind ?? 'other'} · ${update.status ?? 'pending'}]${RESET}`)
      break
    case 'tool_call_update': {
      const u = update
      if (u.title) console.log(`${BOLD}▸ ${u.title}${RESET} ${DIM}[${u.status ?? ''}]${RESET}`)
      else if (u.status) console.log(`${DIM}  ${u.toolCallId} → ${u.status}${RESET}`)
      const text = (u.content ?? [])
        .filter((c) => c.type === 'content' && c.content?.type === 'text')
        .map((c) => c.content.text)
        .join('')
      if (text !== '') {
        const excerpt = text.length > 400 ? `${text.slice(0, 400)}…` : text
        console.log(`${DIM}  ${excerpt.replace(/\n/g, '\n  ')}${RESET}`)
      }
      break
    }
    case 'plan':
    case 'plan_update': {
      const entries = update.plan?.entries ?? []
      console.log(`${BOLD}PLAN${RESET}`)
      for (const e of entries) console.log(`  ${e.status === 'completed' ? '✔' : e.status === 'in_progress' ? '●' : '○'} ${e.content}`)
      break
    }
    case 'plan_removed':
      break
    case 'usage_update':
      console.log(`${DIM}[context ${update.used}/${update.size}${update.cost ? ` · ${update.cost.amount} ${update.cost.currency}` : ''}]${RESET}`)
      break
    case 'current_mode_update':
      console.log(`${DIM}[mode → ${update.currentModeId}]${RESET}`)
      break
    case 'config_option_update':
      break
    case 'available_commands_update':
      break
    case 'session_info_update':
      if (update.title) console.log(`${DIM}[session title: ${update.title}]${RESET}`)
      break
    default:
      break
  }
}

// ---------------------------------------------------------------------------
// Permission + elicitation (ask the human; policy can auto-answer)
// ---------------------------------------------------------------------------

let approvePolicy = args.approve
let pendingPermission = null // () => void, resolves the ask() wait on cancel

function pickOption(options, kinds) {
  for (const k of kinds) {
    const hit = options.find((o) => o.kind === k)
    if (hit) return hit
  }
  return undefined
}

async function askUser(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer))
  })
}

async function requestPermission({ sessionId, options, toolCall }) {
  const preview = toolCall?.rawInput !== undefined ? JSON.stringify(toolCall.rawInput) : ''
  if (approvePolicy === 'always') {
    const opt = pickOption(options, ['allow_once', 'allow_always'])
    if (opt) return { outcome: { outcome: 'selected', optionId: opt.optionId } }
  }
  if (approvePolicy === 'reject') {
    const opt = pickOption(options, ['reject_once', 'reject_always'])
    if (opt) return { outcome: { outcome: 'selected', optionId: opt.optionId } }
  }
  console.log(`\n${BOLD}permission requested:${RESET} ${toolCall?.title ?? '(untitled tool call)'}`)
  if (preview !== '') console.log(`${DIM}  ${preview.length > 600 ? `${preview.slice(0, 600)}…` : preview}${RESET}`)
  options.forEach((o, i) => console.log(`  ${i + 1}. ${o.name} ${DIM}(${o.kind})${RESET}`))
  const cancelled = new Promise((resolve) => {
    pendingPermission = resolve
  })
  const answer = await Promise.race([
    askUser(`allow? [1-${options.length}, or number] `).then((a) => ({ a })),
    cancelled.then(() => ({ a: null })),
  ])
  pendingPermission = null
  if (answer.a === null) return { outcome: { outcome: 'cancelled' } }
  const idx = Number.parseInt(answer.a, 10)
  const opt = Number.isInteger(idx) && idx >= 1 && idx <= options.length ? options[idx - 1] : undefined
  if (opt) return { outcome: { outcome: 'selected', optionId: opt.optionId } }
  const fallback = pickOption(options, ['reject_once', 'reject_always', 'allow_once'])
  return fallback
    ? { outcome: { outcome: 'selected', optionId: fallback.optionId } }
    : { outcome: { outcome: 'cancelled' } }
}

async function elicit(params) {
  console.log(`\n${BOLD}elicitation:${RESET} ${params.message}`)
  if (params.mode === 'url') {
    console.log(`  open: ${params.url}`)
    const ok = (await askUser('done? accept [y/N] ')).trim().toLowerCase() === 'y'
    return ok ? { action: 'accept' } : { action: 'decline' }
  }
  if (params.mode !== 'form') return { action: 'decline' }
  const schema = params.requestedSchema ?? {}
  const content = {}
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const raw = await askUser(`  ${prop.title ?? key} (${prop.type}${(schema.required ?? []).includes(key) ? ', required' : ''}): `)
    if (raw === '' && !(schema.required ?? []).includes(key)) continue
    if (prop.type === 'number') content[key] = Number(raw)
    else if (prop.type === 'integer') content[key] = Number.parseInt(raw, 10)
    else if (prop.type === 'boolean') content[key] = /^(y|t|true|1)$/i.test(raw)
    else if (prop.type === 'array') content[key] = raw.split(',').map((s) => s.trim()).filter((s) => s !== '')
    else content[key] = raw
  }
  return { action: 'accept', content }
}

// ---------------------------------------------------------------------------
// REPL
// ---------------------------------------------------------------------------

const rl = createInterface({ input: process.stdin, output: process.stdout })
let sessionId = null
let authMethods = []
let turnActive = false
let queuedPrompt = null
let sessionSeq = 0

function setPromptText() {
  rl.setPrompt(`\nkimi${sessionId ? `#${sessionSeq}` : ''}> `)
  rl.prompt(true)
}

async function newSession() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await agent.request('session/new', { cwd: args.cwd, mcpServers: [] })
      sessionId = res.sessionId
      sessionSeq += 1
      console.log(`${DIM}session ${sessionId} @ ${args.cwd}${RESET}`)
      return
    } catch (err) {
      if (err.jsonRpcCode === -32000 && attempt === 0 && authMethods.length > 0) {
        console.log(`${DIM}auth required, trying ${authMethods[0].name}…${RESET}`)
        await agent.request('authenticate', { methodId: authMethods[0].id })
        continue
      }
      if (err.jsonRpcCode === -32000) {
        throw new Error('authentication required: run `kimi` in a terminal, finish login, then restart kimi-acp-host')
      }
      throw err
    }
  }
}

async function sendPrompt(text) {
  turnActive = true
  try {
    const res = await agent.request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }],
    })
    console.log(`\n${DIM}— turn ended (${res.stopReason})${RESET}`)
  } catch (err) {
    console.log(`\n${DIM}— turn failed: ${err.message}${RESET}`)
  } finally {
    turnActive = false
    if (queuedPrompt !== null) {
      const next = queuedPrompt
      queuedPrompt = null
      await sendPrompt(next)
    }
  }
}

rl.on('line', async (line) => {
  const text = line.trim()
  if (text === '') {
    if (!turnActive) setPromptText()
    return
  }
  if (text === '/exit') {
    cleanup()
    return
  }
  if (text === '/cancel') {
    if (sessionId) agent.notify('session/cancel', { sessionId })
    console.log(`${DIM}(cancel sent)${RESET}`)
    return
  }
  if (text === '/new') {
    try {
      await newSession()
    } catch (err) {
      console.log(`${DIM}${err.message}${RESET}`)
    }
    setPromptText()
    return
  }
  if (text.startsWith('/permission')) {
    const v = text.split(/\s+/)[1]
    if (v === 'ask' || v === 'always' || v === 'reject') {
      approvePolicy = v
      console.log(`${DIM}approval policy → ${v}${RESET}`)
    } else {
      console.log(`${DIM}usage: /permission ask|always|reject (current: ${approvePolicy})${RESET}`)
    }
    setPromptText()
    return
  }
  if (sessionId === null) {
    console.log(`${DIM}no session yet${RESET}`)
    setPromptText()
    return
  }
  if (turnActive) {
    queuedPrompt = text
    console.log(`${DIM}(queued for next turn)${RESET}`)
    return
  }
  console.log(`${DIM}you> ${text}${RESET}`)
  await sendPrompt(text)
  setPromptText()
}).on('close', () => cleanup())

process.on('SIGINT', () => {
  if (pendingPermission) {
    const resolve = pendingPermission
    pendingPermission = null
    resolve() // askUser race resolves to null → respond cancelled
    return
  }
  if (turnActive && sessionId) {
    agent.notify('session/cancel', { sessionId })
    console.log(`${DIM}(interrupt → session/cancel; Ctrl-C again to quit)${RESET}`)
    return
  }
  cleanup()
})

let exiting = false
function cleanup() {
  if (exiting) return
  exiting = true
  terminals.releaseAll()
  try {
    agent?.proc.kill('SIGTERM')
  } catch { /* already dead */ }
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const proc = spawn(args.kimi, ['acp'], { stdio: ['pipe', 'pipe', 'pipe'] })
proc.stderr.on('data', (c) => process.stderr.write(`${DIM}[kimi] ${c}${RESET}`))
proc.on('error', (err) => {
  console.error(`failed to start "${args.kimi} acp": ${err.message}`)
  process.exit(1)
})
proc.on('exit', (code, signal) => {
  terminals.releaseAll()
  console.log(`\n${DIM}agent exited (code ${code}, signal ${signal})${RESET}`)
  process.exit(signal !== null ? 1 : (code ?? 0))
})

agent = new AgentConnection(proc)

try {
  const init = await agent.request('initialize', {
    protocolVersion: 1,
    clientInfo: { name: 'kimi-acp-host', title: 'Kimi ACP Host', version: '0.1.0' },
    clientCapabilities: {
      terminal: true,
      fs: { readTextFile: true, writeTextFile: true },
    },
  })
  authMethods = init.authMethods ?? []
  if (init.protocolVersion !== 1) {
    console.error(`agent wants protocol version ${init.protocolVersion}, host speaks 1 — continuing anyway`)
  }
  console.log(`${DIM}agent: ${init.agentInfo?.name ?? '?'} v${init.agentInfo?.version ?? '?'} · protocol ${init.protocolVersion}${RESET}`)
  await newSession()
} catch (err) {
  console.error(`startup failed: ${err.message}`)
  process.exit(1)
}

console.log(`${DIM}type a prompt, /cancel to interrupt, /exit to quit · approval: ${approvePolicy}${RESET}`)
setPromptText()
