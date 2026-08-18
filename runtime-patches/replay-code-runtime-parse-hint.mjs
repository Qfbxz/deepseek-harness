#!/usr/bin/env node
// Idempotent replay of the strip-phase parse-hint patch for compiled
// dsh-code-runtime-worker-thread. Appends the remediation hint and an
// unclosed-literal location to stripTypeScriptTypes SyntaxErrors, which
// otherwise arrive as a bare message with no line or column.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const targets = process.argv.slice(2)
if (targets.length === 0) {
  console.error('usage: node replay-code-runtime-parse-hint.mjs <lib/index.js ...>'),
  process.exit(1)
}

const HELPERS = [
  'var SYNTAX_HINT = " \u2014 the program body failed to parse before any code ran; fix the syntax, or move complex logic into a file written first and keep this body minimal";',
  'function unclosedLiteralHint(program) {',
  "	var state = 'code'; var line = 1; var openLine = 0;",
  "	for (var i = 0; i < program.length; i += 1) {",
  "		var c = program[i]; var next = program[i + 1];",
  "		if (c === '\\n') { line += 1; if (state === 'line-comment') state = 'code'; continue; }",
  "		if (state === 'line-comment') continue;",
  "		if (state === 'block-comment') { if (c === '*' && next === '/') { state = 'code'; i += 1; } continue; }",
  "		if (state === 'sq' || state === 'dq' || state === 'tpl') {",
  "			if (c === '\\\\') { i += 1; continue; }",
  "			if ((state === 'sq' && c === '\\'') || (state === 'dq' && c === '\"') || (state === 'tpl' && c === '\\`')) state = 'code';",
  "			continue;",
  "		}",
  "		if (c === '/' && next === '/') { state = 'line-comment'; i += 1; continue; }",
  "		if (c === '/' && next === '*') { state = 'block-comment'; i += 1; continue; }",
  "		if (c === '\\'' || c === '\"' || c === '\\`') { state = c === '\\'' ? 'sq' : c === '\"' ? 'dq' : 'tpl'; openLine = line; }",
  "	}",
  "	if (state === 'code' || state === 'line-comment' || state === 'block-comment') return '';",
  "	var kind = state === 'tpl' ? 'template literal' : 'string';",
  "	var opening = (program.split('\\n')[openLine - 1] || '').trim().slice(0, 60);",
  "	return ' (unterminated ' + kind + ' starting at line ' + openLine + ': ' + opening + ')';",
  '}',
  '',
].join('\n')

for (const target of targets) {
  let src = readFileSync(target, 'utf8')
  if (src.includes('function unclosedLiteralHint')) {
    console.log('[skip] already patched:', target)
    continue
  }
  const importAnchor = 'import { stripTypeScriptTypes } from "node:module";'
  if (!src.includes(importAnchor)) throw new Error('import anchor missing in ' + target)
  src = src.replace(importAnchor, importAnchor + '\n' + HELPERS)
  const oldCatch = [
    '\t\t} catch (error) {',
    '\t\t\treturn this.failureBeforeWorker({',
    '\t\t\t\tkind: "exception",',
    '\t\t\t\tmessage: messageOf(error)',
    '\t\t\t});',
    '\t\t}',
  ].join('\n')
  const newCatch = [
    '\t\t} catch (error) {',
    '\t\t\tvar parseMessage = error instanceof SyntaxError',
    '\t\t\t\t? messageOf(error) + unclosedLiteralHint(request.program) + SYNTAX_HINT',
    '\t\t\t\t: messageOf(error);',
    '\t\t\treturn this.failureBeforeWorker({',
    '\t\t\t\tkind: "exception",',
    '\t\t\t\tmessage: parseMessage',
    '\t\t\t});',
    '\t\t}',
  ].join('\n')
  if (!src.includes(oldCatch)) throw new Error('catch anchor missing in ' + target)
  src = src.replace(oldCatch, newCatch)
  writeFileSync(target, src)
  execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
  console.log('[patched]', target)
}