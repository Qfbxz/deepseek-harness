#!/usr/bin/env node
// 补丁：dsh-agent-loop 流式工具预调度（Claude Code StreamingToolExecutor 机制）
//
// 机制：chunk 流中 tool-call 块聚合完成的瞬间（而非整个流结束后），对该调用提前执行
// 调度器原语 prepare() + appendToolCall() + dispatch()——与 runGroup.startCall 完全相同的
// 原语序列，只是提前发起。收益 = min(剩余流时长, 工具执行时长)/step，多工具场景 1-3s。
//
// 正确性设计（核心：绝不双写、绝不乱序）：
// - tool/call 事件在预启动时写入（turn/step 与流结束后相同——同一个 step 内），
//   runGroup.startCall 命中 __bhPreflight 映射时跳过 append/prepare/dispatch，
//   直接接管已存在的 promise → tool/call 日志恰好一次。
// - 结果提交仍由 runGroup.commitReady 按 model-order 执行——顺序不变量零改动。
// - 只预启动 executionMode 判定 parallel 的调用；独占 barrier 语义原样。
// - 预启动失败静默退化原路径（映射 miss = startCall 正常执行）。
// - abort 时流循环 catch 分支已处理；未预启动的调用由原调度器补合成结果（replay 有效）。
//
// 2026-08-25 v2 修复（v1 上线即炸："ReferenceError: __bhPreflight is not defined"）：
// - 根因：v1 把 const __bhPreflight 声明插在 for await 锚点前——该行在 step() 的
//   try 块内；而挂载引用 this.loopCtx.__bhPreflight = __bhPreflight 在 try/catch 之后的
//   while 体内。const 块级作用域 → 任何带工具调用的 step 必抛 ReferenceError。
//   纯文本 step 在 toolCalls.length===0 提前返回不触发；node --check 只查语法，
//   作用域缺陷漏网。v2 声明上移到 const chunkSeqs 行后（try 之前的 while 体作用域，
//   流循环探针与 executeToolCalls 挂载两处引用同域可见）。
// - 次因（同炸型隐患）：v1 的 A2/A3 在声明锚点判断之外无条件应用——上游漂移使
//   声明锚点失配而 executeToolCalls 锚点仍在时，会注入无声明的悬空引用，且被
//   幂等 [skip] 永久保护。v2 四锚点全命中才整体应用，部分命中大声退出不写盘；
//   v1 已打上的错位声明自动迁移（strip 旧声明行 → 按 v2 位置重插，A1/A2/A3 原样保留）。
//
// 锚点（dsh-agent-loop/lib/index.js rc.8 未压缩产物，四锚点验证）：
//   D  const chunkSeqs 行后声明映射（while 体作用域）
//   A1 for-await 流循环 assembler.push 后注入预启动探针
//   A2 runGroup.startCall 的 prepare 调用行（命中映射则跳过）
//   A3 executeToolCalls 调用前挂载映射
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const targets = process.argv.slice(2)
if (targets.length === 0) { console.error('usage: replay-agent-loop-streaming-tool-dispatch.mjs <agent-loop/lib/index.js>...'); process.exit(1) }

const TAG = '/*patch(streaming-tool-dispatch)*/'
const DECL = 'const __bhPreflight = new Map(); ' + TAG
const DECL_ANCHOR = 'const chunkSeqs = [];'

function declInPlace(src) {
  const i = src.indexOf(DECL_ANCHOR)
  if (i < 0) return false
  const indent = src.slice(src.lastIndexOf('\n', i) + 1, i)
  return src.startsWith('\n' + indent + DECL, i + DECL_ANCHOR.length)
}

// A1：流循环内预启动（assembler.push 后）
const A1_OLD = 'assembler.push(chunk);'
const A1_ADD = [
  '',
  '				/*patch(streaming-tool-dispatch) CC StreamingToolExecutor semantics: start parallel-safe tool calls the moment their block completes in the stream. Uses the SAME scheduler primitives as runGroup.startCall (prepare + appendToolCall + dispatch) so the tool/call event is written exactly once; runGroup re-uses the in-flight promise and keeps model-order commit. Exclusive calls never preflight. Any preflight failure silently falls back to the original path. */',
  '				try {',
  '					if (this.loopCtx.tools && typeof this.loopCtx.tools.executionMode === "function" && this.loopCtx.tools[TOOL_RUNTIME_SCHEDULER]) {',
  '						for (const __b of assembler.blocks()) {',
  '							if (__b.type === "tool-call" && !__bhPreflight.has(__b.id)) {',
  '								const __exec = { callId: __b.id, name: __b.name, arguments: JSON.parse(__b.arguments || "{}"), agent: this.loopCtx.agents.requireInitiator(), signal };',
  '								if (this.loopCtx.tools.executionMode(__exec).kind !== "parallel") continue;',
  '								const __prepared = await this.loopCtx.tools[TOOL_RUNTIME_SCHEDULER].prepare(__exec);',
  '								if (__prepared.kind !== "dispatch") continue;',
  '								const __seq = appendToolCall(this.loopCtx.agents.requireInitiator().session, turn, step, __b);',
  '								const __promise = this.loopCtx.tools[TOOL_RUNTIME_SCHEDULER].dispatch(__prepared.exec).then((outcome) => ({ exec: __prepared.exec, result: outcome.result, needsPost: outcome.kind === "post-result" }), (error) => ({ exec: __prepared.exec, error }));',
  '								__bhPreflight.set(__b.id, { seq: __seq, promise: __promise });',
  '							}',
  '						}',
  '					}',
  '				} catch { /* preflight is a pure optimization: fall back silently */ }',
].join('\n')

