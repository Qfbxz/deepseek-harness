# Agent Note: WP8 session approval cache and prefix rules

Status: implemented

[English](2026-11-10-wp8-approval-cache-prefix-rules.md) | 中文

## Problem

[缺口 G7、条目 W9](../../proposed/feature/2026-11-08-cross-harness-parity-program.md)：[user-approval](../../../../packages/interaction/user-approval/src/index.ts) 在每次提权时都提问。Codex 按会话缓存审批，并提供可持久化的命令前缀规则与明确的反例——`python3` 前缀绝不可持久化，`rm` 与 heredoc 形态被点名为禁止。提案把持久化作用域（会话内存还是跨重启）留作悬而未决的问题。

## Decision

**seam 在 `ask` 策略下、任何应答者分发之前自行解析重复请求。** 会话审批缓存按归一化请求形态为请求建键——精确工具名加上规范化参数（`approvalShapeKey`）：字符串去除首尾空白并折叠连续空白，引号、大小写与数组顺序保持敏感，对象成员顺序不敏感，`undefined` 成员按 JSON 语义丢弃。同一形态在会话内获批一次后即以 `allowed-once` 解析，不再提示；`cacheMaxEntries`（默认 512，非负整数，`0` 关闭，构造期校验）按会话限制缓存容量，最旧条目淘汰、命中即刷新。`persistPrefix(agent, toolName, tokens)` 存储按工具限定的规则：该工具后续 `command` 参数恰好以 `tokens` 开头的请求由规则直接应答。

**禁止形态是固定安全不变量，在写入路径拒绝。** `persistPrefix` 在下列情况以可执行理由拒绝且不落任何规则：token 含 heredoc 操作符；任何位置含裸的禁止命令（包括 `timeout 10 rm` 一类带值前置形态）；剥离直通包装命令（`sudo`、带赋值的 `env`、`nohup`、`command`、`time`）后未解析出具体命令；或解析出的命令是多字符禁止名的扩展（`python3.11`、`rmdir`；单字母成员 `R` 永不前缀匹配）。`forbiddenPrefixReason` 暴露同一判定，供应答者过滤其提供的选项。该清单不是 `Config` 字段：任何部署都无法放宽它，因为一条持久化的 `python3 -c` 规则会预批准任意代码。

**作用域：仅会话内存。** 缓存与规则随进程消亡；跨重启持久化留作独立的未来决策（即提案的悬而未决问题），这也使 `SessionEventMap` 保持不变——每个已解析的请求仍追加其 `approval/asked` + `approval/decided` 审计对，回放能看到每个决定，而 wire 格式不新增任何成员。dsh-tools 执行器现在会在 `ApprovalRequest` 上传递调用的已解析参数；不带参数的请求——结构上即沙箱提权通道——在缓存之外、也永不匹配规则，因此服务绝不自动批准它看不见的东西。`'never'` 策略仍在两个削减器之前确定性地拒绝。

## Alternatives considered

**按 `callId` 从会话日志推导参数。** 否决：扫描日志找已流式输出的工具调用，是为请求方本已持有的数据引入间接的第二来源，且审计事件本就刻意不带参数。

**把缓存放进 tools 执行器。** 否决：审批决定归 seam 所有——`'never'` 闸门已经放在 `request()` 内部，正是因为监听器顺序不可信、不能承担策略执行——而执行器侧的缓存无法治理未来的非工具请求方。

**持久化前缀规则（新增 `SessionEventMap` 成员 + 回放折叠）。** 随作用域决策一并暂缓：它会新增 wire 格式成员并带来 SDK 期望输出的联动改动，而对等性证据并不要求这种授权生命周期；会话内存与 Codex 的会话级缓存一致。

**把禁止清单做成可配置项。** 作为配置攻击面否决："破坏性形态永不持久化"是安全不变量，仓库规则要求安全不变量保持固定。

## Testing

- `packages/interaction/user-approval/tests/approval-cache.spec.ts` 钉住键归一化等价类（空白折叠、引号／大小写／数组顺序敏感、成员顺序无关、工具名敏感）、缓存行为（命中且不应答者 consultations 加审计对、拒绝／取消／不可用不入缓存、按会话隔离、淘汰、LRU 刷新、`0` 关闭、构造校验、`'never'` 优先、无参数直通）与前缀规则（按工具匹配、token 校验、重复幂等、每种禁止形态——任意位置的裸禁止命令、heredoc、带值前置、`python3.11`／`rmdir` 一类族名拼写、仅包装命令的规则——拒绝且不落规则、会话隔离、`'never'` 优先）。
- keyless snapshot（`examples/headless-agent/tests/wp8-approval-cache.snapshot.ts`）驱动组装好的单次执行 headless 应用：两次完全相同的 `todo_write` 调用产生两对审计记录但恰好一次应答者咨询（记录在咨询标记文件中）；前缀场景通过公开 API 持久化 `["echo"]`，让不同形态的 `echo beta` 免提示运行，并在拒绝该请求前记录服务对禁止的 `["rm","-rf"]` 持久化的可执行拒绝理由，命令因此永不执行。

## Consequences

- 同形态工作在每个会话内只打断一次；持久化审计流保持完整，回放与不变量机制能看到每个已解析的请求。
- 子系统页旧的"有意省略工具参数"事实已被替换：`arguments` 存在但只服务缓存／规则匹配——应答者仍通过 `callId` 渲染已流式输出的调用。
- 目前没有内置应答者呈现"此后总是允许该前缀"选项；`persistPrefix` 是公开的 Consumer 扩展点，README 记录了这一缺口。
- 沙箱提权通道按设计继续每次提示；为其扩展参数传递是独立决策。
- 新 `cacheMaxEntries` 字段的 config-catalog 条目（中英）按 WP2/WP4 先例手工应用，因为生成器仍被既有 dshmarket 缺失阻断；待机器复核。
- Supersession 检查结论：检索活跃树未发现拥有审批缓存或前缀规则决策的既有 note；[approval-seam](2026-07-06-approval-seam.md) 与 [sandbox](2026-07-06-sandbox.md) 保持现行且未被触碰，[2026-11-08 程序提案](../../proposed/feature/2026-11-08-cross-harness-parity-program.md)仍是 W9 的归属决策记录。本 note 解决了该提案关于审批作用域的悬而未决问题（现在是会话内存，重启持久化暂缓）。
