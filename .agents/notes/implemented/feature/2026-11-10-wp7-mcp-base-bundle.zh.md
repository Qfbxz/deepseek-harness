# Agent Note: WP7 MCP base-bundle registry mount

Status: implemented

[English](2026-11-10-wp7-mcp-base-bundle.md) | 中文

## Problem

跨 harness 对齐程序的[缺口 G6、条目 W8](../../proposed/feature/2026-11-08-cross-harness-parity-program.md)：`@deepseek-ai/dsh-mcp-client` 早已存在，但[基础 bundle](../../../../packages/bundle/base/cordis.patch.yml) 没有为它携带任何行，因此默认 profile 无法接入任何 MCP 服务器。此前的工具清单 note（[2026-07-31-even-out-shipped-tool-rosters](2026-07-31-even-out-shipped-tool-rosters.md)）正是出于"交付的行必须点名一台第三方服务器并每次启动都 spawn 它"的理由，把该插件只作为 CLI 依赖交付，并且点名了缺失的那一层：一个读取用户服务器清单、按条目逐台挂载客户端的桥接。

## Decision

**基础 profile 以一行休眠的注册表行挂载 MCP 能力。** [`@deepseek-ai/dsh-mcp-client/registry`](../../../../packages/mcp/mcp-client/README.md#registry-entry) 是一个命名空间插件，其 `Config` 为 `{ servers: Config[] }`，`servers` 默认 `[]`；基础 patch 以行 `mcp` 携带它并保留空的默认值——在后续 patch 层替换 `servers` 之前，不启动任何服务器进程，也没有任何 `mcp__*` 工具加入目录。每个条目都是一份完整的 `mcp-client` config，并作为子实例激活，具备该插件既有的连接、发现与重连语义；`failOnStartupError: false` 让连接失败保持为逐条目自己的选择而非启动失败。交付组合中的任何位置都不硬编码服务器清单。

**注册表配置错误在加载期响亮失败。** 未通过 mcp-client config schema 校验的条目会让子项的配置校验报错拒绝；注册表内重复的 `serverName` 由前置的注册表检查捕获，错误同时给出两个条目的下标；两类失败都经过被 await 的子挂载传播到该行——损坏的组合绝不会以部分挂载的服务器清单启动。空默认值加加载期响亮失败，就是本程序钉死的 A9 语义。

部署面：在 profile 或 home 的 patch 层替换 `mcp` 行的 `config`（patch 会替换目标行的整个 `config`），或像从前一样直接插入单服务器 `mcp-client` 行——[`examples/mcp-memory`](../../../../examples/mcp-memory/README.md) 的 overlay 原样保留，仍是另一条挂载路径。HMR 以注册表行为单位整体重载——编辑该行会断开并重新挂载每台服务器——而不是逐台热替换。

## Alternatives considered

**在基础 patch 里放逐服务器行。** 否决：交付的 patch 无法在不硬编码服务器名或空占位行的前提下携带服务器清单，而且每加一台服务器都要改 bundle，而不是替换一份 config。

**默认启用一台样例服务器。** 否决，理由就是工具清单 note 已记录的那条：任何交付的 `command` 都会在每台用户的机器上点名并 spawn 一台第三方子进程，不经 `ctx.shell`，也在 Web 沙箱策略之外。空注册表在让能力可挂载的同时保住了"不 spawn"的规则。

**独立的 `@deepseek-ai/dsh-mcp-registry` 包。** 否决：注册表是对单一能力的组合，不是第二个 seam；subpath 入口先例（`dsh-tool-subagent-control/list-agents`）让它留在它所挂载插件的旁边。

**只靠子实例做校验。** 部分采纳：每个条目的 schema 校验与启动失败都来自子项，schema 只存在一份；注册表只补充重复 `serverName` 检查——它的错误必须给出两个下标，而跨行的逐实例命名空间预留无法在同一行内表达这一点。

## Testing

- `packages/mcp/mcp-client/tests/registry.spec.ts` 钉住：空默认值、空注册表的干净挂载、带双下标的重复 `serverName` 拒绝、schema 非法条目的拒绝、以及合法条目的必败 spawn 把启动失败折叠进注册表激活。
- `packages/bundle/base/tests/base.spec.ts` 钉住：恰好一行 `mcp`（registry 入口、`servers: []`）、没有直接的 `mcp-client` 行、bundle manifest 声明 `@deepseek-ai/dsh-mcp-client`。
- keyless headless 快照（`examples/headless-agent/tests/wp7-mcp.snapshot.ts`）驱动产品 headless profile：`--dump-config` 呈现休眠行；重复 `serverName` overlay 与 schema 非法 overlay 各自在加载期让启动失败并携带注册表的错误；fixture overlay 以一台零依赖 stdio MCP 服务器 patch 该行，真实的 `mcp__fixture__add` 调用经组装后的 profile 往返并落入持久会话日志。
- WP7 执行环境中不存在 `DEEPSEEK_API_KEY`（仅对进程环境与根 `.env` 检查键名是否存在，未读取值），因此 roadmap 的带密钥 fixture 服务器 e2e 一轮未运行；上面的快照一轮通过脚本化模型适配器 keyless 地驱动了同一条 wire 路径。

## Consequences

- 休眠行零开销：无进程、无工具 schema、无请求字节。只有部署提供服务器之后才开始产生 token 与 KV-cache 影响，且那是 mcp-client 插件自己已文档化的影响。
- 配置了 stdio 服务器的部署会引入不经 `ctx.shell`、也不在 Web 沙箱策略之内的子进程——工具清单 note 记录的这一告警现在只在服务器清单点名一台服务器时才适用。
- [2026-07-31-even-out-shipped-tool-rosters](2026-07-31-even-out-shipped-tool-rosters.md) 被部分取代并保持活跃：其"MCP 是依赖,不是配置行"的事实已过时——基础 bundle 现在携带休眠行，它预言的缺失桥接就是本注册表；其决策——不点名服务器、默认不 spawn——被保留并由空默认值强制。两份 note 互相链接。
- 注册表 `Config` 记录在包 README 中，而不在[配置目录](../../../../docs/config-catalog.md)里：生成器只扫描每个包的 `src/index.ts` 入口，注册表位于 `./registry` subpath 之后，与 `dsh-tool-subagent-control/list-agents` 同型。
- `SessionEventMap` 无变化：注册表经由既有的 `ctx.tools` 注册路径贡献工具，一切模型可见内容——工具 schema、调用、结果——都通过既有事件落日志。
- supersession 检查：检索活动 note 树后确认，除上文处理的工具清单 note 的"依赖,不是配置行"事实外，没有其他 note 拥有基础 bundle 挂载 MCP 的决策；mcp-client 插件（[2026-07-07](2026-07-07-mcp-client-plugin.md)）、自动重连（[2026-08-06](2026-08-06-mcp-client-auto-reconnect.md)）与 memory-overlay（[2026-07-31](2026-07-31-third-party-memory-mcp-examples.md)）各 note 保持现状、未做改动。[2026-11-08 程序提案](../../proposed/feature/2026-11-08-cross-harness-parity-program.md)仍是 W8 的决策归属记录。
