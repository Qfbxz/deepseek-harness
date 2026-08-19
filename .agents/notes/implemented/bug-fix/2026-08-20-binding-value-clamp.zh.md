# Agent Note: run_code 在绑定结果到达程序前钳制超大值

Status: implemented

## Problem

绑定调用返回超大载荷（50 KB bash stdout、巨型文件读取）时，原始 `result.value` 无界地流入 run 的完成值，撑爆外层输出账本后以不透明 abort 收场：模型只看到 run_code 失败、没有可用诊断，盲重试再次撞墙。dispatch bridge 对每个子调用都用原始值 settle，工具与账本之间没有任何尺寸约束。

## Decision

在 dispatch bridge 的 settle 点钳制每个绑定结果（`packages/core/tools/src/code-mode.ts`）：`clampBindingValue` 将单个字符串封顶在 `BINDING_VALUE_MAX_CHARS = 24_000` 字符并追加显式 `…[truncated N of M chars]` 标记；数组/对象按元素/键递归钳制，保持 JSON 形状。程序收到的值——以及它派生进完成值的任何内容——按每次绑定调用有界。

## Alternatives considered

- **在末尾对整个完成值钳制一次。** 程序可把多个绑定结果折叠成一个巨型聚合；按绑定钳制约束的是输入而非最终渲染，且截断标记附着在产生它的那次调用上。
- **将超大结果作为错误拒绝。** 工具已成功、副作用已落地；报错会诱导重试，而带显式标记的截断值让程序继续执行并按需窄读。
- **提高账本预算。** 只是挪走失败点而非消除它；失控载荷仍会跨越 worker 边界。

## Consequences

- 返回超过 24 000 字符的绑定到达程序时已截断并带显式标记；run 正常完成而非不透明 abort。
- durable 子调用日志与工具渲染保留工具自身内容（日志监听器本就可能替换为预览+定位符）；钳制只作用于送入程序完成路径的值。
- 已发布 npm 包的运行时副本经 `runtime-patches/replay-discard-diagnostic.mjs`（补丁 12，watchdog 条目 `p12-discard-diagnostic`）携带该修复；全局重装 dsh 后 watchdog 自动重放。
