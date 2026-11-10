# 同模型下，为什么 Kimi 智能体的分析质量最高

——Kimi Code CLI vs Claude Code vs Codex vs DeepSeek-Harness vs Strata 源码级对比

> 导入说明：本文自 Kimi Code CLI 工作副本（`AGENT_HARNESS_COMPARISON.md`，2026-11-08 第二版）导入本仓库，供 harness 改造参考。属外部研究文档，不属本仓库文档分层与预算门禁管辖；采纳其中条目时，以 [.agents/notes/proposed/feature/2026-11-08-cross-harness-parity-program.md](../../.agents/notes/proposed/feature/2026-11-08-cross-harness-parity-program.md) 为决策记录，以同目录 [HARNESS_IMPROVEMENT_ROADMAP.md](HARNESS_IMPROVEMENT_ROADMAP.md) 为执行计划。

> 对比日期：2026-11-08（第二版：同日加入 strata 对比）
>
> 方法：六个只读子代理按统一 8 维框架（系统提示词 / 工具契约 / 上下文工程 / 主循环 / 子代理 / 错误反馈 / 人审 / 技能渐进披露）深挖源码——四个 harness 各一个，strata 拆为 agent 层与引擎服务层两个；关键结论均经人工抽查源码复核（路径+行号可查）。
>
> 说明：这是 harness 设计层面的因果分析，不是运行时 benchmark。"同模型下 Kimi 质量最高"是前提观察，本文回答的是 harness 差异如何解释这一观察。

## 0. 结论摘要

同一个大模型，智能体输出质量的上限由三件事决定：**模型能看见什么**（信息保真）、**模型被阻止做错什么**（行为纪律）、**模型做错后如何被拉回来**（恢复回路）。

四仓对比后，Kimi 质量优势不来自某一个"杀手锏"，而来自**七项机制的组合密度**——其中三项是 Kimi 独有或最完备的：

1. **方法论双通道注入**：系统提示词教方法论，工具描述随工具走且带反例——知识对任何模型生效，不绑死某个模型家族（Codex/Claude/DeepSeek 均不同程度绑死自家模型）。
2. **反退化护栏最完备**：同参数重复调用在第 3/5/8 次注入三级递增提醒、第 12 次强终止、同步去重复用（`src/kimi_cli/soul/toolset.py:153-156`）——这是长分析任务不"卡死循环"的直接原因。**DeepSeek-Harness 原样复刻了 [3,5,8] 阈值**（`packages/guard/repeat-tool-reminder/src/index.ts:46`），说明该设计已被同行认定为业界标杆。
3. **子代理结果质量下限**：子代理最终回复 <200 字符时强制续写一轮，要求补"技术细节/发现/父代理需要的信息"（`src/kimi_cli/subagents/runner.py:40-48`）——四仓唯一，直接抬高每次并行探查的回报质量。

另有四项 Kimi 做得好但对手各有单项亮点：结构化压缩 + 每步 checkpoint、上下文注入的"诚实性"（标注截断并给下一步）、动态注入的预算与节流、错误反馈可执行。

> 2026-11-08 增补：strata（本地推理引擎 + DeepSeek-Harness 集成封装）已纳入对比。它不参与"分析质量排名"，但其 32K 本地窗口下的实测从**需求侧**独立佐证了 §3.1/§3.6 的结论，见 §3.8。

## 1. 对比范围

| 仓库 | 路径 | 定位 | 技术栈 |
|---|---|---|---|
| Kimi Code CLI | `kimi/`（本仓库） | Python CLI 智能体，模型无关（kosong 抽象层） | Python 3.12+, Typer, asyncio |
| Claude Code | `claude-code桌面版原生代码/` | 官方 CLI 还原源码，深度绑定 Anthropic 基础设施 | TypeScript + React Ink + Bun |
| Codex | `codex/codex/` | OpenAI 官方 CLI，按模型分发提示词 | Rust (codex-rs) + npm 壳 |
| DeepSeek-Harness | `DeepSeek-Harness/` | 插件化 monorepo harness（Cordis DI） | TypeScript (59 包) |
| Strata（即 deepstrata） | `strata/` | 本地 DeepSeek V4.1/Qwen 推理引擎 + 桌面应用，以 DeepSeek-Harness 为 agent 后端（集成封装形态） | C++/Metal/SYCL 引擎 + Python serve + Node host |

