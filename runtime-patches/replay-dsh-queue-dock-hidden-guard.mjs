#!/usr/bin/env node
// 补丁 42:dsh-queue-dock 排队条钉死的隐藏态污染。
// 根因:与补丁41同族——task-board/ssh 面板激活时会话区 display:none,
// queue-dock 自有 MutationObserver(body childList)被 board 容器 append 触发,
// place() 对隐藏输入卡测量:cr.width=0 → qdock.style.width 钉成 "0px"、
// marginLeft 按误差收敛式钉错值;面板关闭后排队条 0 宽/错位直到下轮 pass。
// 修:cr.width<=0 直接 return(保持上次有效几何,禁止钉 0)。
// 幂等:含 patch(hidden-guard) 标记即跳过;锚点失配大声报错。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const target = process.argv[2]
if (!target) { console.error('usage: replay-dsh-queue-dock-hidden-guard.mjs <client.mjs>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('/*patch(hidden-guard)*/')) { console.log('[skip] already patched:', target); process.exit(0) }
const OLD = '        var cr = card.getBoundingClientRect();'
const NEW = OLD + '\n        if (cr.width <= 0) /*patch(hidden-guard)*/ return; // board/ssh 隐藏态:保持上次几何,禁止钉 0'
const n = s.split(OLD).length - 1
if (n !== 1) { console.error('[FAIL] anchor count ' + n + ' != 1 — upstream restructured, review manually:', target); process.exit(1) }
s = s.split(OLD).join(NEW)
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[ok] queue-dock hidden-guard patched (width<=0 gate)')
