# Agent Note：跨 harness 对齐计划 —— 循环卫生、子代理保真与上下文诚实

Status: proposed

[English](2026-11-08-cross-harness-parity-program.md) | 中文

## 问题

对四个同源 coding-agent harness（Kimi Code CLI、Claude Code、Codex、以及封装本仓库的 Strata 宿主）的源码级对比，量出了本 harness 缺失对方最强机制的七处差距。完整证据表见 [docs/research/AGENT_HARNESS_COMPARISON.md](../../../../docs/research/AGENT_HARNESS_COMPARISON.md)；本 Note 持有"补齐差距"的决策。兄弟仓库路径一律以反引号标注为只读工作副本引用，不做链接。

G1 —— 循环卫生。[repeat-tool-reminder](../../../../packages/guard/repeat-tool-reminder/src/index.ts) 在同参数连续第 3、5、8 次调用时注入提醒，但没有任何机制强终止该 turn，也没有机制在一个 step 内对完全重复的调用直接复用已记录结果。Kimi（工作副本 `kimi/src/kimi_cli/soul/toolset.py`，常量约 153 行）使用同款阶梯，并在第 12 次强终止；同 step 内完全重复的调用直接复用原结果。没有任何包约束 turn 级工具调用预算；Claude Code 有 turn 上限，Kimi 步数上限 1000。

G2 —— 子代理报告保真。委派直接返回子代理的最终消息，不做校验。Kimi 在报告不足 200 字符时执行一次有界续写（`kimi/src/kimi_cli/subagents/runner.py`），要求补齐技术细节、发现、以及父代理需要的全部信息。

G3 —— 截断诚实性。[compaction-tool-result-pruner](../../../../packages/compaction/compaction-tool-result-pruner/src/config.ts) 把超限工具结果剪成头尾两段；通知说明了截断，但既没有原始大小，也没有下一步指引。Kimi 在截断通知追加"use pagination or more specific queries"；Codex 在结构化工具输出中报告 `original_token_count`。

G4 —— 压缩质量与失败处理。[compaction-basic](../../../../packages/compaction/compaction-basic/src/summarizer.ts) 固定保留 16% 尾部，输出的分段 checkpoint 各节没有保留优先级排序；Kimi 的压缩提示词给出六级保留优先级（当前任务状态 > 错误与解法 > 代码演化 > 更早历史），配 KEEP/MERGE/REMOVE 规则和结构化输出模板。摘要器失败后无熔断地重试：Claude Code 在连续 3 次失败后停止自动压缩，其源码注释记录了一个连续失败 3,272 次的会话。预算与触发所依赖的 token 估算按字符数折算；引擎对真实 agent 代码流量的实测为每 token 2.09 字符，一次会话出现 59,048（引擎）对 31,794（harness）的偏差（Strata 宿主 `apps/host/server/agent/context-budget.mjs`）。

G5 —— 方法论层。harness 自写的静态提示词约 2 KB，标准 persona 只有一句话，探索、验证、汇报的方法论无处可学。Kimi 在约 2,239 词、8 节的系统提示词中显式教授；Claude Code 的提示词注释为单条规则保存了 A/B 实测数字（如 "29-30% FC rate vs v4's 16.7%"）。

G6 —— MCP 接线。[packages/mcp](../../../../packages/mcp/README.md) 已存在，但[基础 bundle](../../../../packages/bundle/base/cordis.patch.yml) 未挂载，默认 profile 无法接 MCP 服务器。

G7 —— 审批打断成本。[user-approval](../../../../packages/interaction/user-approval/src/index.ts) 每次升级都询问。Codex 为会话缓存审批结果，并提供可持久化的命令前缀规则，附带明确的反例（`python3` 前缀绝不可持久化；`rm` 与 heredoc 形态被点名禁止）。

## 提案

九个工作项。所有随部署变化的取值一律是经过校验的 `Config` 字段（遵守仓库"禁止硬编码可调参数"规则）；下列默认值是评审起点，不是决定。

