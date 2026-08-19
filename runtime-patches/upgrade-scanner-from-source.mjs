import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const [srcTs, ...targets] = process.argv.slice(2)
if (!srcTs || targets.length === 0) { console.error('usage: node upgrade-scanner3.mjs <src/index.ts> <compiled...>'); process.exit(1) }

const ts = readFileSync(srcTs, 'utf8')
const start = ts.indexOf('function unclosedLiteralHint(')
if (start < 0) throw new Error('scanner missing in source')
let depth = 0, end = -1
for (let i = ts.indexOf('{', start); i < ts.length; i++) {
  if (ts[i] === '{') depth++
  else if (ts[i] === '}') { depth--; if (depth === 0) { end = i; break } }
}
let fn = ts.slice(start, end + 1)
fn = fn.replace('(program: string): string {', '(program) {')
fn = fn.replace(/let state: 'code' \| 'sq' \| 'dq' \| 'tpl' \| 'line-comment' \| 'block-comment' = 'code'/, "let state = 'code'")
fn = fn.replace(/let state: [^=]+= 'code'/, "let state = 'code'")
fn = fn.replaceAll('const ', 'var ')
if (fn.includes(': string')) throw new Error('signature type residue in extracted fn')
new Function(fn) // parse check

for (const target of targets) {
  let src = readFileSync(target, 'utf8')
  if (src.includes('adjacent literals at line')) { console.log('[skip] already upgraded:', target); continue }
  const t0 = src.indexOf('function unclosedLiteralHint(program) {')
  if (t0 < 0) throw new Error('compiled scanner missing in ' + target)
  let d2 = 0, e2 = -1
  for (let i = t0; i < src.length; i++) {
    if (src[i] === '{') d2++
    else if (src[i] === '}') { d2--; if (d2 === 0) { e2 = i; break } }
  }
  src = src.slice(0, t0) + fn + src.slice(e2 + 1)
  writeFileSync(target, src)
  execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
  console.log('[upgraded]', target)
}