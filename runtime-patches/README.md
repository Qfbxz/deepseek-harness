# runtime-patches（运行时手工补丁备份）

> **客户端插件（client.mjs）补丁生效链（2026-08-19 实测）**：生产模式 client 插件不在主 bundle——host 启动读源码经 `/plugins/<pkg>/client.js?rev=<内容哈希>` 服务（manifest 在 `window.__DSH_BOOT__.entries`）。改 client.mjs 后必须：**重启 dsh web（host 重读+rev 更新）→ 刷新浏览器（拉新 rev）**。`/plugin/...`（单数）是 SPA 404 兜底假 200，勿信。dev:web 同跑才有热更。

官方 npm 包尚未携带、但已在本机运行时手工落地的修复。任何 `@deepseek-ai/dsh` 全局重装或 `~/.dsh/profiles` 重建（含升级 rc.7+）都会覆盖这些文件——**2026-08-24 起无需手动重放**：启动自愈 + 运行中看护 + 文件监听三层插件按三态机理（见「自动化」节）自动恢复或退役；本 README 的手动重放命令保留作兜底与离线恢复路径。

## 构建管线已修复（2026-08-24）

`pnpm run build:lib`（host+client，342 单元）已在本机跑通。此前 `[@deepseek-ai/dsh-root] Cannot find entry` 的根因：profile `link:` 安装把社区插件依赖骨架（空 node_modules、无 package.json/lib）提升到 `packages/community/*`，tsdown workspace 枚举把每个骨架当构建单元、继承根 entry glob 相对空目录解析为空，报错标签经向上 config 查找误取根包名。修复：`tsdown.config.ts` 的 workspace 改对象形式并 exclude `packages/community/**`（源码级，非环境妥协）。**「从本仓库源码重建 bundle」路径自此可用**：`pnpm run build:lib` 后将产物同步到全局/profiles 即可。

## 自动化（2026-08-24 起；2026-08-24 二次升级为三态全自动）

### 三态检测机理（现行）

幂等基准是**官方产物的坏形态**（`badPattern`），不是我们注入的好代码：

| 检测 | 判定 | 动作 |
|---|---|---|
| marker（我们的修复）在场 | 已打补丁 | 零动作 |
| marker 缺 + 坏形态在场 | 官方仍坏 | 自动重放恢复 |
| marker 缺 + 坏形态也缺 | 官方已修复/重构掉 | **RETIRED 自动退役**：日志一次，永不再试 |

唯一人工态：坏形态在场但 replay 锚点失配（官方重构且坏行为原样保留）→ 状态感知提醒（首条详记 + 每 50 次摘要 + 恢复转场），不刷屏。官方修复版发布后补丁**自动退役**，无需人工删除 replay 脚本（确认日志后可顺手清理）。

### 载体（三层）

1. **启动全量重放**：`~/.dsh/profiles/web/plugins/dsh-local/runtime-patches-autorun.mjs`（id `runtime-patches-autorun`）——每次 dsh web 启动重放全部 replay 脚本（幂等、单一事实源指向本目录）。已实测 `npm install -g --force` 冲掉后一次跑齐 5 个 `[patched]`。
2. **运行中看护**：`~/.dsh/profiles/web/plugins/dsh-local/runtime-patches-watchdog.mjs`（id `runtime-patches-watchdog`）——默认 30s 巡检 6 个标记，按上表三态处置；服务运行中发生的重装/升级无需等重启。双场景实测：官方原版覆盖 → restored；构造官方修复近似形态 → RETIRED。日志 `~/.dsh/runtime-patches-watchdog.log`。
3. **文件监听**：`~/.dsh/profiles/web/plugins/dsh-local/reasoning-row-watch.mjs`（id `reasoning-row-watch`，补丁 3 专用）——启动检查 + `fs.watch` 监听 client.js，升级写入瞬间防抖 2s 重打。

三个插件均在 cordis.patch.yml 注册，仓库目录（本 README 所在处）不在时静默跳过，不阻塞启动。

