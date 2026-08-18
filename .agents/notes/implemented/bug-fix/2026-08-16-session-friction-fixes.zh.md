# 2026-08-16 会话摩擦修复（petro-agent 事故复盘）

## 背景

一份导出的 DPOS 会话（dsh-session-session-b5b7304a）记录了一个下午、24 轮中反复出现的 harness 摩擦：11 个自行归类的错误家族，其中数个在多次「根治」后仍然复发。本次修复其中四个位于 harness 源码内的问题。其余家族要么已在 HEAD 修复（rc.6 裸 `Symbol()` 调度器分裂，现为 `Symbol.for` 并带 core/tools 回归测试），要么属于环境侧（~/.dsh profile hoist 事故），要么只涉及模型纪律（内联程序的 JS 语法失误——那里的结构性免疫是 sh.mjs 模块模式，属于用户空间约定而非 harness 代码）。

## 变更

1. **run_code 与 bash 的 description 改为可选**（packages/core/tools、packages/shell/tool-bash）。缺失或空白的 `description` 不再让调用以 `missing required property "description"` 失败——这是该会话中最高频的模型侧失误（复发 5 次以上），且 bash 的该错误在 run_code 程序内嵌套 `tools.bash({command})` 时持续触发。两处 schema 均标记可选；`presentCall` 从载荷本身派生标签（run_code：程序首个有效行 `deriveRunCodeTitle`；bash：命令首行 `deriveBashDescription`——均导出以保证回放确定性）；run_code 的 SDK 说明文本改述为「可选但建议提供」。原空白拒绝测试替换为省略场景覆盖。workflow 的 `meta.description` 保持必填：它是工作流的身份数据而非 UI 标签。

2. **按语言分档的 token 格式化**（ui-conversation）。`formatTokens` 接受活动语言：zh 用万/亿两档（5,600 / 8.6 万 / 321 万 / 3.11 亿——与周边文案一致的单位），en 保持 K/M/B 并在十亿级滚入 B 而非拉长 M（即会话中 310.95M 一类的总量）。语言经注册处 `ctx.locale` 闭包以 `activeLocale` 注入回调流入（composer bar + stats dock），符合「inject 返回普通回调」的 slots 规则。ContextMeter 同步接入该席位用于占用率数字。

3. **可执行的 grep 失败信息**（tool-fs-search）。搜索目标缺失时保留 rg stderr 摘要，但补充下一步动作（对照会话工作区检查路径后重试）；SEARCH_ABORTED 点名补救手段（收窄 pattern / 增加 include / 限定 path），不再只给裸的中止字符串；正则被拒时点名转义补救（字面量元字符需 \\+ \\* \\()，让携带裸算式的交替式在下一调用自纠。此前这些报错都读起来像内部故障，诱发了会话中的盲目重试。

4. **read 缺失文件与 offset 越界指引**（tool-fs read-target、read-render）。`read` 不存在的文件时，`FS_NOT_FOUND` 附带恢复规则：对照会话工作区核实路径，或——当任务切片本就要求创建该文档时——直接 `write`（观察策略下全新写入走 `createIfAbsent`，无需先读）。`offset` 超出文件行数时点名有效范围与动作（以 offset ≤ N 重读，或从头读），不再只给行数——针对已缩短文件或记错的 spill 文件的一次自纠。「创建意图 ⇒ 直接写」的判断规则本身属于 agent 纪律：先读后写只适用于修改既有文件。

5. **run_code 诊断中的解析失败提示**（code-runtime-worker-thread）。程序体 SyntaxError 现在输出消息加补救提示（修正语法，或先写文件再以最小内联体调用）；合成函数体的栈被丢弃，因为其帧不含位置信息。此前 `Expected ',', got '<eof>'` 毫无上下文地到达模型。

另有：composer dock footer 以带 2px 间距的 `statsBand` 列包裹 dock 条目，使堆叠的插件条（内置统计行 + dsh-usage-stats 一类市场插件）保持可见间隔，不再读成一整面数字墙——即会话中统计文本粘连的问题。

## 验证

- pnpm vitest run：code-mode/ts-types/py-types（152）、tool-fs-search（146）、tool-fs（321）、code-runtime（114）、chat-stats + context-meter（29）。
- pnpm run typecheck 通过。
- pnpm run test:gui：3789 通过；2 个 HEAD 既有失败（chat-branch-tails 缓存命中字符串、community/dsh-git-graph 的 ui-theme 滚动条重绑定）——经 `git stash` 验证在 HEAD 即红，本次未触碰。
