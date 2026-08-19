#!/usr/bin/env node
// 补丁 18：dsh-usage-stats 用量徽章迁到设置行专属座位 sidebar.settings.action
//（ui-sidebar 源码新增的孔），order 提到 1（记忆为 5，用量排其左），并废除其
// 「把宿主容器内联改成 column」的兼容副作用——设置行必须保持 row。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const target = process.argv[2]
if (!target) { console.error('usage: replay-usage-stats-settings-row.mjs <client.js>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
const did = []
if (!s.includes('patch(settings-seat)')) {
  if (!s.includes('sidebar.footer.action') && s.includes('sidebar.settings.action')) {
    console.log('[skip] upstream already on the settings row:', target)
  } else {
    const OLD1 = 'ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({\n\t\t\t\tname: "sidebar.footer.action",'
    const NEW1 = '/*patch(settings-seat)*/ctx.slots.inject("sidebar.settings.action", () => ctx.slots.register({\n\t\t\t\tname: "sidebar.settings.action",'
    if (!s.includes(OLD1)) throw new Error('registration anchor missing — plugin restructured, review manually')
    s = s.replace(OLD1, NEW1)
    s = s.replace('order: 10\n\t\t\t}, UsageStatsPanel)', 'order: 1\n\t\t\t}, UsageStatsPanel)')
    did.push('seat')
  }
}
if (!s.includes('patch(no-column-hack)')) {
  const OLD2 = 'let host = layerRef.current?.parentElement ?? null;'
  const NEW2 = 'return void 0; /*patch(no-column-hack)*/ let host = layerRef.current?.parentElement ?? null;'
  if (!s.includes(OLD2)) throw new Error('column-hack anchor missing — plugin restructured, review manually')
  s = s.replace(OLD2, NEW2)
  did.push('no-column')
}
if (did.length === 0) { console.log('[skip] already patched:', target); process.exit(0) }
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target, '(' + did.join('+') + ')')
