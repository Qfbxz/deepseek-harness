#!/usr/bin/env node
// 补丁 9：dsh-git-commit 提交面板必须向下展开（原默认向上、被 tab 栏裁切）。
// 源即运行时（profile link 到 personal-plugins 源）；本 replay 供任何副本回滚后重放。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const target = process.argv[2]
if (!target) { console.error('usage: node replay-git-commit-panel-below.mjs <client.mjs>'); process.exit(1) }
let src = readFileSync(target, 'utf8')
if (src.includes('patch(panel-below)')) { console.log('[skip] already patched:', target); process.exit(0) }
const oldBlock = [
  '      var top = r.top - p.offsetHeight - 8;',
  '      if (top < 8) top = r.bottom + 8;',
].join('\n')
const newBlock = [
  '      // patch(panel-below): the commit panel MUST open downward from the chip.',
  '      // The old default opened upward (top - height - 8), which clipped against',
  '      // the tab bar above; only an overflow past the viewport bottom falls back up.',
  '      var top = r.bottom + 8;',
  '      if (top + p.offsetHeight > window.innerHeight - 8) top = r.top - p.offsetHeight - 8;',
  '      if (top < 8) top = 8;',
].join('\n')
if (!src.includes(oldBlock)) throw new Error('position anchor missing in ' + target)
src = src.replace(oldBlock, newBlock)
writeFileSync(target, src)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target)
