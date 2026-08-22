# Agent Note：subagent-acp 的 ACP 终端反向 RPC

Status: implemented

[English](2026-08-22-subagent-acp-terminal-reverse-rpc.md) | 中文

## 问题

ACP 后端此前有意声明 `clientCapabilities: {}`——其子 agent 被假定在自身进程内自行完成 shell 与文件访问（见 [ACP 后端 Agent Note](2026-06-22-acp-subagent-backend.md)）。把工具执行路由到客户端的子 agent 打破了这一假定：`kimi acp` 的 shell 工具走 ACP `terminal/*` 反向 RPC 执行，能力未声明时每个此类工具都以 "ACP terminal capability is unavailable" 失败。部署 `dsh-frostfin`（以 Kimi Code 经 ACP 替换 DSH agent loop）正是这种子 agent。

## 备选方案

- **改造子 agent 使其自给自足**——否决：它是第三方适配器（`kimi acp`），客户端代执行是其受支持的执行路径。
- **同时声明 `fs.*`**——否决：同一个 kimi 适配器在 `fs` 未声明时自行完成文件访问（观察：`fs/read_text_file`/`fs/write_text_file` 仅在客户端声明时才被调用）。声明了只会让文件 I/O 无谓地跨线传输。
- **包内本地 `child_process` 执行器**——否决：[`run.ts`](../../../../packages/subagent/subagent-acp/src/run.ts) 已让子 agent 走 `dsh-subprocess` seam 获得清理、树级拆卸与服务托管生命周期；终端命令必须走同一 seam。

## 决策

`@deepseek-ai/dsh-subagent-acp` 增加可选配置 `terminal`（默认 `false`，保持文档化的自给自足行为）。开启时 `initialize` 声明 `clientCapabilities.terminal`，运行的 ACP 客户端通过每运行一个的 `AcpTerminalPool`（[terminal.ts](../../../../packages/subagent/subagent-acp/src/terminal.ts)）服务 `terminal/create · output · wait_for_exit · kill · release`：

- `create` 在 wire 边界校验请求，经 seam spawn（`stdin: 'ignore'`，stdout/stderr 各自为按生效 `outputByteLimit`——配置 `terminalOutputByteLimit`，默认 1 MB，请求值可覆盖——的有界 `SubprocessCollect` 尾部），并生成不透明 id。
- `output` 返回合并快照——stdout 尾部在前、stderr 尾部在后，快照顺序——在 UTF-8 字符边界上截断到该终端的字节上限，`truncated` 来自截断或任一 reader 的 lossy 标志，退出后附带已定的 `{exitCode, signal}`。
- `wait_for_exit` 兑现 seam 的 `done`；spawn 级失败仍保持终端有效，失败文本即输出，退出码 127（真实 shell 的未找到语义）。
- `kill` 调用 seam 的树级 `terminate()` 且 id 保持有效；`release` 额外删除 id（未知 id 回 resource-not-found）。运行 dispose 时先对每个存活终端树执行终止并等待 seam 的退出证明，再运行子 agent 拆卸阶梯。

## 验证

`tests/terminal.spec.ts` 覆盖截断（多字节边界）、wire 边界校验、spawn 规格（collect 配置、env、cwd 默认）、合并/截断快照、kill/release 的 id 语义、spawn 失败映射与 `releaseAll`。端到端：`dsh-frostfin` 开启 `terminal: true` 后，Kimi Code 子 agent 的 shell 工具经该池执行；关闭标志则同一子 agent 复现 "ACP terminal capability is unavailable" 失败。