同目录的 `cc-switch`/`codex-relay`/`codex-session-patcher`（辅助工具）、`strata` 的配套数据目录（`Strata-data`）、`加速prefill`（实验目录）不构成同维度对比。`dsh-infinite-gen-4` 是挂接在 DeepSeek-Harness 生态上的提示词插件（非 harness 本体），不纳入对比；strata 的 profile 中 vendor 了该插件属于上游生态事实，不影响 harness 层结论。

## 2. 五仓库 harness 画像

| 维度 | Kimi | Claude Code | Codex | DeepSeek-Harness | Strata |
|---|---|---|---|---|---|
| 系统提示词 | 14.3KB / ~2,239 词，8 节，规则密度高 | 静态 ~3.5K token + 36 个工具 prompt 共 133KB | 按模型分发 1,822–3,511 词，兜底 3,390 词 | **仅 ~2KB**（~300 词），规则散在工具指导 | 复用 DSH 注入机制，自写 ~400 token 人格段（`preset.mjs:41-50`） |
| 工具描述均长 | ~1.2KB/工具，**带反例与"何时不用"** | ~3.7KB/工具（Bash 达 21KB） | **极简**（exec_command 仅一句话） | 单句 + 100–350 字符指导段 | 工具 100% 复用 DSH（21 插件）；自写契约层：12 个开关组 + 人话审批翻译 |
| 上下文压缩 | 双阈值触发 + 6 级优先级结构化摘要 + XML 模板 + 每步 checkpoint | 五级管线 + 熔断器 | 一次性 handoff 摘要（426 字节 prompt，输入上限 20K） | 两级（剪枝 + LLM 7 段 checkpoint），摘要复用前缀命中 KV cache | DSH 压缩 + 自研 context-budget/fit：引擎 tokenizer 预检、实测 2.09 chars/token 校准、摘要永不切 tool-call 对 |
| 防退化护栏 | **3/5/8 三级提醒 + 12 次强终止 + 去重复用** | 提示词级规则（禁 sleep/poll 等） | 无专门机制 | 复刻 3/5/8 提醒（无强终止） | turn-guard 纯计数五阈值（搜索失败 3 / 计划 10·普通 25 / 重写 4 / 上下文 93% / 静默 85%） |
| 子代理 | 3 类型 + 200 字符质量下限 + git-context 预热 + 可 resume | 6 内置类型 + fork 共享 cache + "don't peek/race" 反幻觉 | 6 工具两代实现，深度/并发限制 | spawn/fork + 权限委派时冻结 | 复用 DSH delegation（spawn/fork/workflow-ptc）+ acp 外接 6 家 CLI（一 turn 一进程） |
| 模型耦合度 | **无**（kosong 抽象，行为不随模型分叉） | 高（cache 边界、strict mode、GrowthBook、ant-only 特性） | 极高（models.json 按模型分发模板/截断策略/工具形态） | 中（自身提示词薄，逻辑上"期待"被训练好的模型） | 高（绑定本地引擎 32K 实测基线与引擎 tokenizer/count_tokens） |

关于 strata 的定位：它**不是第五个竞争者，而是第五种形态**。其 agent 层全部行为来自外部固定组件 DeepSeek-Harness（DSH 0.2.1-alpha.3，pin commit + 漂移测试），strata 自写的是"宿主"——进程生命周期、profile 动态生成、12 个注入插件（8 自研 + 4 vendored）、纯算术守卫模块、NDJSON 事件投影，共约 7,361 行（`apps/host/server/agent/`）。工具实现、压缩引擎、持久会话、审批服务全部复用 DSH。它的独特价值在于：**在 32K 本地小窗口这个最严苛的约束下，把上下文工程做到了量化闭环**（详见 §3.8）。

## 3. 七个核心差异（按对分析质量的影响排序）

### 3.1 方法论"双通道注入"：知识随工具走，不随模型走 ★最核心

**分析质量的第一决定因素是模型是否被教会"怎么分析"。** Kimi 把方法论同时放在两个通道：

