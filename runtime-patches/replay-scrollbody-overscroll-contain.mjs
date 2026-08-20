#!/usr/bin/env node
// 补丁 29：scrollBody 边界滚动链收敛——官方 ui-conversation 的 .scrollBody 未声明
// overscroll-behavior，滚动列表到顶/底继续滚会链式穿透到最近可滚祖先
// （场景：整页橡皮筋、代码块内滚带动外层列表）。本补丁在编译产物中给
// .scrollBody 注入 overscroll-behavior:contain，与官方 _tableScroll 等内部
// 滚动容器的 contain 配方保持一致。安全：纯属性追加，不改变布局/盒模型。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const target = process.argv[2]
if (!target) {
  console.error('usage: replay-scrollbody-overscroll-contain.mjs <ui-conversation client.js>')
  process.exit(1)
}

let src = readFileSync(target, 'utf8')
const MARKER = 'overscroll-behavior:contain'
const ANCHOR = 'scrollbar-gutter:stable;'
const RULE_OPEN = 'scrollBody{'

if (src.includes(MARKER)) {
  console.log('[skip] already patched:', target)
  process.exit(0)
}

// 定位第一个 .scrollBody{ ... } 规则块
const blockOpen = src.indexOf(RULE_OPEN)
if (blockOpen < 0) {
  throw new Error('scrollBody{ rule not found in ' + target + ' — upstream may have renamed the class')
}
const blockClose = src.indexOf('}', blockOpen + RULE_OPEN.length)
if (blockClose < 0) {
  throw new Error('scrollBody{ block has no closing } in ' + target)
}

// 在该块内查找 ANCHOR
const anchorIdx = src.indexOf(ANCHOR, blockOpen)
if (anchorIdx < 0 || anchorIdx > blockClose) {
  throw new Error('scrollbar-gutter:stable; not inside first scrollBody{ block of ' + target + ' — rule structure changed upstream')
}

src = src.slice(0, anchorIdx + ANCHOR.length) + MARKER + ';' + src.slice(anchorIdx + ANCHOR.length)
writeFileSync(target, src)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target)
