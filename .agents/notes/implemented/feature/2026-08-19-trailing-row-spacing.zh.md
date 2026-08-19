# Agent Note：行内上下文面板留出水平呼吸空间

Status: implemented

[English](2026-08-19-trailing-row-spacing.md) | 中文

## 问题

`send-after` 槽把优先级胜者面板渲染在输入行内（主发送按钮右侧，填满行余宽）。goalbar、queue、todo 三面板在该模式都去掉了独立卡片的 width/margin（不超卡片即可）。但它们没在面板自身边沿与发送按钮 / 卡片右墙之间留间距——行模式规则把 `.dock` 设为 `margin: 0`，让面板贴两端，整条读起来是一行连写的数字。

## 决策

三面板的行模式规则都加 `padding: 0 10px`，goalbar 额外给子元素之间加 `margin-left: 8px`（目标条通常是两列）。padding 取 10px 与独立卡片的水平内边距一致，行与卡片共享同一视觉节奏。goalbar 的子元素间距让目标与操作面在同行内不挤。

## 备选方案

- **在 .sendAfter 包装器上加 padding。** 包装器由会话骨架所有、不归面板；加 padding 会惩罚无面板的空行（`flex: 1 1 0` 按内容尺寸），每个面板需自带行内 padding。
- **加大发送按钮 margin 把面板右推。** 发送按钮是工具行控件、不是面板边界；面板应在自己的 padding 通道里，不应与交互控件相挤。

## 影响

行模式面板两侧各有 10px 间距，与独立卡片水平节奏一致。目标条两列同行时 8px 间距让两列不挤。独立卡片模式未动（其 padding 级联就是同一 10px 节奏）。

## 测试

跑 `pnpm run build:lib:client`；编译产物含 `[data-send-after] .dock{...;padding:0 10px}`（goal/queue）与 `[data-send-after] .root{...;padding:0 10px}`（todo）。视觉验证：刷新 GUI，行内面板两侧 10px 间距、goalbar 两列同行 8px 间距。