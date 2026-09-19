# Agent Note: Code-mode 绑定调用拒绝位置原始值并点名 lossy 属性

Status: implemented

[English](2026-08-28-code-mode-binding-argument-diagnostics.md) | 中文

## Problem

模型以位置原始值调用 `tools.x("name")` 时到达宿主的对象检查，要么以含混的消息失败，要么在宿主不应答时挂起。lossless-JSON 拒绝也只说参数不是无损 JSON——`{ id: undefined }` 让模型猜哪个属性有问题，于是同一调用反复重演。

## Decision

`makeNamespaces` 在 post 之前拒绝位置原始值，消息给出收到的类型、有界的预览、以及纠正形态 `tools.${name}({ … })`。函数、日期、数组与对象保持原路径，lossless-JSON 语义及其测试不变。对 lossless 拒绝，`describeLossyProperties` 列出至多八个 JSON 快照无法承载的顶层属性（`undefined`、函数、抛错的 getter），超过八个追加 `+N more` 后缀；说不出诊断时保持为空。

## Consequences

- 可纠正的失败现在把修法带在消息里；即 `run_code` 用户记录的位置参数坑。
- p3 自愈补丁（`replay-worker-binding-omitted-args`）退役：源码现在拥有它过去注入的 `args === undefined ? {}` 归一化。
- bootstrap spec 新增两个用例钉住位置参数提示与 lossy 属性诊断。
