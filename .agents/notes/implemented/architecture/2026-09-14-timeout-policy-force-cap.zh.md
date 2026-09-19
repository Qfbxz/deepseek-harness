# Agent Note：timeout-policy 强制兜底 —— 永不落定的工具不得挂死循环

Status: implemented

[English](2026-09-14-timeout-policy-force-cap.md)

## 问题

2026-09-14 会话 `session-a684330e` 永久卡死：turn 15 step 24 的 `run_code` 程序内跑同步 `execSync(dotnet build …)`，`tool/call` 已落盘但 `tool/result` 永不出现；后续所有用户消息被 splice 进在途轮次 inbox 永不处理，唯一恢复手段是杀后端进程。

当时版本的 timeout-policy 无条件 `await next()`：deadline 只协作式 abort `exec.signal`，且仅在工具 Promise 最终落定时才替换结果。永不落定的工具（事件循环被同步 `execSync` 阻塞、死锁、或忽略信号）让 `await` 永久 pending——没有 `TOOL_TIMEOUT`、没有错误、没有 turn end。同步 `execSync` 阻塞事件循环期间，协作式计时器本身也无法触发。

## 决策

包装层保留协作路径为第一手段，增加有界第二手段：

1. 照旧布置 deadline，把融合信号交给工具。
2. 当*本插件自身*的 deadline 触发（`timeoutOf(d.signal, TOOL_TIMEOUT)`）且工具 Promise 未落定时，启动宽限计时器（配置字段 `forceAfterMs`，默认 15000 ms，`0` 关闭）。
3. 宽限期内工具落定：沿用既有替换路径，语义不变。
4. 未落定：包装层直接返回 `toolTimeoutResult(timeoutMs)`；被放弃的工具 Promise 挂吞掉处理（分发规范化会把已落定执行转为结果，不会有其他失败从中浮出）。

上游取消不受影响：宽限计时器只为 timeout 分类的 abort 布置，保留 `TOOL_ABORTED` 与嵌套 deadline 的既有语义。被放弃的工具工作本身仍未被终止——终止仍归能力方；兜底只约束*循环*的等待时长。

## 考虑过的替代方案

- **包装层内硬杀** —— deadline 一触发立即放弃工具 Promise。否决：会放弃正在清理中的工具，替换掉协作路径本可正确处理的结果；宽限期保留了全部既有协作语义。
- **为未声明 `timeoutMs` 的工具提供注册表级默认预算** —— 再次否决：已交付的 `bash`／`read`／`write`／`edit` 有意不声明，统一预算会改变从未承诺信号协作的工具的行为。
- **只在部署垫片里修**（促成本次改动的个人 `dsh-tool-timeout` 插件）—— 否决：垫片同样换 `exec.signal`，但只作用于单一部署；语义应归入 timeout-library note 指定的强制执行归属地。

## 影响

- `apply` 现在接受 schemastery `Config`（`forceAfterMs`），包的 peer/dev 依赖新增 `@deepseek-ai/schemastery`；直接 `ctx.plugin(timeoutPolicy)` 无配置挂载得到 15 s 默认值。
- 测试钉住三个新行为：永不落定工具在宽限期后被强制替换、`forceAfterMs: 0` 恢复旧版无限等待、宽限期内落定走正常替换路径。
- 触发本改动的事故同时产出了即时部署垫片（个人 `dsh-tool-timeout` 插件，同样换 `exec.signal`，对 `run_code` 施加 180 s wall-clock abort）；本包改动是该语义的持久归宿。
- 保留的已知限制：未声明 `timeoutMs` 的工具仍无 deadline；注册表级默认值仍不在范围内。
