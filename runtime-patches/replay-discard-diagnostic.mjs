#!/usr/bin/env node
// 补丁 12（rc.2 适配版）：run_code 绑定结果超长无上限流入 completion value →
// 溢出 output ledger 变 opaque abort。clampBindingValue 在 dispatch settle 位
// 把单个绑定结果截到 24k 字符（数组/对象递归，带显式截断标记）。
// 2026-08-26 适配：rc.2 的 dsh-tools 运行时读打包产物 lib/index.js（code-mode
// 内联），旧版打 lib/types/code-mode.js 是空操作；旧版还从仓库构建产物提取
// 锚点，仓库重组后提取源失效。现改为自包含载荷，与仓库 src 的
// clampBindingValue 同源（packages/core/tools/src/code-mode.ts，01cc9ed3b8 还原）。
// 幂等：marker 在场即跳过；锚点失配大声报错（上游修复后自动退役）。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const targets = process.argv.slice(2)
if (targets.length === 0) { console.error('usage: replay-discard-diagnostic.mjs <dsh-tools lib/index.js> [...]'); process.exit(1) }

for (const target of targets) patchOne(target)

function patchOne(target) {
let s = readFileSync(target, 'utf8')
if (s.includes('function clampBindingValue')) { console.log('[skip] already patched:', target); return }

const HELPER = [
  'function clampBindingValue(value) {',
  '\tif (typeof value === "string") {',
  '\t\treturn value.length > 24000 ? value.slice(0, 24000) + "…[truncated " + (value.length - 24000) + " of " + value.length + " chars]" : value;',
  '\t}',
  '\tif (Array.isArray(value)) return value.map(clampBindingValue);',
  '\tif (typeof value === "object" && value !== null) {',
  '\t\tconst out = {};',
  '\t\tfor (const [k, v] of Object.entries(value)) out[k] = clampBindingValue(v);',
  '\t\treturn out;',
  '\t}',
  '\treturn value;',
  '}',
  '',
  '',
].join('\n')

const helperAnchor = 'function renderValue(value) {'
const n1 = s.split(helperAnchor).length - 1
if (n1 !== 1) { console.error('[FAIL] helper anchor count ' + n1 + ' != 1 — upstream restructured, review manually:', target); process.exit(1) }
s = s.replace(helperAnchor, HELPER + helperAnchor)

// settle 位：run_code dispatch 的 resolve 成功分支；后随 const agent = exec.agent
// 使其在两处 value: result.value 中唯一（另一处是 presentation 物化，不打）。
const OLD = 'value: result.value\n\t\t\t\t\t\t});\n\t\t\t\t\t\tconst agent = exec.agent;'
const NEW = 'value: clampBindingValue(result.value)\n\t\t\t\t\t\t});\n\t\t\t\t\t\tconst agent = exec.agent;'
const n2 = s.split(OLD).length - 1
if (n2 !== 1) { console.error('[FAIL] settle anchor count ' + n2 + ' != 1 — upstream restructured, review manually:', target); process.exit(1) }
s = s.split(OLD).join(NEW)

writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[ok] dsh-tools binding-value clamp patched (p12, rc.2 bundle):', target)
}
