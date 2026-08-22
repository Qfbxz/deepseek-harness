# kimi-acp-host — 完整实现所有反向 RPC 的 kimi ACP 宿主

零依赖 Node 脚本（≥18）：把 `kimi acp` 作为子进程拉起，通过 stdio 上的
NDJSON JSON-RPC 驱动它，并实现 kimi 适配层用到的**全部客户端侧方法**。
本会话里 `Bash`/`Grep`/`Glob` 报 `ACP terminal capability is unavailable`，
根因就是宿主既没在 `initialize` 里声明 `clientCapabilities.terminal = true`，
也没实现 terminal 方法族；本宿主两者都补齐。

## 运行

```sh
node kimi-acp-host/host.mjs --cwd /path/to/repo
# 可选: --kimi /path/to/kimi (或环境变量 KIMI_BIN)
#       --approve ask|always|reject   (默认 ask)
```

先在终端 `kimi` 完成登录（Paseo 场景同理），再启动本宿主。

REPL 内：直接输入即 `session/prompt`；`/cancel` 中断本轮；
`/permission always` 运行中切策略；`/new` 开新会话；`/exit` 退出。
Ctrl-C：优先取消挂起的权限问答 → 否则发 `session/cancel` → 再按退出。

## 方法覆盖（agent → host 反向 RPC）

| 线上方法 | 实现 |
| --- | --- |
| `session/update` | 流式渲染：agent/user/thought chunk、tool_call(_update)、plan(_update/_removed)、usage、mode、session_info |
| `session/request_permission` | 三种策略：`ask` 编号问答 / `always` 自动 allow_once / `reject` 自动拒绝；被 cancel 时按规范回 `cancelled` |
| `fs/read_text_file` | 支持 1-based `line` + `limit` |
| `fs/write_text_file` | 直接落盘 |
| `terminal/create` | 本地 spawn，stdout+stderr 合并捕获，`outputByteLimit`（默认 1MB）从头部按 UTF-8 字符边界截断并置 `truncated`；spawn 失败按真实 shell 语义记 exit 127 |
| `terminal/output` | 立即返回当前输出 + 可选 `exitStatus` |
| `terminal/wait_for_exit` | 挂起至退出，返回 `{exitCode, signal}` |
| `terminal/kill` | SIGTERM，2s 后升级 SIGKILL，terminalId 保持有效 |
| `terminal/release` | 先 kill 再失效 |
| `elicitation/create` · `elicitation/complete` | UNSTABLE，尽力实现：form 逐字段问答 / url 打印链接；`complete` 为通知 no-op |
| 其余（`mcp/connect` 等） | 回 JSON-RPC `-32601`；kimi 适配层自己转换 http/stdio/sse MCP，不会发这些 |

initialize 声明：`protocolVersion: 1`、`clientCapabilities: { terminal: true,
fs: { readTextFile: true, writeTextFile: true } }`——这正是解锁 kimi 在 ACP
模式下 shell/文件工具的关键开关。

## 已知边界

- 未在本仓库内做自动化测试（编写时编写环境无 shell）。冒烟：
  `node kimi-acp-host/host.mjs --cwd /tmp && 输入 "跑一下 ls -la"`，
  应看到 `terminal/create` 被本宿主执行并回传输出。
- 权限问答被 Ctrl-C 取消后，已键入的下一行会被挂起的 readline question
  吞掉一次（回答被丢弃），再输入一行即恢复正常。
- 参考规格：仓库内 `node_modules/@agentclientprotocol/sdk`（0.25.1）的
  `dist/schema/index.d.ts` 方法表与 `types.gen.d.ts` 字段定义；
  kimi 侧能力矩阵见官方文档 kimi-acp 参考页。
