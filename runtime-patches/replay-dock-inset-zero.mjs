#!/usr/bin/env node
// 补丁 28：dock 条对齐输入卡——官方设计 --dsh-composer-dock-inset:8px 使 goal/queue/todo/
// 我的消息条每侧比输入卡窄 8px（用户 2026-08-20 定稿改为齐平）。dsh 升级重装官方 dist
// 后变量退回 8px，本补丁在 ui-conversation 的 client bundle 中将其重写为 0px。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const target = process.argv[2]
if (!target) { console.error('usage: replay-dock-inset-zero.mjs <ui-conversation client.js>'); process.exit(1) }
let src = readFileSync(target, 'utf8')
if (src.includes('dock-inset:0px')) { console.log('[skip] already patched:', target); process.exit(0) }
const OLD = 'dock-inset:8px'
const NEW = 'dock-inset:0px'
if (!src.includes(OLD)) throw new Error('dock-inset:8px not found in ' + target + ' — upstream may have changed the variable name or value')
src = src.split(OLD).join(NEW)
writeFileSync(target, src)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target)
