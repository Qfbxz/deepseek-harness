#!/usr/bin/env node
// 补丁 25：desktop-launcher 的浮动关机按钮 fixed 在右下（bottom:24px;right:24px），
// 与发送消息按钮（同在右下）重叠。移到顶部右上（top:24px;right:24px）——与
// git chip 行（top:45、右缘约距边 80px）水平错开不冲突。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CANDIDATES = [
  join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', '@linxin666', 'dsh-desktop-launcher', 'lib', 'client.js'),
  join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@deepseek-ai/dsh/node_modules/@linxin666/dsh-desktop-launcher/lib/client.js'),
]
const target = process.argv[2] ?? CANDIDATES.find(p => { try { readFileSync(p); return true } catch { return false } })
if (!target) { console.error('usage: replay-launcher-power-top.mjs <client.js>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
const OLD_ORIG = 'position:fixed;bottom:24px;right:24px}'
const OLD_V1 = 'position:fixed;/*patch(power-top)*/top:24px;right:24px}'
const OLD_V2 = 'position:fixed;/*patch(power-top)*/top:24px;right:76px}'
const NEW = 'position:fixed;/*patch(power-top)*/display:none;top:34px;right:76px}'
if (s.includes(NEW)) { console.log('[skip] already patched:', target); process.exit(0) }
if (s.includes(OLD_V2)) s = s.replace(OLD_V2, NEW)
else if (s.includes(OLD_V1)) s = s.replace(OLD_V1, NEW)
else if (s.includes(OLD_ORIG)) s = s.replace(OLD_ORIG, NEW)
else throw new Error('power button position anchor missing — plugin restructured, review manually')
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target)
