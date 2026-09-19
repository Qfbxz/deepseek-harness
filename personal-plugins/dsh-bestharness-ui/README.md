# dsh-bestharness-ui

Claude Code Spinner 渲染机制的 DSH Web 移植（BestHarness 舰队 UI 插件）。

## 功能

**1. 生成状态动画**——增强 DSH 原生状态条（`.turnStatus`，"Deep diving..." 行）为 Claude Code 同款：

| 要素 | Claude 源码出处 | 本实现 |
|---|---|---|
| 帧动画 glyph | SpinnerGlyph.tsx：darwin 字符集 + reverse，120ms/帧 | 同款 `·✢✳✶✻✽` 弹跳循环 |
| 随机动词 | Spinner.tsx：每 turn `sample()` 一次 | 35 词池（Claude 精选 + DSH 品牌词） |
| token 平滑跳动 | SpinnerAnimationRow.tsx：50ms 三档追赶（gap<70→+3 / <200→15% / else+50） | 同逻辑，真实 usage（优于 Claude 的 /4 估算） |
| 停滞渐红 | useStalledAnimation.ts：无新 token 渐变 rgb(171,43,63) | 同款插值，12s 宽限 + 工具运行时豁免 |
| 微光 | GlimmerMessage | CSS background-clip:text 扫过，2.4s 周期 |
| 降级 | prefers-reduced-motion → '●' + 无动画 | 同款 |

**2. /clear 命令**——Claude /clear 的 DSH 等价：输入 `/clear` 回车 = 新建会话并切换
（DSH 会话是一等实体，旧会话保留可回溯——这是设计哲学差异，不是丢失）。
实现为捕获阶段 keydown 拦截 + 复用 sidebar 官方新建按钮 `click()`（同一条代码路径，
零 host 面）；Shift+Enter / 输入法组合 / 找不到按钮时一律放行原提交，绝不吞输入。

## 架构

- **host**（index.mjs）：惰性折叠 live 会话 usage（usage-all 生产模式，O(new events)）+
  `/api/bh-ui/live` exact 路由（loopback fence：非 GET 405、非本机 403）。
  聚合：turnTokens（turn 内 outputTokens 之和，turn:start 归零）/ totalTokens /
  lastUsageAt / openTools（call-result 配对计数）。turn:step 去重防双计。
- **client**（client.mjs）：MutationObserver 锚定 `[role=status][aria-live=polite]`（TurnStatus
  语义锚点），追加 glyph/verb/token 元素（React-owned 节点零移动零删除），改写首文本节点为
  随机动词（React props 不变不回写）。1s 轮询 + rAF 50ms 追赶。状态条卸载时全部自清还原。

## 负优化防护

- 纯增强：锚点找不到 / fetch 失败 / 插件卸载 → DSH 原生状态条原样可用。
- 只读聚合：host 无监听注册无定时器。
- 数据安全：loopback 双检（peer socket + Host header）。
