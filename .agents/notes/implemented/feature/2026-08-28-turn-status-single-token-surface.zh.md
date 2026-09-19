# Agent Note: 运行状态行只讲活动；token 数字只属于 StatsLine

Status: implemented

[English](2026-08-28-turn-status-single-token-surface.md) | 中文

反转 [2026-08-26-turn-status-token-display](2026-08-26-turn-status-token-display.md) 的 token 显示半边；该 note 的 locale key 迁移与活动标签工作仍然有效。

## Problem

2026-08-26 之后运行状态行显示已结算的 token 用量，而输入区 StatsLine 显示会话总量。两个界面重述重叠的数字，去重线（commit 3e9200935 及其前序）不得不持续为同一个事实调和两个渲染方。

## Decision

状态行只承载相位标签与计时。所有 token 数字——运行中或已结算——归属 StatsLine 单一 token 界面，且 StatsLine 在回合运行期间隐藏速度/用量组（commit 4d0389fc3），运行中不再有任何重复。

随显示一并删除：`RunningTurnUsage` 对 legacy assistant 节点的折叠、`nonNegTokens`、`turnStatusGlyph` 脉冲动画、两种语言的 `turn.statusTokensBoth` / `turn.statusTokensOut` locale key。

## Consequences

- 测试断言运行中状态行不含 `tokens` 文本。
- 计时保持 `label-tertiary`，使其附近的数字读数与 StatsLine 同色。
- 未来若要实时 token 数字，扩展 StatsLine，不扩展状态行。
