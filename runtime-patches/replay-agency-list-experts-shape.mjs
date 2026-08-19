#!/usr/bin/env node
// 补丁 22：agency-agents 的 list_experts 工具描述不含返回形状——模型猜 r.experts
// 直接 TypeError；也不知道自有分区键（0-domain-masters/0-engineering），猜 engineering
// 落到全停用的内置分区。描述补上精确形状与发现流程。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CANDIDATES = [
  join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', '@michengai', 'dsh-agency-agents', 'lib', 'index.js'),
  join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@deepseek-ai/dsh/node_modules/@michengai/dsh-agency-agents/lib/index.js'),
]
const target = process.argv[2] ?? CANDIDATES.find(p => { try { readFileSync(p); return true } catch { return false } })
if (!target) { console.error('usage: replay-agency-list-experts-shape.mjs <index.js>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('patch(list-experts-shape)')) { console.log('[skip] already patched:', target); process.exit(0) }
const OLD = 'Call this before summon_expert when you need an exact expert slug."'
const NEW = 'Call this before summon_expert when you need an exact expert slug. /*patch(list-experts-shape)*/ Return shape: {divisions: [{division, count?, experts?: [{slug, name, description}]}], total} — without a filter each entry carries division+count only; with a division filter the matching entry carries its experts array (read it as result.divisions[0].experts, NOT result.experts). Only ENABLED experts appear. Always call without a filter first to discover the actual division keys — this roster adds 0-domain-masters (petroleum domain masters) and 0-engineering (engineering/IT roles) ahead of the builtin divisions."'
if (!s.includes(OLD)) throw new Error('list_experts description anchor missing — plugin restructured, review manually')
s = s.replace(OLD, NEW)
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target)
