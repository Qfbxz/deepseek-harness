#!/usr/bin/env node
// 补丁 14：dsh-client-auto-continue 注册 settings.plugin.item 时缺 options.key，
// keyed slot 校验拒绝 → 插件整体加载失败（"Failed to load plugins"）。
// 上游：HsiangNianian/dsh-auto-continue；对齐 dshmarket/vision-router 的 key 传法。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const target = process.argv[2]
if (!target) { console.error('usage: replay-auto-continue-slot-key.mjs <client.js>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('patch(slot-key)')) { console.log('[skip] already patched:', target); process.exit(0) }
const OLD = '        name: "settings.plugin.item",\n        id: SETTINGS_NS,'
const NEW = '        name: "settings.plugin.item",\n        /*patch(slot-key)*/key: SETTINGS_NS,\n        id: SETTINGS_NS,'
if (!s.includes(OLD)) throw new Error('slot register anchor missing')
s = s.replace(OLD, NEW)
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target)
