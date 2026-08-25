#!/usr/bin/env node
// 补丁 43:dsh-queue-dock 排队条的纯几何变化盲区(detailsCol 展开/侧栏过渡)。
// 根因(2026-08-23 DPOS 会话复现):queue-dock 只有 body childList MutationObserver,
// 右侧"任务管理"面板(detailsCol)展开/收起是 grid-template-columns 纯几何变化,
// 不产生 childList mutation → place() 永不重跑 → 折叠期钉死的内联 width/marginLeft
// 残留(实测 qbar 1000px vs 中列收缩后 ~700px) → 排队条撑破容器、"我的消息"右端
// 截断、统计行连带错位。补丁42 只治隐藏态钉 0,没治几何盲区。
// 修:centerCol 挂 ResizeObserver,稳态防抖 200ms 后重钉 place()(与补丁41 同构;
// 过渡期连续 resize 持续重置防抖,只在几何稳定后钉终态;3s 重挂防 React 重建)。
// 幂等:含 patch(geo-observer) 标记即跳过;锚点失配大声报错。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const target = process.argv[2]
if (!target) { console.error('usage: replay-dsh-queue-dock-geo-observer.mjs <client.mjs>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('/*patch(geo-observer)*/')) { console.log('[skip] already patched:', target); process.exit(0) }
const OLD = '      obs.observe(document.body, { childList: true, subtree: true });'
const NEW = [
  '      obs.observe(document.body, { childList: true, subtree: true });',
  '      /*patch(geo-observer)*/ (function () {',
  '        var geoTimer = null;',
  '        var geoAttached = null;',
  '        var geoObs = new ResizeObserver(function () {',
  '          clearTimeout(geoTimer);',
  '          geoTimer = setTimeout(function () { try { place(); } catch (e) {} }, 200);',
  '        });',
  '        var geoAttach = function () {',
  '          var col = document.querySelector(\'[class*="centerCol"]\');',
  '          if (!col || col === geoAttached) return;',
  '          geoObs.disconnect();',
  '          geoObs.observe(col);',
  '          geoAttached = col;',
  '        };',
  '        geoAttach();',
  '        setInterval(geoAttach, 3000);',
  '      })();',
].join('\n')
const n = s.split(OLD).length - 1
if (n !== 1) { console.error('[FAIL] anchor count ' + n + ' != 1 — upstream restructured:', target); process.exit(1) }
s = s.replace(OLD, NEW)
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[ok] queue-dock geo-observer patched (centerCol ResizeObserver -> place())')
