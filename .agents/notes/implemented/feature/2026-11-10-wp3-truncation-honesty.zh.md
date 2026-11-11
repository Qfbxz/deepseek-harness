# Agent Note: WP3 truncation honesty — one sized truncation notice for pruned tool results

Status: implemented

[English](2026-11-10-wp3-truncation-honesty.md) | 中文

## 问题

跨 harness 对齐程序（[缺口 G3](../../proposed/feature/2026-11-08-cross-harness-parity-program.md)）测得：剪枝器会把超出预算的工具结果切成头部、标记 `\n\n[... tool result middle pruned ...]\n\n` 与尾部——文本声明了剪切，却不含原始大小、保留大小与下一步指引，模型只能对一个大小未知的空洞做推理，且没有恢复路径。对比对象对此都有答案：Kimi 在截断提示后附可执行的下一步，Codex 在结构化输出里上报 `original_token_count`。被剪枝的错误结果同样带这个不透明标记，因此被截断的错误文本对自己的大小同样不诚实。

## 决策

剪枝器只发出一种截断通知，由 `@deepseek-ai/dsh-compaction-tool-result-pruner` 中的 `truncationNotice(originalChars, headChars, tailChars)` 构建：`[truncated] original N chars -> kept head X + tail Y; re-read specific ranges to page through the middle`，前后各一个空行，`N`、`X`、`Y` 为实际 Unicode 码点数。每个被剪枝的结果——成功或错误——都携带这一种形态；该 builder 是唯一生产者，因此不存在第二种通知形态。

**被截断错误文本的落点就是剪枝器。** 统一的工具错误包装（`dsh-tools` 中的 `Error: ${message}`）不做任何截断：它原样包装工具抛出的消息。唯一会截断面向模型的工具错误文本的机制就是本剪枝器，而错误结果与成功结果走同一条 `pruneContent` 路径，因此共享 builder 就是全部约定，`packages/core/tools` 无需改动。包测试在 `isError: true` 结果与成功结果上同时钉死通知原文。

**配置校验为通知宽度预留预算。** `headChars + TRUNCATION_NOTICE_MAX_CHARS + tailChars` 不得超过 `thresholdChars`，其中 `TRUNCATION_NOTICE_MAX_CHARS` 是每个取值取 `Number.MAX_SAFE_INTEGER` 时的通知长度——码点计数所能达到的最宽位数。装不下通知的预算在插件构造期失败；在更短的静态标记下原本有效的配置（例如 `thresholdChars: 100, headChars: 20, tailChars: 10`）现在在加载期失败。出厂默认（`8192/4096/1024`）以很大余量满足该界。

**不新增 Config 字段。** 通知格式是固定约定，不是随部署变化的取值，因此针对硬编码可调项的仓库规则不适用于它；真正随部署变化的字符预算仍是经过校验的 `Config` 字段。

## 已考虑的替代方案

**保留静态标记、把通知追加在尾部之后。** 否决——一个结果里会存在两种通知形态，而且位于中段之外的通知会脱离保证单遍收敛的发出体积预算算术。

**把通知预算按低于 `Number.MAX_SAFE_INTEGER` 的固定位数预留。** 否决——更大的原始大小会发出超出已校验预算的通知，把一个数据事实变成剪枝时的响亮失败，而不是加载期的配置判定。

**把同一后缀扩展到 shell 工具的通知。** 暂缓——`dsh-tool-bash` 的 `[output truncated; full output: …]` 与持久 shell 的 `<response clipped>` 提示宣告的是 spill 文件或滚动缓冲丢失，不是头尾剪切，且其表现层会解析这些标记；收敛它们是本程序 WP3 落点之外的独立决策。

**为通知格式提供 Config 开关。** 否决——格式是固定约定，开关只会让模型可见契约按部署分叉，且没有消费者。

## 测试

- `packages/compaction/compaction-tool-result-pruner/tests/tool-result-pruner.spec.ts` 在成功结果与 `isError: true` 结果上钉死带实际大小的通知原文、单遍收敛、通知宽度校验界，以及在旧短标记下原本有效的预算的加载期拒绝。
- keyless headless 场景 `examples/headless-agent/tests/snapshots/compaction-prune/` 通过组装好的应用回放一个超大的 bash 结果：持久日志与流中携带 `compaction/prune` 影子价、带通知原文的替换 `tool/result` 与压缩信封，重试请求看到已剪枝的替换。

## 后果

- 模型能看到被剪切内容的大小与恢复步骤，`compaction-basic` 的摘要器在剪枝后的表层读到同一通知。
- 低于通知界的剪枝预算在插件构造期失败；默认组合与所有出厂 profile 都以余量满足该界。
- 剪枝替换比原静态标记多携带少量文本；发出体积仍在 `thresholdChars` 内，压力计算与单遍收敛不受影响。
- 既有 `compaction-recovery` snapshot 不变：其被影子的节点是用户消息，其工具结果永远不会超大。新 `compaction-prune` 场景钉死的 `shadowedTokenCount` 经共享估算器为剪枝替换定价，对该通知文本保持稳定。