## 补丁 1：bash description 可选（dsh-tool-bash）

源码修复已提交（`packages/shell/tool-bash/src/index.ts`，见 Agent Note 2026-08-16-session-friction-fixes），等上游发 rc.8+ 自然对齐。编译产物补丁把三处落地：

- 删除空 description 抛错（`invalid description: expected a non-empty string`）
- 缺省时从命令首行派生标签（`deriveBashDescription`，60 字符封顶）
- schema 去掉 `required: true`，参数说明标注可选与回退行为

补丁 2 的 scanner 升级：源码 scanner 扩展（相邻字面量检测）后，用 `upgrade-scanner-from-source.mjs` 从源码 ts 提取最新版替换编译产物中的同名函数：

```sh
node runtime-patches/upgrade-scanner-from-source.mjs \
  packages/code-runtime/code-runtime-worker-thread/src/index.ts \
  "$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-code-runtime-worker-thread/lib/index.js"
```

重放（幂等，可重复执行；升级 dsh 后跑一次）：

`sh`
node runtime-patches/replay-tool-bash-optional-description.mjs \
  "$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-bash/lib/index.js" \
  ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-bash/lib/index.js
`

## 补丁 2：run_code description 可选（dsh-tools 编译层）

源码修复已提交（见 PR-A 2026-08-18-optional-tool-descriptions）。编译层在 dsh-tools 的 code-mode，不在 dsh-tool-bash。把同样的修复带进运行时：移除 description 参数的 required: true、移除执行期空串拒绝 throw、注入 deriveRunCodeTitle 从首行派生标签（PR-A 等价语义）：

`sh`
node runtime-patches/replay-run-code-optional-description.mjs \
  "$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js"
`

## 补丁 3：省略的绑定参数记录归一为空对象（worker.cjs makeNamespaces）

源码修复已提交（a24b60b73c，见 Agent Note 2026-08-19-binding-omitted-args-empty-object）。全可选 schema 的零参调用（`tools.job_list()`）此前被误判为不可序列化并以 `binding arguments must be lossless JSON` 拒绝。补丁在 worker.cjs 的绑定包装器注入 `args === undefined ? {} : args` 归一（注意：worker.cjs 与 index.js 是同包两个文件，本补丁打 worker.cjs，补丁 2 打 index.js，升级后都要重放）：

`sh`
node runtime-patches/replay-worker-binding-omitted-args.mjs \
  "$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-code-runtime-worker-thread/lib/worker.cjs"
`

## 补丁 4：run_code 解析失败提示与未闭合字面量定位（dsh-code-runtime-worker-thread）

源码修复已提交（见 Agent Note 2026-08-16-session-friction-fixes 第 5 条 + 3f95abbcf0 补强）。补丁让 `stripTypeScriptTypes` 阶段的 SyntaxError 携带补救提示与未闭合字符串/模板的起始行 —— 此前 `Expected ',', got '<eof>'` 毫无位置信息。注意 `~/.dsh/profiles` 下该包软链到全局，只需打全局一份：

```sh
node runtime-patches/replay-code-runtime-parse-hint.mjs \
  "$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-code-runtime-worker-thread/lib/index.js"
