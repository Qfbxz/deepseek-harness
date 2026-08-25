#!/usr/bin/env node
// 补丁 13：git-graph 分支弹出层向下展开（原 bottom:calc(100%+4px) 锚在 chip 上方，
// chip 位于顶栏时整层顶出屏幕不可见；对齐同包 popoverHero 的向下语义）。
// 2026-08-24 重做：git-graph 0.3.0 间距 4px→8px 且类名哈希化，锚点按新版重写；
// 保留旧 4px 锚点作回退（市场重装旧版时仍可打上）。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const target = process.argv[2]
if (!target) { console.error('usage: replay-git-graph-popover-below.mjs <client.js>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('patch(popover-below)')) { console.log('[skip] already patched:', target); process.exit(0) }
const variants = [
  ['bottom:calc(100% + 8px);left:0;overflow:hidden}', '/*patch(popover-below)*/top:calc(100% + 8px);bottom:auto;left:0;overflow:hidden}'],
  ['bottom:calc(100% + 4px);left:0;overflow:hidden}', '/*patch(popover-below)*/top:calc(100% + 4px);bottom:auto;left:0;overflow:hidden}'],
]
for (const [OLD, NEW] of variants) {
  const n = s.split(OLD).length - 1
  if (n === 0) continue
  if (n !== 1) { console.error('[FAIL] anchor count ' + n + ' != 1 — upstream restructured, review manually:', target); process.exit(1) }
  s = s.replace(OLD, NEW, 1)
  writeFileSync(target, s)
  execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
  console.log('[patched]', target)
  process.exit(0)
}
console.log('[skip] anchor missing (plugin updated):', target)