- 系统提示词 `src/kimi_cli/agents/default/system.md`（8 节：Prompt and Tool Use / Coding Guidelines / Research Guidelines / Working Environment / Project Information / Skills / Ultimate Reminders）明确教探索纪律：目录树只显示两级、"... and N more" 需自行探索（`system.md:89`）、子目录要先查 `AGENTS.md`（`system.md:121`）。
- 每个工具的描述外部化为 `.md` 文件且**带反例**：`glob.md:24-30` 有 "Bad example patterns"（`**` 会撑爆上下文、避开 node_modules）；`ask_user.md` 写明 "When NOT to use"；`bash.md`（3.5KB）含输出说明/安全守则/效率守则/可用命令清单。17 个工具描述共 ~19.9KB。

对比之下：

- **Codex** 把用法知识全放系统提示词（工具描述一句话），而其提示词按模型分发——第三方模型只能拿到通用兜底模板，用法知识与工具脱钩。
- **Claude Code** 工具描述最厚（均 3.7KB），但其质量优化（verification agent、REPL、numeric length anchors）多为 ant-only，外部构建拿不到完整能力。
- **DeepSeek-Harness** 静态文本仅 ~2KB，没有方法论层——它默认模型已被训练得"会用"，这恰恰在同模型对比中成为短板：**harness 的价值就在于让未经特调的模型也表现良好**。

> 关键洞察：Kimi 的提示词是"模型无关的方法论文本"，而 Claude/Codex 的提示词是"模型相关的调参产物"。换到同一个第三方模型时，前者的知识全量生效，后者的知识大半失效或失配。

### 3.2 反退化护栏：3/5/8 三级提醒 + 12 次强终止 ★独有完备

长分析任务最常见的失败模式是模型卡死循环（反复调用同一工具、反复读同一文件）。Kimi 的治理是三层的（`src/kimi_cli/soul/toolset.py:153-156`）：

- 第 **3** 次：注入换方法提醒；
- 第 **5** 次：注入"检视结果、改变参数"提醒；
- 第 **8** 次：注入"停止一切调用，改用文字总结"提醒；
- 第 **12** 次：强制终止该 turn；
- 同一 step 内完全重复的调用直接复用原结果不重复执行（`toolset.py:371-423`）。

跨仓证据链：DeepSeek-Harness 的 `repeat-tool-reminder` 守卫默认阈值就是 `[3, 5, 8]`（`packages/guard/repeat-tool-reminder/src/index.ts:46`），gentle→detailed 升级提醒的形态也一致——这是**同行对 Kimi 设计的直接背书**。Claude Code 只有提示词级的"禁 sleep/poll"规则，Codex 没有专门机制。分析任务动辄几十上百次工具调用，这个护栏是"分析能不能跑完、跑得深"的硬保障。

### 3.3 子代理结果质量下限：200 字符强制续写 ★四仓唯一

Kimi 的子代理最终回复 <200 字符时，强制续写一轮并给出明确补写要求："补技术细节与实现、详细发现与分析、父代理需要的全部重要信息"（`src/kimi_cli/subagents/runner.py:40-48`）。配合 explore 子代理启动时自动注入 `<git-context>`（remote/branch/脏文件/最近 3 条 commit），保证每次并行探查回传的是**有细节的报告而非一句话**。

对比：Claude Code 强调"子代理只回一条消息，用户看不见，你必须转述"（逼主代理消化），Codex/DeepSeek 回传结果消息但**均无质量下限**。在"用子代理并行深挖代码库"的分析场景里，这项设计直接决定单次探查的信息密度。

### 3.4 上下文压缩的结构化与防丢失深度

长分析必然触发压缩，压缩质量决定后半程分析质量。Kimi 的组合（`src/kimi_cli/soul/compaction.py`、`prompts/compact.md`、`kimisoul.py:1036/1447-1464`）：

- 双阈值触发（≥85% 窗口，或 +50K 预算溢出前）；
- 压缩 prompt 给 **6 级保留优先级**（当前任务状态 > 错误与解法 > 代码演化…）+ MUST KEEP/MERGE/REMOVE 规则 + XML 结构化输出模板；
- **每步落盘 checkpoint**，可回滚；压缩后自动注入仍活跃后台任务的快照，防信息静默丢失；
- 每次调用按剩余上下文动态计算输出预算（`llm.py:181-196`）。

对比：Codex 是一次性 handoff 摘要（426 字节 prompt，"给另一个 LLM 的交接总结"，单次输入上限 20K）——中段细节全靠一次摘要，分析任务细节保真弱；DeepSeek 的 7 段 checkpoint 结构不错且 KV-cache 感知（工程亮点），但其压缩只保留 16% 尾部原文、且方法论层缺失导致摘要"知道保留了什么"却"不知道该怎么用"；Claude Code 的五级管线 + 熔断器（连续失败 3 次熔断，注释记载曾有会话 3,272 次连续失败的教训）是全仓最精细的，但其行为依赖 Anthropic 私有 token 计数与 cache 基础设施。

