#!/usr/bin/env node
// 补丁 58：dsh-mobile 远程连接面板主题化——面板本体已用 --dsw-alias-* token，但内部
// 卡片/引导框是硬编码浅色面（#fff/#eff6ff/#f5f5f8 系）+ 深色文字（#1e293b/#475569 系），
// 暗色主题下白底看不清文字。逐声明替换为 token+原值回退：亮色模式外观不变，暗色跟随
// 全局主题。纯色品牌按钮（白字蓝/绿底）不动——两种主题下均可读。
// 幂等：映射后形态在场即跳过；原始形态全缺且映射形态也缺 = 上游重构，大声报错。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const targets = process.argv.slice(2)
if (targets.length === 0) { console.error('usage: replay-dsh-mobile-theme.mjs <dsh-mobile client.js> [...]'); process.exit(1) }

const MAP = {
  'background:#fff': 'background:var(--dsw-alias-bg-base,#fff)',
  'background:#eff6ff': 'background:var(--dsw-alias-bg-multi-select,#eff6ff)',
  'background:#e8f0ff': 'background:var(--dsw-alias-bg-multi-select,#e8f0ff)',
  'background:#f5f8ff': 'background:var(--dsw-alias-bg-multi-select,#f5f8ff)',
  'background:#f8fbff': 'background:var(--dsw-alias-bg-base,#f8fbff)',
  'background:#eaf8f2': 'background:var(--dsw-alias-interactive-bg-hover,#eaf8f2)',
  'background:#f1f5f9': 'background:var(--dsw-alias-bg-layer-1,#f1f5f9)',
  'background:#f3f5f8': 'background:var(--dsw-alias-bg-layer-1,#f3f5f8)',
  'color:#1e293b': 'color:var(--dsw-alias-label-primary,#1e293b)',
  'color:#172554': 'color:var(--dsw-alias-label-primary,#172554)',
  'color:#475569': 'color:var(--dsw-alias-label-secondary,#475569)',
  'color:#64748b': 'color:var(--dsw-alias-label-tertiary,#64748b)',
  'color:#087454': 'color:var(--dsw-alias-state-success-primary,#087454)',
  'color:#b91c1c': 'color:var(--dsw-alias-state-error-secondary,#b91c1c)',
  'color:#dc2626': 'color:var(--dsw-alias-state-error-primary,#dc2626)',
  'border:1px solid #bfdbfe': 'border:1px solid var(--dsw-alias-border-l2,#bfdbfe)',
  'border:1px solid #dc2626': 'border:1px solid var(--dsw-alias-state-error-primary,#dc2626)',
}
const MARK = MAP['background:#fff']

for (const target of targets) {
  let src = readFileSync(target, 'utf8')
  if (src.includes(MARK) && !src.includes('background:#fff')) { console.log('[skip] already themed:', target); continue }
  let n = 0
  for (const [old, replacement] of Object.entries(MAP)) n += src.split(old).length - 1, src = src.split(old).join(replacement)
  if (n === 0) { console.error('[fail] no hardcoded declarations found — upstream restructured:', target); process.exit(1) }
  writeFileSync(target, src)
  execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
  console.log(`[ok] themed ${n} declarations:`, target)
}
