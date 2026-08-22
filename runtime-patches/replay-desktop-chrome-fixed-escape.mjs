#!/usr/bin/env node
// 补丁 35：desktop-chrome placeGoalGitRow 的 fixed-escape。git-graph 挂载点从侧栏
// logoRow 挪进底部 composer anchor 后，anchor 带 backdrop-filter 成为 position:fixed
// 的 containing block——分支芯片钉视口坐标却渲染在 anchor 相对位置（底部），
// 与顶部的 commit 按钮分离。修复：钉位前把挂载链上所有创建 containing block 的
// 祖先属性（backdropFilter/perspective/transform/filter/contain/containerType）
// 逐个内联中和（实测仅两个 0 高度包装层带 backdropFilter，无视觉影响）。
// 目标：personal-plugins/dsh-desktop-chrome/client.mjs（git 分支切换/重置会冲掉）。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const target = process.argv[2]
if (!target) { console.error('usage: replay-desktop-chrome-fixed-escape.mjs <client.mjs>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('patch(fixed-escape)')) { console.log('[skip] already patched:', target); process.exit(0) }
const T = '\t\t\t\t\t'
const OLD = T + 'branchLeft = Math.max(8, Math.min(branchLeft, Math.round(window.innerWidth - chip.getBoundingClientRect().width - 8)));\n'
  + T + 'chip.style.position = "fixed";'
const NEW = T + 'branchLeft = Math.max(8, Math.min(branchLeft, Math.round(window.innerWidth - chip.getBoundingClientRect().width - 8)));\n'
  + T + '// patch(fixed-escape): git-graph 的 composer anchor 带 backdrop-filter，\n'
  + T + '// 成为 position:fixed 的 containing block——芯片钉的是视口坐标却渲染成\n'
  + T + '// anchor 相对位置（底部，2026-08-22 挂载点从侧栏 logoRow 挪进 composer\n'
  + T + '// anchor 后回归）。挂载链上创建 containing block 的祖先（backdropFilter/\n'
  + T + '// perspective/transform/filter/contain/containerType）逐个中和；实测仅\n'
  + T + '// 两个 0 高度包装层带 backdropFilter，清除无视觉影响。\n'
  + T + 'let anc = chip.parentElement;\n'
  + T + 'while (anc !== null && anc !== document.body) {\n'
  + T + '\tconst acs = getComputedStyle(anc);\n'
  + T + '\tif (acs.backdropFilter !== "none") anc.style.backdropFilter = "none";\n'
  + T + '\tif (acs.perspective !== "none") anc.style.perspective = "none";\n'
  + T + '\tif (acs.transform !== "none") anc.style.transform = "none";\n'
  + T + '\tif (acs.filter !== "none") anc.style.filter = "none";\n'
  + T + '\tif (acs.contain !== "none") anc.style.contain = "none";\n'
  + T + '\tif (acs.containerType !== undefined && acs.containerType !== "normal" && acs.containerType !== "") anc.style.containerType = "normal";\n'
  + T + '\tanc = anc.parentElement;\n'
  + T + '}\n'
  + T + 'chip.style.position = "fixed";'
if (!s.includes(OLD)) { console.log('[skip] anchor missing (plugin updated):', target); process.exit(0) }
s = s.replace(OLD, NEW)
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target)
