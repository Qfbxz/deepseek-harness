/**
 * Minimal Electron shell for the official DeepSeek Harness Web Host.
 *
 *  - Spawns `dsh --profile web` as a child process (PATH lookup) and parses
 *    the canonical readiness line `dsh web: http://127.0.0.1:<port>` to learn
 *    the loopback URL.
 *  - If an existing HTTP responder is already listening on the dsh port,
 *    attaches to it instead of double-spawning.
 *  - Exposes one IPC channel `dsh-desktop-window` consumed by preload.js.
 *  - Keeps the child alive for the lifetime of the app and kills it on quit
 *    (non-macOS); on macOS the app stays resident after the last window
 *    closes and the Dock icon reopens the window.
 *
 * Designed as a few hundred lines of plain JavaScript, no vendored runtime, no
 * bundled plugins — the `@deepseek-ai/dsh-desktop` fork's 673MB stage-runtime
 * + electron-builder pipeline is intentionally absent.
 */

const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const { spawn } = require('node:child_process')
const { existsSync, readdirSync } = require('node:fs')
const { join, dirname } = require('node:path')
const os = require('node:os')
const net = require('node:net')

/**
 * Loopback port to probe when an existing dsh web might be already serving.
 * Only 3080 (the dsh default): the probe is a bare TCP connect that accepts
 * any listener, so 3000/5173 (Next/Vite dev servers) would attach the shell
 * to an unrelated app and leave the real backend unreachable.
 */
const PROBE_PORTS = [3080]
/** Max time to wait for the spawned dsh readiness line, in milliseconds. */
const READINESS_TIMEOUT_MS = 90_000
/** Canonical readiness prefix emitted by `dsh --profile web` on stdout. */
const READINESS_PREFIX = 'dsh web: '

/** Hold the single-instance lock so a second launch focuses the existing window. */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  return
}

/** The active Web Host child, or undefined when we attached to an existing one. */
let child = undefined
/** Owns the BrowserWindow lifecycle and the IPC channel. */
let win = undefined

/**
 * Probe one loopback port for an HTTP responder: connect, send a minimal
 * HEAD request, and require an `HTTP/` status line back. A bare TCP connect
 * would match any listener (a database, an SSH tunnel) and render a blank
 * window.
 * @param port - TCP port to test.
 * @returns true when the listener answers with an HTTP status line.
 */
function probePort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    const done = (ok) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(1500)
    socket.once('connect', () => {
      socket.write('HEAD / HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n')
    })
    socket.once('data', (chunk) => {
      done(chunk.toString('latin1').startsWith('HTTP/'))
    })
    socket.once('error', () => done(false))
    socket.once('timeout', () => done(false))
  })
}

/** Find an existing dsh web already speaking HTTP on a probed loopback port. */
async function findExistingUrl() {
  for (const port of PROBE_PORTS) {
    if (await probePort(port)) {
      return `http://127.0.0.1:${port}`
    }
  }
  return undefined
}

/**
 * Resolve the dsh executable. Finder and Dock launches inherit launchd's
 * minimal PATH, which lacks nvm's bin directory, so a bare `spawn('dsh')`
 * dies with ENOENT; probe DSH_BIN, PATH, then the common install locations.
 * @returns An absolute executable path, or undefined when none exists.
 */
function resolveDshBin() {
  const explicit = process.env.DSH_BIN
  if (explicit !== undefined && explicit !== '' && existsSync(explicit)) return explicit
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (dir === '') continue
    const candidate = join(dir, 'dsh')
    if (existsSync(candidate)) return candidate
  }
  const nvmRoot = join(os.homedir(), '.nvm/versions/node')
  if (existsSync(nvmRoot)) {
    const versions = readdirSync(nvmRoot).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    for (let i = versions.length - 1; i >= 0; i -= 1) {
      const candidate = join(nvmRoot, versions[i], 'bin/dsh')
      if (existsSync(candidate)) return candidate
    }
  }
  for (const candidate of ['/opt/homebrew/bin/dsh', '/usr/local/bin/dsh']) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Spawn `dsh --profile web` and parse its stdout for the canonical readiness
 * line. The line shape is enforced by the official CLI; we only match the
 * URL token after the prefix.
 * @returns The first loopback URL the child emits.
 */
