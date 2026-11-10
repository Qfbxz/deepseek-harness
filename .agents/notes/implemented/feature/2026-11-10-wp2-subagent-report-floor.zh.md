# Agent Note: WP2 subagent report floor — bounded continuation for short child reports

Status: implemented

[English](2026-11-10-wp2-subagent-report-floor.md) | 中文

## 问题

跨 harness 对齐程序（[缺口 G2](../../proposed/feature/2026-11-08-cross-harness-parity-program.md)）测得：委派把子 agent 的最终消息未经检查地直接回传——子 agent 用一句话回答研究或分析任务时，这句话就成为父级拿到的全部委派结果。对比中该机制最强者（Kimi Code CLI，工作副本 `kimi/src/kimi_cli/subagents/runner.py`）在子 agent 最终回复不足 200 字符时强制续写一轮，要求补齐技术细节、发现以及父级需要的全部信息，并回传更长的消息。本 harness 此前没有下限，每份过短的子代理报告都在无声消耗委派工具本应换来的并行探查价值。

## 决策

报告下限落在 `tool-subagent`。所有随部署变化的取值都是经过校验的 `Config` 字段；配置错误在插件加载期抛出——Loader 路径走 Schemastery schema，直接 `apply()` 调用走 `resolveReportFloor`。

**`minReportChars`（默认 200，Unicode 码点）与 `floorContinuationAttempts`（默认 1，`0` 关闭）作用于前台一次性结果路径**——本工具把子代理报告作为调用结果返回的唯一路径：one-shot 模式的前台默认路径，以及 continuable 模式显式 `run_in_background: false` 的路径。`completed` 报告短于下限时消耗最多 `attempts` 次续写往返；回传父级的是收集到的最长报告。

**续写通道就是运行句柄上已发布的子代理自身对话。** `SubagentRun.localAgent` 暴露确切的进程内子 agent，续写要求作为它的下一个 FIFO 轮次投递，走与一次性 driver 投递初始提示词相同的 `Agent.followup()` / `whenIdle()` / 会话日志读取——不改 provider 接口、不新增循环分支、不新增 `SessionEventMap` 成员：续写要求只是子代理持久会话里一条普通的已记录用户消息，父级看到的只有作为工具结果的最终报告，因此模型可见性与日志按构造保持一致。续写要求一份完整的替换报告，至少覆盖：技术细节与实现细节、详细发现与分析、委派方需要的全部重要信息。续写轮次运行失败或未以 `completed` 结束时，保留已收集的报告并停止消耗次数——下限是对已完成委派的质量提升，它的失败不能变成委派的失败。没有公开本地子 agent 的运行（进程外提供方）没有续写通道，报告原样返回。

## 已考虑的替代方案

**把下限应用到一次性后台 job 结果。** 本次不做：job 的结果映射在 seam 的 `settleRun` 里，注入下限选出的输出要么复制该映射，要么给 seam 辅助函数加参数。后台路由有自己的补救故事——父级通过 `job_output` 收集，也可以重新委派。

**把下限应用到可继续后台子代理。** 拒绝：结算通知是 continuation 管理器在 Activation 拆除时投递的，短收尾消息意味着要么对抗该生命周期，要么唤醒正在结算的子代理再跑一轮。`send_message` 已是这些子代理面向模型的续写通道。

**用 provider 能力位控制下限。** 拒绝——这会改动 subagent provider 接口；`localAgent` 的有无已经区分了能续写与不能续写的运行。

**带上了短答案的第二次全新委派。** 拒绝：它回答的是另一个子 agent，并且为重建第一个子代理已持有的上下文再付一次完整提示词。

**硬编码阈值。** 被仓库规则拒绝：两个取值都是带加载期校验的 `Config` 字段。

## 测试

- `packages/subagent/tool-subagent/tests/report-floor.spec.ts` 用脚本化模型驱动真实 spawn 提供方与子循环：短报告恰好一次续写并返回更长结果、长报告不续写、`floorContinuationAttempts: 0` 保留短报告、未干净完成的续写丢弃其部分文本并停止消耗次数、次数上限约束重复轮次且最长结果胜出、`localAgent: undefined` 的运行保留短报告、两字段的加载期非法值拒绝。
- keyless headless 场景 `examples/headless-agent/tests/snapshots/subagent-floor-short/`、`subagent-floor-long/`、`subagent-floor-disabled/` 通过组装的一次性应用回放前台 `subagent_fork` 委派，钉住父级流中的提升报告、子代理持久日志中的单次续写要求，以及下限关闭时原样返回的短报告。

## 后果

- 每次进程内前台委派都有了报告质量下限。代价是每份短报告一次 provider 往返——本地引擎上是 prefill 时间——由 `floorContinuationAttempts` 约束，可设为 `0`。
- 下限按 Unicode 码点计数，不按估算 token：同样的 200 码点在 CJK 中比拉丁文本承载更多信息，因此该下限对 CJK 报告偏保守。基于 token 的下限归入程序的 provider 声明 token 计数器条目，在那里延后处理。
- 进程外提供方（ACP）原样保留短报告；该跳过是文档化的配置行为，不是错误。
- 下限从不降低结果质量：返回的是收集到的最长报告，且每条失败路径都保留已 `completed` 的答案。
