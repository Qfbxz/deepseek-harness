# Agent Note: WP5 provider-declared token counter

Status: implemented

[English](2026-11-10-wp5-provider-token-counter.md) | 中文

## Problem

跨 harness 对齐程序（[gap G4，条目 W6](../../proposed/feature/2026-11-08-cross-harness-parity-program.md)）测得：本 harness 用固定字符启发式为上下文压力计价——每 token 四个字符加结构开销——而引擎 tokenizer 实测真实 agent 流量约为每 token 2.09 个字符：一次会话引擎计 59,048 token，而 harness 只计 31,794。所有建立在估算之上的预算与压缩触发都会在真实压力约一半处动作。提案还留下两个必须先回答的设计问题：字符估算器归属哪个包，以及提供方声明的计数能力挂载在哪里。

## Decision

**估算器归属确定为 `packages/llm/token-meter`。** `estimate.ts` 是唯一的启发式模块（固定密度加结构开销），`ctx.tokenMeter.measure()`/`estimateMessage()` 服务面是消费方为内容计价的唯一途径。任何消费方都不直接 import 估算器；所有定价决定都留在 meter 内部。

**计数能力以可选适配器方法挂载在 llm capability 上。** `LlmAdapter` 声明 `countTokens?(provider, model, request, signal?): Promise<number>`，基类不提供实现——与 `providerRetryPolicy()` 相同的缺省缺席模式。`LlmRuntime.countTokens()` 转发到该路由的适配器，适配器未声明该能力时返回 `undefined`：缺席是需要调用方定价处理的事实，从不是错误。运行时在该 wire 边界校验适配器返回值——非负安全整数，否则以 `LlmError` `INVALID_TOKEN_COUNT` 拒绝——与精确模型元数据校验同构。请求类型 `LlmCountTokensRequest` 携带 `messages`、可选 `system` 与可选 `tools`，使计数能覆盖完整请求 envelope。随产品交付的 DeepSeek 适配器有意不声明该能力；声明支持是提供方侧决策，记录在 Alternatives，pi-ai 适配器已针对暴露计数端点的引擎声明了它（[llm-pi-ai countTokens](2026-11-11-llm-pi-ai-count-tokens.md)）。

**消费接线走 compaction-basic，它本就同时注入两个服务。** 路由适配器声明计数时，压力路径上的每一次阈值判定——初始检查、模型无关剪枝后的重测、重试循环内的每次收敛重测——都为当前 envelope（已记录标头的 system 与 tools 加上完整派生的表层消息）取一份新的提供方计数并传入 `measure()`。失败的计数发出警告并回退到字符估算；被取消 signal 赢得的计数重新抛出；计数失败从不推进连续失败熔断器，因为它们是定价输入失败，不是压缩尝试。溢出路径不需要计数（其范围选择只读逐节点价格），手动 `compactNow()` 没有阈值，而区域准备、稳定性检查与 `shadowedTokenCount` 保持逐节点启发式价格——因此保留选择与 compaction-recovery 哨兵值都独立于计数器。

**测量获得第三种基线状态 `reported`。** 调用方提供的计数覆盖这个边界上的确切被测 envelope，因此 `measure()` 直接以它锚定，没有带符号表层增量，并覆盖 usage 与 estimated 两类锚点；`surfaceTokens`、`nodes` 与 `logRevision` 不受影响。meter 侧再校验该计数等于重复检查一个 typed 同进程、且已被 wire 边界校验过的值，所以 meter 信任其参数。

**不新增 Config 字段。** 能力声明本身就是开关：适配器只在其提供方提供计数端点时声明 `countTokens`，部署通过选择适配器启用该行为，而不是调整 compaction-basic。额外的提供方往返是使用该能力固有的成本。

## Alternatives considered

**路线 A——meter 注入 llm 并自行查询计数。** 否决：`measure()` 是同步的，而提供方计数是异步往返；自行查询会迫使测量 API 异步化，或在 replay 折叠期间做投机预取，重塑 meter 对所有消费方的纯日志回放保证。

**把能力挂在 `LlmResolvedModelInfo` 上。** 否决：精确模型元数据是脱离请求内容的身份/容量回答；带请求内容的操作无法放在那里。

**当时就让真实的 DeepSeek/pi-ai 适配器声明计数。** 暂缓：提供方侧支持（例如 `count_tokens` 端点）是独立的适配器决策；keyless counter-mock fixture 在 pi-ai 适配器声明之前证明了完整路径（[llm-pi-ai countTokens](2026-11-11-llm-pi-ai-count-tokens.md)），DeepSeek 适配器保持未声明。

**只在初始测量时取计数。** 否决：剪枝后与收敛重测将改与字符估算比较，而触发用的是上报计数——密度分化时（实测 2.09 案例）同一表层会在两种计价制度间翻转上下阈值，压缩会基于不一致的数字中止或重试。

**在 meter 内再校验一次计数。** 否决：唯一不受信任的跨越是适配器 wire 返回，`LlmRuntime.countTokens()` 已校验；为 typed 同进程调用方再加一道检查是在重复该边界。

## Testing

- `packages/llm/llm/tests/service.spec.ts` 钉住未声明缺席（`undefined`、`NO_ADAPTER`）、provider/model/request/signal 转发，以及非法返回值表（`INVALID_TOKEN_COUNT`）。
- `packages/llm/token-meter/tests/token-meter.spec.ts` 钉住 `reported` 基线（直接锚定、零 delta、表层字段不动、基线冻结）及其对活跃 usage 锚点的覆盖。
- `packages/compaction/compaction-basic/tests/compaction-basic.spec.ts` 钉住内容成比例的 fixture 计数器越过估算保持低于的阈值、在新压缩后计数上恰好一次摘要收敛、估算保持的未声明对照、失败计数回退（估算、警告、熔断不动）以及取消重抛。
- keyless headless 场景 `examples/headless-agent/tests/snapshots/token-counter/` 与 `.../token-counter-absent/` 通过组装后的一次性 app 回放：fixture 适配器按每 token 2 字符为真实 envelope 计数（首次 9896，压缩后 9420），对照 0.5 × 19000 = 9500 的阈值，只有上报计数能触发已提交的压缩（`shadowedTokenCount: 377`，逐节点启发式计价如前），而相同的未声明运行不压缩任何内容。compaction-recovery 哨兵 `shadowedTokenCount: 266` 与 web seeded-history/stats-paged-history 数字不变。

## Consequences

- 带计数适配器的部署按真实提供方密度做触发决策；不带者逐字节保持原行为，因为 `undefined` 使每条测量路径原样不动。
- 压力路径的每次压缩尝试最多付出三次计数往返（初始、剪枝后、压缩后）加每次收敛重试一次，流向计数提供方——本地引擎上是延迟，远端计数端点上是不计费的廉价请求。
- 上报计数是时点锚：计数之后的表层变化不会相对它重新计价，直到下一次计数或匹配的 usage 锚点，这正是压力路径每个变更步骤都重新计数的原因。
- `TokenMeasurementBaseline` 新增 `reported` kind；生成的 cordis API 目录与 subsystems 页面在同一变更中重新生成。
- `recallable-compaction` 继续拥有回滚、会话内历史召回与缓存感知分块；projected-usage 投影保持自己的提供方用量锚点语义（[该 note](../architecture/2026-07-29-projected-token-usage-and-request-context.md) 仍是占用度数字的拥有者）。
