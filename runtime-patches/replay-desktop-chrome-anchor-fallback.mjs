#!/usr/bin/env node
// 补丁 10：desktop-chrome git chip 锚行兜底（panelHeader 折叠为 0 高时 chip 被钉 -12px 出屏）。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const target = process.argv[2]
if (!target) { console.error('usage: replay-desktop-chrome-anchor-fallback.mjs <client.mjs>'); process.exit(1) }
let src = readFileSync(target, 'utf8')
if (src.includes('patch(anchor-fallback)')) { console.log('[skip] already patched:', target); process.exit(0) }
const T = '\t\t\t\t\t';
const OLD = [
  T + 'const titleRow = tabs !== null ? tabs.previousElementSibling : null;',
  T + 'const anchorRow = titleRow !== null ? titleRow.getBoundingClientRect() : (tabs !== null ? tabs.getBoundingClientRect() : clusterRect);',
  T + 'const top = Math.round(anchorRow.top + (anchorRow.height - 24) / 2);',
].join('\n')
const NEW = [
  T + 'const titleRow = tabs !== null ? tabs.previousElementSibling : null;',
  T + '// patch(anchor-fallback): a collapsed panelHeader (height 0) yields',
  T + '// top = -12 and pins the git chips off-screen. Fall back to the tabs',
  T + '// row, then the cluster rect; clamp any remainder to the viewport top.',
  T + 'let anchorRow = titleRow !== null ? titleRow.getBoundingClientRect() : (tabs !== null ? tabs.getBoundingClientRect() : clusterRect);',
  T + 'if (anchorRow.height < 14) anchorRow = tabs !== null ? tabs.getBoundingClientRect() : clusterRect;',
  T + 'if (anchorRow.height < 14) anchorRow = clusterRect;',
  T + 'const top = Math.max(2, Math.round(anchorRow.top + (anchorRow.height - 24) / 2));',
].join('\n')
if (!src.includes(OLD)) throw new Error('anchor block missing in ' + target)
src = src.replace(OLD, NEW)
writeFileSync(target, src)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target)
