# Agent Note: TurnStatus 实时 token 显示：计费输入 + 输出，跟随 locale 的标签

Status: implemented

[English](2026-08-26-turn-status-token-display.md) | 中文

## 问题

回合状态是唯一不显示任何 token 的表面，而 StatsLine（会话总量）与回合页脚（仅输出的 tokens/s）各讲一半：回合运行期间，用户看不到模型正在消耗什么。

## 决策

`ChatView` 的运行中状态行在活动标签旁显示已结算的每回合 token 用量——`↑{计费输入} ↓{输出} · {解码 tps}`；原先硬编码的 `Deep diving...` 标签移入 `conversation` 命名空间，成为 `turn.status`（zh `生成中…`，en `Generating…`）。显示遵循 Claude Code 约定：输入侧对三个互斥的计费桶求和（`inputTokens + cacheReadTokens + cacheWriteTokens`——缓存 token 同样占据上下文并在 prompt 缓存下占大头），使数字跨步骤可比；输出为 provider 的 completion token（含思考）。tps 复用已结算页脚的解码速率定义（最近一步的 outputTokens / decodeMs），而不是墙钟差值。`runningTurnUsage` 从 legacy 兼容投影（`s.chat.legacy.nodes`）折叠开放回合的 assistant 节点——与 StatsLine 读取的是同一批稳定领域节点，`turn`/`usage` 字段有保证。用量按完成的 `assistant/message` 落账，总量随每步前进；进行中的一步在完成时并入。只有 `output > 0` 才渲染该数字，保持首步之前的状态行干净。

## 备选方案

**墙钟差值 tps。** 已否决：它会把工具耗时悄悄摊进分母；解码速率定义（最近一步的 outputTokens / decodeMs）与已结算页脚的数字一致。

**进行中步骤的逐 token 实时计数。** 已否决：chunk 事件不带用量，不做估算就无法实时逐 token 计数；用量按完成的 `assistant/message` 落账，进行中的一步在完成时并入。

**以猜测的 `node.location.turn` / `node.data.usage` 路径读取视图层节点仓库。** 已否决（早期进行中草稿尝试过）：这些路径在 `ChatConversationViewNode` 上不存在，只会静默得到 0；legacy 兼容投影（`s.chat.legacy.nodes`）才是带 `turn`/`usage` 字段保证的稳定来源。

## 影响

- 状态行的运行中数字采用 Claude Code 输入约定，与已结算页脚的总量可比。
- 硬编码的 `Deep diving...` 字符串移除；标签经真实字典解析，测试用 `makeTranslate(zh, …)` 钉住 zh 标签。
