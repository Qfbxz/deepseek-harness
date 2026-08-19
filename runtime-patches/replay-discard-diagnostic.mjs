#!/usr/bin/env node
// Patch 12: discard diagnostic + clampBindingValue, extracted from built lib.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const NL = String.fromCharCode(10)
const target = process.argv[2]
if (!target) { console.error('usage: replay-discard-diagnostic.mjs <code-mode.js>'); process.exit(1) }
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'core', 'tools', 'lib', 'types', 'code-mode.js')
let s = readFileSync(target, 'utf8')
if (s.includes('clampBindingValue')) { console.log('[skip] already patched:', target); process.exit(0) }
const built = readFileSync(SRC, 'utf8')
const capAnchor = 'const BINDING_VALUE_MAX_CHARS'
const h0 = built.indexOf(capAnchor)
if (h0 < 0) throw new Error('cap anchor missing in built')
const hEnd = built.indexOf('Cap for the derived call label', h0)
if (hEnd < 0) throw new Error('renderValue anchor missing')
const helpers = built.slice(h0, hEnd)
const d0 = built.lastIndexOf('if (runOver()) {', built.indexOf('outcome.isError'))
if (d0 < 0) throw new Error('discard block missing in built')
const dEnd = built.indexOf('// The worker turns', d0)
const discardNew = built.slice(d0, dEnd).trimEnd()
const lines = s.split(NL)
const di = lines.findIndex(l => l.includes('result discarded'))
if (di < 0) throw new Error('discard anchor missing in target')
let start = di
while (start > 0 && !lines[start].includes('if (runOver())')) start--
if (!lines[start].includes('if (runOver())')) throw new Error('discard if-wrapper missing in target')
let end = di
while (end < lines.length && lines[end].trim() !== '}') end++
if (end === lines.length) throw new Error('discard block close missing in target')
const baseIndent = (lines[start].match(/^\s+/) || [''])[0]
const builtLines = discardNew.split(NL)
const builtBase = (builtLines[0].match(/^\s+/) || [''])[0]
const rebuilt = builtLines.map(l => {
  const lead = (l.match(/^\s+/) || [''])[0]
  return l.trim() === '' ? '' : baseIndent + lead.slice(builtBase.length) + l.trim()
}).join(NL)
lines.splice(start, end - start + 1, rebuilt)
s = lines.join(NL)
const oldSettle = 'value: result.value }'
if (!s.includes(oldSettle)) throw new Error('settle anchor missing in target')
s = s.replace(oldSettle, 'value: clampBindingValue(result.value) }')
s = s.replace('function renderValue', helpers + NL + 'function renderValue')
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target)