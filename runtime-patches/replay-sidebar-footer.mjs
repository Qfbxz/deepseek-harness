#!/usr/bin/env node
// 补丁 56：侧栏底部整组修复（合并原 p19 导入短标签、p55 导出按钮，2026-08-26 用户指令归一）：
// ① chat-import 触发按钮去可见文字（图标-only；aria-label/title 走独立键不受影响）；
// ② session-log-export 侧栏导出按钮（镜像导入图标 scaleX(-1)、贴导入按钮右侧同行、
//    1s 重钉兜底 React 重渲染，点击转发到会话头部导出）。
// 「移动访问」字样去除在 dsh-custom-ui（仓库源码软链持久，无需重放）。
// 按目标文件内容自动分派①/②；幂等：各自 marker 在场即跳过；锚点失配大声报错。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const targets = process.argv.slice(2)
if (targets.length === 0) { console.error('usage: replay-sidebar-footer.mjs <client.js> [...]'); process.exit(1) }

// ② 导出按钮（与已验证部署形态逐字一致；锚点带 ctx. 前缀防吞前缀）
const MARK_EXPORT = '/*patch(export-sidebar)*/'
const ANCHOR_EXPORT = 'ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({'
const BLOCK_EXPORT = `${MARK_EXPORT}
		ctx.slots.inject("sidebar.footer.action", () => {
			ctx.slots.register({
				name: "sidebar.footer.action",
				id: "session-log-export",
				order: 5,
			}, () => react_jsx_runtime.jsx("button", {
				type: "button",
				"aria-label": "导出",
				title: "导出 Session",
				style: { width: "auto", flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: "2px", cursor: "pointer", background: "none", border: "none", padding: "4px 6px" },
				onClick: (e) => {
					const target = document.querySelector('[aria-label="导出 Session"], [aria-label*="导出"] button, [class*="sessionHeader"] [aria-label*="导出"]');
					if (target && target !== e.currentTarget) target.click();
				},
				dangerouslySetInnerHTML: { __html: '<svg width="16" height="16" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex:none;transform:scaleX(-1)" aria-hidden="true"><path d="M905.309091 628.363636c-27.927273 0-46.545455 18.618182-46.545455 46.545455v223.418182H165.236364V125.672727h200.145454c27.927273 0 46.545455-18.618182 46.545455-46.545454s-18.618182-46.545455-46.545455-46.545455H118.690909c-27.927273 0-46.545455 18.618182-46.545454 46.545455v865.745454c0 27.927273 18.618182 46.545455 46.545454 46.545455h786.618182c27.927273 0 46.545455-18.618182 46.545454-46.545455v-269.963636c0-27.927273-18.618182-46.545455-46.545454-46.545455z" fill="currentColor"/><path d="M556.218182 558.545455h349.090909v-93.09091h-269.963636l293.236363-269.963636-65.163636-65.163636-307.2 283.927272V116.363636h-93.090909V558.545455h4.654545z" fill="currentColor"/></svg>' },
			}));
			// 与导入按钮同行：把本槽渲染出的按钮搬到导入按钮（按其 SVG 路径签名识别）
			// 右侧——导入的三种布局（行内/浮动行）自然跟随；React 重渲染重建节点时 1s 重钉兜底。
			const place = () => {
				const mine = Array.from(document.querySelectorAll('button[aria-label="导出"]'));
				const btn = mine[mine.length - 1];
				if (!btn) return;
				const imp = Array.from(document.querySelectorAll("button")).find(b => b !== btn && b.innerHTML.includes("M905.309091"));
				if (imp && imp.parentElement && btn.parentElement !== imp.parentElement) imp.insertAdjacentElement("afterend", btn);
			};
			place();
			const iv = setInterval(place, 1000);
			ctx.effect(() => () => { clearInterval(iv); });
		});
		${ANCHOR_EXPORT}`

// ① 导入按钮去文字：删掉 LogoIcon 后的标签子节点（aria-label/title 用独立键，保留）。
// 该包发布带 CRLF 行尾——锚点按目标文件实际行尾拼接。
const MARK_ICON_ONLY = '/*patch(sidebar-icon-only)*/'
const iconOnlyAnchor = (nl) => '          React.createElement(LogoIcon, { size: 16 }),' + nl + '          !rail && t("trigger.label")),'
const iconOnlyBlock = (nl) => '          React.createElement(LogoIcon, { size: 16 })' + MARK_ICON_ONLY + '),'

for (const target of targets) {
  let src = readFileSync(target, 'utf8')
  const isExport = src.includes(ANCHOR_EXPORT) || src.includes(MARK_EXPORT)
  const isImport = src.includes('trigger.label')
  if (isExport) {
    if (src.includes(MARK_EXPORT)) { console.log('[skip] export already patched:', target) }
    else {
      src = src.replace(ANCHOR_EXPORT, BLOCK_EXPORT, 1)
      writeFileSync(target, src)
      execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
      console.log('[ok] sidebar export button injected:', target)
    }
  } else if (isImport) {
    if (src.includes(MARK_ICON_ONLY)) { console.log('[skip] icon-only already patched:', target) }
    else {
      const nl = src.includes('\r\n') ? '\r\n' : '\n'
      const ANCHOR_ICON_ONLY = iconOnlyAnchor(nl)
      if (!src.includes(ANCHOR_ICON_ONLY)) { console.error('[fail] import anchor not found — upstream changed:', target); process.exit(1) }
      src = src.replace(ANCHOR_ICON_ONLY, iconOnlyBlock(nl), 1)
      writeFileSync(target, src)
      execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
      console.log('[ok] import trigger icon-only:', target)
    }
  } else {
    console.error('[fail] unrecognized target (neither export nor import):', target); process.exit(1)
  }
}