```

## 补丁 5：对象抛错结构化序列化（worker.cjs + dsh-tools 双副本）

源码修复已提交（`packages/code-runtime/code-runtime-worker-thread/src/bootstrap.ts` 新增 `renderThrownValue`、`packages/core/tools/src/code-mode.ts` 新增 `errorMessage`）。真根因在 worker 序列化层：`prepareException` 用 `String(detail)` 把程序抛出的对象压成 `[object Object]` 字面量，host 端任何修复都来不及介入（到达时已是字符串）。补丁把三个运行时副本一并落地：

- `dsh-code-runtime-worker-thread/lib/worker.cjs`：注入 `renderThrownValue`（对象→`JSON.stringify`，循环引用→`util.inspect`），抛点改用它
- `dsh-tools/lib/index.js`：该文件自带 `errorMessage` helper，抛点接入
- `dsh-tools/lib/types/code-mode.js`：注入 helper + `node:util` import + 抛点接入

重放（幂等，可重复执行；升级 dsh 后跑一次）：

```sh
node runtime-patches/replay-object-throw-serialization.mjs
```

效果：`throw { code: 499 }` 从 `Error: code run failed (exception): [object Object]` 变为 `Error: code run failed (exception): {"code":499}` —— 模型可读的结构化诊断，可自我纠正。

已在 0.1.0-rc.7 全量重放验证（补丁 1–5 一次过）。锚点引号风格随 tsc 版本漂移（rc.6 双引号、rc.7 单引号），`RUN_CODE_NAME` 锚点已做双引号回退兼容；若未来版本再失配报 `fn anchor missing`，先核对产物引号。

## 补丁 6：Think 行流式自动展开/折叠（dsh-client-ui-conversation）— 已插件化自愈

源码已提交（`packages/client/ui-conversation/src/client/chat/ReasoningRow.tsx`，fc78ffeb9f）。**2026-08-24 起升级免疫**：web profile 的启动+运行时自愈插件 `~/.dsh/profiles/web/plugins/dsh-local/reasoning-row-watch.mjs`（cordis.patch.yml 注册，id `reasoning-row-watch`）在 dsh web 启动时检查一次（覆盖启动前发生的升级），并 `fs.watch` 监听全局 `dsh-client-ui-conversation/lib/client.js`——CLI 升级写入的瞬间防抖 2s 后自动重打（npm pack 官方原版覆盖实测通过）。官方将 fc78ffeb9f 修复发进 npm 版后，原始坏形态消失，插件自动停止尝试（日志 `~/.dsh/reasoning-row-watch.log` 一条 pattern not found，可忽略）。补丁逻辑与 core-hygiene 的 patchReasoning 同源。手动恢复路径保留（源码重建或快照）：

`sh`
cp runtime-patches/backups/dsh-client-ui-conversation.lib.client.repo-built.js \
  ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js
`

恢复后重启 GUI（退出 app 重开）即生效。

## 补丁 7：abort reason 无损渲染 + parse 错误可疑行定位（dsh-code-runtime-worker-thread/lib/index.js）

源码修复（`packages/code-runtime/code-runtime-worker-thread/src/index.ts`）：abort 路径的 `String(signal.reason)` 把 DOMException/对象压成 `[object Object]`——新增 `renderAbortReason`（Error.message → 字符串 → JSON → 兜底）并给两处 abort 构造加 `aborted:` 前缀；无位置的 amaro SyntaxError 新增 `parseErrorLocator`（扫描原始程序首个引号/括号/悬挂转义不配平行，附加 `suspicious line N: <原文>`）。replay 从新构建产物 `lib/types/index.js` 原样提取两函数注入（与源码零漂移；**换机先 `npx tsc -b packages/code-runtime/code-runtime-worker-thread --force` 重建产物再重放**）。

```sh
node runtime-patches/replay-abort-reason-and-parse-locator.mjs \
  "$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-code-runtime-worker-thread/lib/index.js"
```

watchdog 条目 `p7-abort`（marker=`renderAbortReason`，bad=`String(request.signal?.reason)`，官方修复后自动退役）。

## 补丁 8：skill-explorer 认软链（dsh-client-ui-skill-explorer/lib/index.js）

根因：`readdir(withFileTypes)` 的 Dirent 对符号链接描述**链接自身**——软链 skill 目录 `isDirectory()/isFile()` 双 false，落入 else-continue 被**静默跳过**（文件系统 60 个、explorer API 只吐 59）。补丁在扫描循环加 `isSymbolicLink()` 分支：stat 跟链取目标真实类型（断链 continue）。同时 `~/.dsh/skills/spe-lit-search` 已放实体目录双保险（cc-switch 中央库仍为单源，`~/.agents` 等软链在 explorer 重启后经此补丁可见）。

