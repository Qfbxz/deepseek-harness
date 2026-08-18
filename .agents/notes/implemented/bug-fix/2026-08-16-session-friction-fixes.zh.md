# Agent Note：会话摩擦修复（petro-agent 事故复盘）

Status: implemented

[English](2026-08-16-session-friction-fixes.md) | 中文

## 问题

一份导出的 DPOS 会话记录了一个下午、24 轮中反复出现的 harness 摩擦：11 个自行归类的错误族，其中数个在「治愈」后仍再触发。四个住在 harness 源码里：最高频的模型侧失误是工具 description 缺失或空白（复发 5+ 次；bash 的该错误在 run_code 程序内嵌套调用时持续触发并废掉整个程序）；grep 与 read 失败读起来像内部故障、诱发盲目重试；程序体解析失败以光秃秃的 `Expected ',', got '<eof>'` 到达、零上下文。其余族已在 HEAD 修复（rc.6 裸 `Symbol()` 调度器分裂，现 `Symbol.for` 带回归 spec）、属环境侧（~/.dsh profile 提升事故）、或仅模型纪律（内联程序里的 JS 语法滑失——结构性免疫是先写文件的约定，属用户侧模式而非 harness 代码）。

## 决策

1. **run_code 与 bash 的 description 改为可选**（packages/core/tools、packages/shell/tool-bash）。两处 schema 标记可选；`presentCall` 从载荷派生标签（run_code：程序首个有效行 `deriveRunCodeTitle`；bash：命令首行 `deriveBashDescription`——均导出保证回放确定性）；run_code SDK 说明文本改述为可选但建议提供。原空白拒绝测试替换为省略路径覆盖。workflow 的 `meta.description` 保持必填：它是工作流身份数据而非 UI 标签。
2. **可执行的 grep 失败信息**（tool-fs-search）。搜索目标缺失保留 rg stderr 摘要但补下一步动作（对照会话工作区核实路径后重试）；SEARCH_ABORTED 点名补救手段（收窄 pattern / 增加 include / 限定 path）而非裸中止串；非法正则点名转义补救（字面元字符需转义），携带裸算式的交替式在下一调用自纠。
3. **read 缺失文件与 offset 越界指引**（tool-fs read-target、read-render）。`read` 不存在的文件时 `FS_NOT_FOUND` 附带恢复规则：对照会话工作区核实路径，或——当任务切片本就要求创建该文档时——直接 `write`（观察策略下全新写入走 `createIfAbsent`，无需先读）。`offset` 超出文件行数时点名有效范围与动作（以 offset ≤ N 重读，或从头读），不再只给行数——针对已缩短文件或记错 spill 文件的一次自纠。「创建意图 ⇒ 直接写」的判断规则本身属 agent 纪律：先读后写只适用于修改既有文件。
4. **run_code 诊断中的解析失败提示**（code-runtime-worker-thread）。程序体 SyntaxError 输出消息加补救提示（修正语法，或先写文件再以最小内联体调用）；合成函数体的栈被丢弃，因其帧不含位置。类型剥离入口（`stripTypeScriptTypes`，amaro 的 SyntaxError 同样无行列）附加同一提示并尽力定位：扫描点名未闭合字符串/模板字面量的起始行——此类失败的主流形态。

按语言分档的 token 格式化与两行 composer-dock 统计条未随本分支落地：两行 dock 路线已被单行省略+Tooltip 的 StatsLine 取代，HEAD 形态组件不接 `activeLocale` 席位；两者随下一次 dock band 改动回归。

## 备选方案

- **保持 description 必填、改进报错文案。** 失败仍耗一次往返，且 token 压力下模型未必总能补上；派生标签直接消灭失败类别而非描述它。
- **仅 UI 层派生标签。** 标签将依赖渲染期状态，会话日志不再决定模型所见；在「从参数展示」处派生保住 model-visible ⟺ logged。
- **解析错误带源映射位置重抛。** 剥离器不给可映射偏移；线性扫描已点名未闭合字面量行，无需耦合 amaro 内部。

## 影响

无 description 的调用在 UI 头部显示命令/程序首行而非人工摘要——对终端卡片本就按命令命名的标签而言可接受。搜索与 read 失败携带下一步动作，把盲目重试变成单次纠正调用。解析失败自诊断：模型能区分程序文本损坏与工具调用损坏，并按点名行行动。

## 测试

- pnpm vitest run：code-mode/ts-types/py-types（152）、tool-fs-search（146）、tool-fs（321）、code-runtime（116，含未闭合字面量定位两例）、chat-stats + context-meter（29）。
- pnpm run typecheck 干净。
- pnpm run test:gui：3757 通过；两个 goal.snapshot 失败为 master 既有（stderr 中 SQLite ExperimentalWarning），已在原始 `99f6f02fec` 上以 `git stash` 验证为红，此处未触碰。