### 3.5 上下文注入的"诚实性"：标注截断并给下一步

模型基于"它以为看见的全部"做推理，**谎报全量是分析错误的头号来源**。Kimi 系统性地消除这一类错误：

- 目录树注入时明说只显示两级、需要自行探索（`system.md:89`）；
- 工具输出统一 50K 字符/2000 字符每行截断，截断时追加 "Output is truncated" 并附**可执行下一步**（"use pagination or more specific queries"，`tools/utils.py:63-64`）；
- Shell 失败的 brief 附 stderr 尾部 5 行可执行上下文（`shell/__init__.py:123-131`）；
- ReadFile 限额 1000 行并回报总行数与被截断行号（`file/read.py:216-222`）。

对比：Codex 的截断警告带 original_token_count（结构化输出 schema，好设计）但它**没有原生文件读取工具**——大文件分析靠 shell cat + 10K token 截断，对"精读源码"这类任务天然吃亏；Claude Code 的超限落盘+路径预览是同类设计；DeepSeek 用 `[exit code: N]` + remedy 后缀（"re-read the file, then retry"），方向一致但覆盖面窄。

### 3.6 模型无关性：同模型对比的公平前提

Kimi 通过 kosong 抽象层做到行为不随模型分叉——系统提示词一套、工具一套、护栏一套，任何模型拿到的是**完整且一致的 harness**。反观三家：

- **Claude Code**：`USER_TYPE`/GrowthBook/feature() 三层分支交织（子代理报告明确定性"行为不可复现、难以审计"），cache 边界标记、strict mode、attestation header 均为 Anthropic 私有；换模型后这些机制整体失效，且 ~133KB 工具提示词的静态负载对非 Anthropic 模型是纯开销。
- **Codex**：models.json 按模型分发指令模板、截断策略、工具形态（10 个模型 10 套配置）；apply_patch 的 freeform Lark 文法为 GPT-5 系定制，非 OpenAI 模型没有等价编辑通路。
- **DeepSeek-Harness**：薄提示词策略在自家模型上有训练对齐兜底，换第三方模型后"何时不用"规范不统一的散点指导立刻显形（其自身报告列出的短板 1、4）。

> 换句话说：**其他三家是"为某个模型定制的躯壳"，Kimi 是"对任何模型都成立的操作系统"。** 同模型对比恰恰放大了这个差异。

### 3.7 错误反馈的可执行性（共性亮点，Kimi 覆盖最全）

四仓在这点上方向一致——都懂"错误信息要能指导模型自愈"：Claude 的 "File has not been read yet. Read it first..."；Codex 的沙箱拒绝→升级重试闭环；DeepSeek 的 remedy 后缀；Kimi 的错误分类标签 + 拒绝反馈回传 + 子代理被拒附"换方法/别重试/别绕过"指引（`approval.py:82-101`）。这不是差异项，但 Kimi 的覆盖面（工具/审批/子代理/网络四层都有对应回路）最完整。

### 3.8 strata 侧证：小窗口让重量级 harness 直接不可运行

strata 的 `integrations/harness/profile/cordis.patch.yml`（`llm-pi-ai` 条目注释块）记录了一个决定性实测：**DeepSeek-Harness 的系统提示词 + 工具定义在 32K 本地窗口里已占 ~29K token**，8K 输出预算会让每一轮以 "request exceeds the context window" 失败，只能把输出压到 2048。`strata_cli/launch/harness.py:173-216` 进一步实测了 8 个 harness 的提示词占用：Claude Code 15.6K（20 工具）、Codex 8.6K、opencode 7.4K、Hermes 12.9K（20 工具）、pi 1.5K（3 工具）——在 32K 窗口下这些是决定性数字。

这从需求侧独立验证了 §3.1 的结论：**当上下文受限时，"中等长度方法论提示词 + 工具知识随工具走 + 按需加载"是唯一能跑的架构**——Kimi 的设计在无约束环境下最优，在约束环境下变成"唯一可行"。

同时 strata 自研的小窗口上下文工程值得各家学习（`apps/host/server/agent/`）：

