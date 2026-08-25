#!/usr/bin/env node
// 补丁 41:desktop-chrome 钉死 pass 的隐藏态污染 + 纯几何变化盲区。
// 根因(2026-08-22 浏览器实测):A) task-board/ssh 激活时会话区整列 display:none,
//  board 容器 append 触发 childList mutation → 300ms 后 pass 隐藏态跑:goalRow 宽
//  钉成 "0px"(实测),条目 height=0 走 zero-height 分支写 mt/mb=-2px。B) 面板关闭只
//  移除 html attribute,visible 分支从不写 marginTop → mt=-2px 永久残留(实测)。
//  C) 侧栏 grid transition 是纯几何变化不触发 childList observer,中间态测量钉旧值。
// 修:1)board/ssh 激活门控 2)cr0/cr 宽度≤0 门控 3)mt=-2px 复位 4)attribute+ResizeObserver
//  即时重钉 5)dispose 清理。幂等:含 patch(hidden-guard) 即跳过;锚点计数失配大声报错。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const target = process.argv[2]
if (!target) { console.error('usage: replay-desktop-chrome-hidden-guard.mjs <client.mjs>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('/*patch(hidden-guard)*/')) { console.log('[skip] already patched:', target); process.exit(0) }
const edits = [
  ["\t\t\t// Hero (blank-session) phase: no composer row needed; the branch chip",
   "\t\t\t/*patch(hidden-guard)*/ if (document.documentElement.hasAttribute('data-dsh-taskboard-active') || document.documentElement.hasAttribute('data-dsh-ssh-active')) return;\n" +
   "\t\t\t// Hero (blank-session) phase: no composer row needed; the branch chip", 1],
  ["\t\t\t\t\tconst cr0 = card.getBoundingClientRect();",
   "\t\t\t\t\tconst cr0 = card.getBoundingClientRect();\n" +
   "\t\t\t\t\t/*patch(hidden-guard)*/ if (cr0.width <= 0) return; // 隐藏/瞬态:保持上次几何,禁止钉 0", 1],
  ["\t\t\t\tconst cr = card.getBoundingClientRect();",
   "\t\t\t\tconst cr = card.getBoundingClientRect();\n" +
   "\t\t\t\t/*patch(hidden-guard)*/ if (cr.width <= 0) return;", 1],
  ["\t\t\t\t\t\tif (t.style.marginBottom !== \"0px\") t.style.marginBottom = \"0px\";",
   "\t\t\t\t\t\tif (t.style.marginBottom !== \"0px\") t.style.marginBottom = \"0px\";\n" +
   "\t\t\t\t\t\t/*patch(hidden-guard)*/ if (t.style.marginTop === \"-2px\") t.style.marginTop = \"\"; // 复位 zero-height 分支残留", 1],
  ["\t\t\tobserver.observe(document.body, { childList: true, subtree: true });",
   "\t\t\tobserver.observe(document.body, { childList: true, subtree: true });\n" +
   "\t\t\t/*patch(geo-observers)*/ {\n" +
   "\t\t\t\tconst dshcRerunGoalRow = () => { try { placeGoalGitRow(); } catch (e) { /* 1s 兜底仍在 */ } };\n" +
   "\t\t\t\tconst dshcAttrObs = new MutationObserver((muts) => {\n" +
   "\t\t\t\t\tfor (const m of muts) {\n" +
   "\t\t\t\t\t\tif (m.attributeName !== 'data-dsh-taskboard-active' && m.attributeName !== 'data-dsh-ssh-active') continue;\n" +
   "\t\t\t\t\t\tif (!document.documentElement.hasAttribute(m.attributeName)) dshcRerunGoalRow();\n" +
   "\t\t\t\t\t}\n" +
   "\t\t\t\t});\n" +
   "\t\t\t\tdshcAttrObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-dsh-taskboard-active', 'data-dsh-ssh-active'] });\n" +
   "\t\t\t\tlet dshcGeoTimer = 0;\n" +
   "\t\t\t\tconst dshcGeoObs = new ResizeObserver(() => {\n" +
   "\t\t\t\t\twindow.clearTimeout(dshcGeoTimer);\n" +
   "\t\t\t\t\tdshcGeoTimer = window.setTimeout(dshcRerunGoalRow, 150);\n" +
   "\t\t\t\t});\n" +
   "\t\t\t\tlet dshcGeoAttached = null;\n" +
   "\t\t\t\tconst dshcGeoAttach = () => {\n" +
   "\t\t\t\t\tconst col = document.querySelector('[class*=\"centerCol\"]');\n" +
   "\t\t\t\t\tif (col === null || col === dshcGeoAttached) return;\n" +
   "\t\t\t\t\tdshcGeoObs.disconnect();\n" +
   "\t\t\t\t\tdshcGeoObs.observe(col);\n" +
   "\t\t\t\t\tdshcGeoAttached = col;\n" +
   "\t\t\t\t};\n" +
   "\t\t\t\tdshcGeoAttach();\n" +
   "\t\t\t\tconst dshcGeoTimer2 = window.setInterval(dshcGeoAttach, 3000);\n" +
   "\t\t\t\twindow.dshcDisposeGeo = () => { window.clearInterval(dshcGeoTimer2); window.clearTimeout(dshcGeoTimer); dshcGeoObs.disconnect(); dshcAttrObs.disconnect(); };\n" +
   "\t\t\t}", 1],
  ["\t\t\t\twindow.clearInterval(modelPollTimer);",
   "\t\t\t\twindow.clearInterval(modelPollTimer);\n" +
   "\t\t\t\t/*patch(hidden-guard)*/ if (typeof window.dshcDisposeGeo === 'function') window.dshcDisposeGeo();", 1],
]
for (const [oldS, newS, want] of edits) {
  const n = s.split(oldS).length - 1
  if (n !== want) { console.error('[FAIL] anchor count ' + n + ' != ' + want + ' for: ' + oldS.trim().slice(0, 60)); process.exit(1) }
  s = s.split(oldS).join(newS)
}
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[ok] hidden-guard + geo-observers patched (gating x3, mt reset, observers, dispose)')
