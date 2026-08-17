/**
 * Minimal Electron shell for the official DeepSeek Harness Web Host.
 *
 *  - Spawns `dsh --profile web` as a child process (PATH lookup) and parses
 *    the canonical readiness line `dsh web: http://127.0.0.1:<port>` to learn
 *    the loopback URL.
 *  - If an existing dsh web is already listening (port probe), attaches to it
 *    instead of double-spawning.
 *  - Exposes one IPC channel `dsh-desktop-window` consumed by preload.js.
 *  - Keeps the child alive for the lifetime of the window; kills it on quit.
 *
 * Designed to be ~150 lines, no vendored runtime, no bundled plugins — the
 * `@deepseek-ai/dsh-desktop` fork's 673MB stage-runtime + electron-builder
 * pipeline is intentionally absent.
 */

const { app, BrowserWindow, ipcMain } = require('electron')
const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const net = require('node:net')

/** Loopback port to probe when an existing dsh web might be already serving. */
const PROBE_PORTS = [3080, 3000, 4096, 5173]
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
 * Probe one loopback port for an HTTP responder. A two-second ceiling keeps
 * a missing dsh web snappy on cold starts.
 * @param port - TCP port to test.
 * @returns true when a TCP connection succeeds (HTTP or not — any listener counts).
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
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.once('timeout', () => done(false))
  })
}

/** Find an existing dsh web already serving on a probed loopback port. */
async function findExistingUrl() {
  for (const port of PROBE_PORTS) {
    if (await probePort(port)) {
      return `http://127.0.0.1:${port}`
    }
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
    const proc = spawn('dsh', ['--profile', 'web'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    child = proc
    let buffer = ''
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
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      const line = buffer.slice(0, newline).trim()
      const rest = buffer.slice(newline + 1)
      if (line.startsWith(READINESS_PREFIX)) {
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
      buffer = rest
    }
    proc.stdout.on('data', onChunk)
    proc.stderr.on('data', (c) => process.stderr.write(c))
    proc.on('exit', (code) => {
      finish(reject, new Error(`dsh web exited (code ${code}) before becoming ready`))
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

/** IPC handler backing the `dshDesktop.windowCommand` preload bridge. */
function wireWindowCommands(window) {
  ipcMain.on('dsh-desktop-window', (_event, command) => {
    if (command === 'minimize') window.minimize()
    else if (command === 'maximize') {
      if (window.isMaximized()) window.unmaximize()
      else window.maximize()
    } else if (command === 'close') window.close()
  })
}

/** Build the BrowserWindow, load the URL, wire the bridge. */
function createWindow(url) {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    backgroundColor: '#1f1f23',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: require('node:path').join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  wireWindowCommands(window)
  window.once('ready-to-show', () => window.show())
  window.loadURL(url)
  window.on('closed', () => {
    win = undefined
  })
  win = window
  return window
}

/** Tear down the spawned host child (if any) when the app exits. */
function killChild() {
  if (child === undefined) return
  try {
    if (existsSync('/proc')) child.kill('SIGTERM')
    else child.kill()
  } catch {
    /* already dead */
  }
  child = undefined
}

app.on('second-instance', () => {
  if (win !== undefined) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('window-all-closed', () => {
  killChild()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', killChild)
app.on('will-quit', killChild)

app.whenReady().then(async () => {
  try {
    const url = await acquireUrl()
    createWindow(url)
  } catch (error) {
    console.error('dsh-desktop-shell:', error.message)
    app.quit()
  }
})