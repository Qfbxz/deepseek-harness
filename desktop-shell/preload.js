/**
 * Sandboxed preload — exposes one minimal, namespaced desktop bridge so the
 * Web UI (and skins drawing their own window chrome, like dsh-desktop-chrome)
 * can drive the window. Nothing else crosses the context boundary.
 *
 * The `dsh-desktop-window` IPC channel is handled by main.js, which dispatches
 * to Electron's BrowserWindow minimize/maximize/close APIs.
 */

const { contextBridge, ipcRenderer } = require('electron')

const COMMANDS = new Set(['minimize', 'maximize', 'close'])

contextBridge.exposeInMainWorld('dshDesktop', {
  /**
   * Send one window command.
   * @param command - 'minimize' | 'maximize' (toggles) | 'close'.
   */
  windowCommand(command) {
    if (typeof command === 'string' && COMMANDS.has(command)) {
      ipcRenderer.send('dsh-desktop-window', command)
    }
  },
})