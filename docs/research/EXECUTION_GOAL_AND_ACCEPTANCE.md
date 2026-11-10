# 执行 Goal 与验收规范（WP1–WP8）

> 用途：本文是执行会话的 goal 合同与评审依据。执行会话**必须先通过第 0 关理解门禁，才允许写第一行代码**；此后逐 WP 按"执行纪律 → 验收矩阵 → 证据格式"推进。
>
> 文档链（按序必读）：证据 [AGENT_HARNESS_COMPARISON.md](AGENT_HARNESS_COMPARISON.md) → 决策 [.agents/notes/proposed/feature/2026-11-08-cross-harness-parity-program.md](../../.agents/notes/proposed/feature/2026-11-08-cross-harness-parity-program.md) → 计划 [HARNESS_IMPROVEMENT_ROADMAP.md](HARNESS_IMPROVEMENT_ROADMAP.md) → 本文。兄弟仓库 strata 的配套执行合同在其 `docs/EXECUTION_GOAL_AND_ACCEPTANCE.md`。

## Goal 声明（可直接作为 goal 的 objective 与完成判据）

**Objective**：在 DeepSeek-Harness 工作副本严格落地 `docs/research/HARNESS_IMPROVEMENT_ROADMAP.md` 的 WP1–WP8：按本文顺序逐 WP 实现，每个 WP 独立提交；每个 WP 通过机械门禁、行为验收、测量验收、文档验收四列；终审四项审计零红灯。

**Completion criterion**：(1) 验收矩阵 8 行全部标记"绿"，每格附命令级证据（命令 + 关键输出行）；(2) `git log` 显示恰好 8 个独立 WP 提交，每个含 Agent Note 与新增/更新 snapshot；(3) 越权审计通过（禁区文件零改动）；(4) 全量 `pnpm run test` 与 `pnpm run test:snapshot` 通过。四条缺一即 goal 未完成。

## 第 0 关：理解门禁（未通过不得写代码）

1. 按文档链顺序通读四份文档；允许 re-read，不允许跳读。
2. 产出**理解确认表**（放在第一个 PR 描述中）：对每个 WP 填五行——改什么 / 落点文件（精确路径）/ Config 字段名+默认值+校验规则 / 验收测试清单 / 禁止事项。
3. 完成**理解十题**（自答后对照文末答案键自判；任何一题答错 → 回读对应文档并重答，全部正确前禁止开工）：

- Q1 WP1 强终止的默认阈值是多少？由哪个 Config 字段控制？取 0 的语义是什么？
- Q2 同 step 去重的匹配语义是什么？什么样的调用**不**算重复？复用时必须附什么说明？
- Q3 WP3 截断通知必须包含哪三个要素？工具错误截断采用什么约定？
- Q4 WP4 熔断字段名、默认值、触发后的三件事分别是什么？对现有 7 段 checkpoint 结构的要求是什么？
- Q5 WP5 为什么必须先做设计确认？计数能力挂在哪里？provider 无计数器时的行为要求是什么？
- Q6 WP6 方法论段的词预算、四条内容、总增量上限分别是什么？
- Q7 本计划"明确不做"的三项是什么？各归谁管？
- Q8 每个工作包的提交纪律包含哪五个要素？
- Q9 WP7 基础 bundle 挂载 MCP 后的默认注册表状态与配置错误的失败语义是什么？
- Q10 WP8 审批缓存的键是什么？哪些前缀形态禁止持久化？

## 执行纪律

- 顺序：WP1 → WP2 → WP3 → WP4 →（WP5 设计确认 → 实现）→ WP6 → WP7 → WP8。WP1–4 与 WP6–8 之间无技术依赖，但**不得合并提交、不得并行到同一分支**。
- 一 WP 一 PR；提交信息含 WP 编号；PR 描述含该 WP 的理解确认表与证据清单。
- 禁区（终审越权审计对象）：`vendor/`、全部 vendored 插件（含 dsh-infinite-gen-4）、recallable-compaction 提案范围、`agent-loop` 核心调度语义、"把工具指导迁进工具描述"。
- 硬规则：随部署变化的取值必须是校验过的 `Config` 字段；配置错误加载期响亮失败；遇歧义停下记录问题，禁止猜测实现。
- 证据规则：每条验收必须出示"命令 + 关键输出行"；禁止"应当已通过"式声明；未运行的验证必须如实标注"未运行"。

## 验收矩阵

