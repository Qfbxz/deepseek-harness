/**
 * browser-visual-guards.test.mjs — desktop-chrome 浏览器端视觉守卫测试。
 *
 * 背景（2026-08-27 用户报告，仅浏览器端、Electron 壳正常）：
 *  1. 顶部 git 分支选择器在位但整字不可见（旧 Safari gradient-clip text /
 *     皮肤 token 半生效族根因）——CSS 兜底 + JS 对比度自愈。
 *  2. 左栏滚动后状态栏下方大面积空白（旧 Safari display:contents+嵌套
 *     flex 的 min-height:0 收缩失效）——CSS 钉 min-height:100vh。
 *
 * 运行：node --test tests/browser-visual-guards.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const src = await readFile(new URL('../client.mjs', import.meta.url), 'utf8');

test('CSS 兜底规则在位（三类选择器都覆盖）', () => {
  // sidebarCol 满高仅浏览器态（Electron 32px titlebar 专属规则不得被波及）
  assert.match(src, /html:not\(\.dshc-electron\) \[class\*="_sidebarCol"\] \{ min-height: 100vh; \}/);
  // anchor 与 chip 子树：text-fill/clip 双断根因
  assert.match(src, /\[data-gitgraph-chip-anchor\], \[data-gitgraph-chip-anchor\] \*/);
  assert.match(src, /-webkit-text-fill-color: currentColor !important/);
  assert.match(src, /background-clip: border-box !important/);
  // chip 按钮颜色钉 label-primary（popover 列表不钉——anchor 无 color 规则）
  assert.match(src, /\[data-gitgraph-chip\] \{ color: var\(--dsw-alias-label-primary, #e3f4ec\) !important; \}/);
  assert.doesNotMatch(src, /\[data-gitgraph-chip-anchor\] \{[^}]*color/s, 'anchor 不得钉 color（会污染 popover 列表文字）');
});

test('JS 守卫 sentinel 块存在且挂进 heavy pass', () => {
  assert.match(src, /#browser-visual-guards:start[\s\S]*?#browser-visual-guards:end/);
  assert.match(src, /placeLauncherButton, guardBrowserVisuals\]\) \{/);
});

test('守卫不碰 Electron 态（侧栏检测有 dshc-electron 排除）', () => {
  const block = src.match(/#browser-visual-guards:start([\s\S]*?)#browser-visual-guards:end/)[1];
  assert.match(block, /classList\.contains\("dshc-electron"\)/);
});

test('对比度阈值与自愈色符合 WCAG 方向', () => {
  const block = src.match(/#browser-visual-guards:start([\s\S]*?)#browser-visual-guards:end/)[1];
  assert.match(block, /contrast < 2/);           // 触发阈值
  assert.match(block, /#eef4f4/);                // 深底自愈亮字
  assert.match(block, /#101418/);                // 浅底自愈暗字
});
