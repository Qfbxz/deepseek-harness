#!/usr/bin/env node
// 补丁 13：git-graph 分支弹出层向下展开（原 bottom:calc(100%+4px) 锚在 chip 上方，
// chip 位于顶栏时整层顶出屏幕不可见；对齐同包 popoverHero 的向下语义）。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const target = process.argv[2]
if (!target) { console.error('usage: replay-git-graph-popover-below.mjs <client.js>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('patch(popover-below)')) { console.log('[skip] already patched:', target); process.exit(0) }
const OLD = 'bottom:calc(100% + 4px);left:0;overflow:hidden}'
const NEW = '/*patch(popover-below)*/top:calc(100% + 4px);bottom:auto;left:0;overflow:hidden}'
if (!s.includes(OLD)) throw new Error('popover anchor missing')
s = s.replace(OLD, NEW)
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target)
