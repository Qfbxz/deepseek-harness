#!/usr/bin/env node
// 补丁 17：dsh-mobile-nav「导出会话」按钮桌面化三步（各自幂等）：
//   a. 从 ≥1024px 隐藏列表摘出 session-log 与容器 drawer-actions（explorer 保持仅移动端）
//   c. 改名：导出会话日志 → 导出会话（en: Export session）
//   d. 图标：下载箭头（向内）→ 托盘不动、箭头子路径垂直镜像（向外）
import { readFileSync, writeFileSync } from 'node:fs'
const target = process.argv[2]
if (!target) { console.error('usage: replay-mobile-nav-desktop-session-log.mjs <client.js>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
const did = []
// ── a. unhide on desktop ──
if (!s.includes('patch(desktop-session-log)')) {
  const OLD = '  [data-mobile-nav="session-log"],\n  [data-mobile-nav="explorer"],\n  [data-mobile-nav="drawer-actions"],\n'
  const NEW = '  /*patch(desktop-session-log)*/[data-mobile-nav="explorer"],\n'
  if (!s.includes(OLD)) throw new Error('desktop hide-list anchor missing — plugin restructured, review manually')
  s = s.replace(OLD, NEW)
  did.push('unhide')
}
// ── c. rename ──
if (!s.includes("'sessionLog': '导出会话',")) {
  const OLD = "'sessionLog': '导出会话日志',"
  if (!s.includes(OLD)) throw new Error('zh sessionLog anchor missing — plugin restructured, review manually')
  s = s.replace(OLD, "'sessionLog': '导出会话',")
  s = s.replace("'sessionLog': 'Session log',", "'sessionLog': 'Export session',")
  did.push('rename')
}
// ── d. outward arrow icon (no tray — style-matched to the import arrow) ──
if (!s.includes('patch(export-arrow)')) {
  const ARROW = 'M8.72205 8.994C8.77717 8.93934 8.83792 8.88106 8.90271 8.81627L12.4828 5.23424L13.5043 6.25572L9.92224 9.8358C9.6395 10.1185 9.38763 10.3732 9.15857 10.5575C8.91892 10.7503 8.63953 10.9224 8.2865 10.9784C8.09711 11.0083 7.90363 11.0083 7.71423 10.9784C7.36106 10.9224 7.0809 10.7503 6.84119 10.5575C6.61215 10.3732 6.36022 10.1185 6.07751 9.8358L2.49646 6.25572L3.51697 5.23424L7.09705 8.81627C7.16219 8.88142 7.22331 8.94006 7.27869 8.99498V1.3065H8.72205V8.994Z'
  const OLD = "(0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.IconDownloadOutline16, { size: 14 })"
  const NEW = '(0, jsx_runtime_1.jsx)("svg", { "data-icon": "patch(export-arrow)", viewBox: "0 0 16 16", width: "14", height: "14", fill: "currentColor", children: (0, jsx_runtime_1.jsx)("path", { d: "' + ARROW + '", transform: "translate(0,11) scale(1,-1)" }) })'
  if (!s.includes(OLD)) throw new Error('icon anchor missing — plugin restructured, review manually')
  s = s.replace(OLD, NEW)
  did.push('icon')
}
if (did.length === 0) { console.log('[skip] already patched:', target); process.exit(0) }
writeFileSync(target, s)
console.log('[patched]', target, '(' + did.join('+') + ')')
