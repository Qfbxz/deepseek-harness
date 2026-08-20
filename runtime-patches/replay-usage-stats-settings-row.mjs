#!/usr/bin/env node
// 补丁 26：usage-stats 0.1.16 的徽章迁到设置行专属座位 sidebar.settings.action
//（ui-sidebar 源码新增的孔），排在记忆（order 5）之前（order 1），紧凑间距。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const target = process.argv[2]
if (!target) { console.error('usage: replay-usage-stats-settings-row.mjs <client.js>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('patch(settings-seat-v2)')) { console.log('[skip] already patched:', target); process.exit(0) }
// 兼容两种缩进（0.1.x tab×3 / 0.2.x tab×3）
const OLD_A = '\t\t\tctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({\n\t\t\t\tname: "sidebar.footer.action",\n\t\t\t\tid: "usage-stats",\n\t\t\t\torder: 20,'
const OLD_B = '\t\t\tctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({\n\t\t\t\tname: "sidebar.footer.action",\n\t\t\t\tid: "usage-stats",\n\t\t\t\tlocale: NS,\n\t\t\t\torder: 10\n'
const NEW_A = '\t\t\t/*patch(settings-seat-v2)*/ctx.slots.inject("sidebar.settings.action", () => ctx.slots.register({\n\t\t\t\tname: "sidebar.settings.action",\n\t\t\t\tid: "usage-stats",\n\t\t\t\torder: 1,'
const NEW_B = '\t\t\t/*patch(settings-seat-v2)*/ctx.slots.inject("sidebar.settings.action", () => ctx.slots.register({\n\t\t\t\tname: "sidebar.settings.action",\n\t\t\t\tid: "usage-stats",\n\t\t\t\tlocale: NS,\n\t\t\t\torder: 1\n'
if (s.includes(OLD_A)) s = s.replace(OLD_A, NEW_A)
else if (s.includes(OLD_B)) s = s.replace(OLD_B, NEW_B)
else throw new Error('usage-stats slot anchor missing — plugin restructured, review manually')
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target)
