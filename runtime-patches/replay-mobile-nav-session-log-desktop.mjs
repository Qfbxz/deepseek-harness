#!/usr/bin/env node
// 补丁 36：mobile-nav「导出会话」按钮桌面化（新版适配，v3）。
// v1: 桌面隐藏列表摘除 session-log/drawer-actions + display:contents
// v2: 按钮与导入同风格（去边框/同 padding/图标 16px）
// v3: 图标替换为导入图标变体——方盒与缺口原样保留，箭头绕自身中心
//     rotate(180 695 337) 头尾互换 = 从缺口射出（导入为入射）
// 幂等：标记存在时按 v2/v3 增量补齐；插件升级后全量重打。
// 用法：replay-mobile-nav-session-log-desktop.mjs <mobile-nav/lib/client.js>
import { readFileSync, writeFileSync } from 'node:fs'
const target = process.argv[2]
if (!target) { console.error('usage: replay-mobile-nav-session-log-desktop.mjs <client.js>'); process.exit(1) }
let s = readFileSync(target, 'utf8')

const BOX_D = 'M905.309091 628.363636c-27.927273 0-46.545455 18.618182-46.545455 46.545455v223.418182H165.236364V125.672727h200.145454c27.927273 0 46.545455-18.618182 46.545455-46.545454s-18.618182-46.545455-46.545455-46.545455H118.690909c-27.927273 0-46.545455 18.618182-46.545454 46.545455v865.745454c0 27.927273 18.618182 46.545455 46.545454 46.545455h786.618182c27.927273 0 46.545455-18.618182 46.545454-46.545455v-269.963636c0-27.927273-18.618182-46.545455-46.545454-46.545455z'
const ARROW_D = 'M556.218182 558.545455h349.090909v-93.09091h-269.963636l293.236363-269.963636-65.163636-65.163636-307.2 283.927272V116.363636h-93.090909V558.545455h4.654545z'
const OLD_ICON = `children: [(0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.IconDownloadOutline16, { size: 14 }), (0, jsx_runtime_1.jsx)("span", { children: t('sessionLog') })] })] }));`
const NEW_ICON = `children: [/*patch(session-log-desktop)*/(0, jsx_runtime_1.jsx)("svg", { width: 16, height: 16, viewBox: "0 0 1024 1024", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": true, children: [(0, jsx_runtime_1.jsx)("path", { d: "${BOX_D}", fill: "currentColor" }), (0, jsx_runtime_1.jsx)("path", { d: "${ARROW_D}", fill: "currentColor", transform: "rotate(180 695 337)" })] }), (0, jsx_runtime_1.jsx)("span", { children: t('sessionLog') })] })] }));`

if (s.includes('/*patch(session-log-desktop)*/')) {
  // v3 图标增量
  if (!s.includes('rotate(180 695 337)') && s.includes(OLD_ICON)) {
    writeFileSync(target, s.replace(OLD_ICON, NEW_ICON))
    console.log('[ok] session-log-desktop upgraded to v3 (icon)')
    process.exit(0)
  }
  // v2 样式增量（弱选择器 → 强选择器）
  const V2_OLD = `  [data-mobile-nav="session-log"] {
    border: none !important;
    padding: 0 8px !important;
    gap: 8px !important;
    background: transparent !important;
  }
  [data-mobile-nav="session-log"] svg {
    transform: rotate(-135deg);
  }`
  const V2_NEW = `  [data-mobile-nav="drawer-actions"] button[data-mobile-nav="session-log"] {
    border: none !important;
    padding: 6px 2px !important;
    gap: 8px !important;
    background: transparent !important;
  }
  [data-mobile-nav="drawer-actions"] button[data-mobile-nav="session-log"] svg {
    width: 16px !important;
    height: 16px !important;
  }`
  if (s.includes(V2_OLD)) {
    writeFileSync(target, s.replace(V2_OLD, V2_NEW))
    console.log('[ok] session-log-desktop upgraded to v2 (style)')
    process.exit(0)
  }
  console.log('[skip] already patched:', target)
  process.exit(0)
}

// ── 全量打（插件升级后）──
const OLD_HIDE = `@media (min-width: 1024px) {
  [data-mobile-nav="toggle"],
  [data-mobile-nav="files"],
  [data-mobile-nav="fab"],
  [data-mobile-nav="backdrop"],
  [data-mobile-nav="session-log"],
  [data-mobile-nav="explorer"],
  [data-mobile-nav="drawer-actions"] {
    display: none !important;
  }
}`
const NEW_HIDE = `@media (min-width: 1024px) {
  [data-mobile-nav="toggle"],
  [data-mobile-nav="files"],
  [data-mobile-nav="fab"],
  [data-mobile-nav="backdrop"],
  [data-mobile-nav="explorer"] {
    display: none !important;
  }
  /*patch(session-log-desktop)*/[data-mobile-nav="drawer-actions"] {
    display: contents !important;
  }
  [data-mobile-nav="drawer-actions"] button[data-mobile-nav="session-log"] {
    border: none !important;
    padding: 6px 2px !important;
    gap: 8px !important;
    background: transparent !important;
  }
  [data-mobile-nav="drawer-actions"] button[data-mobile-nav="session-log"] svg {
    width: 16px !important;
    height: 16px !important;
  }
}`
let n = 0
if (s.includes(OLD_HIDE)) { s = s.replace(OLD_HIDE, NEW_HIDE); n++ }
if (s.includes(OLD_ICON)) { s = s.replace(OLD_ICON, NEW_ICON); n++ }
if (s.includes(`'sessionLog': '导出会话日志',`)) { s = s.replace(`'sessionLog': '导出会话日志',`, `'sessionLog': '导出',`); n++ }
if (s.includes(`'sessionLog': 'Session log',`)) { s = s.replace(`'sessionLog': 'Session log',`, `'sessionLog': 'Export',`); n++ }
if (n === 0) { console.log('[skip] no anchor matched (plugin restructured) — needs review'); process.exit(0) }
writeFileSync(target, s)
console.log(`[ok] session-log-desktop patched (${n}/4 anchors)`)
