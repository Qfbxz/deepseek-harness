# Agent Note: code-mode 恢复 clamp 与可选 description（合并牺牲品）

Status: implemented

[English](2026-08-26-code-mode-merge-casualty-restore.md) | 中文

## 问题

两个 code-mode 行为只存在于测试与 fleet 运行时补丁中，源码里没有：`clampBindingValue`（commit `01cc9ed3b8`，补丁 12）在 dispatch 结算点把单个绑定结果截到 24k 字符，防止巨大的工具载荷把输出账本冲爆成一次不可读的中止；可选 `description` + `deriveRunCodeTitle`（commit `feec4b49a9`，补丁 2）让缺失或空白的 description 不再导致调用失败——展示层从程序首个有效行派生标签。clamp 是在合并 `b2f23f88ad`/`a135df8be6` 取官方侧冲突块时被丢掉的；description 修复则从未合入 `zoubo`。两种情形下测试都幸存并跑红（2 个失败；clamp 测试在 `code-mode.spec.ts:1553`），而运行时副本经 fleet 补丁（p2/p12）保留了这两个行为——只有源码与测试不一致。

## 决策

`packages/core/tools/src/code-mode.ts` 找回这两个修复。两处恢复都按原始 diff 原样应用到当前源码（锚点未变）。p12 补丁另外为 rc.2 重写：运行时读取的是打包的 `lib/index.js`（code-mode 内联其中），旧的 `lib/types/code-mode.js` 目标是空操作；补丁现在是自包含的多目标载荷（global/profiles-root/web-local）。

## 备选方案

**不用原始 diff，改为重写实现。** 已否决：原始 diff 仍能以未变的锚点原样应用到当前源码，原样应用恢复的是经过 fleet 验证的精确行为，而不是靠新编辑重新引入。

**只靠 fleet 补丁携带这两个修复，源码保持缺失。** 已否决：运行时副本已经靠补丁（p2/p12）保留了这两个行为，只留补丁会让源码与测试永远不一致，并让每次未来合并都暴露在同样的合并牺牲风险下；源码拥有该行为正是幸存测试所钉住的契约。

## 影响

- 源码与测试重新一致：两个跑红的测试（含 `code-mode.spec.ts:1553` 的 clamp 测试）在恢复后的源码上通过。
- p12 补丁现在作用于 rc.2 打包的 `lib/index.js`，是自包含的多目标载荷（global/profiles-root/web-local），替代了空操作的 `lib/types/code-mode.js` 目标。
- 包套件 391/391，tool-bash 86/86，tsc 干净。
