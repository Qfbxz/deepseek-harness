# Harness 改造执行路线图（供智能体会话逐项执行）

> 定位：本文是**可执行计划**，供后续智能体会话在不偏离仓库规则的前提下逐项落地。决策记录（why/alternatives/risks）见 [.agents/notes/proposed/feature/2026-11-08-cross-harness-parity-program.md](../../.agents/notes/proposed/feature/2026-11-08-cross-harness-parity-program.md)，证据基础见同目录 [AGENT_HARNESS_COMPARISON.md](AGENT_HARNESS_COMPARISON.md)。
>
> 执行约束（每个工作包都适用）：遵守根 `AGENTS.md` 全部规则——随部署变化的取值必须是校验过的 `Config` 字段、禁止硬编码；每个工作包独立成 PR 并附 Agent Note 与 keyless snapshot；`pnpm run test`、`pnpm run typecheck`、`pnpm run doc-sync` 全绿后方可提交；不改 `agent-loop` 核心语义（WP2 只加预算守卫）。

## 工作包总览（按收益/风险比排序，可独立成 PR）

| WP | 内容 | 主落点 | 依赖 |
| --- | --- | --- | --- |
| WP1 | 循环卫生：3/5/8 提醒 + 12 强终止 + 同 step 去重 + turn 预算 | `packages/guard/repeat-tool-reminder`、`packages/core/agent-loop` | 无 |
| WP2 | 子代理报告下限 + 有界续写 | `packages/subagent/tool-subagent` | 无 |
| WP3 | 截断诚实性：原始大小 + 下一步指引 | `packages/compaction/compaction-tool-result-pruner` | 无 |
| WP4 | 压缩保留优先级 + 连续失败熔断 | `packages/compaction/compaction-basic` | 无 |
| WP5 | provider 声明的 token 计数器 | llm capability + compaction | 先做设计确认 |
| WP6 | 方法论提示词段 + 工具指导"何时不用"约定 | `packages/core/system-prompt` + preset | 无 |
| WP7 | MCP 挂载进基础 bundle | `packages/bundle/base/cordis.patch.yml` | 无 |
| WP8 | 审批缓存 + 可持久化前缀规则 | `packages/interaction/user-approval` | 无 |

WP1–WP4 无依赖、收益最大，建议首批；WP5 有设计前置；WP6–WP8 相互独立。

## WP1 循环卫生（对应提案 W1+W2）

1. `packages/guard/repeat-tool-reminder/src/index.ts`：新增 Config 字段 `forceStopStreak`（默认 12，`0` 关闭，校验为非负整数）。同参数连续计数达到阈值时，注入终止指令（内容："停止工具调用，改用文字总结当前进展与结论"），并结束当前 turn——复用现有提醒注入通道，终止语义走 agent-loop 既有接口，不新增循环分支。
2. 同 step 去重：在工具执行入口，同一 step 内出现 `(tool, arguments)` 完全相等的第二次调用时，不重新执行，直接返回已记录结果，附注 `duplicate of an earlier call in this step; recorded result reused`。语义钉死：**参数完全相等**（结构化相等，非近似）。
3. `packages/core/agent-loop`：新增 Config 字段 `maxToolCallsPerTurn`（默认 200，`0` 关闭）。计数范围为本 turn 全部工具调用；超限时以系统可见事件结束该 turn（模型能看到原因）。
4. 验收：keyless snapshot 覆盖 3/5/8 阶梯、12 强终止消息、预算事件；单元测试覆盖同 step 去重的相等/不相等两例与 forceStopStreak 边界（0 关闭）。

## WP2 子代理报告下限（W3）

1. `packages/subagent/tool-subagent/src/index.ts`：Config 字段 `minReportChars`（默认 200）、`floorContinuationAttempts`（默认 1，`0` 关闭）。
2. 子代理最终消息长度 < `minReportChars` 时，向该子代理发送一次续写请求，提示词要求补齐：技术细节与实现 / 详细发现与分析 / 父代理需要的全部重要信息；取续写前后更长的结果回传父代理。
3. 验收：短报告 snapshot（续写恰好一次）+ 长报告 snapshot（不触发）+ `floorContinuationAttempts=0` snapshot（不触发）。

