#!/usr/bin/env node
/**
 * replay-search-pool-schema.mjs — dsh-search-failover 工具 schema 兼容补丁。
 *
 * 根因（2026-08-22 实测）：v0.3.8 的 web_search_from 工具 output.schema 使用
 * 属性级 required（sources/url/truncated 内嵌 required: true），rc.8 的
 * schemastery 校验不支持 → "unsupported JSON schema" → 整棵插件树加载失败
 * → host 崩溃循环（App 侧表现为反复重启/连不上 3080）。
 *
 * 三态机理（对齐 runtime-patches 规范）：
 *   marker（本注释块 + 修正形态）在场        → 已打补丁，零动作
 *   marker 缺 + 坏形态（属性级 required）在场 → 自动重放恢复
 *   两者都缺（上游已修/重构）                → RETIRED 退役
 *
 * 用法：node replay-search-pool-schema.mjs [目标文件]（默认 profile 内副本）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MARKER = 'replay-search-pool-schema 2026-08-22'
const targets = process.argv.length > 1 && process.argv[process.argv.length - 1].endsWith('.js')
  ? [process.argv[process.argv.length - 1]]
  : [
      join(homedir(), '.dsh/profiles/web/node_modules/dsh-search-failover/lib/index.js'),
      join(homedir(), '.dsh/profiles/node_modules/dsh-search-failover/lib/index.js'),
    ]

const BAD = [
  ["            sources: {\n              type: 'array',\n              required: true,\n", "            sources: {\n              type: 'array',\n"],
  ["                  url: { type: 'string', required: true },\n", "                  url: { type: 'string' },\n"],
  ["            truncated: { type: 'boolean', required: true },\n", "            truncated: { type: 'boolean' },\n"],
]

let patched = 0
let clean = 0
let retired = 0
for (const file of targets) {
  if (!existsSync(file)) continue
  let src
  try { src = readFileSync(file, 'utf8') } catch { continue }
  if (src.includes(MARKER)) { clean += 1; console.log(`[skip] already patched: ${file}`); continue }
  const bad = BAD.filter(([o]) => src.includes(o))
  if (bad.length === 0) { retired += 1; console.log(`[retired] bad pattern absent (upstream fixed or restructured): ${file}`); continue }
  for (const [o, n] of bad) src = src.split(o).join(n)
  src = `/* ${MARKER}: property-level required removed for rc.8 schemastery compat */\n` + src
  writeFileSync(file, src)
  patched += 1
  console.log(`[patched] ${bad.length} property-level required removed: ${file}`)
}
console.log(`done: patched=${patched} already-ok=${clean} retired=${retired}`)
