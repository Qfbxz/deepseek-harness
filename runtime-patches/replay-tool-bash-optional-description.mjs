#!/usr/bin/env node
// Idempotent replay of the optional-description patch for compiled dsh-tool-bash.
// Targets: the global install copy and the ~/.dsh/profiles copy. Safe to run
// twice: an already-patched file is detected and skipped. Fails loud on any
// unrecognized shape — never silently half-patches.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const targets = process.argv.slice(2)
if (targets.length === 0) {
  console.error('usage: node replay-tool-bash-optional-description.mjs <lib/index.js ...>'),
  process.exit(1)
}

const DERIVE = [
  'var DERIVED_DESCRIPTION_MAX_CHARS = 60;',
  'function deriveBashDescription(command) {',
  '\tfor (const rawLine of command.split("\\n")) {',
  '\t\tconst line = rawLine.trim();',
  '\t\tif (line.length === 0) continue;',
  '\t\tconst stripped = line.startsWith("#") ? line.replace(/^#+\\s*/, "") : line;',
  '\t\treturn stripped.length > DERIVED_DESCRIPTION_MAX_CHARS',
  '\t\t\t? stripped.slice(0, DERIVED_DESCRIPTION_MAX_CHARS - 1) + "\u2026"',
  '\t\t\t: stripped;',
  '\t}',
  '\treturn "(empty command)";',
  '}',
  '',
].join('\n')

const derivedExpr = (prop) => 'args.description?.trim() ? args.description : deriveBashDescription(args.command)' + (prop === 'text' ? '' : ',')

for (const target of targets) {
  let src = readFileSync(target, 'utf8')
  const patchedAlready =
    src.includes('function deriveBashDescription')
    && !src.includes('invalid description: expected a non-empty string')
  if (patchedAlready) {
    console.log('[skip] already patched:', target)
    continue
  }
  const before = src
  // 1) Drop the empty-description throw (validateBashArgs).
  src = src.replace(/\n\s*if \(args\.description\.trim\(\)\.length === 0\) throw new Error\("invalid description: expected a non-empty string"\);/, '')
  // 2) Ensure the derive helper exists, before bashDescription().
  if (!src.includes('function deriveBashDescription')) {
    const anchor = 'function bashDescription(backgroundEnabled, escalationModes)'
    if (!src.includes(anchor)) throw new Error('anchor bashDescription missing in ' + target)
    src = src.replace(anchor, DERIVE + '\n' + anchor)
  }
  // 3) Background branch: content text derives when omitted/blank.
  src = src.replace(/\t\t\t\ttext: args\.description\n/, '\t\t\t\ttext: ' + derivedExpr('text') + '\n')
  // 4) Terminal branch: card description derives when omitted/blank.
  src = src.replace(/\t\tdescription: args\.description,\n/, '\t\tdescription: ' + derivedExpr('card') + '\n')
  // 5) Schema: description is no longer required; copy names the fallback.
  src = src.replace(
    /(description: \{\n\t\t\t\ttype: "string",)\n\t\t\t\trequired: true,\n/,
    '$1\n',
  )
  const COPY_TAIL = 'Optional; omitted or blank, the first command line labels the call.'
  if (!src.includes(COPY_TAIL)) {
    src = src.replace(
      'Install package dependencies"."',
      'Install package dependencies". ' + COPY_TAIL + '"',
    )
  }
  if (src === before) throw new Error('no hunks applied — unrecognized file shape: ' + target)
  writeFileSync(target, src)
  execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
  console.log('[patched]', target)
}