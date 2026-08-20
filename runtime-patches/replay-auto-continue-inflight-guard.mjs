#!/usr/bin/env node
// 补丁 24：auto-continue 的 fire() 只查会话列表 running 标志——标志在步骤边界
// 滞后/闪烁时误判空闲，"继续"入队后宿主中止在飞工具调用，冒出
// aborted: {"kind":"user"}（工具调用被注入消息打断）。插件自身已在 mux 帧里
// 跟踪 lastToolResult==="pending"，发前补一道在飞工具守卫即可。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CANDIDATES = [
  join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'dsh-client-auto-continue', 'lib', 'client.js'),
  join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@deepseek-ai/dsh/node_modules/dsh-client-auto-continue/lib/client.js'),
]
const target = process.argv[2] ?? CANDIDATES.find(p => { try { readFileSync(p); return true } catch { return false } })
if (!target) { console.error('usage: replay-auto-continue-inflight-guard.mjs <client.js>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('patch(inflight-guard)')) { console.log('[skip] already patched:', target); process.exit(0) }
const OLD = '    if (state.queued > 0) {\n      this.log(`跳过 ${sessionId}: 已有排队消息`);\n      return;\n    }'
const NEW = [
  '    /*patch(inflight-guard)*/ if (state.lastToolResult === "pending") {',
  '      this.log(`跳过 ${sessionId}: 工具调用仍在执行(${state.lastTool ?? "?"}), 列表 running 标志滞后`);',
  '      return;',
  '    }',
  '    if (state.queued > 0) {',
  '      this.log(`跳过 ${sessionId}: 已有排队消息`);',
  '      return;',
  '    }',
].join('\n')
if (!s.includes(OLD)) throw new Error('fire() queued-check anchor missing — plugin restructured, review manually')
s = s.replace(OLD, NEW)
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target)
