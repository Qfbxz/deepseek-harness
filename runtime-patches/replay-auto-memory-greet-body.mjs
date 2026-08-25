#!/usr/bin/env node
// 补丁 47:dsh-auto-memory greet 路由 500("body is not defined")。
// 根因:0.1.29 的 /api/dsh-auto-memory/greet handler 引用 body.ws 却漏了
// const body = await readJsonBody(req)(对比同文件 summarize handler 有这一行),
// ReferenceError 被 catch 成 500 → 客户端时段问候角标拿不到数据。
// 修:补上 readJsonBody 行,与 summarize 同款。上游修复(0.1.30+)后锚点失配自动报错退役。
// 注意:该包发布带 CRLF 行尾,锚点按文件实际行尾构造,不做全文件归一。
// 幂等:含 patch(greet-body) 标记即跳过;锚点失配大声报错。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const target = process.argv[2]
if (!target) { console.error('usage: replay-auto-memory-greet-body.mjs <index.js>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('/*patch(greet-body)*/')) { console.log('[skip] already patched:', target); process.exit(0) }
const NL = s.includes('\r\n') ? '\r\n' : '\n'
const OLD = [
  "        if ((req.method || 'POST') !== 'POST') return writeJson(res, 405, { error: 'method not allowed' })",
  '        try {',
  "          const ws = body && body.ws ? body.ws : ''",
].join(NL)
const NEW = [
  "        if ((req.method || 'POST') !== 'POST') return writeJson(res, 405, { error: 'method not allowed' })",
  '        const body = /*patch(greet-body)*/ await readJsonBody(req)',
  '        try {',
  "          const ws = body && body.ws ? body.ws : ''",
].join(NL)
const n = s.split(OLD).length - 1
if (n !== 1) { console.error('[FAIL] anchor count ' + n + ' != 1 — upstream restructured, review manually:', target); process.exit(1) }
s = s.replace(OLD, NEW, 1)
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[ok] auto-memory greet-body patched (readJsonBody line restored, NL=' + JSON.stringify(NL) + ')')
