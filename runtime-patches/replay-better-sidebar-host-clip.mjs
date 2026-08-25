#!/usr/bin/env node
// 补丁 45:better-sidebar 面板宿主不裁剪隐藏面板 → 整页无限滚 + 底部空白。
// 根因:web-ui-all 0.3.0(2026-08-23 升级)的底栏/侧栏隐藏动画用 translateY 平移出视口
// + visibility:hidden,但面板宿主 [data-dsh-panel-host](fixed;inset:0)未声明
// overflow:hidden —— 绝对定位子元素平移出宿主后仍贡献视口滚动区
// (实测文档被撑高 465px,底部大片空白可无限滚)。
// 修:宿主加 overflow:hidden。隐藏面板本就 pointer-events:none,可见面板均在
// inset:0 视口内,无裁剪副作用。
// 幂等:marker 在场即跳过;锚点失配大声报错(上游修复后自动退役)。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const target = process.argv[2]
if (!target) { console.error('usage: replay-better-sidebar-host-clip.mjs <better-sidebar client.js>'); process.exit(1) }

let s = readFileSync(target, 'utf8')
if (s.includes('/*patch(host-clip)*/')) { console.log('[skip] already patched:', target); process.exit(0) }
const OLD = '[data-dsh-panel-host]{z-index:40;pointer-events:none;position:fixed;inset:0}'
const NEW = '[data-dsh-panel-host]{z-index:40;pointer-events:none;position:fixed;inset:0;overflow:hidden/*patch(host-clip)*/}'
const n = s.split(OLD).length - 1
if (n !== 1) { console.error('[FAIL] anchor count ' + n + ' != 1 — upstream restructured (0.3.0 前后样式不同或已修复), review manually:', target); process.exit(1) }
s = s.split(OLD).join(NEW)
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[ok] better-sidebar panel-host clip patched (p45)')
