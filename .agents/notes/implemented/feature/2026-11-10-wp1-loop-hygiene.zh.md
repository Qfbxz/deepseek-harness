# Agent Note: WP1 loop hygiene — force stop, same-step dedup, and the turn tool-call budget

Status: implemented

[English](2026-11-10-wp1-loop-hygiene.md) | 中文

## 问题

兄弟编码 agent harness 的源码级对比（[跨 harness 对齐计划](../../proposed/feature/2026-11-08-cross-harness-parity-program.md)，缺口 G1）量出了本 harness 缺失的三项循环卫生机制。repeat-tool-reminder guard 在连续同参数第 3、5、8 次注入提醒，但没有任何机制强制结束 turn——模型在阶梯之后继续重复时，只能靠宿主兜底，循环无界。同一 step 内出现完全重复调用时，没有任何机制复用已记录结果——模型在同一条 assistant 消息里发出两次相同调用，就要支付第二次真实执行。也没有任何包实施 per-turn 工具调用预算——工具调用或 steering 可以无限延长一个 turn。

## 决策

三个机制补齐缺口。所有随部署变化的取值都是经过校验的 `Config` 字段；配置错误在插件加载期抛出。

**强终止（`forceStopStreak`，默认 12，`0` 关闭）落在 `repeat-tool-reminder`。** 当已提交的重复链达到阈值时，guard 在 `tools/pre-execute`——即阈值调用派发之前——为该执行标记 `concludeTurn`（agent-loop 既有的 turn 终止接口，注册表物化该调用结果时读取），并把固定指令 `停止工具调用，改用文字总结当前进展与结论` 挂到既有提醒通道（`additionalContexts`，作为注入 `user/message` 送达）。因此循环经由普通结束路径、在模型读到指令之后结束 turn；没有新增循环分支。计数仍留在 post-execute，被拒绝的调用保持结构性计数；恰好在阈值处被拒绝或失败的调用无法携带成功结论，此后同一链的每次重复都保持高于阈值并重新武装强终止——阈值处或之后第一次成功提交的结果结束 turn。判定在派发前做出（pre-execute waterfall 按模型顺序串行执行，派发前窥探与已提交计数一致）。

**同 step 重复复用落在 `repeat-tool-reminder`。** 在一个 step 之内（每次 `agent/pre-step` 重置），首次执行的 `(tool, canonical arguments)` 组合记录其派发结果，并在 `tools/result` 记录其冻结的最终结果；完全相同的重复调用在 `tools/execute` 入口直接返回已记录结果，不调用工具体，并附注 `duplicate of an earlier call in this step; recorded result reused` 作为注入上下文。匹配经由链的规范化做到精确结构相等：重排对象算重复；近似变体、子集与不同值照常执行。在途重复复用首次调用的派发结果而不是与工具体竞速；首次调度的失败传播给重复调用，而不是伪造第二个结果。重复调用仍会计入重复链：一次尝试就是一次尝试。

**turn 工具调用预算（`maxToolCallsPerTurn`，默认 200，`0` 关闭）落在 `agent-loop`。** 调度器在一个 turn 至多准入该数量的模型发出调用，计数包含被其他策略拒绝或因取消被跳过的调用。越过预算的一批调用被切分：获准的调用照常运行，未启动的调用以 `TOOL_CALL_BUDGET_EXHAUSTED` 错误结果提交以保证回放有效，同时一条每 turn 一次的注入 `agent-loop` 上下文消息向模型说明预算已耗尽。切分返回 `concluded`，turn 在通知送达后经由普通结束路径收尾；后续超预算的 step 跳过其调用而不重复通知。无需新增 session 事件——通知就是普通注入上下文，模型可见性与持久日志天然一致。预算在插件启动时固定，刻意不放入 settings 段；`agent-spine-demo` 转发该字段，组合层部署可以设置它。

## 已考虑的替代方案

**改为在阈值处阻止调用而非结束 turn。** post-execute `block` 把结果变成错误并保持 turn 打开——模型面对一个错误结果仍可继续调用，这正是该机制要打断的循环。经由既有 `concludesTurn` 接口结束 turn，同时仍送达指令。

**把链计数移到 pre-execute。** 在强终止判定处推进链可以省去窥探，但计数将依赖监听器顺序（guard 之前拒绝调用的 pre-execute 监听器会遮蔽该调用），而 post-execute 计数对每一次拒绝都是结构性可见的。串行的派发前窥探同时保住两者。

**给在途重复返回最终结果。** 等首次调用的 `tools/result` 再回答竞速重复，会在调度器失败并跳过 finalize 时死锁。派发结果复用在调用体落定时即可解析，并接受「后续 post-execute 策略改写重复所见结果」这一窄窗口。

**为预算越过新增 session 事件。** 该事件与注入 `user/message` 已记录的内容重复；注入上下文通道有日志、有来源归属、可重建，新增 `SessionEventMap` 成员只会增加表面积而不增加信息。

**硬编码阈值。** 被仓库规则否决：每个阈值都是带加载期检查的校验过的 `Config` 字段。

## 测试

- `packages/guard/repeat-tool-reminder/tests/repeat-tool-reminder.spec.ts` 钉住强终止（标记、指令、turn 结束、默认阈值 12）、`forceStopStreak: 0` 只保留阶梯、精确与重排参数的同 step 去重、不同参数与跨 step 重复不去重、并行在途复用、失败向在途重复的传播、以及负数与分数 `forceStopStreak` 的拒绝。
- `packages/core/agent-loop/tests/budget.spec.ts` 钉住关闭的预算、turn 中途切分与已提交跳过结果及每 turn 一次的通知、通知 step 之后的 sticky 收尾、并行批次切分、直接构造的校验拒绝、以及默认值 200。
- keyless headless 场景 `examples/headless-agent/tests/snapshots/loop-repeat/` 与 `examples/headless-agent/tests/snapshots/loop-budget/` 经组装的一次性应用回放 12 次相同 `todo_write` 调用与预算为 4 的五次调用任务，钉住 3/5/8 阶梯、强终止消息、预算事件，以及收尾每个 turn 的文字总结。

## 后果

- 重复的模型现在面对有界的升级阶梯：3/5/8 提醒、12 强终止、默认每 turn 至多 200 次准入调用。强终止的代价是携带指令的最后一次请求；预算的代价是每个被跳过调用一条合成结果。
- 完全相同的同 step 重复不再支付第二次执行，且模型可以通过注释区分复用。Code Mode 下的程序适用同一规则：同一 step 内以完全相同参数两次调用同一工具的程序，读到的是已记录结果。
- guard 不再是纯建议性的：`forceStopStreak` 是一条有界的执行路径，仍由配置约束，仍通过循环的普通结束语义表达而非否决。
- 2026-07-08 `repeat-tool-guard` → `repeat-tool-reminder` 重命名记录中的理由（「不阻止也不执行 guard 决定」）描述的是重命名当时的插件，先于本次强终止；名称与[已归档的提醒决策](../../archived/feature/2026-07-08-repeat-tool-guard.md)仍是历史记录。