## WP3 截断诚实性（W4）

1. `packages/compaction/compaction-tool-result-pruner`：截断通知格式统一为 `[truncated] original N chars -> kept head X + tail Y; re-read specific ranges to page through the middle`。
2. 工具错误统一包装处对被截断的错误文本采用同一后缀约定。
3. 验收：剪枝器输出 snapshot 更新；文档（包 README）同步。

## WP4 压缩契约与熔断（W5）

1. `packages/compaction/compaction-basic/src/summarizer.ts`：摘要提示词增加保留优先级排序——当前任务状态 > 错误与解法 > 文件与代码 > 用户消息 > 更早历史；各节附 MUST KEEP / MERGE / REMOVE 指令。保持现有 7 段 checkpoint 结构不变，只加排序与指令，避免 snapshot 大面积漂移。
2. Config 字段 `maxConsecutiveFailures`（默认 3）：连续失败达到阈值后停止自动压缩、抛出可见错误、会话保持可用（不阻塞用户继续输入）。
3. 验收：summarizer snapshot 更新；熔断单元测试恰好第 N 次停止；失败后用户输入仍可正常走通（keyless 回放）。

## WP5 provider 声明的 token 计数器（W6，先设计后实现）

1. 设计确认（实现前必须完成，结论写入本 WP 的 Agent Note）：定位字符估算器的归属包；确定计数能力声明挂在 llm capability 的位置（provider 可声明 `countTokens`，如 Strata worker 的 `/v1/messages/count_tokens`）。
2. 实现：provider 声明计数能力时，预算与压缩触发改用上报计数；未声明时行为与今天完全一致（字符估算兜底）。
3. 验收：无计数器 provider 的全部 snapshot 不变；有计数器 fixture 验证预算数值换用上报值。

## WP6 方法论段与"何时不用"约定（W7）

1. `packages/core/system-prompt`：新增可选方法论段，**预算 300 词**（加词预算校验），内容四条：先探索后结论；进入子目录先查该目录 AGENTS.md；先验证后声称；引用代码给 `path:line`。
2. standard preset 各工具的 prompt 指导段：统一增加 "When not to use" + 1–2 条 bad pattern 子节（反例风格参照对比报告 §3.1：`**` 通配会撑爆上下文、避开 node_modules、能推断就别问用户等）。
3. 验收：组装 transcript snapshot 可见新段；词预算门禁通过；系统提示词总增量 ≤ 2KB（用脚本量化并记录）。

## WP7 MCP 挂载（W8）

1. `packages/bundle/base/cordis.patch.yml`：基础 profile 挂载 `packages/mcp` 能力，Config 驱动，默认空注册表；配置错误在加载期响亮失败。
2. 验收：hygiene 门禁通过；headless snapshot 呈现空注册表；有 `DEEPSEEK_API_KEY` 时用一个 fixture MCP 服务器（`serve/mcp_fake_server.py` 可作参照形态）跑一次 e2e。

## WP8 审批缓存与前缀规则（W9）

1. `packages/interaction/user-approval/src/index.ts`：会话级缓存，键 = 归一化请求形态（工具 + 归一化参数）；同形态已批准则不再询问。
2. 前缀规则：批准时可选择持久化命令前缀（正例 `["cargo","test"]`）；书面禁止形态：`rm`、heredoc、通用解释器（`python3` 等）——持久化请求遇到禁止形态直接拒绝。
3. 验收：缓存键归一化单元测试、前缀持久化单元测试、打断缩减 snapshot。

## 完成后的下游动作（不在本仓库执行）

全部 WP 落地后，Strata 工作副本按其 `docs/HARNESS_ROADMAP.md` 阶段二执行：升级 pin 版本、更新漂移测试、删除被上游机制取代的宿主兜底。

## 明确不做

- 不做压缩回滚/历史召回/缓存感知分块（归 [recallable-compaction](../../.agents/notes/proposed/feature/2026-07-06-recallable-compaction.md) 提案）。
- 不把工具指导迁移进工具描述（推迟的独立决策，见提案"已考虑的替代方案"）。
- 不触碰 vendored 插件（含 dsh-infinite-gen-4）。
