# Agent Note：工具调用标签在缺省 description 时依然成立

Status: implemented

[English](2026-08-18-optional-tool-descriptions.md) | 中文

## 问题

`run_code` 与 `bash` 把 `description` 声明为必填字符串并在执行期拒绝空串。上下文压力下的模型会省略或留白——现场观测到同一会话以此失败五次以上（`missing required property "description"` 或 `invalid description: expected a non-empty string`），每次都是不携带任务信号的白费往返。`run_code` 内部该失败还会放大：一个嵌套 `tools.bash({command})` 缺 description 就废掉整个程序。

## 决策

两处 schema 将该参数改为可选，展示层在省略或空白时派生调用标签：程序首个有效行（`deriveRunCodeTitle`）或命令首行（`deriveBashDescription`），剥注释标记、60 字符封顶。两个助手均为纯导出，日志参数回放可精确复现标签。空串拒绝测试替换为省略路径覆盖。`workflow` 的 `meta.description` 保持必填：它是工作流的身份数据而非展示标签。

## 备选方案

- **保持必填、改进报错文案。** 失败仍耗一次往返，且模型未必总能补上该字段。派生标签直接消灭这一失败类别，而非描述它。
- **仅 UI 层派生。** 标签将依赖渲染期状态，会话日志不再决定模型所见。在「从参数展示」处派生保住了「model-visible ⟺ logged」。

## 影响

无 description 的调用在 UI 头部显示命令/程序首行而非人工摘要——对终端卡片本就按命令命名的标签而言可接受。模型给出的 description 恒优先。

## 测试

`packages/shell/tool-bash` 与 `packages/core/tools` 套件钉住两个方向：省略产出派生标签、给出则原样透传。装配 transcript 快照覆盖模型收到的工具声明。
