#!/usr/bin/env node
// 补丁 46:desktop-chrome 三件套——launcher 电源钮钉侧栏折叠钮旁 + 会话区/队列条
// 全宽 CSS 先行 + mutation 帧内防闪（widen/标记stats/钉chips 绘制前生效）。
// 详见各段注释;幂等:placeLauncherButton 在场即跳过;锚点失配大声报错。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const target = process.argv[2] ?? '/Users/boergege/compile/优秀仓库参考/DeepSeek-Harness/personal-plugins/dsh-desktop-chrome/client.mjs'
let s = readFileSync(target, 'utf8')
if (s.includes('placeLauncherButton')) { console.log('[skip] already patched:', target); process.exit(0) }

const NL = '\n'
const cssAnchor = 'html { font-size: 93.75%; }'
const cssBlock = [
"/* PATCH 2026-08-23: launcher 电源钮钉到侧栏折叠钮旁（28px 同款图标钮；",
" * 几何由 placeLauncherButton 内联驱动，p25 的 display:none 基线被内联覆盖） */",
"[class*=\"triggerFloating\"].dshc-pinned { width: 28px; height: 28px; box-shadow: none; background: transparent; transition: none !important; }",
"[class*=\"triggerFloating\"].dshc-pinned:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }",
"[class*=\"triggerFloating\"].dshc-pinned svg { width: 16px; height: 16px; }",
"[class*=\"_collapsed\"] [class*=\"_newSession\"] { margin-top: 30px; }",
"/* PATCH 2026-08-23: 会话区全宽 CSS 先行——首帧即全宽，消除加载/切换会话时",
" * 窄→宽的可见过渡（JS widenConversation 是 mutation+300ms 后置扫描，每轮",
" * 会话切换都会重演一次窄帧）。scope 到中列区控制影响面；JS 扫描保留作兜底",
" * （元素已被 CSS 置宽后其 600-900 过滤自然跳过，不冲突）。 */",
"[class*=\"centerCol\"] [class*=\"_column\"], [class*=\"centerCol\"] [class*=\"_card\"] { max-width: none !important; transition: none !important; }",
"/* 队列条 CSS 先行默认态：首帧即全宽对齐输入卡（JS place() 的内联精调随后覆盖，",
" * 100%≈精确 px 视觉无差）；对齐有 goal 的钉宽常态，无 goal 挪 chips 行由 JS 处理。 */",
"[data-queue-dock] { flex: 0 0 auto; width: 100%; max-width: none; margin: 0; }",
			].join('\n')

const fnAnchor = '\t\tconst runHeavyPatches = () => {'
const fnBlock = [
"\t\t// 2026-08-23: launcher 电源钮钉到侧栏折叠钮旁。不搬节点（React 事件委托），",
"\t\t// fixed 钉位 + 1s 兜底重算；折叠窄轨占第二图标位居中（新会话钮 CSS 让位）；",
"\t\t// aria-label 翻转触发 rAF 追踪 350ms 逐帧跟随侧栏动画，无独立滑动。",
"\t\tfunction placeLauncherButton() {",
"\t\t\tconst btn = document.querySelector('[class*=\"triggerFloating\"]');",
"\t\t\tconst toggle = document.querySelector('button[aria-label=\"收起侧边栏\"], button[aria-label=\"打开侧边栏\"]');",
"\t\t\tif (btn === null || toggle === null) return;",
"\t\t\tconst tr = toggle.getBoundingClientRect();",
"\t\t\tif (tr.width === 0) return;",
"\t\t\tbtn.classList.add(\"dshc-pinned\");",
"\t\t\tif (!toggle.__dshcPinObs) {",
"\t\t\t\ttoggle.__dshcPinObs = new MutationObserver(() => {",
"\t\t\t\t\tif (toggle.__dshcPinRaf) return;",
"\t\t\t\t\tconst end = performance.now() + 350;",
"\t\t\t\t\tconst step = () => {",
"\t\t\t\t\t\ttry { placeLauncherButton(); } catch { /* 1s 兜底仍在 */ }",
"\t\t\t\t\t\tif (performance.now() < end) toggle.__dshcPinRaf = requestAnimationFrame(step);",
"\t\t\t\t\t\telse toggle.__dshcPinRaf = 0;",
"\t\t\t\t\t};",
"\t\t\t\t\ttoggle.__dshcPinRaf = requestAnimationFrame(step);",
"\t\t\t\t});",
"\t\t\t\ttoggle.__dshcPinObs.observe(toggle, { attributes: true, attributeFilter: [\"aria-label\"] });",
"\t\t\t}",
"\t\t\tbtn.style.display = \"inline-flex\";",
"\t\t\tbtn.style.right = \"auto\";",
"\t\t\tconst left = tr.left - 34;",
"\t\t\tif (left < 4) {",
"\t\t\t\t// 折叠窄轨：占第二个图标位（折叠钮下方），相对图标列居中；",
"\t\t\t\t// 新会话钮由 CSS margin-top 让位（见 STYLE_TEXT launcher-pin 段）。",
"\t\t\t\tbtn.style.left = Math.round(tr.left + (tr.width - 28) / 2) + \"px\";",
"\t\t\t\tbtn.style.top = Math.round(tr.bottom + 8) + \"px\";",
"\t\t\t} else {",
"\t\t\t\tbtn.style.left = Math.round(left) + \"px\";",
"\t\t\t\tbtn.style.top = Math.round(tr.top + tr.height / 2 - 14) + \"px\";",
"\t\t\t}",
"\t\t}",
			].join('\n')

