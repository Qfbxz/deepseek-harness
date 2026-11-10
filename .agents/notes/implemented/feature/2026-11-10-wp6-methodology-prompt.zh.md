# Agent Note: WP6 methodology prompt section and when-not-to-use guidance

Status: implemented

[English](2026-11-10-wp6-methodology-prompt.md) | 中文

## Problem

跨 harness 对齐程序（[gap G5，条目 W7](../../proposed/feature/2026-11-08-cross-harness-parity-program.md)）测得：本 harness 不教任何方法论——静态提示词约 2KB，persona 只有一句话，探索、验证与汇报纪律无处可学，默认模型"已经会用"。同一对比还发现兄弟 harness 给每个工具都附带"何时不用"陈述与反例，而本 harness 的每工具提示词指导只有正向指令——这正是换一个非配套模型时最先暴露的缺口。

## Decision

**方法论段是 harness 级内建，默认开启。** `dsh-system-prompt` 在顺序 10 注册 `harness:methodology`——位于 persona 之后、工具指导之前——传授四条合同规则：先探索后结论；进入子目录先读该目录根部的 AGENTS.md；先验证后声称，并说明未运行什么；引用代码给 `path:line`。`includeMethodology`（默认 `true`）关闭该段；`methodology` 供部署自撰规则替换固定文本；`methodologyMaxWords`（默认 `300`，整数 1–10000）限制解析后的文本。词数在插件构造时计数：超过上限即抛出并报出实际词数，预算漂移在启动时响亮失败，而不是无声地撑大提示词。默认开启沿用 `includeHarnessIdentity` 先例——harness 拥有的固定提示词家具随附启用，兼容性或窗口受限部署（Strata 29K/32K profile 是点名案例）用一行 patch 关闭。

**standard preset 每个工具指导段都带 `When not to use:` 陈述与一至两条反例。** `read`、`write`、`edit`、`glob`、`grep`、`bash`、`pwsh`、后台 `jobs`、`web_search`、`web_fetch`、`goal`、`workflow`、`ralph`、`subagent`（一份模板覆盖 spawn 与 fork）的指导段加入该标记；原文已含规则的段改为重组——标记句收尾，不再重复。`ask_user_question` 获得首个跨调用指导段（顺序 117），承载"先查证后提问"规则。`todo_write`、skill 加载器与 subagent 控制工具保持无段——它们的一次调用 description 已拥有这些合同，为其发明指导段只会白花提示词字节。约定保持在 prompt 侧：程序推迟的"指导迁入工具描述"决策未被触碰。

**组装提示词增量是量出来的，不是断言出来的。** 将每个刷新后的 ACP `system-prompt*.expected.md` golden 与基线提交版本逐行对比，只计新增的方法论与 `When not to use:` 字节（不含吸收的既有陈旧）：

```sh
git worktree add /tmp/wp6-base d05842d98a   # then diff goldens between the two trees
```

标准组合（`text-turn/system-prompt.expected.md`）增加 **1481 字节**；最大的刷新 golden（`subagent-child-question-rejection`，其组合额外插入 ask-user 段）增加 **1616 字节**——都在 ≤2KB 合同之内。按实测的每 token 约 2.09 字符折算约合每请求 700 token；Strata 式受限 profile 通过设置 `includeMethodology: false` 收回。

## Alternatives considered

**插件默认关、由 base bundle 行开启。** 否决：G5 是 harness 级缺口，bundle 行默认仍会让每个直接挂载 `dsh-system-prompt` 的组合——harness 的公开接缝——没有方法论。identity 段就是"默认随附的 harness 家具"的先例。

**把规则写进工具 description。** 此处否决：程序明确推迟指导迁入 description 的迁移，且跨调用习惯在提示词段中有既定归属。

**固定 300 词常量、文本不可撰。** 否决：对不可编辑常量设上限永远不会触发，`methodologyMaxWords` 会沦为死配置；文本作为 Config 字段才让预算成为真校验。

