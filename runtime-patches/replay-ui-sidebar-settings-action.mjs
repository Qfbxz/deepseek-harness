#!/usr/bin/env node
// 补丁 16：把仓库构建的 dsh-client-ui-sidebar（含 sidebar.settings.action 孔）同步到
// 全局安装。官方升级会覆盖回无孔版本——本脚本按 marker 幂等重同步。产物快照在
// runtime-patches/backups/（随 git 提交，换机可用）；改了 ui-sidebar 源码后需
// `pnpm --filter @deepseek-ai/dsh-client-ui-sidebar bundle` 并刷新快照。
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const target = process.argv[2]
if (!target) { console.error('usage: replay-ui-sidebar-settings-action.mjs <global client.js>'); process.exit(1) }
const SRC = join(dirname(fileURLToPath(import.meta.url)), 'backups', 'dsh-client-ui-sidebar.lib.client.settings-action.js')
const marker = 'sidebar.settings.action'
let t = readFileSync(target, 'utf8')
if (t.includes(marker)) { console.log('[skip] already has the settings-action hole:', target); process.exit(0) }
const built = readFileSync(SRC, 'utf8')
if (!built.includes(marker)) throw new Error('repo-built snapshot lacks the hole — rebuild and refresh the backup')
copyFileSync(SRC, target)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target)