// A2：startCall 命中映射则跳过 append/prepare/dispatch
const A2_OLD = 'const startCall = async (index) => {'
const A2_NEW = [
  'const startCall = async (index) => {',
  '		const __pf = group[index] && group[index].block && ctx.__bhPreflight ? ctx.__bhPreflight.get(group[index].block.id) : void 0; /*patch(streaming-tool-dispatch)*/',
  '		if (__pf) {',
  '			callSeqs[index] = __pf.seq;',
  '			started++;',
  '			const promise = __pf.promise.then((outcome) => {',
  '				if (outcome.error !== void 0) { schedulerFailure ??= { error: outcome.error }; return index; }',
  '				slots[index] = { exec: outcome.exec, result: outcome.result, needsPost: outcome.needsPost };',
  '				return index;',
  '			});',
  '			inFlight.set(index, promise);',
  '			return;',
  '		}',
].join('\n')

// A3：executeToolCalls 调用前挂映射（引用与 D 声明同在 while 体作用域）
const A3_OLD = 'const { concluded } = await executeToolCalls(this.loopCtx, turn, step, toolCalls, signal,'
const A3_NEW = 'this.loopCtx.__bhPreflight = __bhPreflight; /*patch(streaming-tool-dispatch)*/\n			const { concluded } = await executeToolCalls(this.loopCtx, turn, step, toolCalls, signal,'

let failed = false
for (const target of targets) {
  let s = readFileSync(target, 'utf8')

  // v1 遗留修复：声明错位在 for await 前（try 块内）。剥掉错位声明行并还原 for-await
  // 缩进，下方按 v2 位置重插；A1/A2/A3 注入位置本就正确，原样保留。
  if (s.includes(DECL) && !declInPlace(s)) {
    const before = s
    s = s.replace(/([ \t]*)const __bhPreflight = new Map\(\); \/\*patch\(streaming-tool-dispatch\)\*\/\nfor await \(const chunk of stream\) \{/, '$1for await (const chunk of stream) {')
    if (s === before) s = s.replace(DECL + '\n', '')
    if (s.includes(DECL) && !declInPlace(s)) { console.error('[error] legacy streaming-tool-dispatch declaration not relocatable — restore file from backup and rerun:', target); failed = true; continue }
  }

  const need = {
    decl: !declInPlace(s),
    a1: !s.includes('CC StreamingToolExecutor semantics'),
    a2: !s.includes('const __pf = group[index]'),
    a3: !s.includes('this.loopCtx.__bhPreflight = __bhPreflight'),
  }
  if (!need.decl && !need.a1 && !need.a2 && !need.a3) { console.log('[skip] already patched:', target); continue }

  const hasDeclAnchor = s.includes(DECL_ANCHOR)
  const hasA1 = s.includes(A1_OLD)
  const hasA2 = s.includes(A2_OLD)
  const hasA3 = s.includes(A3_OLD)
  if (!hasDeclAnchor && !hasA1 && !hasA2 && !hasA3) {
    console.log('[retire-check] anchors missing — official refactor or fix; inspect manually:', target)
    continue
  }
  const missing = []
  if (need.decl && !hasDeclAnchor) missing.push('decl')
  if (need.a1 && !hasA1) missing.push('A1')
  if (need.a2 && !hasA2) missing.push('A2')
  if (need.a3 && !hasA3) missing.push('A3')
  if (missing.length > 0) {
    console.error('[error] partial anchor match (' + missing.join('/') + ') — refusing to emit dangling references; inspect manually:', target)
    failed = true
    continue
  }

  // D：while 体作用域声明（chunkSeqs 行后、try 之前）
  if (need.decl) {
    const i = s.indexOf(DECL_ANCHOR)
    const indent = s.slice(s.lastIndexOf('\n', i) + 1, i)
    const at = i + DECL_ANCHOR.length
    s = s.slice(0, at) + '\n' + indent + DECL + s.slice(at)
  }

  if (need.a1) {
    const idx = s.indexOf(A1_OLD, s.indexOf(TAG))
    if (idx >= 0) s = s.slice(0, idx + A1_OLD.length) + A1_ADD + s.slice(idx + A1_OLD.length)
    else { console.error('[error] A1 push anchor missing — inspect manually:', target); failed = true; continue }
  }
  if (need.a2) s = s.replace(A2_OLD, A2_NEW)
  if (need.a3) s = s.replace(A3_OLD, A3_NEW)

  writeFileSync(target, s)
  execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
  console.log('[patched] streaming tool dispatch v2 (preflight via scheduler primitives):', target)
}
process.exit(failed ? 1 : 0)
