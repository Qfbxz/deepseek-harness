# dsh-bestharness-guard

BestHarness 综合守卫 —— 五家 harness（Claude Code / Codex / Kimi / opencode / DSH）源码分析结晶，单插件补强 DSH。

## 三机制

| 机制 | 出处 | 默认 | 说明 |
|---|---|---|---|
| 四级防死循环梯子 | Kimi CLI toolset.py:154 | **开** | streak 3→温和提醒 / 5→详细提醒 / 8→强停提示 / 12→**block 强制拦截**（post-execute block 决策）；canonical 深度键序排序防键序绕过；用户插话自动重置 |
| turn 级 token 预算 | Claude Code tokenBudget.ts | 关 | 仅计 output tokens（防 input 缓存虚高误停）；达 90% 注入 wrap-up 提示；连续 3 次 delta<500 判定边际递减 |
| 子代理摘要质量门 | Kimi runner.py:38 | 关 | 子代理 turn 结束摘要 <200 字符注入扩写指令；每 turn 至多一次（防反复扩写）|

## 设置

设置服务为唯一数据源（namespace `bestharness-guard`），GUI 设置卡与行为读写同一 scope，改动即时生效。

- 梯子：enabled / gentleAt / detailedAt / stopHintAt / forceStopAt / include[] / exclude[] / argumentsPreviewChars
- 预算：enabled / turnTokens / completionThreshold / diminishingDelta
- 摘要门：enabled / minChars

## 负优化防护

- 与内置 repeat-tool-reminder 不冲突：内置是本插件子集（只提醒不 block），同装无重复副作用
- 预算/摘要门默认关闭：不开启零开销（监听器秒退）
- nudge 一次性消费：绝不重复注入
- 摘要门 per-turn 去重：不会反复触发扩写
- 全部走公开扩展面（tools/post-execute、agent/pre-step、session/event），不动核心，随时 `dsh plugin remove` 卸载

## 安装

```bash
cd ~/compile/优秀仓库参考/DeepSeek-Harness
# profile 注册（与 dsh-context-ring 同方式）：
# ~/.dsh/profiles/<profile>/cordis.patch.yml 或 dsh plugin add 本目录
```
