#!/usr/bin/env node
// 补丁 36：git-graph 分支 chip 的 body-portal。根因：rc.8 官方 composer 的
// NX9AIq_composerSeat 带 backdrop-filter:blur(10px)，成为 position:fixed 后代的
// containing block——desktop-chrome 钉的视口坐标被解释成相对 composer（top:16
// 渲染在 y≈702），分支弹层跟着落在屏幕中部、与顶部提交按钮分离。修复：
// BranchChip 的 anchor 经 react_dom.createPortal 挂到 document.body（与
// dsh-git-commit chip 同构），fixed 天然以视口为包含块；portal 保住 React 事件。
// 目标：~/.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-git-graph/lib/client.js
// （插件市场更新会冲掉；4 个锚点全中才写盘，防半截补丁）。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const target = process.argv[2]
if (!target) { console.error('usage: replay-git-graph-body-portal.mjs <client.js>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('patch(body-portal)')) { console.log('[skip] already patched:', target); process.exit(0) }

let n = 0
const R1_OLD = '\t\tlet react_jsx_runtime = require("react/jsx-runtime");'
const R1_NEW = R1_OLD + '\n\t\tlet react_dom = require("react-dom"); // patch(body-portal)'
if (s.includes(R1_OLD)) { s = s.replace(R1_OLD, R1_NEW); n++ }
const R2_OLD = '\t\t\t(0, react.useLayoutEffect)(() => {\n\t\t\t\tif (!heroSeat) return;'
const R2_NEW = R2_OLD + '\n\t\t\t\t// patch(body-portal): anchor 已挂到 document.body，composer 内的 hero 行\n\t\t\t\t// 测量链（outlet/stack/heroRow）不再存在，跳过（顶部定位由 desktop-chrome 钉）。\n\t\t\t\tif (anchorRef.current !== null && anchorRef.current.parentElement === document.body) return;'
if (s.includes(R2_OLD)) { s = s.replace(R2_OLD, R2_NEW); n++ }
const R3_OLD = '\t\t\treturn /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {\n\t\t\t\tref: anchorRef,'
const R3_NEW = '\t\t\t// patch(body-portal) 2026-08-22: anchor 经 createPortal 挂到 document.body。\n\t\t\t// 根因：composer 链上的 NX9AIq_composerSeat 带 backdrop-filter:blur(10px)，\n\t\t\t// 成为 position:fixed 后代的包含块——chip 的视口坐标被解释成相对 composer\n\t\t\t// （钉 top:16 渲染在 y≈702），分支弹层跟着落在屏幕中部。挂到 body 后 fixed\n\t\t\t// 天然以视口为包含块（与 dsh-git-commit chip 同构）；portal 保住 React 事件。\n\t\t\treturn /* @__PURE__ */ react_dom.createPortal((0, react_jsx_runtime.jsxs)("div", {\n\t\t\t\tref: anchorRef,'
if (s.includes(R3_OLD)) { s = s.replace(R3_OLD, R3_NEW); n++ }
const R4_OLD = '\t\t\t\t]\n\t\t\t});\n\t\t}\n\t\t//#endregion\n\t\t//#region src/client/locales.ts'
const R4_NEW = '\t\t\t\t]\n\t\t\t}), document.body); // patch(body-portal)\n\t\t}\n\t\t//#endregion\n\t\t//#region src/client/locales.ts'
if (s.includes(R4_OLD)) { s = s.replace(R4_OLD, R4_NEW); n++ }

if (n < 4) { console.log('[skip] anchors missing (' + n + '/4, plugin updated?):', target); process.exit(0) }
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target)