```sh
node runtime-patches/replay-skill-explorer-symlinks.mjs \
  ~/.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-skill-explorer/lib/index.js
```

watchdog 条目 `p8-explorer-symlink`（marker=`patch(symlink-support)`，bad=原始 isFile 判定行）+ autorun 启动重放；插件作者修复（或改用其他扫描实现）后自动退役。

## 补丁 9：dsh-git-commit 提交面板向下展开（personal-plugins/dsh-git-commit/client.mjs）

源码修复已提交（`a53bd06fec`）。面板原默认向上展开（`top - height - 8`），被上方 tab 栏裁切；补丁改为默认从 chip 向下（`r.bottom + 8`），仅越过视口底部时回退向上，最终钳制 `top ≥ 8`。源即运行时（profile link 到 personal-plugins 源），replay 供任何副本回滚后重放：

```sh
node runtime-patches/replay-git-commit-panel-below.mjs \
  /Users/boergege/compile/优秀仓库参考/DeepSeek-Harness/personal-plugins/dsh-git-commit/client.mjs
```

watchdog 条目 `p9-git-panel-below`（marker=`patch(panel-below)`，bad=旧向上定位行）。

## 补丁 10：desktop-chrome git chip 锚行兜底（personal-plugins/dsh-desktop-chrome/client.mjs）

源码修复已提交（`816f3e1f72`）。panelHeader 折叠为 0 高时锚行算出 `top = -12`，git chip 被钉出屏；补丁在锚行高度 < 14 时依次回退 tabs 行、cluster rect，并把结果钳制到视口顶部（`top ≥ 2`）。源即运行时，replay 供回滚后重放：

```sh
node runtime-patches/replay-desktop-chrome-anchor-fallback.mjs \
  /Users/boergege/compile/优秀仓库参考/DeepSeek-Harness/personal-plugins/dsh-desktop-chrome/client.mjs
```

watchdog 条目 `p10-chip-anchor`（marker=`patch(anchor-fallback)`，bad=旧锚行取 top 行）。

## 补丁 11：git-graph 分支 chip 恒渲染（@linxin666/dsh-client-ui-git-graph）

第三方包（不在本仓库）：非 git 会话原直接 `return null`，chip 整个消失；补丁改为渲染禁用占位（label "—"、onClick 禁用），仅 `showBranchSelector` 关闭或 repo 未就绪时才隐藏。升级重装该包后需重放：

```sh
node runtime-patches/replay-git-graph-chip-always.mjs \
  ~/.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-git-graph/lib/client.js
```

watchdog 条目 `p11-chip-always`（marker=`patch(chip-always)`，bad=旧 guard 行；插件作者修复后自动退役）。

## 补丁 12：run_code discard 诊断 + 绑定结果 24k 钳制（dsh-tools/lib/types/code-mode.js）

源码修复：discard 诊断部分已提交（`de98efaac`，`packages/core/tools/src/code-mode.ts`）；`clampBindingValue` 增量在源码中、待提交。旧形态 `run is over ... result discarded` 不区分工具成败，模型只能盲重试；超大绑定返回值（如 50 KB bash stdout）会撑爆输出账本并以不透明 abort 收场。replay 从本仓库构建产物 `packages/core/tools/lib/types/code-mode.js` 原样提取注入（新 discard 诊断：errored/succeeded + JSON 尺寸签名 + side-effects 提示；`clampBindingValue`：字符串 24k 截断、数组/对象递归逐元素钳制）。**换机先 `npx tsc -b packages/core/tools --force` 重建产物再重放**。

```sh
node runtime-patches/replay-discard-diagnostic.mjs \
  "$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/types/code-mode.js"
```

watchdog 条目 `p12-discard-diagnostic`（marker=`clampBindingValue`，bad=`result discarded`，官方修复后自动退役）+ autorun 启动重放。

## 补丁 13：git-graph 分支弹出层向下展开（@linxin666/dsh-client-ui-git-graph）

