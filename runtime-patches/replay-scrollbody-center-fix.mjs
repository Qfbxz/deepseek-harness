#!/usr/bin/env node
// 补丁 30：scrollBody 垂直居中/滚动空白联合修复。
// CSS 默认 justify-content:center（新会话 hero 立即居中，无闪烁）；
// desktop-chrome 插件每秒检测：内容溢出时 JS 切 flex-start（长对话无底部空白）。
// 本 replay 确保编译产物中 scrollBody 的 justify-content 为 center。
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
// 目标形态：center（CSS 默认居中）
const CENTER = 'scrollBody{justify-content:center;overflow-y:auto}'
const PATCHED_CENTER = 'scrollBody{/*patch(center-fix)*/justify-content:center;overflow-y:auto}'
const PATCHED_FLEX = 'scrollBody{/*patch(center-fix)*/justify-content:flex-start;overflow-y:auto}'
if (s.includes(PATCHED_CENTER)) { console.log('[skip] already patched (center):', target); process.exit(0) }
if (s.includes(PATCHED_FLEX)) {
  s = s.replace(PATCHED_FLEX, PATCHED_CENTER)
} else if (s.includes(CENTER)) {
  s = s.replace(CENTER, PATCHED_CENTER)
} else {
  throw new Error('scrollBody justify-content anchor missing — upstream restructured, review manually')
}
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target, '(center default, JS handles overflow)')
