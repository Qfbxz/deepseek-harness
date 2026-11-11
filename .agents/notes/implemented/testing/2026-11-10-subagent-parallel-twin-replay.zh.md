# Agent Note: subagent-parallel 孪生回放确定性

Status: implemented

[English](2026-11-10-subagent-parallel-twin-replay.md) | 中文

## 问题

authored（手工编排）快照场景 `subagent-parallel` 跨多次运行间歇性失败。它的 golden 钉死了一份交叉的完成记录——父侧第一个调用的结果是 `BETA`、第二个是 `ALPHA`——只有当两处并发的调度竞态都恰好落在录制时的方向上，回放运行才能复现这份 golden：

- **`dsh-llm-replay` 按"首次调用顺序"把子脚本绑定到 live 会话**（见 [subagent-snapshot-replay note](2026-06-22-subagent-snapshot-replay.md)）。同一条 assistant 消息里的两个子代理会争抢第一次模型调用，任何一个 live child 都可能领到另一个 child 的脚本。`loadSessionScripts` 对已录制子脚本的排序是确定的（header `createdAt`，再按 id），但 live 绑定顺序由事件循环时机决定（`XXX(concurrent-subagents)`）。
- **harness 按 `createdAt` 排序 children。** 同一毫秒内创建的两个 child 打成平局，平局裁决比较的是全新随机的会话 id（`a.id.localeCompare(b.id)`），因此哪份产出日志落在 fixture 位置 1、哪份落在位置 2 是掷硬币。

WP6 时期为了让[同步骤重复调用复用](../feature/2026-11-10-wp6-methodology-prompt.md)不把两次委派折叠成一个 child，把两次委派改成了不同的（`ALPHA` 与 `BETA`）。不同的委派让两处竞态都变得可观测：绑定交叉时，父侧第一个调用拿到的是另一个 child 的回答；harvest 顺序翻转时，两份 child fixture 互相拿对方的内容做比较。只有两处竞态都复现录制方向时场景才绿。

## 决策

恢复[并行委派 note](../feature/2026-08-09-parallel-subagent-delegations.md)规定的孪生契约——只有可互换的孪生才能无竞态地回放——同时仍然拉起两个 live child：

- **两次委派是逐字节相同的孪生**（`description`、`prompt`、显式 `run_in_background: false`）。显式写出来不是风格问题：acp-agent 组合以 `backgroundMode: continuable` 运行委派工具，省略 `run_in_background` 会默认变成后台 continuable child，返回持久 id 而不是任务结果。
- **该场景启动专用 overlay**（`subagent-parallel.cordis.yml` 与其 `*cordis.snapshot.yml` 回放对应物），仅为这个场景禁用 `repeat-tool-reminder` guard。该 guard 的同步骤重复复用会把精确匹配 `(tool, canonical arguments)` 的重复调用直接用第一次调用的已录制结果应答，因此逐字节相同的孪生会被折叠回一个 child。guard 不注入 system-prompt 段、不注册任何工具，所以 overlay 组合出的 header 与 default class 逐字节一致，仍在 text-turn 的 pin 之下。
- **其余由确定性完成。** agent-loop 调度器按 model 顺序提交并行工具结果，因此不管哪个 child 先落定，父日志都是 `tool/call, tool/call, tool/result, tool/result`、两个结果都是 `BETA`。两个 child 的 transcript 除被规范化掉的值（会话 id、消息 UUID、时间戳）外完全相同，绑定竞态与 harvest 顺序竞态因此都变得不可观测。

golden 通过 `DSH_SNAPSHOT=refresh`（无密钥回放写回）重录，随后按位置恢复了已提交的 header 身份、事件时间与消息 UUID，因此 diff 只携带语义性改动。

## 已否决的替代方案

**用脚本长度或节奏强制稳定的完成顺序。** 否决：绑定发生在第一次模型调用时，脚本长度来不及起作用；harvest 平局裁决用的是随机会话 id。节奏只能改变哪个 child 先完成，改变不了哪个 child 绑定哪份脚本。

**对两份 child 日志做顺序无关断言。** 否决：共享套件按位置逐份比较 harvest 日志与 fixture。为单个场景重排或集合比较两行，等于在共享测试基建里写一个场景专属归一化器，还模糊了位置比较对其他所有场景的证明力。

**修基建：给 `dsh-llm-replay` 加显式的首次调用序号，外加确定性的 harvest 平局裁决。** 这是 `XXX(concurrent-subagents)` 点名的真正解法，但它是所有场景共同依赖的回放/harness 行为，远超一次场景稳定性修复的范围。推迟到真的出现需要不同并发 children 的场景为止；在那之前孪生契约就是成文规则。

## 后果

- 场景仍在一条 assistant 消息里驱动两个 live 并行 child，仍然证明组装后应用的 `tool/call, tool/call, tool/result, tool/result` 父 transcript 与 `PARENT_DONE` 回复。它不再能证明父侧哪个调用拿到哪个 child 的回答——在回放绑定下这个映射本质上不确定。
- 孪生 child 的消息是指纹歧义的，`stabilizeFixtureMessageIds` 无法在 refresh 时延续其已提交 UUID：未来任何一次 `DSH_SNAPSHOT=refresh` 都会重新随机化孪生 children 的消息 id。比较仍然全绿，因为归一化器会擦除所有 UUID；要字节稳定的 id 就需要重录时用过的同款按位置还原。
- repeat guard 的完整覆盖仍在其专属 `repeat-tool-reminder` 场景；本 overlay 只对一个组合禁用它，header 一致性守卫会 live 验证 overlay 仍组合出被 pin 的 default header。