const afAnchor = '\t\t\tconst observer = new MutationObserver(() => {'
const afBlock = [
"\t\t\t// 2026-08-23 防闪三件套：mutation 微任务后、同一帧绘制前（rAF 时序）先跑",
"\t\t\t// 几何关键补丁——放宽列卡/标记 stats 行/钉 chips，首帧即终态，消除切换",
"\t\t\t// 会话时窄→宽跳动；300ms 防抖的全量补丁保持不变（重活不进每帧路径）。",
"\t\t\tlet dshcFlickerRaf = 0;",
"\t\t\tconst runAntiFlicker = () => {",
"\t\t\t\tif (dshcFlickerRaf !== 0) return;",
"\t\t\t\tdshcFlickerRaf = window.requestAnimationFrame(() => {",
"\t\t\t\t\tdshcFlickerRaf = 0;",
"\t\t\t\t\tfor (const patch of [widenConversation, patchStatsLine, placeGoalGitRow]) {",
"\t\t\t\t\t\ttry { patch(); } catch { /* 全量补丁兜底 */ }",
"\t\t\t\t\t}",
"\t\t\t\t});",
"\t\t\t};",
			].join('\n')

const obsCallOld = 'wire();\n\t\t\t\tmountWidget();'
const obsCallNew = 'wire();\n\t\t\t\tmountWidget();\n\t\t\t\t/*patch(anti-flicker)*/ runAntiFlicker();'

const repl = [
  [cssAnchor, cssAnchor + NL + cssBlock, 1],
  [fnAnchor, fnBlock + NL + fnAnchor, 1],
  [afAnchor, afBlock + NL + afAnchor, 1],
  [obsCallOld, obsCallNew, 1],
  ['moveUsageToMemoryRow]) {', 'moveUsageToMemoryRow, placeLauncherButton]) {', 1],
  ['try { placeGoalGitRow(); placeErrStreak = 0 } catch (e) {',
   'try { placeLauncherButton(); } catch { /* 钉位失败保持隐藏基线 */ }' + NL + '\t\t\t\ttry { placeGoalGitRow(); placeErrStreak = 0 } catch (e) {', 1],
]
for (const [o, r, expect] of repl) {
  const n = s.split(o).length - 1
  if (n !== expect) { console.error('[FAIL] p46 anchor ' + JSON.stringify(o.slice(0, 50)) + ' count ' + n + ' != ' + expect + ' — upstream restructured, review manually'); process.exit(1) }
  s = s.split(o).join(r)
}
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[ok] desktop-chrome launcher-pin + anti-flicker patched (p46)')
