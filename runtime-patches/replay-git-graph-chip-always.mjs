#!/usr/bin/env node
// Patch 11: git-graph branch chip always renders; non-git sessions get a disabled placeholder.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const target = process.argv[2]
if (!target) { console.error('usage: replay-git-graph-chip-always.mjs <client.js>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('patch(chip-always)')) { console.log('[skip] already patched:', target); process.exit(0) }
const NL = String.fromCharCode(10)
const T = String.fromCharCode(9,9,9)
const DQ = String.fromCharCode(34)
const g1 = T + 'if (!showBranchSelector || repo === void 0 || repo === null) return null;'
const n1 = '// patch(chip-always): non-git session renders a disabled placeholder chip' + NL + T + 'if (!showBranchSelector || repo === void 0) return null;' + NL + T + 'const notARepo = repo === null;'
if (!s.includes(g1)) { console.log('[skip] anchor missing (plugin updated):', target); process.exit(0) }
s = s.replace(g1, n1)
const g2 = 'label: repo.branch === "" ? props.t("branch.detached") : repo.branch,'
const n2 = 'label: notARepo ? "—" : (repo.branch === "" ? props.t("branch.detached") : repo.branch),'
if (!s.includes(g2)) { console.log('[skip] anchor missing (plugin updated):', target); process.exit(0) }
s = s.replace(g2, n2)
const g3 = 'onClick: openBranchPopover'
const n3 = 'onClick: notARepo ? undefined : openBranchPopover, disabled: notARepo || undefined'
if (!s.includes(g3)) { console.log('[skip] anchor missing (plugin updated):', target); process.exit(0) }
s = s.replace(g3, n3)
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target)
