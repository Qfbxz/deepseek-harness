#!/usr/bin/env node
// 补丁 57：ui-theme 全局 html/body 钉死（webui 滚动空白修复层②，2026-08-26 另一会话
// 引入）：html,body{overscroll-behavior:none;height:100%;overflow:hidden}。
// 桌面版不豁免——dsh-desktop-chrome 的 body-scroll-guard v8 用 html.dshc-electron 类
// 把 body 高度改 calc(100%-32px)（壳标题栏 padding-top:32px，钉死+overflow:hidden 会
// 硬裁底部 32px；高度链不能动，动则侧栏文件树失约束撑爆页面，见 desktop-chrome 注释）。
// 幂等：marker 在场即跳过；锚点失配大声报错。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const targets = process.argv.slice(2)
if (targets.length === 0) { console.error('usage: replay-ui-theme-body-pin.mjs <ui-theme client.js> [...]'); process.exit(1) }

const MARK = 'html,body{overscroll-behavior:none;height:100%;overflow:hidden}'
const ANCHOR = 'var base_css_default = ":root{--dsw-font-family'

for (const target of targets) {
  let src = readFileSync(target, 'utf8')
  if (src.includes(MARK)) { console.log('[skip] already pinned:', target); continue }
  if (!src.includes(ANCHOR)) { console.error('[fail] anchor not found — upstream changed:', target); process.exit(1) }
  src = src.replace(ANCHOR, 'var base_css_default = "' + MARK + ':root{--dsw-font-family', 1)
  writeFileSync(target, src)
  execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
  console.log('[ok] ui-theme body pin injected:', target)
}
