#!/usr/bin/env node
// 补丁 15：dsh-auto-memory「记忆」按钮两步增强（各自幂等）：
//   a. 迁到设置行专属座位 sidebar.settings.action（ui-sidebar 源码新增的孔，
//      见 replay-ui-sidebar-settings-action.mjs；slot inject 会等声明出现，顺序无关）
//   b. 按钮加大脑轮廓图标（lucide brain 路径，14px 描边，随 currentColor）
// 上游若原生改挂设置行则步骤 a 自动跳过。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const target = process.argv[2]
if (!target) { console.error('usage: replay-auto-memory-settings-row.mjs <client.js>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
const did = []
// ── a. slot migration ──
if (!s.includes('patch(settings-row)')) {
  if (!s.includes("slots.inject('sidebar.footer.action'") && s.includes('sidebar.settings.action')) {
    console.log('[skip] upstream already on the settings row:', target)
  } else {
    const OLD1 = "slots.inject('sidebar.footer.action', function () {"
    const NEW1 = "/*patch(settings-row)*/slots.inject('sidebar.settings.action', function () {"
    const OLD2 = "name: 'sidebar.footer.action', id: 'auto-memory'"
    const NEW2 = "name: 'sidebar.settings.action', id: 'auto-memory'"
    if (!s.includes(OLD1) || !s.includes(OLD2)) { console.log('[skip] anchor missing (plugin updated):', target); process.exit(0) }
    s = s.replace(OLD1, NEW1).replace(OLD2, NEW2)
    s = s.replace('1. sidebar.footer.action —', '1. sidebar.settings.action —')
    did.push('slot')
  }
}
// ── b. memory icon ──
if (!s.includes('patch(memory-icon)')) {
  const OLD = "}, h('span', null, t('memory')))"
  const NEW = "}, h('svg', { 'data-icon': 'patch(memory-icon)', viewBox: '0 0 24 24', width: '14', height: '14', fill: 'none', stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round', style: { marginRight: '4px', flex: 'none', verticalAlign: '-2px' } }, h('path', { d: 'M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z' }), h('path', { d: 'M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z' })), h('span', null, t('memory')))"
  if (!s.includes(OLD)) { console.log('[skip] anchor missing (plugin updated):', target); process.exit(0) }
  s = s.replace(OLD, NEW)
  did.push('icon')
}
if (did.length === 0) { console.log('[skip] already patched:', target); process.exit(0) }
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target, '(' + did.join('+') + ')')
