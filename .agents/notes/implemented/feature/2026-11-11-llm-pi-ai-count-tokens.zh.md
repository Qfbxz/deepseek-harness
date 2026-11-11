# Agent Note: llm-pi-ai 面向兼容引擎的 countTokens

Status: implemented

[English](2026-11-11-llm-pi-ai-count-tokens.md) | 中文

## 问题

提供方 token 计数器（[WP5](2026-11-10-wp5-provider-token-counter.md)）交付了 seam——`LlmAdapter.countTokens?` 与 compaction-basic 的消费端——但刻意暂缓了适配器侧的声明，两个已发布适配器都保持未声明，于是所有部署仍以字符估算为上下文压力计价。跨 harness 一致性程序的 strata 集成（[提案](../../proposed/feature/2026-11-08-cross-harness-parity-program.md)）在其引擎路由上需要相反的能力：strata worker 按协议各暴露一个计数操作（Anthropic 侧 `POST /v1/messages/count_tokens`，OpenAI 侧 `POST /v1/chat/completions/count_tokens`），其 context-budget 工作以 `adapter.countTokens !== undefined` 为开关，从密度修正估算切换到提供方上报计数。本 note 回答的开放问题是：多协议适配器在「每个协议各有一个计数端点」时在哪里声明该能力，以及计数失败时适配器层做什么。

## 决策

**`PiAiAdapter` 声明 `countTokens()`，协议即声明。** 适配器只把两种协议映射到计数端点，宿主与流式请求相同：`anthropic-messages` 走 `POST {baseURL}/v1/messages/count_tokens`，`openai-completions` 走 `POST {baseURL}/chat/completions/count_tokens`。两者都接受协议原生 prompt 信封并以 `{"input_tokens": N}` 回答，因此 `ctx.llm.countTokens()` 在这些路由上返回提供方分词器对完整请求信封——system、tools 与 messages——的计价。其余协议的模型在任何网络 I/O 之前即以 `COUNT_UNAVAILABLE` 失败。没有新增 Config 字段：能力按适配器整体声明，遵循 WP5「能力声明即开关」的决策；映射表之外的协议是该协议的既定事实，不是每模型的缺席配置。

**计数针对的是流式请求会真正携带的内容。** 计数询问通过与流式调用相同的历史转换（`toPiCountContext`，与 `toPiContext` 共享内部实现）、解析同一凭据、合并同一标头。协议线格式转换逐开关镜像 pi-ai 自身的请求形态——OpenAI 侧的 `supportsDeveloperRole`、`requiresAssistantAfterToolResult`、`requiresThinkingAsText`、`requiresToolResultName`，Anthropic 侧的 `allowEmptySignature`——包括回放 thinking 的落位（OpenAI 侧按签名命名的字段；Anthropic 侧 signed／redacted／降级为文本的块）、连续工具结果的分组，以及工具结果内图片的处理。分词器不计价的请求专属字段（采样参数、cache-control 标记、chat template kwargs、延迟工具引用）一律省略。

**失败语义保持 WP5 的消费端契约。** 一次计数就是一次 POST，不做重试。任何端点失败——未映射协议、传输错误、超时、非 2xx、响应缺少非负安全整数 `input_tokens`——都抛出点明原因的 `LlmError('COUNT_UNAVAILABLE')`；compaction-basic 已有的 catch 就是那一次警告和回退到字符估算的动作。适配器方法无法用返回 `undefined` 表达失败：seam 把已声明适配器的返回类型定为 `Promise<number>`，`LlmRuntime.countTokens()` 在该边界校验返回值，描述性抛错是唯一符合 seam 的信号，也正是 WP5 验收测试已经钉住的形态。被调用方 signal 取消的计数像流式请求一样以 `ABORTED` 重新抛出。profile 的 `timeoutMs` 与调用方 signal 一起约束计数请求；携带图片的信封与流式请求完全一致地解析持久附件服务。

## 曾考虑的替代方案

**端点失败时从适配器返回 `undefined`。** 否决：在该 seam 上不可行——可选方法的返回类型是 `Promise<number>`，`LlmRuntime.countTokens()` 会把非整数变成 `INVALID_TOKEN_COUNT`，吞掉 `undefined` 还会产出误导性诊断，并在消费端自己的警告之外叠加第二次警告。抛错契约交付的可见结果与 WP5 钉住的完全一致：一次警告、估算回退、熔断器不动。

**按路由或按协议配置计数开关。** 否决：WP5 已决策「不新增 Config 字段；能力声明即开关」，而需要逐路由设置的开关会让路由默认处于未计数状态。映射表是固定代码；没有计数端点的协议是该协议的事实，不是设置项。

**调用 pi-ai 自身的线格式转换函数。** 不可行：pi-ai 只导出流式入口；`convertMessages` 与 Anthropic 构造器都是模块私有。本包内的计数转换逐开关镜像这些形态，并由针对两种协议、断言精确请求体的 fixture 测试钉住。

**发送缩减的计数请求体（纯文本，类似 spill 标记的计数器）。** 否决：seam 的请求携带 system、tools 与 messages，忽略工具 schema 与回放历史的计数会恰恰低估 compaction 为之做预算的那些会话——这正是 WP5 要消除的偏差。

## 测试

- `packages/llm/llm-pi-ai/tests/count-tokens.spec.ts` 按协议模式钉住：已声明计数的端点路径、原生请求体形态与认证标头；无 system 无 tools 的最小信封；compat 开关渲染（`developer` 角色、结果桥接、thinking 转文本、具名工具结果、空签名）；两侧回放的 signed、redacted 与无签名 thinking；经持久附件服务的图片转换；单次尝试的失败（404、传输错误、不可读与非法计数、超时）抛出 `COUNT_UNAVAILABLE`；未映射协议在任何网络 I/O 之前的拒绝；发起前与进行中的取消；降级回放下的计数；无凭据路由不发送认证标头。
- `pnpm run test:snapshot` 保持全绿：`token-counter` 与 `token-counter-absent` headless 场景以及 `compaction-recovery` 哨兵（`shadowedTokenCount: 266`）不变，fixture 适配器场景不经过本适配器。
- `packages/compaction/compaction-basic/tests/compaction-basic.spec.ts` 钉住消费端不变：抛错的已声明计数警告一次、回退估算、且不推进熔断器。

## 后果

- 引擎暴露任一计数端点的部署——strata worker 两侧都有，以及镜像真实 API 的 Anthropic／OpenAI 兼容网关——在真实提供方密度下做触发决策；其余协议不加配置地继续使用字符估算。
- 压缩路径的每次尝试在计数路由上最多付出三次计数 POST 加每次收敛重试一次，全部单次尝试；本地引擎上只是延迟。
- 计数转换以镜像代码而非函数调用跟随 pi-ai 的请求形态：pi-ai 升级若改变某协议的 prompt 渲染，需要同步更新镜像转换，断言精确请求体的 fixture 测试就是漂移信号。
- seam 无改动；`dsh-llm`、`token-meter` 与 compaction-basic 无需编辑。DeepSeek 适配器在其提供方具备计数操作之前保持未声明。
