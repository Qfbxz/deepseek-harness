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
if (!s.includes("'sessionLog': '导出',")) {
  const OLD = "'sessionLog': '导出会话日志',"
  const OLD2 = "'sessionLog': '导出会话',"
  if (!s.includes(OLD) && !s.includes(OLD2)) throw new Error('zh sessionLog anchor missing — plugin restructured, review manually')
  s = s.includes(OLD) ? s.replace(OLD, "'sessionLog': '导出',") : s.replace(OLD2, "'sessionLog': '导出',")
  s = s.includes("'sessionLog': 'Session log',") ? s.replace("'sessionLog': 'Session log',", "'sessionLog': 'Export',") : s.replace("'sessionLog': 'Export session',", "'sessionLog': 'Export',")
  did.push('rename')
}
// ── d. icon: the import box + a straight 45° arrow shooting out the notch ──
if (!s.includes('patch(export-arrow5)')) {
  const BOX = 'M905.309091 628.363636c-27.927273 0-46.545455 18.618182-46.545455 46.545455v223.418182H165.236364V125.672727h200.145454c27.927273 0 46.545455-18.618182 46.545455-46.545454s-18.618182-46.545455-46.545455-46.545455H118.690909c-27.927273 0-46.545455 18.618182-46.545454 46.545455v865.745454c0 27.927273 18.618182 46.545455 46.545454 46.545455h786.618182c27.927273 0 46.545455-18.618182 46.545454-46.545455v-269.963636c0-27.927273-18.618182-46.545455-46.545454-46.545455z'
  const ARROW = 'M363 723L733 353L799 419L880 140L601 221L667 287L297 657Z'
  const mk = (marker, body) => '(0, jsx_runtime_1.jsx)("svg", { "data-icon": "' + marker + '", viewBox: "0 0 1024 1024", width: "14", height: "14", fill: "currentColor", children: ' + body + ' })'
  const V6 = mk('patch(export-arrow5)', '[(0, jsx_runtime_1.jsx)("path", { d: "' + BOX + '" }), (0, jsx_runtime_1.jsx)("path", { d: "' + ARROW + '" })]')
  const V5 = mk('patch(export-arrow4)', '[(0, jsx_runtime_1.jsx)("path", { d: "' + BOX + '" }), (0, jsx_runtime_1.jsx)("path", { d: "M465 560V270L362 270L512 20L662 270L559 270V560Z" })]')
  const V4 = mk('patch(export-arrow3)', '[(0, jsx_runtime_1.jsx)("path", { d: "' + BOX + '" }), (0, jsx_runtime_1.jsx)("path", { d: "M556.218182 558.545455h349.090909v-93.09091h-269.963636l293.236363-269.963636-65.163636-65.163636-307.2 283.927272V116.363636h-93.090909V558.545455h4.654545z", transform: "translate(1024,0) scale(-1,1)" })]')
  const V3 = mk('patch(export-arrow2)', '(0, jsx_runtime_1.jsx)("path", { d: "M556.218182 558.545455h349.090909v-93.09091h-269.963636l293.236363-269.963636-65.163636-65.163636-307.2 283.927272V116.363636h-93.090909V558.545455h4.654545z", transform: "translate(1195.5,175) scale(-1,1)" })')
  const V2 = mk('patch(export-arrow)', '(0, jsx_runtime_1.jsx)("path", { d: "M8.72205 8.994C8.77717 8.93934 8.83792 8.88106 8.90271 8.81627L12.4828 5.23424L13.5043 6.25572L9.92224 9.8358C9.6395 10.1185 9.38763 10.3732 9.15857 10.5575C8.91892 10.7503 8.63953 10.9224 8.2865 10.9784C8.09711 11.0083 7.90363 11.0083 7.71423 10.9784C7.36106 10.9224 7.0809 10.7503 6.84119 10.5575C6.61215 10.3732 6.36022 10.1185 6.07751 9.8358L2.49646 6.25572L3.51697 5.23424L7.09705 8.81627C7.16219 8.88142 7.22331 8.94006 7.27869 8.99498V1.3065H8.72205V8.994Z", transform: "translate(0,11) scale(1,-1)" })')
  const ORIG = "(0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.IconDownloadOutline16, { size: 14 })"
  for (const prev of [V5, V4, V3, V2]) {
    if (s.includes(prev)) { s = s.replace(prev, V6); break }
  }
  if (!s.includes('patch(export-arrow5)')) {
    if (s.includes(ORIG)) s = s.replace(ORIG, V6)
    else throw new Error('icon anchor missing — plugin restructured, review manually')
  }
  did.push('icon')
}
// ── e. borderless button ──
if (!s.includes('patch(no-btn-border)')) {
  const OLD = '@media (min-width: 1024px) {'
  const NEW = '/*patch(no-btn-border)*/[data-mobile-nav="session-log"]{border:none !important;background:transparent;}\n@media (min-width: 1024px) {'
  if (!s.includes(OLD)) throw new Error('media-query anchor missing — plugin restructured, review manually')
  s = s.replace(OLD, NEW)
  did.push('borderless')
}
if (did.length === 0) { console.log('[skip] already patched:', target); process.exit(0) }
writeFileSync(target, s)
console.log('[patched]', target, '(' + did.join('+') + ')')
