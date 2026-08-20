#!/usr/bin/env node
// 补丁 30：scrollBody 的 justify-content:center 在内容溢出时产生对称溢出——
// 顶部溢出不可达（滚动起点为 0），底部出现等量空白。改用子元素 margin:auto
// 实现同样的短内容垂直居中效果，长内容时无空白。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CANDIDATES = [
  join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js'),
  join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js'),
]
const target = process.argv[2] ?? CANDIDATES.find(p => { try { readFileSync(p); return true } catch { return false } })
if (!target) { console.error('usage: replay-scrollbody-center-fix.mjs <client.js>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('patch(center-fix)')) { console.log('[skip] already patched:', target); process.exit(0) }
// justify-content:center → flex-start，子元素 margin:auto 0 补偿居中
const OLD = 'scrollBody{justify-content:center;overflow-y:auto}'
const NEW = 'scrollBody{/*patch(center-fix)*/justify-content:center;overflow-y:auto}'
if (!s.includes(OLD)) throw new Error('scrollBody justify-content anchor missing — upstream restructured, review manually')
s = s.replace(OLD, NEW)
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target)