- **量化校准**：DSH 按 4 chars/token 定价，引擎实测真实 agent 流量为 2.09（一次会话引擎计 59,048 vs DSH 计 31,794），于是用引擎回报的真实 prompt 校准密度（`context-budget.mjs`）；
- **发送前真 tokenizer 预检**：调引擎 `count_tokens` 三态判定 send/summarize/too-large（`context-fit.mjs`）；
- **护栏全部"计数不信模型"**：turn-guard 五阈值各挂着对应的真实事故编号（#3623/#3684/#4244/AGENT-LOST）；
- **reply-cut 修复截断丢失**：流式跟踪工具草稿，被截时向模型注入"分次写"提醒自动续写（`reply-cut.mjs`）。

## 4. 反向解释：其他三家在同等条件下为什么吃亏

- **Claude Code**：单项工程最精细（提示词实证迭代——注释里内嵌 A/B 数据如 "29-30% FC rate vs v4's 16.7%"；prompt cache 工程登峰造极），但这些优势**全部以 Anthropic 基础设施为前提**。同模型换成第三方时：厚提示词变纯负载、cache 工程失效、feature 门控拿不到完整质量特性、行为分支不可控。
- **Codex**：上下文工程纪律最制度化（仓库 AGENTS.md 把"无重写、有界、≤10K/条、P0 评审"写成代码评审规则，落实为 ContextualUserFragment 架构），但知识传递通道单一（全在按模型分发的系统提示词里），且**无原生文件读取工具**——对一个以"读代码"为核心的分析型任务，这是结构性劣势。
- **DeepSeek-Harness**：循环卫生抄对了（3/5/8）、压缩结构不错，但**缺方法论层**是致命的：harness 静态文本 2KB 意味着分析"怎么系统地探索、怎么验证、怎么汇报"全靠模型自觉；另外主循环无轮次/步数上限、MCP 默认未接线。strata 作为其下游集成方，同样继承"无 checkpoint 回滚、无请求级重试"的缺口，只能靠宿主侧守卫部分弥补。

## 5. Kimi 自己的短板（诚实清单）

对比中也确认了 Kimi 的不足，说明"最高"不等于"无懈可击"：

1. web 工具描述极薄（`search.md` 67 字节、`fetch.md` 146 字节），与文件类工具精细度断层；
2. 压缩仅保留最近 2 条消息，中段细节完全依赖单次 LLM 摘要；
3. D-Mail（模型自助上下文管理）默认关闭，仅 okabe spec 启用；
4. 系统 prompt 14KB 全量常驻无分层加载；AGENTS.md 32KiB 全注入，长项目基础开销大；
5. token 估算用 chars/4，CJK 场景系统性低估，可能延迟触发压缩——strata 的引擎实测校准（2.09 chars/token）正是这一问题的极端化例证与解法。

## 6. 可迁移的启示

若要把其他 harness 改造到 Kimi 的水平，按投入产出排序：

1. 给工具描述补"反例 + 何时不用"（改动小、收益大，Codex/DeepSeek 最缺）；
2. 移植 3/5/8/12 防退化阶梯（DeepSeek 已证明可移植）；
3. 给子代理回传加质量下限与续写机制；
4. 把截断/注入处的"诚实性标注 + 可执行下一步"做成统一规范；
5. 把按模型分发的调参型提示词重构为模型无关的方法论型提示词。

strata 侧的完整汲取清单（含落地位置与优先级）已单独成文：`strata/docs/HARNESS_LESSONS.md`；执行计划见 `strata/docs/HARNESS_ROADMAP.md` 与本仓库 `docs/research/HARNESS_IMPROVEMENT_ROADMAP.md`。

## 7. 局限性说明

- 六个子代理报告均给出路径级证据，其中最关键的三个事实（3/5/8/12、200 字符下限、DeepSeek [3,5,8] 复刻）经主会话直接读源码复核无误；其余引用以子代理报告为准，未逐条复核。
- strata 两节（§2 表格、§3.8）以两份子代理报告为准，未逐条复核；其中 29K/32K 注释与 8-harness 提示词占用表均有明确路径可查证。
- 未做运行时 benchmark：本文论证的是 harness 设计与质量的因果机制，非量化排名。
- Claude Code 仓库为还原源码，外部构建与 ant 内部构建存在能力差异，部分"短板"可能只针对还原版。
