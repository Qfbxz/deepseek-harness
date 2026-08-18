# 2026-08-16 会话摩擦修复（petro-agent 事故复盘）

## 背景

一份导出的 DPOS 会话（dsh-session-session-b5b7304a）记录了一个下午、24 轮中反复出现的 harness 摩擦：11 个自行归类的错误家族，其中数个在多次「根治」后仍然复发。本次修复其中四个位于 harness 源码内的问题。其余家族要么已在 HEAD 修复（rc.6 裸 `Symbol()` 调度器分裂，现为 `Symbol.for` 并带 core/tools 回归测试），要么属于环境侧（~/.dsh profile hoist 事故），要么只涉及模型纪律（内联程序的 JS 语法失误——那里的结构性免疫是 sh.mjs 模块模式，属于用户空间约定而非 harness 代码）。

## 变更

1. **run_code 与 bash 的 description 改为可选**（packages/core/tools、packages/shell/tool-bash）。缺失或空白的 `description` 不再让调用以 `missing required property "description"` 失败——这是该会话中最高频的模型侧失误（复发 5 次以上），且 bash 的该错误在 run_code 程序内嵌套 `tools.bash({command})` 时持续触发。两处 schema 均标记可选；`presentCall` 从载荷本身派生标签（run_code：程序首个有效行 `deriveRunCodeTitle`；bash：命令首行 `deriveBashDescription`——均导出以保证回放确定性）；run_code 的 SDK 说明文本改述为「可选但建议提供」。原空白拒绝测试替换为省略场景覆盖。workflow 的 `meta.description` 保持必填：它是工作流的身份数据而非 UI 标签。

2. **按语言分档的 token 格式化未随本分支落地**：其依附的两行 dock 路线已被单行省略+Tooltip 的 StatsLine 形态取代，HEAD 形态的组件不接 `activeLocale` 席位；该机制随下一次 dock band 改动回归。

3. **可执行的 grep 失败信息**（tool-fs-search）。搜索目标缺失时保留 rg stderr 摘要，但补充下一步动作（对照会话工作区检查路径后重试）；SEARCH_ABORTED 点名补救手段（收窄 pattern / 增加 include / 限定 path），不再只给裸的中止字符串；正则被拒时点名转义补救（字面量元字符需 \\+ \\* \\()，让携带裸算式的交替式在下一调用自纠。此前这些报错都读起来像内部故障，诱发了会话中的盲目重试。

4. **read 缺失文件与 offset 越界指引**（tool-fs read-target、read-render）。`read` 不存在的文件时，`FS_NOT_FOUND` 附带恢复规则：对照会话工作区核实路径，或——当任务切片本就要求创建该文档时——直接 `write`（观察策略下全新写入走 `createIfAbsent`，无需先读）。`offset` 超出文件行数时点名有效范围与动作（以 offset ≤ N 重读，或从头读），不再只给行数——针对已缩短文件或记错的 spill 文件的一次自纠。「创建意图 ⇒ 直接写」的判断规则本身属于 agent 纪律：先读后写只适用于修改既有文件。

5. **run_code 诊断中的解析失败提示**（code-runtime-worker-thread）。程序体 SyntaxError 现在输出消息加补救提示（修正语法，或先写文件再以最小内联体调用）；合成函数体的栈被丢弃，因为其帧不含位置信息。类型剥离入口（`stripTypeScriptTypes`，amaro 的 SyntaxError 同样不带行列）附加同一提示，并尽力定位：一段扫描点名未闭合字符串/模板字面量的起始行——此类失败的主流形态。此前 `Expected ',', got '<eof>'` 毫无上下文地到达模型。

composer dock 的两行统计条布局未随本分支落地（同第 2 条的形态取代）。

## 验证

- pnpm vitest run：code-mode/ts-types/py-types（152）、tool-fs-search（146）、tool-fs（321）、code-runtime（116，含未闭合字面量定位两例）、chat-stats + context-meter（29）。
- pnpm run typecheck 通过。
- pnpm run test:gui：3789 通过；2 个 HEAD 既有失败（chat-branch-tails 缓存命中字符串、community/dsh-git-graph 的 ui-theme 滚动条重绑定）——经 `git stash` 验证在 HEAD 即红，本次未触碰。
