# Agent Note: WP4 compaction retention priority and consecutive-failure breaker

Status: implemented

[English](2026-11-10-wp4-compaction-priority-and-breaker.md) | 中文

## 问题

跨 harness 对齐程序（[缺口 G4](../../proposed/feature/2026-11-08-cross-harness-parity-program.md)）测得 `dsh-compaction-basic` 的两个压缩缺口。摘要器产出的分节检查点没有保留优先级排序，被迫缩减时没有"先丢什么"的规则；Kimi 对此给出六级保留排序和每节 KEEP/MERGE/REMOVE 规则。而失败的摘要器会永远重试：每次自动尝试只警告并继续，一个死掉的摘要端点会变成每步一次的无界失败循环——对比报告引用了 Claude Code 源码注释，其中记录了单个会话连续 3,272 次压缩失败，靠 3 次熔断才停下。

## 决策

**压缩指令现在给出保留排序和每节的缩减规则，且不改变检查点的小节结构。** 指令——辅助摘要调用的最后一条 user 消息——新增一段保留优先级排序：当前任务状态（`## Current Work`、`## Next Step`、`## Pending Jobs`），其次错误与解法，其次文件与代码（`## Files and Code`、`## Key Technical Concepts`），其次用户消息（`## Primary Request and Intent`），最后更早历史（`## Critical Context`）；另为每个小节附一行 MUST KEEP／MERGE／REMOVE 指令，以及一条"绝不丢高优先级内容去保低优先级内容"的规则。所有小节标题、小节顺序和框定标签原样未动，既有检查点及其消费方保持兼容。

**自动压缩现在在每会话连续失败达到 `maxConsecutiveFailures`（默认 3）后停止。** 熔断统计自动入口 `compactIfNeeded` 的失败，因此两条触发路径——经 `agent/pre-step` 的步骤边界压力与经 `agent/request-error` 的溢出恢复——汇入同一条连续失败计数。第 N 次连续失败时，引擎记录一条点名熔断器、次数、恢复路径与最后一次失败的错误日志；此后该会话的每次自动尝试都直接返回 `null`、不再发起尝试，所以第 N 次失败就是最后一次尝试。会话保持可用：压力 listener 继续放行步骤，溢出恢复继续保留原始提供方错误，用户输入继续流动。

计数语义，由测试钉住：

- 一次失败指一次抛出的 `compactIfNeeded` 尝试，且既不是 `TargetPressureConfigError`（加载期配置错误，自带每目标一次的警告通道；重试不可能成功），也不是取消信号已获胜的失败（用户意图，不是压缩失败）。
- 计数按引擎上的 `Session` 隔离，一个坏会话不会停止共享同一引擎的兄弟会话的压缩。
- 该会话上任何一次成功的压缩事务都会清零计数：经 `compactRegion` 的自动压力或溢出成功，或一次成功的手动 `compactNow()`。`null` 结果（无需压缩，或仅剪枝就清除了压力）既不计入也不重置。
- `maxConsecutiveFailures: 0` 关闭熔断：无论此前失败多少次，自动压缩都在每次触发时尝试。该取值是经过校验的 `Config` 字段——Loader 路径走 Schemastery 的 `z.number().step(1).min(0)`，直接 apply 路径走 `resolveConfig` 的非负整数校验——其余取值都使插件加载失败。

**手动压缩刻意位于熔断之外。** `compactNow()` 不查看连续计数，其失败也不推进计数——手动尝试是用户驱动的动作，自带 `ManualCompactionError` 上报——但一次成功提交的手动事务会清零计数，这是熔断会话不重启即恢复的成文路径。

## 已考虑的替代方案

**在压力路径的熔断点字面抛出异常。** 否决——pre-step listener 刻意捕获操作性失败，使压缩问题绝不阻塞 turn；抛出会终结该步骤，违反"会话保持可用"。可见错误是 error 级日志加上每次失败已留下的持久 `compaction/end` 错误记录；溢出恢复还继续把原始提供方错误上报给用户。

**只在自动成功时清零计数。** 否决——熔断触发后自动压缩不再运行，只按自动成功清零会让触发对本会话终身有效。一次成功的手动压缩证明摘要器恢复工作，是自然的自愈路径。

**手动失败也计数。** 否决——手动失败直接上报给触发它的用户；把它计入会让一次用户试验触发自动熔断。

**`modelPolicies` 内按模型覆盖 `maxConsecutiveFailures`。** 否决——熔断保护的是摘要器，而摘要器可能路由到与会话不同的提供方；会话级顶层取值与会话级计数语义一致，不需要第二条合并路径。

**通过重排或删减小节来表达排序。** 否决——八小节检查点结构被下游消费并被快照钉住；排序加每节指令就能教会缩减规则，不需要移动任何东西。

## 测试

- `packages/compaction/compaction-basic/tests/compaction-basic.spec.ts` 钉住：恰在配置的 N 次触发（以及出厂默认 3 次）、点名熔断器/上限/恢复路径的唯一一次触发错误、经真实 listener 在两条触发路径上的"无第四次尝试"闸门、自动与手动成功后的清零、手动豁免（手动失败留在计数之外）、`maxConsecutiveFailures: 0`、取消与目标配置两类排除、配置校验表与解析默认值。
- `packages/compaction/compaction-basic/tests/snapshots/compaction-instruction.snapshot.txt` 逐字钉住完整指令文本。
- keyless headless 场景 `examples/headless-agent/tests/snapshots/compaction-breaker/` 与 `.../compaction-priority/` 经组装的 one-shot 应用回放：熔断 transcript 钉住三次失败括号、零摘要、第四次工具步骤在无尝试下运行、以及完成的 turn；优先级 transcript 的检查点经 `{{fromRequest:…}}` 占位符把 live 指令片段回显回来——若组装请求不再携带排序或指令，占位符会让 replay 响亮失败。

## 后果

- 一个死掉的摘要端点现在最多花费每会话 `maxConsecutiveFailures` 次尝试，而不是在会话余生里每步失败一次，且停止是可见的，不再是逐步警告流。
- 触发后该会话失去自动压力 relief：超预算会话保持超预算，直到一次手动 `compactNow()` 成功或会话结束。这正是熔断存在的取舍——另一端是无界重试循环。
- 指令增加了排序块与八行指令，是每次辅助摘要调用未缓存后缀的小额固定成本。
- `recallable-compaction` 仍是回滚、会话内历史召回与缓存感知分块的归属者；本笔记没有移动其中任何一项。[排队的手动压缩](2026-07-30-queued-manual-compaction.md) 继续拥有手动压缩生命周期；本笔记只在其调用方契约上新增熔断豁免与手动成功清零。
