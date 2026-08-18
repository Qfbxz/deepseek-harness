#!/usr/bin/env node
// Idempotent replay: make dsh-tools' compiled run_code tool (code-mode) accept a
// missing description at the binding layer, matching the PR-A source fix.
// Targets the global install copy and any ~/.dsh/profiles copy.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const targets = process.argv.slice(2)
if (targets.length === 0) {
  console.error('usage: node replay-run-code-optional-description.mjs <lib/index.js ...>')
  process.exit(1)
}

for (const target of targets) {
  let src = readFileSync(target, 'utf8')
  if (src.includes('function deriveRunCodeTitle') && !src.includes('invalid description: expected a non-empty string')) {
    console.log('[skip] already patched:', target)
    continue
  }
  const before = src

  // 1) Inject the derivation helper at the top of the file (after the initial shebang/
  //    comments block). Function declarations hoist within the IIFE, so presentCall can
  //    reference it.
  const deriveFn = [
    'function deriveRunCodeTitle(code) {',
    "  for (const raw of String(code || '').split('\\n')) {",
    '    const line = raw.trim()',
    '    if (line.length === 0) continue',
    "    const stripped = line.startsWith('//') ? line.slice(2).trimStart() : line.startsWith('/*') ? line.slice(2).replace(/^\\*+/, '').trimStart() : line",
    '    return stripped.length > 60 ? stripped.slice(0, 59) + "\u2026" : stripped',
    '  }',
    "  return '(run code)'",
    '}',
    '',
  ].join('\n')
  if (!src.includes('function deriveRunCodeTitle')) {
    src = src.replace(/(^[^\n]*\n)/, (m) => m + deriveFn)
  }

  // 2) Remove the execute-time throw (the binding layer's "missing required property"
  //    is what fires now; the execute-time check is a second line of defence to drop).
  src = src.replace(
    '			if (args.description.trim().length === 0) throw new Error("invalid description: expected a non-empty string");\n',
    '',
  )

  // 3) Drop `required: true` from BOTH description parameter sites (TS schema and the
  //    PY parameters-getter). Code parameter keeps required.
  //    The exact pattern `description: {\n\t\t\t\ttype: "string",\n\t\t\t\trequired: true,` appears
  //    twice; replace_all handles both. The `code: { ... required: true,` block is
  //    preserved by matching the literal `description:` opener.
  const requiredCount = (src.match(/description: \{\n\t\t\t\ttype: "string",\n\t\t\t\trequired: true,/g) || []).length
  src = src.replace(
    /description: \{\n\t\t\t\ttype: "string",\n\t\t\t\trequired: true,/g,
    'description: {\n\t\t\t\ttype: "string",',
  )

  // 4) Update presentCall title to derive when description omitted/blank. Wrapped in a
  //    one-line ternary to keep the change tightly scoped (the presentCall shape is
  //    a single-property object literal).
  src = src.replace(
    '			title: args.description,',
    '			title: args.description?.trim() ? args.description : deriveRunCodeTitle(args.code),',
  )

  if (src === before) throw new Error('no hunks applied — unrecognized file shape: ' + target)
  writeFileSync(target, src)
  execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
  console.log('[patched]', target, '— removed', requiredCount, 'required-true flag(s)')
}
