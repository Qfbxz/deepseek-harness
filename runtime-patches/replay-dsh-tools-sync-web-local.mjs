#!/usr/bin/env node
// 补丁 48：dsh-tools web-local 副本补丁同步（pnpm hoist 副本缺补丁问题）。
// 根因：2026-08-24 pnpm 把 @deepseek-ai/dsh-tools 等 15 个官方包 hoist 成
// web/node_modules 本地真实副本，web profile 按最近优先加载它——而舰队补丁
// （p2 optional-description / p5 errorMessage / p12 clampBindingValue /
// render-fallback）只打全局副本 → 本地副本是"裸"的 → run_code 缺 description
// 被 schema 必填校验拒绝（"missing required property description"）。
// 修：全局副本（同版本、全补丁超集）的 index.js 与 types/code-mode.js 直接
// 覆盖本地副本。幂等：本地 marker 齐全即 skip；全局文件缺失大声报错。
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const [globalRoot, localRoot] = process.argv.slice(2)
if (!globalRoot || !localRoot) { console.error('usage: replay-dsh-tools-sync-web-local.mjs <global-dsh-tools-root> <web-local-dsh-tools-root>'); process.exit(1) }
const files = ['lib/index.js', 'lib/types/code-mode.js']
const markers = { 'lib/index.js': ['function deriveRunCodeTitle', 'errorMessage(result.error)'], 'lib/types/code-mode.js': ['clampBindingValue'] }
let patched = 0
for (const rel of files) {
  const local = `${localRoot}/${rel}`
  const globalF = `${globalRoot}/${rel}`
  if (!existsSync(globalF)) { console.error('[FAIL] global source missing:', globalF); process.exit(1) }
  const s = existsSync(local) ? readFileSync(local, 'utf8') : ''
  if (markers[rel].every((m) => s.includes(m))) { console.log('[skip] already synced:', local); continue }
  copyFileSync(globalF, local)
  execFileSync(process.execPath, ['--check', local], { stdio: 'pipe' })
  console.log('[ok] synced', rel, '→', local)
  patched += 1
}
console.log(patched ? `[ok] dsh-tools web-local sync done (${patched} file(s))` : '[skip] dsh-tools web-local already fully synced')
