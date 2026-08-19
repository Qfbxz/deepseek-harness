# Agent Note: 侧边栏设置行新增专属动作座位

Status: implemented

## Problem

侧边栏 footer 的所有动作按钮堆在设置按钮上方，实际一个全宽按钮占一行：占用者自带激进几何（内联 `width:100%`、`flex:1` 层，甚至有占用者给 shell 的 `footerActions` 容器内联写 `column`），256px 的栏里五个按钮花掉四行。语义上属于设置旁边的入口——auto-memory 的「记忆」——没有座位：`sidebar.settings` 是 `kind: 'single'`（ui-settings 独占），第二个注册者进不去。

## Decision

- 新增 list 型孔 `sidebar.settings.action`（owner props 与 `sidebar.footer.action` 相同：列状态 `wide`），渲染在 `settingsArea` 内、设置触发器之前。设置行为右对齐 flex 行；触发器在此行按内容收窄而非占满。
- `footerActions` 改为可换行 row + `space-between`——shell 的行策略，用作用域化的 `!important` 压过占用者的内联样式（width、flex、以及被占用者内联写成 `column` 的容器方向）。这是"占用者自有按钮几何"的**文档化例外**：footer 内部行打包优先。
- 折叠 rail 保持垂直堆叠（column、居中）。

## Alternatives considered

- **经 `sidebar.settings` 注册到设置旁。** single 型孔；第二个注册者是契约违反，不是绕行。
- **DOM 重挂按钮到设置行。** React 下次渲染即冲掉或崩溃。
- **保持堆叠、只收窄按钮。** 内联 `width:100%`/`flex:1`/`column` 组合击穿非 important 的 shell 规则；四行五按钮依旧。

## Consequences

- footer 渲染为 2–3 行：一条可换行动作行（含溢出行），随后 `[动作…] 设置` 紧凑右对齐。
- auto-memory 按钮经 `runtime-patches/replay-auto-memory-settings-row.mjs`（补丁 15）带大脑图标挂上新座位；仓库构建的 ui-sidebar 产物经 `replay-ui-sidebar-settings-action.mjs`（补丁 16）在上游发孔之前覆盖同步官方安装。
- 之后想上设置行的占用者注册 `sidebar.settings.action` 即可；既有 `sidebar.footer.action` 注册者除行打包外无感知。
