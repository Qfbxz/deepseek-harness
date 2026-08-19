#!/usr/bin/env node
// 补丁 7：abort reason 无损渲染 + parse 错误可疑行定位（源码级根治 ①③）。
// 源码修复：packages/code-runtime/code-runtime-worker-thread/src/index.ts
//   renderAbortReason —— abort message 从 String(reason)（[object Object]）改为结构化渲染
//   parseErrorLocator —— 无位置的 SyntaxError 附加首个可疑行（引号/括号/悬挂转义不配平）
// 本脚本从仓库新构建产物 lib/types/index.js 提取两个函数与两处调用点改写，注入全局编译副本。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const target = process.argv[2]
if (!target) { console.error('usage: node replay-abort-reason-and-parse-locator.mjs <lib/index.js>'); process.exit(1) }
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'code-runtime', 'code-runtime-worker-thread', 'lib', 'types', 'index.js')

let src = readFileSync(target, 'utf8')
if (src.includes('function renderAbortReason')) { console.log('[skip] already patched:', target); process.exit(0) }
const built = readFileSync(SRC, 'utf8')

// 1) 提取两个函数（从新产物原样搬运，保持与源码零漂移）
function extractFunction(text, name) {
  const start = text.indexOf('function ' + name + '(')
  if (start < 0) throw new Error(name + ' missing in built source — rebuild the package first')
  let depth = 0, i = start, began = false
  for (; i < text.length; i++) {
    const c = text[i]
    if (c === '{') { depth++; began = true }
    else if (c === '}') { depth--; if (began && depth === 0) break }
  }
  return text.slice(start, i + 1)
}
const fnAbort = extractFunction(built, 'renderAbortReason')
const fnLocator = extractFunction(built, 'parseErrorLocator')

// 2) 注入两个函数（放在 messageOf 定义之后；幂等锚 = messageOf 本体）
const msgAnchor = 'function messageOf(error) {';
const msgIdx = src.indexOf(msgAnchor)
if (msgIdx < 0) throw new Error('messageOf anchor missing in ' + target)
let injectAt = src.indexOf('}', msgIdx) + 1
src = src.slice(0, injectAt) + '\n' + fnAbort + '\n' + fnLocator + src.slice(injectAt)

// 3) 改写两处 abort 构造（pre-abort 与 onAbort）
const preOld = 'return this.failureBeforeWorker({ kind: "abort", message: String(request.signal.reason) });'
const preNew = 'return this.failureBeforeWorker({ kind: "abort", message: `aborted: ${renderAbortReason(request.signal.reason)}` });'
if (src.includes(preOld)) src = src.replace(preOld, preNew)
const onOld = 'finish(() => output.failure([...logs, ...strayLogs], { kind: "abort", message: String(request.signal?.reason) }));'
const onNew = 'finish(() => output.failure([...logs, ...strayLogs], { kind: "abort", message: `aborted: ${renderAbortReason(request.signal?.reason)}` }));'
if (src.includes(onOld)) src = src.replace(onOld, onNew)

// 4) parse 失败接线 locator（补丁 4 的 newCatch 形态再升级）
const pcOld = 'messageOf(error) + unclosedLiteralHint(request.program) + SYNTAX_HINT'
const pcNew = 'messageOf(error) + unclosedLiteralHint(request.program) + parseErrorLocator(request.program) + SYNTAX_HINT'
if (src.includes(pcOld)) src = src.replace(pcOld, pcNew)

writeFileSync(target, src)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target)