第三方包（不在本仓库）：分支选择弹出层原以 `bottom:calc(100% + 4px)` 锚在 chip **上方**展开，而 chip 位于顶栏，整层顶出屏幕不可见；补丁对齐同包 `popoverHero` 的向下语义（`top:calc(100% + 4px); bottom:auto`）。升级重装该包后需重放：

```sh
node runtime-patches/replay-git-graph-popover-below.mjs \
  ~/.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-git-graph/lib/client.js
```

watchdog 条目 `p13-popover-below`（marker=`patch(popover-below)`，bad=旧 `bottom:calc(100% + 4px);left:0` 定位；插件作者修复后自动退役）。生效需重启 dsh web 并刷新浏览器（client 插件按 rev 拉取）。

## 补丁 14：auto-continue 设置卡注册缺 key（dsh-client-auto-continue）

第三方包（HsiangNianian/dsh-auto-continue）：注册 `settings.plugin.item` 时只传 `id` 未传 `key`，keyed slot 校验拒绝 → 插件整体加载失败（"Failed to load plugins: dsh-client-auto-continue"）。补丁对齐 dshmarket/vision-router 的传法，在 register options 补 `key: SETTINGS_NS`。升级重装该包后需重放：

```sh
node runtime-patches/replay-auto-continue-slot-key.mjs \
  ~/.dsh/profiles/web/node_modules/dsh-client-auto-continue/lib/client.js
```

watchdog 条目 `p14-auto-continue-slot-key`（marker=`patch(slot-key)`，bad=无 key 的相邻行对；上游补 key 后自动退役）。

## 补丁 15：auto-memory「记忆」按钮迁设置行 + 大脑图标（@a9i5k4/dsh-auto-memory）

第三方包：按钮原注册在 `sidebar.footer.action`（堆在设置上方）。补丁两步（各自幂等）：a. 迁到 `sidebar.settings.action`（ui-sidebar 源码新增的设置行孔，见补丁 16）——与孔的恢复顺序无关，slot inject 会等声明出现；b. 按钮注入 lucide brain 轮廓图标（14px 描边、currentColor）。上游原生改挂设置行则步骤 a 自动跳过。

```sh
node runtime-patches/replay-auto-memory-settings-row.mjs \
  ~/.dsh/profiles/web/node_modules/@a9i5k4/dsh-auto-memory/lib/client.js
```

watchdog 条目 `p15-auto-memory-settings-row`（marker=`patch(settings-row)`，bad=旧 footer.action 注入）。

## 补丁 16：ui-sidebar 设置行孔位同步（@deepseek-ai/dsh-client-ui-sidebar）

源码修复在本仓库（`packages/client/ui-sidebar`：新增 `sidebar.settings.action` 孔 + footer 单行换行布局策略）。官方升级会覆盖回无孔版本——本补丁把 backups/ 里的仓库构建产物幂等重同步到全局。**改了 ui-sidebar 源码后需 `pnpm --filter @deepseek-ai/dsh-client-ui-sidebar bundle` 并刷新 backups/ 快照**。注意：官方发版但未带孔时，重同步会盖掉官方新产物（个人取舍，接受降级换孔位）。

```sh
node runtime-patches/replay-ui-sidebar-settings-action.mjs \
  "$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js"
```

watchdog 条目 `p16-ui-sidebar-settings-action`（marker=`sidebar.settings.action`，bad=恒在的 `sidebar.footer.action` 声明 → 官方带孔后自动停用）。

## 补丁 17：导出按钮桌面化（@dsh-external/dsh-mobile-nav）

第三方包：`导出会话日志`按钮默认仅移动端显示（≥1024px 媒体查询隐藏）。补丁四步（各自幂等）：a. 把 session-log 与容器 drawer-actions 从桌面隐藏列表摘出（文件浏览 explorer 保持仅移动端）；c. 改名 `导出`（en: Export）；d. 图标 = 导入图标的框 + 垂直箭头从框内刺出框外（从里面指向外）；e. 按钮去边框。

