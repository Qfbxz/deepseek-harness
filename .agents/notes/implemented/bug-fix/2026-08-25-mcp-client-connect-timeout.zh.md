# Agent Note: 单次 MCP 连接尝试必须有运维可控的界限

Status: implemented

[English](2026-08-25-mcp-client-connect-timeout.md) | 中文

## Problem

插件激活等待首次连接尝试，每次重连尝试也各自等待，而本包此前不拥有任何界限。MCP SDK 对每个请求有 60 秒超时，但一个接受了 spawn 之后保持沉默的服务器会让激活按该预算整段等待——等待插件树的 Host 启动随之继承延迟。尝试永不 settle 时，重连尝试预算也无法消耗。运维没有任何字段可以按服务器收紧这些等待。

## Decision

`connectTimeoutMs`（默认 30000，正有限数，上限 `MAX_TIMER_DELAY_MS`）约束单次连接尝试——initialize 握手加初始工具同步——以及每次重连尝试。`resolveConnectTimeoutMs` 是显式的 resolve 步骤，绕过 Schemastery 的编程构造会在加载时让插件实例失败，与 `resolveReconnectPolicy` 对称。尝试主体与一个 deadline promise 竞速；落败尝试的迟到 settlement 是惰性的，因为尝试续体和串行同步队列里既有的 `isCurrent` 守卫会跳过已被失败路径替换的世代。超时的尝试关闭自己的世代并计入重连预算，与 connect 被拒绝完全一致。

## Alternatives considered

**依赖 SDK 的逐请求超时。** 否决：它约束的是单个请求而非整次尝试，不提供运维控制，且激活路径每次尝试仍要付出完整 60 秒。

**只约束初次尝试。** 否决：挂起的重连尝试会永久卡住 supervisor 循环，使 `maxAttempts` 形同虚设；尝试是对称的，一个界限同时覆盖两者。

## Consequences

- 激活受单次尝试 deadline 约束；沉默的服务器最多消耗 `connectTimeoutMs` 后由失败路径接管。
- 重连预算能够对挂起的服务器消耗完毕，既有的放弃路径因此可终止。
- 冷启动超过界限的合法慢服务器现在会快速失败；运维为该服务器调高 `connectTimeoutMs`，取代原先的无界等待。

## Testing

`packages/mcp/mcp-client/tests/reconnect.spec.ts` 覆盖：挂起的初次 connect 消耗预算至放弃、挂起的初始同步在界限处失败、`failOnStartupError` 在超时时拒绝激活，以及 `resolveConnectTimeoutMs` 的默认值、显式值、越界拒绝（含 `apply` 的 fail-loud）。
