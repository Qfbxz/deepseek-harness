# @deepseek-ai/dsh-repeat-tool-reminder

[English](README.md) | 中文

这是一个仅提供建议的循环中断器，而非面向模型的工具：它不会出现在工具列表中，不会否决或改写调用，只增加三种行为。它监视每个 agent（智能体）的工具调用流，统计以完全相同的规范化参数连续调用同一工具的次数；达到所配置的连续次数时，它会注入逐级增强的提示，要求模型停止重复、重新阅读上一次结果，并改用其他方案或结束任务；达到 `forceStopStreak` 时，它会强制结束当前 turn，期间的完全相同 step 内重复调用会直接复用已记录的结果。在强终止阈值之下，究竟是换一种方式重试、收集更多证据还是完成任务，仍由模型决定：合理的重复调用既不会延迟，也不会受阻。决策记录见 [repeat-tool-reminder Agent Note](../../../.agents/notes/archived/feature/2026-07-08-repeat-tool-guard.md) 与 [WP1 循环卫生 Agent Note](../../../.agents/notes/implemented/feature/2026-11-10-wp1-loop-hygiene.md)。

## 配置

```yaml
- id: repeat-tool-reminder
  name: '@deepseek-ai/dsh-repeat-tool-reminder'
  config:
    thresholds: [3, 5, 8]        # default; consecutive counts that trigger a reminder
    include: []                  # tool-name patterns to track; empty ⇒ all tools
    exclude: [todo_write]        # tool-name patterns transparent to the chain
    argumentsPreviewChars: 500   # default; cap on arguments quoted in the detailed reminder
    forceStopStreak: 12          # default; consecutive count that force-stops the turn, 0 disables
```

插件加载时，`thresholds` 会对错误配置快速失败：空列表、非整数、小于 2 的值或重复值都会抛出错误，绝不静默回退到默认值；`argumentsPreviewChars` 同样只接受大于等于 1 的整数；`forceStopStreak` 只接受非负整数（`0` 表示关闭强终止，仅保留提醒阶梯）。系统会将列表按升序规范化；第一个阈值只发送简短的通用提醒，后续每个阈值都会发送详细版本，列出工具、连续次数和规范参数。参数内容截取前 `argumentsPreviewChars` 个字符，并附带省略字符数标记，避免循环中的 `write`／`edit` 载荷无限制进入下一次请求（链键始终比较完整的规范字符串；此上限只约束提醒，不影响检测）。

`include`／`exclude` 条目支持 `*` 通配符，并针对调用时实际存在的工具执行谓词判断，而不是引用注册表条目。因此，与当前任何已注册工具都不匹配的模式并非错误（未加载 MCP 工具的部署中，`exclude: [mcp_*]` 仍然有效）；这与 `toolOrder` 的引用目标检查不同。

## 链语义

链键为「`(tool name, canonical arguments)`」：规范化过程会对键进行深度排序，然后执行 `JSON.stringify`，因此仅属性顺序不同的参数对象会视为相同。若某次调用与上一条受跟踪调用相同，该 agent 的连续计数器递增；换成另一条受跟踪调用则重置为 1。

- **不受跟踪的调用对链透明。** 被 `include`／`exclude` 排除的调用既不递增计数器，也不重置计数器；因此，`grep X → todo_write → grep X` 仍算作连续两次 `grep X`，即使 `todo_write` 已被排除。这正是排除机制的价值：循环中穿插的记录类工具不能掩盖循环。
- **被拒绝的调用也计数。** 检测位于 `tools/post-execute`；即便调用被 `tools/pre-execute` 监听器拒绝，该事件也会运行。模型反复尝试被拒绝的调用，恰恰是需要打断的循环。
- **忽略没有 agent 的调用。** 直接调用 `ctx.tools.execute()` 的调用方没有需要提醒的模型，也没有可作为键的活跃 agent 对象。
- **按 agent 分键。** 工具注册表位于上下文层级，subagent 会交错通过同一个 waterfall（瀑布式事件），因此每条链使用 `WeakMap<Agent, Chain>`，以活跃 agent 对象为键。一个 agent 的重复调用绝不会触发另一个 agent 的提醒。用户提示词（`agent/pre-step`）会重置提交该提示词的 agent 链；对象生命周期会自然限制弱引用条目的寿命，无需 dispose（资源释放）监听器。
- **仅驻留内存。** 从持久化恢复的会话会从一条全新的链开始：guard 是启发式提醒，并非有日志记录的不变量；提醒会延后，这是可接受的代价。

## 强终止

达到 `forceStopStreak`（默认 12，`0` 关闭）时，guard 强制结束当前 turn。判定发生在 `tools/pre-execute`，即该次阈值调用派发之前：guard 从已提交的链上窥探即将达到的连续次数，达到或超过阈值时为该执行标记 `concludeTurn`——这是 agent-loop 既有 turn 终止接口，注册表物化该调用结果时读取——因此 turn 经由普通结束路径收尾。指令本身与提醒走同一通道（挂在结果 `additionalContexts` 上，在该步骤工具结果之后作为注入 `user/message` 送达），模型在恰好再看到一次携带 `停止工具调用，改用文字总结当前进展与结论` 及对应连续次数的请求后，turn 关闭。