```sh
node runtime-patches/replay-mobile-nav-desktop-session-log.mjs \
  ~/.dsh/profiles/web/node_modules/@dsh-external/dsh-mobile-nav/lib/client.js
```

watchdog 条目 `p17-desktop-session-log`（marker=`patch(desktop-session-log)`，bad=隐藏列表中的 session-log 行）。

## 补丁 19：导入按钮精简文案（dsh-chat-import）

第三方包：`导入会话`→`导入`（tooltip 保留完整说明"从其他工具导入会话…"）。

```sh
node runtime-patches/replay-chat-import-short-label.mjs \
  ~/.dsh/profiles/web/node_modules/dsh-chat-import/lib/client.js
```

watchdog 条目 `p19-chat-import-short-label`（marker=新文案，bad=旧文案）。行内四键的顺序与间距（图标对间距拉大、space-evenly）在 ui-sidebar 源码 CSS（补丁 16 同步）。

## 补丁 18：用量徽章迁设置行（dsh-usage-stats）

第三方包：用量徽章原注册在 `sidebar.footer.action`。补丁两步（各自幂等）：a. 迁到 `sidebar.settings.action`（order 提到 1，排在记忆左侧，用量占行内剩余宽度）；b. 废除其"把宿主容器内联改成 column"的兼容副作用（设置行必须保持 row）。

```sh
node runtime-patches/replay-usage-stats-settings-row.mjs \
  ~/.dsh/profiles/web/node_modules/dsh-usage-stats/lib/client.js
```

watchdog 条目 `p18-usage-settings-row`（marker=`patch(settings-seat)`，bad=旧 footer.action 注入）。绿色余量百分比的固定定位在 `personal-plugins/dsh-desktop-chrome/client.mjs`（源码，非补丁）。

## 补丁 20：agency-agents 客户端注入自有专家（@michengai/dsh-agency-agents）

第三方包：客户端把 271 内置专家硬编码在 `ROSTER` 常量，输入框 picker 只认这份静态清单（设置页才是动态读宿主目录的）——外部目录的专家在 picker 里永远"暂无可召唤"。补丁从 `~/.dsh/experts/0-masters/` 读 persona，注入 ROSTER / DIVISION_ORDER / ZH_NAME / ZH_DIVISION 四处（标记块可重跑刷新），picker 与设置页一致置顶显示。

```sh
node runtime-patches/replay-agency-own-roster.mjs
```

watchdog 条目 `p20-agency-own-roster`（marker=`/*patch(own-roster)*/`，bad=原版 ROSTER 首条目；上游改为动态名册后自动退役）。启用状态在 `~/.dsh/settings.yaml` 的 `agency-agents.enabled`（插件默认全部停用）。

## 快照清单（backups/）

| 文件 | 来源 | 时间 |
|---|---|---|
| dsh-tool-bash.lib.index.global-rc6.patched.js | 全局安装副本（rc.6 + 补丁） | 2026-08-18 |
| dsh-tool-bash.lib.index.profiles.patched.js | ~/.dsh/profiles 副本（rc.6 + 补丁） | 2026-08-18 |
| dsh-client-ui-conversation.lib.client.repo-built.js | repo 源码构建的 GUI bundle | 2026-08-18 |
| dsh-code-runtime-worker-thread.lib.index.patched.js | 全局安装副本（rc.6 + 补丁 2） | 2026-08-18 |
| dsh-client-ui-sidebar.lib.client.official-rc7.js | 官方原版（补丁 16 同步前的回滚底） | 2026-08-20 |
| dsh-client-ui-sidebar.lib.client.settings-action.js | repo 构建（含 settings.action 孔，补丁 16 的同步源） | 2026-08-20 |

注意：快照是对应版本时刻的产物；跨版本恢复优先用重放脚本（补丁 1）或源码重建（补丁 2），快照仅作兜底。