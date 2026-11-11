# Agent Note: The root dsh-root build entry is existence-guarded and the micromark-util-types split is deduped

Status: implemented

[English](2026-11-11-dsh-root-tsdown-entry-dead-glob.md) | 中文

## Problem

根工作区包 `@deepseek-ai/dsh-root` 是纯记账包：没有 `src/`、没有 `exports`、没有 `files`，`src/` 与 `lib/types/` 无任何 git 历史，全仓库没有任何子路径消费方。但 `tsdown.config.ts` 的构建入口声明了 `lib/types/{index,invariant,startup}.js`。这三个文件只是某份工作副本里来历不明的陈旧产物。2026-11-11 两个事件先后暴露了这处潜伏断裂：版本 bump 到 0.2.3-rc.1 让缺失的 `startup.js` 现形（此前 glob 只解析到两个），而首次物理同步的安装把 lockfile 里长期存在的 `micromark-util-types` 分裂实体化（20 处 snapshot 引用 2.0.3，对上两个精确 2.0.2 钉），使 `packages/client/ui-primitives/src/markdown/parse.ts` 的 Host 类型检查以 `micromark-util-types` 2.0.2/2.0.3 声明不兼容而失败。逆向排查确认：仓库内不存在任何源码、生成器或产出器可以产生 root 产物——上游同样处于这一潜伏状态，其唯一的历史消费方是上游独有的 `scripts/build-exe-for-ssh-helper.ts` exe 构建——因此恢复产物并非可选项，构建必须在没有它们的前提下变得确定。

## Decision

`tsdown.config.ts` 的 root 入口改为存在性守卫：`index.js`、`invariant.js`、`startup.js` 在磁盘上存在时打包进 `dsh-root` 成员，缺失时跳过该成员（空 entry，与 Client face 已有的形态一致）。lockfile 去重后所有 `micromark-util-types` 解析统一为 2.0.3；两个精确 2.0.2 钉随之收敛，物理重复份在下一次安装时消失。上游保留其抛错 glob 与自身的潜伏产物依赖；按所有者指示，本 note 与修复仅在本地记录，不提交上游。

## Alternatives considered

**恢复产物或为其编写生成器。** 否决：无可恢复之物——上游没有源码、仓库没有生成器，凭空造桩产物等于重建刚才断裂的未声明状态依赖。

**将 glob 对齐上游的两名形态（`index,startup`）。** 否决：干净检出下仍会以同样原因抛错；对齐上游保留缺陷而非消除缺陷。

**维持现状并把陈旧产物文档化为必需本地状态。** 否决：每一个新克隆或重新同步的安装都会让 `pnpm run typecheck`、pre-push 钩子与 `doc-typecheck` 因一个无法复现也无法修复的原因失败。

## Consequences

`pnpm run typecheck`、pre-push typecheck 任务与 `doc-typecheck` 现在在完全没有根 `lib/` 的干净检树上通过；宿主构建不再在入口解析处失败，Client face 不受影响。未来若出现 root `lib/types` 产物的生产者（例如恢复 SSH-helper exe 构建），入口会重新打包而无需改配置。上游潜伏缺陷仅在此记录；从上游同步时不得重新引入抛错 glob。dedupe 后 `micromark-util-types` 全量解析为 2.0.3，按精确 2.0.2 钉编写的代码须遵循 2.0.3 声明；store 中仅存的 2.0.2 物理条目无引用，下次 prune 时消失。
