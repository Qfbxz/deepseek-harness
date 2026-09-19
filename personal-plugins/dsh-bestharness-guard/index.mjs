/**
 * dsh-bestharness-guard — BestHarness 综合守卫（五家 harness 源码分析结晶）
 *
 * 三机制单一插件，全部走 DSH 公开扩展面（不动核心、随时可卸载）：
 *
 * 1) 四级防死循环梯子（Kimi CLI toolset.py:154-157 语义）
 *    streak 3 → 温和提醒；5 → 详细提醒；8 → 强停提示；12 → block 强制拦截。
 *    canonical 化 = 深度键序排序（键序不同不绕过）。
 *    负优化防护：与内置 repeat-tool-reminder 语义不冲突（本插件是它的
 *    超集；若两者同装，内置插件先提醒、本插件在 12 级才 block，互不重复）。
 *
 * 2) turn 级 token 预算（Claude Code query/tokenBudget.ts 语义）— 默认关。
 *    负优化防护：默认 turnTokens=0 完全不启用；仅累计 output tokens
 *    （input 由缓存覆盖，计入会虚高误停）；只在步边界注入一条 nudge。
 *
 * 3) 子代理摘要质量门（Kimi runner.py:38-44 语义）— 默认关。
 *    负优化防护：minChars=0 关闭；开启后每个子代理 turn 至多注入一次
 *    扩写指令（去重标记防重复注入）。
 *
 * 设置规范：settingsNamespace('bestharness-guard') + schemastery schema，
 * 设置服务为唯一数据源（GUI 设置卡/行为读取同一 scope）。
 */

import { randomUUID } from 'node:crypto'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-bestharness-guard'
export const inject = ['settings']

// ----------------------------------------------------------------------
// 设置 schema（GUI 设置卡自动渲染；schemastery 强校验，非法值 fail-loud）
// ----------------------------------------------------------------------
export const GUARD_SETTINGS = settingsNamespace('bestharness-guard')

export const Config = z.object({
  doom: z.object({
    enabled: z.boolean().default(true),
    gentleAt: z.number().default(3).min(2),
    detailedAt: z.number().default(5).min(3),
    stopHintAt: z.number().default(8).min(4),
    forceStopAt: z.number().default(12).min(6),
    include: z.array(z.string()).default([]),
    exclude: z.array(z.string()).default([]),
    argumentsPreviewChars: z.number().default(500).min(50),
  }).default({}),
  budget: z.object({
    enabled: z.boolean().default(false),
    turnTokens: z.number().default(200000).min(10000),
    completionThreshold: z.number().default(0.9).min(0.5).max(0.99),
    diminishingDelta: z.number().default(500).min(50),
  }).default({}),
  summary: z.object({
    enabled: z.boolean().default(false),
    minChars: z.number().default(200).min(50),
  }).default({}),
})

const DEFAULTS = {
  doom: { enabled: true, gentleAt: 3, detailedAt: 5, stopHintAt: 8, forceStopAt: 12, include: [], exclude: [], argumentsPreviewChars: 500 },
  budget: { enabled: false, turnTokens: 200000, completionThreshold: 0.9, diminishingDelta: 500 },
  summary: { enabled: false, minChars: 200 },
}

// ----------------------------------------------------------------------
// 提醒文案（Kimi toolset.py:125-152 升级版）
// ----------------------------------------------------------------------
const GENTLE =
  'You are repeating the exact same tool call with identical arguments. ' +
  'Carefully analyze the previous result: try a different approach, different arguments, or finish if enough evidence is gathered.'

function detailedReminder(tool, count, args) {
  return 'Repeated tool call detected:\n' +
    '- tool: ' + tool + '\n' +
    '- consecutive_calls: ' + count + '\n' +
    '- arguments: ' + args + '\n' +
    'These repeated calls are not making progress. Do NOT call this tool with these exact arguments again.'
}

const STOP_HINT =
  'You are stuck in a dead end, repeatedly making the same call without progress. ' +
  'Stop all tool calls. In your next response: analyze why progress is blocked, ' +
  'then report a text-only summary of the problem, what was tried, and what is needed next.'

const BLOCK_FEEDBACK =
  'Tool call blocked by bestharness-guard: identical call repeated too many times without progress. ' +
  'Conclude this turn with a text-only analysis of what blocked you.'

// ----------------------------------------------------------------------
// 工具函数（深度键序 canonical 化，与 repeat-tool-reminder 同款）
// ----------------------------------------------------------------------
function sortJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value !== null && typeof value === 'object') {
    const sorted = {}
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortJsonValue(value[key])
    }
    return sorted
  }
  return value
}

