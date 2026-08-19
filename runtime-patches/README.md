# runtime-patches（运行时手工补丁备份）

官方 npm 包尚未携带、但已在本机运行时手工落地的修复。任何 `@deepseek-ai/dsh` 全局重装或 `~/.dsh/profiles` 重建（含升级 rc.7+）都会覆盖这些文件——覆盖后按本 README 重放即可。

## 补丁 1：bash description 可选（dsh-tool-bash）

源码修复已提交（`packages/shell/tool-bash/src/index.ts`，见 Agent Note 2026-08-16-session-friction-fixes），等上游发 rc.8+ 自然对齐。编译产物补丁把三处落地：

- 删除空 description 抛错（`invalid description: expected a non-empty string`）
- 缺省时从命令首行派生标签（`deriveBashDescription`，60 字符封顶）
- schema 去掉 `required: true`，参数说明标注可选与回退行为

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

## 补丁 3：Think 行流式自动展开/折叠（dsh-client-ui-conversation）

源码已提交（`packages/client/ui-conversation/src/client/chat/ReasoningRow.tsx`，fc78ffeb9f）。GUI 加载的是 `~/.dsh/profiles/.../dsh-client-ui-conversation/lib/client.js`，若被官方更新覆盖：优先从本仓库源码重建 bundle（`pnpm run build:lib:client` 后同步到 profiles），或临时用快照恢复：

`sh`
cp runtime-patches/backups/dsh-client-ui-conversation.lib.client.repo-built.js \
  ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js
`

恢复后重启 GUI（退出 app 重开）即生效。

## 快照清单（backups/）

| 文件 | 来源 | 时间 |
|---|---|---|
| dsh-tool-bash.lib.index.global-rc6.patched.js | 全局安装副本（rc.6 + 补丁） | 2026-08-18 |
| dsh-tool-bash.lib.index.profiles.patched.js | ~/.dsh/profiles 副本（rc.6 + 补丁） | 2026-08-18 |
| dsh-client-ui-conversation.lib.client.repo-built.js | repo 源码构建的 GUI bundle | 2026-08-18 |
| dsh-code-runtime-worker-thread.lib.index.patched.js | 全局安装副本（rc.6 + 补丁 2） | 2026-08-18 |

注意：快照是对应版本时刻的产物；跨版本恢复优先用重放脚本（补丁 1）或源码重建（补丁 2），快照仅作兜底。