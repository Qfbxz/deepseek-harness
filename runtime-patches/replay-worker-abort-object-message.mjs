#!/usr/bin/env node
// 补丁 21：worker 的绑定回复处理器对宿主错误回复直接 CapturedError(message.message)——
// message 为对象时 String() 成 "[object Object]"，以不透明的 code run failed (abort)
// 冒出（vision_describe 等工具的中止即此形态）。源码修复在 bootstrap.ts wireReplies；
// 本 replay 对已装产物幂等落地同一语义。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CANDIDATES = [
  join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-code-runtime-worker-thread', 'lib', 'worker.cjs'),
  join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-code-runtime-worker-thread/lib/worker.cjs'),
]
const target = process.argv[2] ?? CANDIDATES.find(p => { try { readFileSync(p); return true } catch { return false } })
if (!target) { console.error('usage: replay-worker-abort-object-message.mjs <worker.cjs>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('abort-[object Object] fix')) { console.log('[skip] already patched:', target); process.exit(0) }
const OLD = '\t\t} else {\n\t\t\tentry.reject(new CapturedError(message.message));\n\t\t}'
const NEW = [
  '\t\t} else {',
  '\t\t\t/* PATCH 2026-08-20 abort-[object Object] fix: host error replies may carry a',
  '\t\t\t   non-string message.message; String() on objects yields "[object Object]" and',
  '\t\t\t   surfaces as opaque abort failures. Serialize via JSON first, String fallback. */',
  '\t\t\tconst raw = message.message;',
  '\t\t\tconst text = typeof raw === "string" ? raw : (() => { try { return JSON.stringify(raw); } catch { return String(raw); } })();',
  '\t\t\tentry.reject(new CapturedError(text));',
  '\t\t}',
].join('\n')
if (!s.includes(OLD)) throw new Error('wireReplies anchor missing — upstream restructured, review manually')
s = s.replace(OLD, NEW)
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target)
