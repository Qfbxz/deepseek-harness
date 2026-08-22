#!/usr/bin/env node
// 补丁 31：desktop-chrome 用量按钮迁入记忆/设置行（settingsArea）。
// 核心断言三件套 + 防回归护栏：
//   1) moveUsageToMemoryRow 函数存在且注册进 runHeavyPatches 数组；
//   2) 锚点爬升逻辑在位（insertBefore 的锚必须是 settingsArea 直接子级，
//      否则每轮 pass 抛错中断——2026-08-21 页面"按钮从不变"根因）；
//   3) 禁止跨 React 插槽搬运宿主节点（导入会话按钮）的 revert 在位。
// 幂等：标记 patch(usage-row) 存在即 [skip]。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const target = process.argv[2]
if (!target) { console.error('usage: replay-desktop-chrome-usage-row.mjs <client.mjs>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('/*patch(usage-row)*/')) { console.log('[skip] already patched:', target); process.exit(0) }
const checks = {
  fn: 'function moveUsageToMemoryRow()',
  climb: 'while (n !== null && n.parentElement !== settingsArea) n = n.parentElement;',
  registered: 'syncSidebarWidthVar, moveUsageToMemoryRow',
  revert: 'const imp = null;',
  gap: "usg.style.marginRight = '-2px';",
  shift: "usg.style.marginLeft = '-4px';",
  opaque: '.usg_panel * { opacity: 1 !important;',
}
const missing = Object.entries(checks).filter(([, v]) => !s.includes(v)).map(([k]) => k)
if (missing.length > 0) throw new Error('usage-row anchors missing: ' + missing.join(',') + ' — source restructured, review manually')
// 在函数定义行打幂等标记（不改动任何行为，只加注释）
s = s.replace(checks.fn, '/*patch(usage-row)*/' + checks.fn)
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target, '(markers verified: ' + Object.keys(checks).join(',') + ')')
