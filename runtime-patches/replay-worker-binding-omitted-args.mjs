import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const targets = process.argv.slice(2)
if (targets.length === 0) {
  console.error('usage: node patch-worker-binding.mjs <worker.cjs ...>')
  process.exit(1)
}

const TAB = String.fromCharCode(9)
const MARK = 'var callArgs = args === void 0 ? {} : args;'
const anchor = [
  TAB + TAB + TAB + 'value: (args) => {',
  TAB + TAB + TAB + TAB + 'let detached;',
  TAB + TAB + TAB + TAB + 'try {',
  TAB + TAB + TAB + TAB + TAB + 'detached = snapshotCodeJsonValue(args);',
  TAB + TAB + TAB + TAB + '} catch {',
  TAB + TAB + TAB + TAB + TAB + 'detached = void 0;',
  TAB + TAB + TAB + TAB + '}',
].join(String.fromCharCode(10))
const replaced = [
  TAB + TAB + TAB + 'value: (args) => {',
  MARK,
  TAB + TAB + TAB + TAB + 'let detached;',
  TAB + TAB + TAB + TAB + 'try {',
  TAB + TAB + TAB + TAB + TAB + 'detached = snapshotCodeJsonValue(callArgs);',
  TAB + TAB + TAB + TAB + '} catch {',
  TAB + TAB + TAB + TAB + TAB + 'detached = void 0;',
  TAB + TAB + TAB + TAB + '}',
].join(String.fromCharCode(10))

for (const target of targets) {
  let src = readFileSync(target, 'utf8')
  if (src.includes(MARK)) { console.log('[skip] already patched:', target); continue }
  if (!src.includes(anchor)) throw new Error('makeNamespaces anchor missing in ' + target)
  src = src.replace(anchor, replaced)
  writeFileSync(target, src)
  execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
  console.log('[patched]', target)
}