| 项 | 落点 | 变更 |
| --- | --- | --- |
| W1 | `packages/guard/repeat-tool-reminder` | 在 `forceStopStreak`（默认 12）强终止；同 step 去重：step 内完全重复的调用直接返回已记录结果，不重复执行 |
| W2 | `packages/core/agent-loop` | turn 工具调用预算 `maxToolCallsPerTurn`（默认 200，`0` 关闭），超限以系统可见的预算事件结束该 turn |
| W3 | `packages/subagent/tool-subagent` | 报告下限 `minReportChars`（默认 200）+ 一次有界续写 `floorContinuationAttempts`（默认 1），续写要求补齐技术细节 |
| W4 | `packages/compaction/compaction-tool-result-pruner` | 截断通知增加原始大小、保留大小和一句下一步指引；工具错误截断采用同一后缀约定 |
| W5 | `packages/compaction/compaction-basic` | 摘要输出增加保留优先级排序（当前任务状态 > 错误与解法 > 文件与代码 > 用户消息 > 更早历史），并加连续失败熔断 `maxConsecutiveFailures`（默认 3）：停止自动压缩并报出错误 |
| W6 | `packages/core/agent-loop` + `packages/compaction` | provider 声明的 token 计数器：provider 暴露 token 计数操作时（Strata worker 已暴露 `count_tokens`），预算与压缩触发改用上报计数；字符估算保留为兜底 |
| W7 | `packages/core/system-prompt` + preset 指导段 | 可选方法论段（预算 300 词）：先探索后结论、检查嵌套指令文件、先验证后声称、引用路径；并为每个工具的 prompt 指导段统一"何时不用 + 反例"子节约定 |
| W8 | `packages/bundle/base/cordis.patch.yml` | 在基础 profile 挂载 MCP 能力，配置驱动，默认空注册表；配置错误在加载时响亮失败 |
| W9 | `packages/interaction/user-approval` | 会话级审批缓存（按归一化请求形态为键）+ 可持久化前缀规则，附带书面禁止形态（`rm`、heredoc、通用解释器） |

逐项验收：W1、W2 增加 keyless snapshot，覆盖提醒阶梯、强终止系统消息与预算事件；单元测试把同 step 去重钉在"参数完全相等"上。W3 的 snapshot 覆盖短报告（续写恰好一次）与长报告（不续写）。W4、W5 更新摘要器与剪枝器输出 snapshot；熔断单元测试在恰好第 `maxConsecutiveFailures` 次停止。W6 在 provider 无计数器时行为不变，有计数器时切换为上报计数。W7 在组装后的 transcript snapshot 中可见，且不超提示词词预算。W8 通过 hygiene 门禁，基础 profile 中呈现空注册表。W9 为缓存键归一化与前缀规则持久化增加单元测试，并为打断流程的缩减增加 snapshot。每一项落地时按根指令附自己的 Agent Note 与对应检查。

## 与既有提案的关系

[Recallable compaction](2026-07-06-recallable-compaction.md) 持有回滚、会话内历史召回与缓存感知分块；本计划明确排除这些并服从该 Note。检索活动提案树未发现覆盖提醒强终止、报告下限、截断后缀约定、审批缓存或 token 计数器注入的 Note，因此本 Note 不取代任何既有提案。

## 已考虑的替代方案

仅在宿主侧采纳（每个内嵌宿主自行重实现机制）：否决——提示词契约与子代理机制会按宿主分叉，且 Strata 的实测表明宿主已经在绕过 harness 行为打补丁补偿。把每工具指导迁移进工具描述（Kimi 模型，每工具约 1.2 KB）：推迟——现行成文立场是跨调用指导放 prompt 侧，故 W7 先在 prompt 侧统一约定，迁移留作后续独立决策。硬编码阈值：被 Config 字段规则否决。

## 验收标准

[docs/research/EXECUTION_GOAL_AND_ACCEPTANCE.md](../../../../docs/research/EXECUTION_GOAL_AND_ACCEPTANCE.md) 的验收矩阵将 WP1–WP8 八行全部标"绿"且每格附命令级证据、其第 4 关终审四项审计（完整性、回归、越权、文档）零红灯，即本计划完成。该文档持有逐包验收标准，本 Note 不复制内容。

## 风险

本地窗口的提示词预算紧张：Strata 集成实测 web profile 的系统提示词加工具定义接近 32K 窗口中的 29K（Strata 工作副本 `integrations/harness/profile/cordis.patch.yml`），因此 W7 保持在 300 词以内、提醒文本保持简短。强终止可能切断对不稳定工具的合法重试：去重只匹配完全相等的参数，且终止消息指示改为文字总结而非继续调用。报告下限对每份短报告多花一次 provider 往返，在本地引擎上就是 prefill 时间：`floorContinuationAttempts` 默认 1，可设 0。按字符数计的下限对 CJK 文本有偏（200 个中文字符的信息量高于 200 个英文字符）。

## 待决问题

强终止默认值取 12（Kimi）还是对长自主运行取更高？报告下限按字符还是按估算 token 计（考虑 CJK 密度）？每工具指导是否在后续决策中迁移进工具描述，还是永久留在 prompt 侧？审批缓存仅会话级，还是持久化前缀规则要求其跨重启存活？字符估算器今天归哪个包所有，W6 是否应作为 provider 声明的能力放到 llm capability 之后——撰写本 Note 时未能确认归属包，设计阶段必须钉死。
