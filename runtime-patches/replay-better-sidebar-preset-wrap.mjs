#!/usr/bin/env node
// 补丁 35：better-sidebar Agent 预设卡片描述自动换行（原 white-space:nowrap
// 单行省略，描述看不全；改 4 行 -webkit-line-clamp 自适应）。
// 用法：replay-better-sidebar-preset-wrap.mjs <client-registry.js>
import { readFileSync, writeFileSync } from 'node:fs'
const target = process.argv[2]
if (!target) { console.error('usage: replay-better-sidebar-preset-wrap.mjs <client-registry.js>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('/*patch(preset-wrap)*/')) { console.log('[skip] already patched:', target); process.exit(0) }
const OLD = "cardDesc{color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis;font-size:11px;line-height:16px;overflow:hidden}"
const NEW = "/*patch(preset-wrap)*/cardDesc{color:var(--dsw-alias-label-tertiary);white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;font-size:11px;line-height:16px;overflow:hidden}"
if (!s.includes(OLD)) {
  // 官方 dsh-client-ui-agent-preset 变体：已有 4 行 clamp，只缺 white-space:normal（祖先继承 nowrap）
  const OLD2 = "cardDesc{color:var(--dsw-alias-label-secondary);-webkit-line-clamp:4;overflow-wrap:anywhere;-webkit-box-orient:vertical;min-height:42px;font-size:13px;line-height:1.55;display:-webkit-box;overflow:hidden}"
  const NEW2 = "/*patch(preset-wrap)*/cardDesc{color:var(--dsw-alias-label-secondary);white-space:normal;-webkit-line-clamp:4;overflow-wrap:anywhere;-webkit-box-orient:vertical;min-height:42px;font-size:13px;line-height:1.55;display:-webkit-box;overflow:hidden}"
  if (s.includes(OLD2)) { writeFileSync(target, s.replace(OLD2, NEW2)); console.log('[ok] preset-wrap patched (official variant)'); process.exit(0) }
  console.log('[skip] anchor not found (plugin updated or already different):', target); process.exit(0)
}
writeFileSync(target, s.replace(OLD, NEW))
console.log('[ok] preset-wrap patched')
