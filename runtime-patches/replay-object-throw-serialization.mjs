import { readFileSync, writeFileSync, cpSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'

// 补丁 5：对象抛错结构化序列化（renderThrownValue / errorMessage）
// 真根因在 worker 序列化层：String(detail) 把抛出的对象压成 [object Object] 字面量，
// host 端修复来不及介入。本补丁把三个运行时副本一并落地并快照。

const TAB = String.fromCharCode(9)
const NL = String.fromCharCode(10)
const D = String.fromCharCode(36) // $
const workerMark = 'function renderThrownValue(detail)'
const workerThrowOld = TAB+TAB+'message = typeof detail === "string" ? detail : String(detail);'
const workerThrowNew = TAB+TAB+'message = typeof detail === "string" ? detail : renderThrownValue(detail);'
const workerFnAnchor = 'function prepareException(error, remainingOutputBytes, maxOutputBytes = remainingOutputBytes) {'
const workerFnNew = [
  'function renderThrownValue(detail) {',
  TAB+'if (typeof detail === "object" && detail !== null) {',
  TAB+TAB+'try {',
  TAB+TAB+'const serialized = JSON.stringify(detail);',
  TAB+TAB+'if (typeof serialized === "string") return serialized;',
  TAB+TAB+'} catch {}',
  TAB+TAB+'return require("node:util").inspect(detail, { depth: 3, breakLength: 120 });',
  TAB+'}',
  TAB+'try {',
  TAB+'return String(detail);',
  TAB+'} catch {',
  TAB+'return "<unprintable thrown value>";',
  TAB+'}',
  '}',
  workerFnAnchor,
].join(NL)

// 模板字符串抛点用拼接构造，D 即 $，避免本脚本自身被展开
const toolsThrowOld = 'code run failed (' + D + '{result.error.kind}): ' + D + '{result.error.message}' + D + '{logsText}'
const toolsThrowNew = 'code run failed (' + D + '{result.error.kind}): ' + D + '{errorMessage(result.error)}' + D + '{logsText}'

const codeModeImportAnchor = 'import { TOOL_RUNTIME_SCHEDULER } from "./index.js";'
const codeModeImportNew = ['import { inspect } from "node:util";', codeModeImportAnchor].join(NL)
const codeModeFnAnchor = "export const RUN_CODE_NAME = 'run_code';"
const codeModeFnNew = [
  'function errorMessage(error) {',
  TAB+'if (error instanceof Error) return error.message;',
  TAB+'if (typeof error === "object" && error !== null) {',
  TAB+TAB+'if ("message" in error && typeof error.message === "string") return error.message;',
  TAB+TAB+'try {',
  TAB+TAB+'const serialized = JSON.stringify(error);',
  TAB+TAB+'if (typeof serialized === "string") return serialized;',
  TAB+TAB+'} catch {',
  TAB+TAB+'return inspect(error, { depth: 3, breakLength: 120 });',
  TAB+TAB+'}',
  TAB+'}',
  TAB+'try {',
  TAB+'const str = String(error);',
  TAB+'return str === "[object Object]" ? "<unprintable object>" : str;',
  TAB+'} catch {',
  TAB+'return "<unprintable thrown value>";',
  TAB+'}',
  '}',
  codeModeFnAnchor,
].join(NL)
function patchWorker(target) {
  let src = readFileSync(target, 'utf8')
  if (src.includes(workerMark)) { console.log('[skip] already patched:', target); return }
  if (!src.includes(workerThrowOld)) throw new Error('worker throw anchor missing in ' + target)
  if (!src.includes(workerFnAnchor)) throw new Error('worker fn anchor missing in ' + target)
  src = src.replace(workerThrowOld, workerThrowNew).replace(workerFnAnchor, workerFnNew)
  writeFileSync(target, src)
  execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
  console.log('[patched]', target)
}

function patchToolsIndex(target) {
  let src = readFileSync(target, 'utf8')
  if (src.includes('errorMessage(result.error)')) { console.log('[skip] already patched:', target); return }
  if (!src.includes(toolsThrowOld)) throw new Error('tools throw anchor missing in ' + target)
  if (!src.includes('function errorMessage')) throw new Error('tools errorMessage helper missing (unexpected upstream change) in ' + target)
  src = src.replace(toolsThrowOld, toolsThrowNew)
  writeFileSync(target, src)
  execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
  console.log('[patched]', target)
}

function patchToolsCodeMode(target) {
  let src = readFileSync(target, 'utf8')
  if (src.includes('function errorMessage(')) { console.log('[skip] already patched:', target); return }
  if (!src.includes(toolsThrowOld)) throw new Error('code-mode throw anchor missing in ' + target)
  if (!src.includes(codeModeImportAnchor)) throw new Error('code-mode import anchor missing in ' + target)
  // quote style varies across tsc releases: fall back to the double-quote form (rc.6)
  const fnAnchor = src.includes(codeModeFnAnchor) ? codeModeFnAnchor : 'export const RUN_CODE_NAME = "run_code";'
  if (!src.includes(fnAnchor)) throw new Error('code-mode fn anchor missing in ' + target)
  src = src.replace(toolsThrowOld, toolsThrowNew).replace(codeModeImportAnchor, codeModeImportNew).replace(fnAnchor, codeModeFnNew)
  writeFileSync(target, src)
  execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
  console.log('[patched]', target)
}

const backupDir = join(dirname(new URL(import.meta.url).pathname), 'backups')
function snapshot(target, name) {
  cpSync(target, join(backupDir, name))
  console.log('[snapshotted]', name)
}

const npmRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
const dshRoot = join(npmRoot, '@deepseek-ai/dsh/node_modules')
const worker = join(dshRoot, '@deepseek-ai/dsh-code-runtime-worker-thread/lib/worker.cjs')
const dshTools = join(dshRoot, '@deepseek-ai/dsh-tools')

patchWorker(worker)
snapshot(worker, 'dsh-code-runtime-worker-thread.lib.worker.object-throw-patched.cjs')
patchToolsIndex(join(dshTools, 'lib/index.js'))
snapshot(join(dshTools, 'lib/index.js'), 'dsh-tools.lib.index.object-throw-patched.js')
patchToolsCodeMode(join(dshTools, 'lib/types/code-mode.js'))
snapshot(join(dshTools, 'lib/types/code-mode.js'), 'dsh-tools.lib.types.code-mode.object-throw-patched.js')
console.log('done: object-throw serialization patch applied to 3 runtime copies')