| WP | 机械门禁（全绿+附命令） | 行为验收（场景级） | 测量验收 | 文档验收 |
| --- | --- | --- | --- | --- |
| WP1 | `pnpm run test`、`typecheck`、`test:snapshot -t <wp1>` | snapshot 含 3/5/8 阶梯与 12 强终止消息；预算事件模型可见；去重相等/不相等两单测；`forceStopStreak=0` 与 `maxToolCallsPerTurn=0` 关闭语义各一测 | 无 | 包 README 更新；Agent Note |
| WP2 | 同上 | 短报告续写恰一次；长报告不触发；`floorContinuationAttempts=0` 不触发 | 无 | 同上 |
| WP3 | 同上 | 剪枝通知含原始大小+头尾大小+下一步句；错误截断同后缀 | 无 | 同上 |
| WP4 | 同上 | 摘要含优先级排序与 KEEP/MERGE/REMOVE；熔断恰在第 N 次停止；失败后用户输入可继续（keyless 回放） | 无 | 同上 |
| WP5 | 同上 | 无计数器 provider 全部 snapshot 不变；有计数器 fixture 预算改用上报值 | 设计确认结论写入 Agent Note（估算器归属包、能力挂载点） | 同上 |
| WP6 | 同上 + `doc-sync` | 组装 transcript snapshot 可见方法论段与工具指导新子节 | 词预算校验通过；系统提示词总增量 ≤2KB（附量化脚本输出） | 同上 |
| WP7 | 同上 + `hygiene` | headless snapshot 呈现空注册表；配置错误加载期失败 | （有 key 时）fixture MCP 服务器 e2e 一轮 | 同上 |
| WP8 | 同上 | 缓存键归一化单测；前缀持久化单测含禁止形态拒绝；打断缩减 snapshot | 无 | 同上 |

## 第 4 关：终审四审计（全部 WP 完成后）

1. **完整性**：对照 roadmap 工作包表逐项核销，不允许"部分完成"或"留待后续"。
2. **回归**：全量 `pnpm run test` + `pnpm run test:snapshot` 通过。
3. **越权**：`git diff --stat` 对照禁区清单 = 零改动。
4. **文档**：每个 PR 有 Agent Note；受影响 README/JSDoc 同步；`pnpm run doc-sync` 绿。

## 审查协议（评审会话使用）

- 红队规则：逐项要求执行会话出示证据；**抽查不少于 3 个 snapshot diff 原文**；`grep` 新增阈值数字确认全部走 Config 校验（无散落硬编码）；核对每项默认值与本文一致。
- 不通过处置：任一格红 → 打回该 WP 修复，不得进入下一 WP；连续两格红 → 暂停执行，回读第 0 关后重新自答理解十题。
- 证据格式统一为：命令 → 关键输出行 → 一句结论。

## 理解十题答案键（评审判分依据）

- A1：默认 12；字段 `forceStopStreak`；`0` 表示关闭强终止（只保留提醒阶梯）。
- A2：`(tool, arguments)` 结构化完全相等才算重复；近似/子集/重排参数不算；复用时附注 `duplicate of an earlier call in this step; recorded result reused`。
- A3：原始大小 N、保留 head/tail 大小、下一步指引句（re-read specific ranges to page through the middle）；工具错误截断采用同一后缀约定。
- A4：`maxConsecutiveFailures` 默认 3；触发后停止自动压缩、抛出可见错误、会话保持可用（用户输入不阻塞）；7 段 checkpoint 结构不变，只加保留优先级排序与 MUST KEEP/MERGE/REMOVE 指令。
- A5：字符估算与引擎实测偏差过大（实测 2.09 chars/token vs 折算假设）；能力挂在 llm capability、由 provider 声明（如 Strata worker 的 `count_tokens`）；无计数器时行为必须与今天完全一致（字符估算兜底）。
- A6：≤300 词且加校验；四条为：先探索后结论、进入子目录先查该目录 AGENTS.md、先验证后声称、引用代码给 `path:line`；系统提示词总增量 ≤2KB（附脚本证据）。
- A7：压缩回滚/历史召回/缓存感知分块（归 recallable-compaction 提案）；工具指导迁进工具描述（推迟的独立决策）；vendored 插件（含 dsh-infinite-gen-4，禁止触碰）。
- A8：独立 PR、提交信息含 WP 编号、附 Agent Note、附新增/更新 keyless snapshot、`pnpm run test`+`typecheck`+`doc-sync` 全绿。
- A9：默认空注册表；配置错误在加载期响亮失败，不静默跳过。
- A10：归一化请求形态（工具 + 归一化参数）；`rm`、heredoc、通用解释器（如 `python3`）禁止持久化。