function spawnHostAndWait() {
  return new Promise((resolve, reject) => {
    const dshBin = resolveDshBin()
    if (dshBin === undefined) {
      reject(new Error('dsh executable not found: set DSH_BIN or install dsh on PATH'))
      return
    }
    // dsh's shebang is `#!/usr/bin/env node`; its bin directory (nvm,
    // homebrew) also holds node, so prepending it fixes shebang resolution
    // under launchd's minimal PATH.
    const proc = spawn(dshBin, ['--profile', 'web'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${dirname(dshBin)}:${process.env.PATH ?? ''}` },
    })
    child = proc
    let buffer = ''
    let stderrTail = ''
    let done = false
    const finish = (fn, value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      fn(value)
    }
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      finish(reject, new Error(`dsh web did not become ready within ${READINESS_TIMEOUT_MS}ms`))
    }, READINESS_TIMEOUT_MS)
    const onChunk = (chunk) => {
      buffer += chunk.toString('utf8')
      for (;;) {
        const newline = buffer.indexOf('\n')
        if (newline < 0) return
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line.startsWith(READINESS_PREFIX)) continue
        const token = line.slice(READINESS_PREFIX.length).trim().split(/\s+/u, 1)[0]
        try {
          const url = new URL(token)
          if (url.hostname === '127.0.0.1' && url.protocol === 'http:' && url.pathname === '/') {
            finish(resolve, url.toString())
            return
          }
        } catch {
          /* fall through */
        }
        finish(reject, new Error(`dsh web readiness URL is invalid: ${token}`))
        return
      }
    }
    proc.stdout.on('data', onChunk)
    proc.stderr.on('data', (c) => {
      // Keep the stderr tail so the exit error carries the real cause; a bare
      // exit code is not diagnosable from the launch error dialog.
      stderrTail = (stderrTail + c.toString('utf8')).slice(-800)
      process.stderr.write(c)
    })
    proc.on('exit', (code) => {
      // Drop the dead reference so killChild() and later spawns see the truth.
      if (child === proc) child = undefined
      const tail = stderrTail.slice(-400).replace(/\s+$/, '')
      finish(reject, new Error(`dsh web exited (code ${code}) before becoming ready${tail ? `: ${tail}` : ''}`))
    })
    proc.on('error', (err) => finish(reject, err))
  })
}

/** Acquire the web URL to load: existing instance first, then spawn our own. */
async function acquireUrl() {
  const existing = await findExistingUrl()
  if (existing !== undefined) return existing
  return spawnHostAndWait()
}

/** True while an acquire-and-open attempt is in flight (guards against double spawn). */
let opening = false

/**
 * Acquire the URL and open the one window. Concurrent activations (rapid Dock
 * clicks) join the in-flight attempt instead of starting a second one: two
 * racing acquireUrl() calls both probe before either spawned host is
 * listening, so both spawn and the shell leaks a second host process.
 */
async function ensureWindow() {
  if (opening) return
  opening = true
  try {
    const url = await acquireUrl()
    createWindow(url)
  } finally {
    opening = false
  }
}

/**
 * The live window, or undefined while none exists or after it is destroyed.
 * Every window-touching callback must go through this accessor: a captured
 * BrowserWindow reference used after destroy throws "Object has been
 * destroyed", which is fatal in the main process.
 */
function activeWindow() {
  return win !== undefined && !win.isDestroyed() ? win : undefined
}

/**
 * IPC handler backing the `dshDesktop.windowCommand` preload bridge.
 * Registered exactly once at module scope: per-window listeners are never
 * removed, so a reopened window stacks a second listener holding the previous
 * (destroyed) window, and its first dispatch crashes the process. Dispatching
 * through `activeWindow()` keeps destroyed windows unreachable instead.
 */
ipcMain.on('dsh-desktop-window', (_event, command) => {
  const window = activeWindow()
  if (window === undefined) return
  if (command === 'minimize') window.minimize()
  else if (command === 'maximize') {
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  } else if (command === 'close') window.close()
})

/** Build the BrowserWindow and load the URL; window commands arrive through the module-level IPC handler. */
function createWindow(url) {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    backgroundColor: '#1f1f23',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  window.once('ready-to-show', () => window.show())
  window.loadURL(url)
  window.on('closed', () => {
    win = undefined
  })
  win = window
  return window
}

/** Tear down the spawned host child (if any) when the app exits; kill() defaults to SIGTERM. */
function killChild() {
  if (child === undefined) return
  try {
    child.kill()
  } catch {
    /* already dead */
  }
  child = undefined
}

app.on('second-instance', () => {
  const window = activeWindow()
  if (window !== undefined) {
    if (window.isMinimized()) window.restore()
    window.focus()
  }
})

app.on('window-all-closed', () => {
  // On macOS the app (and a spawned host) stays resident with no windows;
  // the Dock icon reopens the window via `activate`. Killing the host here
  // would strand a resident app whose next activation can never load a URL.
  // Everywhere else the last closed window ends the app and tears down the host.
  if (process.platform !== 'darwin') {
    killChild()
    app.quit()
  }
})

app.on('before-quit', killChild)
app.on('will-quit', killChild)

// Reopen a window on macOS activation (Dock click) after all windows were
// closed: the app stayed resident, so reacquire the URL — an attached host may
// have gone away while the shell had no window.
app.on('activate', async () => {
  const window = activeWindow()
  if (window !== undefined) {
    window.focus()
    return
  }
  try {
    await ensureWindow()
  } catch (error) {
    console.error('dsh-desktop-shell activate:', error.message)
    dialog.showErrorBox('DeepSeek Harness Shell', error.message)
  }
})

app.whenReady().then(async () => {
  try {
    await ensureWindow()
  } catch (error) {
    console.error('dsh-desktop-shell:', error.message)
    dialog.showErrorBox('DeepSeek Harness Shell', error.message)
    app.quit()
  }
})