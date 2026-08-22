#!/usr/bin/env node
// 补丁 38:subagent in-process driver 经 reflect.get 取 agents 服务。
// 根因:driver L179 直接 `parent.ctx.agents.create(...)` —— parent 是调用方父 Agent,
// 其 cordis 纤维的 inject 白名单无 'agents'(网关抛 cannot get property without inject),
// 前台 subagent / summon_expert / auto-memory summarize 全灭;后台路径走
// ctx.inject(['agents']) 子纤维(dsh-subagent L2369)所以幸存。
// 修:改用 parent.ctx.reflect.get('agents')(官方 API,读 store 不走 inject 网关,
// 与后台路径同构)。服务缺席时 undefined.create 大声失败,不静默。
// 幂等:含 patch(driver-agents) 标记即跳过;锚点失配大声报错。
// 用法: replay-subagent-driver-agents-access.mjs <subagent-in-process-driver/lib/index.js>
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const target = process.argv[2]
if (!target) { console.error('usage: replay-subagent-driver-agents-access.mjs <index.js>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('/*patch(driver-agents)*/')) { console.log('[skip] already patched:', target); process.exit(0) }
const OLD = 'return drivePublishedRun(await parent.ctx.agents.create({'
const NEW = 'const /*patch(driver-agents)*/agentsSvc = parent.ctx.reflect.get("agents"); if (agentsSvc === undefined) throw new Error("subagent driver: agents service not provided"); return drivePublishedRun(await agentsSvc.create({'
if (!s.includes(OLD)) { console.error('[FAIL] anchor missing — upstream restructured, review manually:', target); process.exit(1) }
s = s.replace(OLD, NEW)
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[ok] driver-agents patched (parent.ctx.agents → reflect.get)')