function canonicalize(args) {
  const parsed = typeof args === 'string' ? safeParse(args) : args
  try {
    return JSON.stringify(sortJsonValue(parsed))
  } catch {
    return String(args)
  }
}

function safeParse(raw) {
  try { return raw ? JSON.parse(raw) : {} } catch { return { _raw: String(raw) } }
}

function wildcardToRegExp(pattern) {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`)
  return new RegExp('^' + escaped.replaceAll('*', '.*') + '$')
}

function preview(canonical, cap) {
  if (canonical.length <= cap) return canonical
  return canonical.slice(0, cap) + '… (+' + (canonical.length - cap) + ' more chars)'
}

function notice(text, summary) {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'bestharness-guard', form: 'notice', summary },
    // 会话日志校验要求 user/message 带 id（assertMessageEventShape：非空字符串）；
    // 缺 id 的事件写入成功但恢复会话时 SessionPersistenceCorruptionError（2026-08-25 事故）。
    id: randomUUID(),
  }
}

// ----------------------------------------------------------------------
// apply
// ----------------------------------------------------------------------
export function apply(ctx) {
  let cfg = structuredClone(DEFAULTS)

  // 设置服务 = 唯一数据源：注册 scope，行为读 scope，GUI 卡同 scope
  ctx.inject(['settings'], (sctx) => {
    const scope = sctx.settings.register(GUARD_SETTINGS, Config, { base: DEFAULTS })
    const sync = () => {
      const v = scope.get()
      cfg = {
        doom: { ...DEFAULTS.doom, ...(v.doom ?? {}) },
        budget: { ...DEFAULTS.budget, ...(v.budget ?? {}) },
        summary: { ...DEFAULTS.summary, ...(v.summary ?? {}) },
      }
    }
    sync()
    ctx.effect(() => scope.watch(sync), 'bestharness-guard: settings sync')
  }, 'bestharness-guard: settings')

  // ================= 机制 1：四级梯子 =================
  const chains = new WeakMap() // agent -> { key, count }
  const compiledPatterns = () => ({
    include: cfg.doom.include.map(wildcardToRegExp),
    exclude: cfg.doom.exclude.map(wildcardToRegExp),
  })

  // 内置 repeat-tool-reminder 在树且启用时，其 gentle+detailed 两档已覆盖本插件的
  // 低两档（默认阈值同为 3/5，同 step 双份近似文案）——跳过低两档，本插件独有
  // 价值保留在 stopHint/block 高档。取舍得当：内置阈值可另行配置，若调高则本
  // 插件低档也静默；高档不受影响，防死循环能力不降级。
  let builtinReminder = false
  ctx.inject(['loader'], (lctx) => {
    try {
      builtinReminder = lctx.loader.entries().some((e) =>
        e.options?.name === '@deepseek-ai/dsh-repeat-tool-reminder' && e.fiber !== undefined && !e.disabled)
    } catch { builtinReminder = false }
  }, 'bestharness-guard: builtin reminder detection')

  function tracked(toolName) {
    const { include, exclude } = compiledPatterns()
    if (include.length > 0 && !include.some(p => p.test(toolName))) return false
    return !exclude.some(p => p.test(toolName))
  }

  function observe(exec) {
    if (!cfg.doom.enabled) return undefined
    if (!exec.agent) return undefined
    if (!tracked(exec.name)) return undefined
    const canonical = canonicalize(exec.arguments)
    const key = JSON.stringify([exec.name, canonical])
    const chain = chains.get(exec.agent)
    const count = chain !== undefined && chain.key === key ? chain.count + 1 : 1
    chains.set(exec.agent, { key, count })

    const d = cfg.doom
    if (count >= d.forceStopAt) {
      return { level: 'block', summary: exec.name + ' x' + count + ' [blocked]' }
    }
    if (builtinReminder && (count === d.gentleAt || count === d.detailedAt)) return undefined
    if (count === d.gentleAt) {
      return { level: 'remind', message: GENTLE, summary: exec.name + ' x' + count }
    }
    if (count === d.detailedAt) {
      return { level: 'remind', message: detailedReminder(exec.name, count, preview(canonical, d.argumentsPreviewChars)), summary: exec.name + ' x' + count }
    }
    if (count === d.stopHintAt) {
      return { level: 'remind', message: STOP_HINT, summary: exec.name + ' x' + count + ' [final warning]' }
    }
    return undefined
  }

  ctx.on('tools/post-execute', async (exec, _result, next) => {
    const verdict = observe(exec)
    const downstream = await next()
    if (!verdict) return downstream
    if (verdict.level === 'block') {
      return {
        kind: 'block',
        feedback: [{ type: 'text', text: BLOCK_FEEDBACK }],
        additionalContexts: [notice(BLOCK_FEEDBACK, verdict.summary)],
      }
    }
    const reminder = notice(verdict.message, verdict.summary)
    if (downstream.kind === 'block') {
      return { kind: 'block', feedback: downstream.feedback, additionalContexts: [reminder, ...(downstream.additionalContexts ?? [])] }
    }
    return { ...downstream, additionalContexts: [reminder, ...(downstream.additionalContexts ?? [])] }
  })

  // 用户真实插话 → 重置链（跨插话的重复不是循环）
  ctx.on('agent/pre-step', ({ agent, messages }, next) => {
    if (messages.some(m => m.source && m.source.kind === 'user')) chains.delete(agent)
    return next()
  })

  // ================= 机制 2：turn token 预算（默认关） =================
  const budgetState = new WeakMap() // agent -> { continuations, lastDelta, lastOutput }

  ctx.on('session/event', (session, event) => {
    if (!cfg.budget.enabled || event.type !== 'assistant/message' || !event.usage) return
    const agent = lookupAgent(ctx, session)
    if (!agent) return
    let t = budgetState.get(agent)
    if (!t) {
      t = { continuations: 0, lastDelta: 0, lastOutput: 0 }
      budgetState.set(agent, t)
    }
    const out = event.usage.outputTokens ?? 0
    const delta = out - t.lastOutput
    t.lastOutput = out
    agent._bh_output_tokens = (agent._bh_output_tokens ?? 0) + Math.max(0, delta)

    const b = cfg.budget
    const used = agent._bh_output_tokens
    if (used >= b.turnTokens * b.completionThreshold) {
      agent._bh_nudge = 'Token budget ' + Math.round((used / b.turnTokens) * 100) + '% used. ' +
        'Wrap up: summarize what was accomplished and what remains.'
    } else if (t.continuations >= 3 && delta < b.diminishingDelta && t.lastDelta < b.diminishingDelta) {
      agent._bh_nudge = 'Recent steps show diminishing returns (small token deltas). ' +
        'Wrap up: summarize what was accomplished and what remains.'
    } else if (delta > 0) {
      t.continuations++
      t.lastDelta = delta
    }
  })

  ctx.on('session/event', (session, event) => {
    if (!cfg.budget.enabled || event.type !== 'turn/start') return
    const agent = lookupAgent(ctx, session)
    if (agent) { agent._bh_output_tokens = 0; agent._bh_nudge = undefined }
  })

  ctx.on('agent/pre-step', ({ agent, messages }, next) => {
    const nudge = agent._bh_nudge
    if (!nudge) return next()
    agent._bh_nudge = undefined // 一次性消费，防重复注入
    const decision = next()
    if (decision && typeof decision.then === 'function') {
      return decision.then(d =>
        d.kind === 'enter' ? { kind: 'enter', messages: [notice(nudge, 'budget nudge'), ...d.messages] } : d,
      )
    }
    return decision
  })

  // ================= 机制 3：子代理摘要质量门（默认关） =================
  const gated = new WeakSet() // session -> already gated this turn

  ctx.on('session/event', (session, event) => {
    if (!cfg.summary.enabled || event.type !== 'turn/end') return
    if (gated.has(session)) return
    const header = session && session.header
    if (!header || (!header.parentSession && header.seedLength === undefined)) return
    const msgs = session.surface && typeof session.surface.messages === 'function' ? session.surface.messages() : undefined
    if (!msgs) return
    let lastText = ''
    for (const m of msgs) {
      if (m.role === 'assistant') {
        const t = (m.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('').trim()
        if (t) lastText = t
      }
    }
    if (lastText && lastText.length < cfg.summary.minChars) {
      gated.add(session) // 本 turn 只注入一次（负优化防护：不会反复扩写）
      try {
        session.append({
          type: 'user/message',
          message: notice(
            'Your final summary is too short (' + lastText.length + ' chars; minimum ' + cfg.summary.minChars + '). ' +
            'Expand it: what was done, key findings, files touched, and what the caller should know next.',
            'summary quality gate',
          ),
        })
      } catch { /* append 不可用时 fail-soft 跳过 */ }
    }
  })

  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') gated.delete(session)
  })
}

// ----------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------
function lookupAgent(ctx, session) {
  try {
    if (ctx.agents && typeof ctx.agents.get === 'function') return ctx.agents.get(session.id)
    if (ctx.agents && typeof ctx.agents.resolve === 'function') return ctx.agents.resolve(session.id)
  } catch { /* not found */ }
  return undefined
}
