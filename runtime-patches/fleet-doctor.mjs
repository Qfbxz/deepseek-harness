#!/usr/bin/env node
// fleet-doctor — DSH 补丁舰队一键体检：
//   1. 测试套件（tests/*.test.mjs）
//   2. autorun 重放（幂等收敛，REAPPLIED 即异常信号）
//   3. watchdog 哨兵（PATCHES 表 marker 全检）
// 退出码 0 = 全绿；非 0 = 存在需人工介入项。
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const RP = dirname(fileURLToPath(import.meta.url))
const FLEET = join(RP, 'self-heal-fleet')
let bad = 0

// 1) 测试套件
console.log('== 1/3 测试套件 ==')
for (const f of readdirSync(join(RP, 'tests')).filter(x => x.endsWith('.test.mjs'))) {
  try {
    const out = execFileSync(process.execPath, ['--test', 'tests/' + f], { encoding: 'utf8', cwd: RP, timeout: 120000, stdio: 'pipe' })
    const p = (out.match(/pass (\d+)/) || [])[1] ?? '?'
    console.log('  PASS', f, '(' + p + ' tests)')
  } catch (e) { bad++; console.log('  FAIL ', f) }
}

// 2) autorun 重放
console.log('== 2/3 autorun 重放 ==')
const { autorunJobs } = await import('file://' + join(FLEET, 'patches-table.mjs'))
for (const [script, args] of autorunJobs()) {
  try {
    const out = execFileSync(process.execPath, [script.startsWith('/') ? script : join(RP, script), ...args], { encoding: 'utf8', timeout: 60000, stdio: 'pipe' }).trim()
    if (/\[patched\]|\[ok\]/.test(out)) { bad++; console.log('  REAPPLIED(此前缺失!)', script) }
  } catch (e) { bad++; console.log('  ERROR', script, ((e.stderr || '')).split('\n').filter(Boolean).slice(-1)[0].slice(0, 120)) }
}
console.log('  (未列出 = 幂等 skip，正常)')

// 3) watchdog 哨兵
console.log('== 3/3 watchdog 哨兵 ==')
const { watchdogChecks } = await import('file://' + join(FLEET, 'patches-table.mjs'))
let ok = 0
for (const c of watchdogChecks()) {
  try {
    if (readFileSync(c.file, 'utf8').includes(c.marker)) ok++
    else { bad++; console.log('  MARKER缺失', c.id, c.file) }
  } catch { bad++; console.log('  文件缺失', c.id, c.file) }
}
console.log('  ' + ok + '/' + watchdogChecks().length + ' 健康')
console.log(bad === 0 ? '\n[doctor] 全绿 ✔' : '\n[doctor] ' + bad + ' 项需人工介入 ✘')
process.exit(bad === 0 ? 0 : 1)
