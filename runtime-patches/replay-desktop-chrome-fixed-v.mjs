#!/usr/bin/env node
// 补丁 35（v2，取代 fixed-escape）：顶部 git chips 垂直位置恒定。用户 2026-08-22
// 要求：分支/提交 chip 与子代理等按钮平齐、固定垂直、水平自动避让、不随滚动
// 跳动。实测标题行在固定头部里本就不随滚动移动（y=12 恒定）；旧 rawTop 逐像素
// 跟随 + tabs(y≈48)/cluster 回退链在行瞬态塌缩（height<14）时造成 16↔46 跳变。
// 同时退役 v1 的逐祖先中和 fixed-escape 打法（根因已由 git-graph body-portal
// 补丁解决；中和法在 React 重建 composerSeat 后失效，且清真实 seat 的 blur 会
// 丢 composer 磨砂玻璃），并清理 v1 写进 seat 的内联 backdrop-filter:none 残留。
// 目标：personal-plugins/dsh-desktop-chrome/client.mjs（git 重置会冲掉）。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const target = process.argv[2]
if (!target) { console.error('usage: replay-desktop-chrome-fixed-v.mjs <client.mjs>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('patch(fixed-v)')) { console.log('[skip] already patched:', target); process.exit(0) }

let changed = 0
// (a) rawTop 跟随 → 恒定缓存
const A_OLD = '\t\t\t\t\t// patch(scroll-stick): 长对话滚动时标题行（PTC/子代理所在）\n'
  + '\t\t\t\t\t// 会滚出视口——chips 钉在 anchorRow.top 为负的地方=悬空错位。\n'
  + '\t\t\t\t\t// 目标行可见时逐像素跟随；滚出时钳回视口顶部安全带（不悬空、\n'
  + '\t\t\t\t\t// 不与顶部 dock 重叠，回滚时自然回到同行位置）。\n'
  + '\t\t\t\t\tconst rawTop = Math.round(anchorRow.top + (anchorRow.height - 24) / 2);\n'
  + '\t\t\t\t\tconst top = Math.max(6, Math.min(rawTop, 46));'
const A_NEW = '\t\t\t\t\t// patch(fixed-v) 2026-08-22: 垂直位置恒定（用户要求：与子代理等\n'
  + '\t\t\t\t\t// 按钮平齐、不随滚动/面板瞬态跳动）。实测标题行在固定头部里本就不\n'
  + '\t\t\t\t\t// 随滚动移动（y=12 恒定）；旧 rawTop 逐像素跟随 + tabs(y≈48)/cluster\n'
  + '\t\t\t\t\t// 回退链在行瞬态塌缩（height<14）时造成 16↔46 跳变。现在只在标题行\n'
  + '\t\t\t\t\t// 真实有效时更新缓存值，塌缩/缺失时沿用缓存，绝不换锚。\n'
  + '\t\t\t\t\tif (titleRow !== null) {\n'
  + '\t\t\t\t\t\tconst tr = titleRow.getBoundingClientRect();\n'
  + '\t\t\t\t\t\tif (tr.height >= 14) pinnedChipTop = Math.round(tr.top + (tr.height - 24) / 2);\n'
  + '\t\t\t\t\t}\n'
  + '\t\t\t\t\tconst top = Math.max(6, Math.min(pinnedChipTop, 46));'
if (s.includes(A_OLD)) { s = s.replace(A_OLD, A_NEW); changed++ }

// (b) v1 中和循环 → 退役 + 残留清理（正则匹配，缩进不敏感）
const B_RE = /[ \t]*\/\/ patch\(fixed-escape\): git-graph 的 composer anchor 带 backdrop-filter，\n(?:[ \t]*\/\/[^\n]*\n)*?[ \t]*let anc = chip\.parentElement;\n[ \t]*while \(anc !== null && anc !== document\.body\) \{\n(?:[ \t]*[^\n]*\n)*?[ \t]*\}\n/
const B_NEW = '\t\t\t\t// patch(fixed-escape) 已退役 2026-08-22：根因在 git-graph 侧修复——\n'
  + '\t\t\t\t// 其 anchor 现经 createPortal 挂 document.body，chip 的 position:fixed\n'
  + '\t\t\t\t// 天然以视口为包含块。旧的逐祖先中和法治标且有害：React 重建\n'
  + '\t\t\t\t// composerSeat 节点后陷阱重新武装（实测双 seat 并存，清过的带内联\n'
  + '\t\t\t\t// none、chip 真祖先仍是 blur(10px)），且清真实 seat 的 blur 会丢\n'
  + '\t\t\t\t// composer 磨砂玻璃。此处仅清理历史残留：旧 pass 写进 seat 的内联\n'
  + '\t\t\t\t// backdrop-filter:none 移除，恢复官方类样式。\n'
  + '\t\t\t\tfor (const seat of document.querySelectorAll(\'[class*="composerSeat"]\')) {\n'
  + '\t\t\t\t\tif (seat.style.backdropFilter === "none") seat.style.backdropFilter = "";\n'
  + '\t\t\t\t}\n'
if (B_RE.test(s)) { s = s.replace(B_RE, B_NEW); changed++ }

// (c) 缓存声明
const C_OLD = '\t\tfunction placeGoalGitRow() {\n\t\t\t// Hero (blank-session) phase: no composer row needed; the branch chip'
const C_NEW = '\t\t// patch(fixed-v): 顶部 chips 的恒定垂直位置缓存（标题行有效时刷新；见\n'
  + '\t\t// placeGoalGitRow 内 patch(fixed-v) 注释）。16 = 标题行 y12 + (32-24)/2 的实测值。\n'
  + '\t\tlet pinnedChipTop = 16;\n' + C_OLD
if (!s.includes('let pinnedChipTop') && s.includes(C_OLD)) { s = s.replace(C_OLD, C_NEW); changed++ }

if (changed === 0) { console.log('[skip] anchors missing (plugin updated):', target); process.exit(0) }
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched] (' + changed + ' transforms)', target)
