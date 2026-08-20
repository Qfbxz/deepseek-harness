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
if (s.includes('patch(power-top)')) { console.log('[skip] already patched:', target); process.exit(0) }
const OLD = 'position:fixed;bottom:24px;right:24px}'
const NEW = 'position:fixed;/*patch(power-top)*/top:24px;right:24px}'
if (!s.includes(OLD)) throw new Error('power button position anchor missing — plugin restructured, review manually')
s = s.replace(OLD, NEW)
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target)
