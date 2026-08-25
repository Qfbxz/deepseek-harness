#!/usr/bin/env node
// 补丁 40:dsh-tools defineTool 对缺失 output.render 的兜底。
// 根因:defineTool 无条件包装 `render(args,value){ return userRender(args,value) }`,
// 而插件不提供 render 时 userRender === undefined,调用即抛 "userRender is not a
// function",被 createSuccessResult 归一成 ToolOutputError "output.render failed" ——
// 工具执行成功却整体失败。对照同类钩子(finalizeContent/presentCall/presentationMeta)
// 均为条件挂载,render 是唯一缺兜底的必经路径。波及:dsh-chat-import 的
// doctor/import_agents/import_mcp/import_settings 等全部未声明 render 的第三方工具。
// 修:userRender 缺失时兜底 generic JSON 文本渲染(value 已过 schema 校验,
// JSON.stringify 安全)。治本一处,所有插件受益。
// 幂等:含 patch(render-fallback) 标记即跳过;锚点失配大声报错。
// 用法: replay-dsh-tools-render-fallback.mjs <dsh-tools/lib/index.js>
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const target = process.argv[2]
if (!target) { console.error('usage: replay-dsh-tools-render-fallback.mjs <index.js>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('/*patch(render-fallback)*/')) { console.log('[skip] already patched:', target); process.exit(0) }
const OLD = 'const userRender = options.output.render;'
const NEW = 'const userRender = options.output.render ?? /*patch(render-fallback)*/ ((_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }]);'
if (!s.includes(OLD)) { console.error('[FAIL] anchor missing — upstream restructured, review manually:', target); process.exit(1) }
s = s.replace(OLD, NEW)
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[ok] render-fallback patched (defineTool: missing render -> generic JSON text)')