**为 `todo_write`、skill 加载器、subagent 控制新增指导段。** 推迟：它们的 description 目前不缺跨调用习惯，而每个新段都消耗每请求字节。

## Testing

- `packages/core/system-prompt/tests/system-prompt.spec.ts` 逐字钉扎默认渲染文本、persona 与工具指导之间的顺序 10 槽位、`includeMethodology: false`、部署自撰替换、加载期 301 词超限拒绝、上调上限、schema 与构造器对非法上限的拒绝、空文本拒绝。
- `packages/shell/tool-bash`、`packages/fs/tool-fs`、`packages/workflow/tool-ralph` 与 agent-spine-demo 套件钉扎段列表与重组后的指导文本；demo bundle 转发 `includeMethodology`/`methodology`/`methodologyMaxWords`，其兼容性部署测试关闭该段。
- 不得继承无关提示词权重的阈值校准 fixture 显式关闭该段：compaction-loop-repro harness 与 minimal JSON-RPC 组合（其部署提示词就是配置的 persona）设 `includeMethodology: false`；WP5 token-counter 场景整体重述 agent-spine 行将其关闭，并把手工包络重新校准到 20200-token 窗口（探针实测首计数 10543 对 0.5 × 20200 = 10100 阈值），保住单次压缩编排。
- 全量 keyless 快照套件回放全绿：136 通过、2 跳过、0 失败。ACP golden 同时携带新段与新子节；刷新的 `stream-json` 场景对提示词不可见（`{{system}}` 归一化），其 diff 限于既有内容形状陈旧。

## Consequences

- 每个启用的部署为每次请求支付约 1.5KB 系统提示词。窗口受限部署以 patch 关闭该段；词上限约束自撰替换文本，但不约束指导子节约定本身。
- 快照重录面：20 个 ACP system-prompt golden 加 headless 与 JSON-RPC 场景 fixture 携带 WP6 行（标准组合各 1481 字节），并吸收了 f5617203e6 时代未刷新的既有陈旧——glob/grep 指导段与 bash description/subagent 持久化形状——golden 合计约 3KB。套件从基线 83 个失败（ACP 78、headless subagent-diagnostic/subagent-inheritance/headless-profile、JSON-RPC SDK、session-fixture-layout）降到零。
- `subagent-parallel` 需要的是 fixture 改编而非刷新：其脚本化的父级在同一步发出两次相同委派，而 WP1 同 step 去重现在会用已记录结果直接复用第二次调用（改动前已在基线 worktree 上验证一致），因此该场景当时改为脚本化 ALPHA 与 BETA 两次委派，以继续锻炼两个真实并行的子代理。这一不同委派的改编重新暴露了并发 children 的回放绑定竞态；[孪生回放确定性 note](../testing/2026-11-10-subagent-parallel-twin-replay.md) 已将其替换为逐字节相同的孪生委派加一个禁用该 guard 的场景 overlay。
- `subagent-diagnostic` 需要一行 harness 修正：父日志查找匹配的裸子串也出现在子日志的 `parentSession` 字段里，现改为匹配会话头 id。
- `subagent-child-question-rejection` 不再共享 `text-turn` 的 system-prompt golden：其组合插入 `tool-ask-user`，父级提示词现携带 ask-user 段，该场景改为拥有自己的 golden。
- 约定顺序区间新增 `10` 方法论槽位；[提示词归属 note](../architecture/2026-07-05-prompt-variables-and-tool-guidance-ownership.md) 记录该区间事实且其余不变——每工具语义仍在 description，跨调用习惯仍在段中。`SessionEventMap` 不变：该段是提示词家具，不是日志事件。
- Supersession 检查：没有活动 note 拥有方法论提示词内容或指导段约定；2026-07-05 归属 note 被扩展（一条区间事实）并交叉链接，不构成 supersession；2026-11-08 程序提案仍是 W7 的归属决策记录。
