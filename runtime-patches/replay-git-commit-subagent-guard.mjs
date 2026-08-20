#!/usr/bin/env node
// 补丁 p24：dsh-git-commit 提交 chip 不应显示在子代理页面。
// 子代理页面有会话层级导航（nav[aria-label="会话层级"]）且含多个 crumb（父/子层级，用"/"分隔）；
// 普通页面只有当前会话 1 个 crumb，无分隔符。
// 源即运行时（profile link 到 personal-plugins 源）；本 replay 供任何副本回滚后重放。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const target = process.argv[2]
if (!target) { console.error('usage: node replay-git-commit-subagent-guard.mjs <client.mjs>'); process.exit(1) }
let src = readFileSync(target, 'utf8')
if (src.includes('patch(subagent-guard)')) { console.log('[skip] already patched:', target); process.exit(0) }
const oldBlock = [
  '    function placeChip() {',
  '      // chip 只需存在（挂在 body）；定位由 dsh-desktop-chrome 统一负责：',
  '      // position:fixed 钉在分支 chip 左边、与 tab 栏水平对齐。',
  '      if (document.getElementById(CHIP_ID) === null) {',
  '        document.body.appendChild(buildChip());',
  '      }',
  '    }',
].join('\n')
const newBlock = [
  '    // patch(subagent-guard): 子代理页面不显示提交按钮（子代理不提交）。',
  '    // 检测：会话层级导航存在多个 crumb（父/子层级，用"/"分隔）→ 子代理页面。',
  '    function isSubagentPage() {',
  '      var nav = document.querySelector(\'nav[aria-label="会话层级"]\');',
  '      if (nav === null) return false;',
  '      return nav.querySelectorAll(\'[class*="crumbSep"]\').length > 0;',
  '    }',
  '    function placeChip() {',
  '      // chip 只需存在（挂在 body）；定位由 dsh-desktop-chrome 统一负责：',
  '      // position:fixed 钉在分支 chip 左边、与 tab 栏水平对齐。',
  '      var existing = document.getElementById(CHIP_ID);',
  '      if (isSubagentPage()) {',
  '        if (existing !== null) existing.remove();',
  '        return;',
  '      }',
  '      if (existing === null) {',
  '        document.body.appendChild(buildChip());',
  '      }',
  '    }',
].join('\n')
if (!src.includes(oldBlock)) throw new Error('placeChip block missing in ' + target)
src = src.replace(oldBlock, newBlock)
writeFileSync(target, src)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target)
