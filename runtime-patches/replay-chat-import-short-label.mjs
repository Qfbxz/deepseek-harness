#!/usr/bin/env node
// 补丁 19：dsh-chat-import「导入会话」按钮精简为「导入」（tooltip 保留完整说明）。
import { readFileSync, writeFileSync } from 'node:fs'
const target = process.argv[2]
if (!target) { console.error('usage: replay-chat-import-short-label.mjs <client.js>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('"trigger.label": "导入",')) { console.log('[skip] already patched:', target); process.exit(0) }
const OLD = '"trigger.label": "导入会话",'
if (!s.includes(OLD)) { console.log('[skip] anchor missing (plugin updated):', target); process.exit(0) }
s = s.replace(OLD, '"trigger.label": "导入",')
writeFileSync(target, s)
console.log('[patched]', target)
