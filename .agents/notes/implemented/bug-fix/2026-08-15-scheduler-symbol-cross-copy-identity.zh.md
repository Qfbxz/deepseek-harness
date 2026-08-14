# Agent Note：工具调度器符号在重复包副本间共享同一身份

Status: implemented

[English](2026-08-15-scheduler-symbol-cross-copy-identity.md) | 中文

## 问题

Profile 安装的插件把 `@deepseek-ai/dsh-*` 包声明为 npm 依赖，于是 `dsh plugin add` 会在 `~/.dsh/profiles/<profile>/node_modules/` 下物化出这些包的第二份物理副本，与桌面宿主内置的那份并存。依赖布局的任何变化（例如 lockfile 重建）都可能让这套闭包浮现；profile 层没有任何机制阻止它。

`TOOL_RUNTIME_SCHEDULER` 原本是每模块各建一次的 `Symbol()`。两个模块副本因此持有两个描述相同、身份不同的符号。当某个组合从一份副本解析 `dsh-agent-loop`、而从另一份解析 `tools` 服务时，`ctx.tools[TOOL_RUNTIME_SCHEDULER]` 读到 `undefined`，`startCall` 在 `.prepare` 上失败——该上下文里的每一次工具调用都以 `Cannot read properties of undefined (reading 'prepare')` 死亡，轮次上报为 `UNKNOWN`。在暴露此问题的事故中，子代理的全部工具调用都以这种方式失败，而主会话一直正常，因为只有子代理组合跨越了两份副本。

## 决策

调度器改经全局符号注册表注册：`Symbol.for('@deepseek-ai/dsh-tools.scheduler')`。注册表键就是包文档记载的名称，因此任何版本、任何副本只要采用同样的注册方式即可互操作，与 pnpm 物化出多少副本、某个组合解析到哪一份无关。对副本本身去重（workspace 别名、仅宿主解析）是打包策略层面的改动，有各自的失败模式；身份层面的注册在不触碰依赖布局的前提下修复了跨副本契约。

## 验证

`tests/scheduler-symbol.spec.ts` 固化契约：导出符号等于文档键上的 `Symbol.for` 结果——注册表保证任何采用同样注册方式的副本共享同一身份。事故复现——一个自带 `dsh-tools` 副本的 profile 闭包驱动子代理工具调用——在宿主副本改用全局注册表后，从普遍的 `reading 'prepare'` 失败变为干净执行。
