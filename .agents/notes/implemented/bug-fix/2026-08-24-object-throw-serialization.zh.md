# Agent Note: run_code 失败诊断中的抛出对象按结构化序列化

Status: implemented

## Problem

run_code 程序抛出普通对象——`throw { code: 499 }`——模型看到的是：

```
Error: code run failed (exception): [object Object]
```

模型无法从这个字面量自我纠正：分不清是工具信封解析错、绑定拒绝还是拼写错误，只能盲目重试再撞同一堵墙。泄漏有三层，只有最深层是源头：

1. **worker 序列化（根因）**：`bootstrap.ts` 的 `prepareException` 用 `String(detail)` 渲染非字符串抛出值，把任何普通对象压成 `[object Object]`。这发生在 worker 线程内；host 收到 DoneMessage 时值已经是扁平字符串，任何 host 侧修复都来不及介入。
2. **host 抛点（纵深防御）**：`code-mode.ts` 的 `CodeRunFailedError` 抛点直接插值 `result.error.message`。message 是字符串时无害，但任何把对象直接递给它的非 worker 路径会以同样方式泄漏。
3. **传播链**：worker 把压扁的字符串传给 host，host 原样转发。

已验证只修 host 无效：补丁打在 host 抛点后泄漏依旧，因为压扁发生在第 1 层。

## Decision

在发生压扁的那一层无损序列化抛出对象，host 抛点做同型防御：

- `bootstrap.ts` 新增 `renderThrownValue(detail)`：对象走 `JSON.stringify`；循环引用降级 `util.inspect`（标记 `<Circular>`）；其余 `String()`。`prepareException` 对非字符串 detail 改用它。
- `code-mode.ts` 新增导出的 `errorMessage(error)` helper，同样的形态纪律（Error.message，然后对象 `.message`，然后 JSON，然后 inspect），`CodeRunFailedError` 抛点接入。

非字符串抛出值现在以可读 JSON 到达模型——`{"code":499}` 而非 `[object Object]`——恢复结构化 `isError` 契约承诺的自我纠正闭环。

## Alternatives considered

- **只修 host 抛点。** 已验证不足：压扁发生在 worker，host 根本看不到原值。
- **把抛出对象作为结构化 JSON 放进失败信封。** 为一个有界字符串已能服务的场景扩大 DoneMessage 线上契约；`prepareFailure` 的字节上限已正确约束诊断。
- **保留 `String()` 但特判该字面量。** `String(obj)` 从不抛错，try/catch 兜底抓不住；遮蔽这个字面量是藏住形态而不是渲染它。

## Consequences

- `throw { code: 499, detail: { reason: 'x' } }` 现在报 `Error: code run failed (exception): {"code":499,"detail":{"reason":"x"}}`。
- `toString` 抛错的对象经 `inspect` 渲染，不再走旧的不可达兜底 `program threw an unrenderable value`（对应的 bootstrap 断言随行为更新）。
- 已发布 npm 包的运行时副本通过 `runtime-patches/replay-object-throw-serialization.mjs` 携带同一修复（幂等，快照进 `backups/`）；全局重装 dsh 后与补丁 1–4 一样重放一次。
- 源码改动同时解锁了 host 编译：`protocol.ts` 导出 `CallMessage`，`bootstrap.spec.ts` 改用它（`posted` 数组类型、命名空间非空访问），清掉了此前卡死 `tsc -b` 的两处基线 TS 错误。

## Testing

- `packages/code-runtime/code-runtime-worker-thread` bootstrap 套件：29/29（unrenderable 断言更新为新的 inspect 渲染）。
- `packages/core/tools` code-mode 套件：92/92，含两个新测试——`errorMessage` 四步形态纪律逐 shape 断言、`CodeRunFailedError` 消息字段字符串不变式。
- 两包合计：500/500。
- 活跃 harness 端到端：`throw { code: 499, detail: { reason: 'synthetic-object-throw' } }` 在失败文本里返回完整 JSON。
