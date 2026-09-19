/**
 * p42-restart-cancel.test.mjs — P42「取消=清缓存+刷新」判定覆盖面测试。
 *
 * 背景（2026-08-31 用户报告）：左侧栏顶部电源钮（@linxin666/dsh-desktop-launcher）
 * 弹出的对话框是「确认退出 / Confirm exit」（role=dialog, aria-label=dialog.title），
 * 不是「重启」对话框。P42 原判定 /重启|restart/i 对其恒 false → 点「取消」只关弹窗，
 * 既不清缓存也不刷新页面。
 *
 * 取证（launcher 0.3.6 lib/client.js 文案表）：
 *   zh: dialog.title=确认退出  dialog.description=…确定要退出吗？  dialog.cancel=取消
 *   en: dialog.title=Confirm exit  dialog.cancel=Cancel
 * 取消按钮为 <button type="button">（textContent=取消/Cancel），位于
 * role="dialog" 容器内 → P42 的按钮循环与 closest 选择器均可命中，唯正则失配。
 *
 * 运行：node --test tests/p42-restart-cancel.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const src = await readFile(new URL('../client.mjs', import.meta.url), 'utf8');

// 从源码中穷举提取全部 P42 对话框判定正则（两份实现都要覆盖）
const judgeRe = /\/(重启[^/]*)\/i\.test\(\(?dlg\.textContent/g;
const judges = [];
for (const m of src.matchAll(judgeRe)) judges.push(new RegExp(m[1], 'i'));

test('P42 判定实现存在且两份齐全', () => {
  assert.ok(judges.length >= 2, `应提取到 >=2 份判定，实际 ${judges.length}`);
});

test('RED→GREEN：退出确认对话框文案必须命中判定（电源钮取消=清缓存+刷新）', () => {
  assert.ok(judges.length >= 2, '提取器空转：judges 为空会让下面的循环 vacuous pass');
  const launcherDialogTexts = [
    '确认退出',                      // zh dialog.title（h2 在 dlg.textContent 内）
    '确定要退出吗？',                 // zh dialog.description 兜底
    'Confirm exit',                  // en dialog.title
    'Are you sure you want to exit?', // en dialog.description 兜底
  ];
  for (const j of judges) {
    for (const t of launcherDialogTexts) {
      assert.ok(j.test(t), `判定 ${j} 未覆盖退出确认对话框文案「${t}」→ 电源钮「取消」不清缓存不刷新`);
    }
  }
});

test('原「重启」对话框语义不回退', () => {
  const keep = ['确定重启应用吗？', 'restart now?', '正在重启'];
  for (const j of judges) for (const t of keep) assert.ok(j.test(t), `判定 ${j} 丢失原语义「${t}」`);
});

test('marker 与取消按钮锚点在位（watchdog/宿主 rev 惯例不受影响）', () => {
  assert.match(src, /patch\(restart-cancel-refresh\)/);
  assert.match(src, /txt === '取消' \|\| txt === 'Cancel'/);
  assert.ok(countOccurrences(src, "clearCacheReload") >= 8, 'clearCacheReload 定义+双份挂载+双份引用齐备');
});

function countOccurrences(hay, needle) { return hay.split(needle).length - 1; }

// ---- 2026-09-02 折叠钮旁重启按钮·弹出页取消失效（p42v3 浮层记忆）----
test('RED→GREEN：浮层记忆机制存在（不猜容器类名的根治路径）', () => {
  assert.ok(countOccurrences(src, 'restartLayers') >= 3, 'restartLayers 声明+记忆+判定引用齐备');
  assert.match(src, /lay\.isConnected && lay\.contains\(t\)/, '取消点击需 contains 于已记忆浮层');
  assert.match(src, /p42mo\.observe\(document\.body/, 'MutationObserver 需挂 body 子树');
});
test('RED→GREEN：祖先兜底窗口 800 字符 × 12 层（原 200×6 对弹出页截断失效）', () => {
  assert.match(src, /ai < 12 && anc/, '层数需 >=12');
  assert.match(src, /\.slice\(0, 800\)\)\) \{ hitRestart = true/, '祖先文本窗口需 >=800');
});
test('RED→GREEN：取消锚点含 title/aria-label（图标按钮无文本场景）', () => {
  const p42click = src.slice(src.indexOf("txt === '取消'"));
  assert.match(p42click.slice(0, 600), /aria-label/, '取消判定需含 aria-label 路径');
});