计数仍发生在 post-execute，上面的拒绝调用计数保证是结构性的；pre-execute 窥探按模型顺序串行执行，与已提交计数一致。恰好在阈值处被拒绝或失败的调用无法携带成功结论（`concludesTurn` 只存在于成功结果上），此时停止指令仍会挂在该结果上，同一链的后续每次重复都保持高于阈值并重新武装强终止——阈值处或之后第一次成功提交的结果会结束 turn。同 step 重复（见下）仍会计入链，一次尝试就是一次尝试。

## 同 step 重复复用

在一个 step 之内（从 `agent/pre-step` 到 `step/end`），首次执行的 `(tool, canonical arguments)` 组合会记录其结果；第二次出现相同键的调用在执行入口（`tools/execute`）直接返回已记录结果，不调用工具体。匹配是精确结构相等，复用链的规范化：深度属性顺序被归一化，因此仅重排的对象算重复；近似变体、子集与不同值都是不同调用，照常执行。复用结果携带注释 `duplicate of an earlier call in this step; recorded result reused` 作为注入上下文，在下一次请求中对模型可见，且重复调用仍会计入重复链。与首次调用仍在同批执行中的在途重复复用其派发结果，而不是与工具体竞速；首次调用的调度失败会传播给重复调用，而不是伪造第二个结果。拒绝、派发前中止以及其他未经过 `tools/execute` 的管线路径既不会被记录，也不会被复用。

## 提醒传递

提醒通过 post-execute 决策中的 `additionalContexts`（来源为 `{kind: 'plugin', plugin: 'repeat-tool-reminder'}`）传递，绝不替换 `content`；用于审计的 `tool/result` 事件仍保留工具自己的输出。循环会缓冲这段上下文，并在该步骤的工具结果之后将其作为注入的 `user/message` 追加；会话会将它渲染为普通的合成用户消息。因此，提醒对模型可见、带有来源归属，并且无需增加会话事件即可从会话日志重建。guard 始终通过 `next()` 委派，并将自己的提醒放在下游决策的上下文数组之前（两种结果都适用：被阻止的调用也会收到提醒）；每个条目保留自己的来源和元数据。强终止指令与重复复用注释经由同一通道、携带同一来源。

## 模型体验

### 首个阈值的上下文消息

#### 模型看到的内容

达到第一个配置的连续重复阈值时，对应 agent 会收到以下提醒。系统不会添加工具 schema 或正常调用文本。

##### 首个阈值提醒

```markdown
You are repeating the exact same tool call with identical arguments. Carefully analyze the previous result before calling again: if the task is not complete, try a different approach or different arguments instead of repeating the call.
```

#### Token 影响

达到阈值前为零 token。提醒会作为该 agent 的历史记录保留。

#### KV Cache 影响

仅追加；新出现的内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

### 后续阈值的上下文消息

#### 模型看到的内容

达到后续阈值时，agent 会收到以下详细提醒模板。受上限约束的参数预览严格以 `… (+<omitted> more chars)` 结尾。

##### 后续阈值提醒

```markdown
Repeated tool call detected:
- tool: <toolName>
- consecutive_calls: <count>
- arguments: <canonicalArguments>
The repeated calls are not making progress. Do not call this tool with these exact arguments again. Inspect the latest result and choose a different action, different arguments, or finish the task if enough evidence has been gathered.
```

#### Token 影响

每条提醒都会作为历史记录保留；`argumentsPreviewChars` 会限制随数据变化的参数文本长度，而各 agent 仍使用独立计数器。

#### KV Cache 影响

仅追加；新出现的内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

### 强终止上下文消息

#### 模型看到的内容

达到 `forceStopStreak`（默认 12）时，agent 收到以下强终止消息，随后在指令送达后结束当前 turn。

##### 强终止消息

```markdown
停止工具调用，改用文字总结当前进展与结论
(Force stop: <count> consecutive identical calls to <toolName>.)
```

#### Token 影响

每次强终止一条固定消息；送达后 turn 即结束。

#### KV Cache 影响

仅追加；新出现的内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

### 重复复用注释

#### 模型看到的内容

同一 step 内第二次出现精确相同的 `(tool, arguments)` 调用时，会收到第一次调用的已记录结果，并在下一次请求中看到以下注释。

##### 重复复用注释

```markdown
duplicate of an earlier call in this step; recorded result reused
```

#### Token 影响

每次复用一条固定注释；复用结果内容与原调用结果共享。

#### KV Cache 影响

仅追加；新出现的内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **仅检测精确匹配**：规范化过程会对键进行深度排序，因此近似变体（稍作修改的路径、值内增加的空白）可以绕过链，也不算重复；在没有需求证据前，不采用模糊匹配。
- **压缩（compaction）不会重置链**：跨越压缩检查点的链会继续计数。
- **在途重复复用派发结果**：与首次调用同批并行的在途重复会复用其策略前置的派发结果；只有首次调用提交之后发生的复用才携带最终（策略后）结果。
- **Code Mode 子派发按同一规则复用**：`run_code` 程序在同一 step 内以完全相同参数调用同一工具两次时，第二次得到已记录结果；需要新鲜读取的程序应改变参数或跨 step 调用。
- **subagent 之间不共享链**：链与复用表始终按 agent 隔离；即使父 agent 与其 subagent 重复相同调用，也不会合并计数。
- **合理的幂等轮询超过阈值后仍会收到提醒**：可通过 `thresholds`／`exclude`／`forceStopStreak` 配置释放压力。
- **超过最高阈值后提醒阶梯不再发声**：提醒只在精确达到所配置的次数时触发；阶梯之外的边界是 `forceStopStreak` 强终止。
