#!/usr/bin/env node
/**
 * replay-subagent-tool-routes.mjs — 五路子代理工具实例配置自愈补丁。
 *
 * 根因（2026-08-22）：dsh-tool-subagent 每实例只绑一个 provider（模型无
 * provider 选择器），五后端（claude-code/codex/kimi/opencode/hermes）虽已
 * 注册 ctx.subagents，但未暴露为模型可调用的独立工具 → 会话内无法点名调用。
 *
 * 修复：向 ~/.dsh/profiles/web/cordis.patch.yml 幂等注入五个 tool-subagent
 * 实例（toolName: subagent_claude_code / subagent_codex / subagent_kimi /
 * subagent_opencode / subagent_hermes，全部 one-shot）。
 *
 * 三态机理（对齐 runtime-patches 规范，配置文件特化）：
 *   marker（id: tool-subagent-claude-code）在场 → 已打补丁，零动作
 *   marker 缺 + 文件存在                        → 追加恢复段（幂等）
 *   文件不存在                                  → ERROR 大声报错（配置本体，不可退役）
 *
 * 用法：node replay-subagent-tool-routes.mjs [目标yml]（默认 profile patch）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MARKER = 'tool-subagent-claude-code'
const target = process.argv.length > 2 && process.argv[process.argv.length - 1].endsWith('.yml')
  ? process.argv[process.argv.length - 1]
  : join(homedir(), '.dsh/profiles/web/cordis.patch.yml')

if (!existsSync(target)) {
  console.error(`[error] ${target} missing — profile patch layer itself is gone; refusing to recreate from scratch`)
  process.exit(1)
}

const src = readFileSync(target, 'utf8')
if (src.includes(`id: ${MARKER}`)) {
  console.log(`[skip] already routed: ${target}`)
  process.exit(0)
}

const BLOCK = `
# --- 2026-08-22 replay-subagent-tool-routes: 五路子代理工具实例自愈段 ---
# 五后端已注册 ctx.subagents（claude-code/codex 走官方 SDK，kimi/opencode/hermes
# 走 ACP）；本段把它们各绑一个 dsh-tool-subagent 实例，暴露为模型可调用的
# 独立工具。删除本段 = 下个 watchdog/autorun 周期自动恢复（幂等）。
- insert:
  - id: tool-subagent-claude-code
    name: '@deepseek-ai/dsh-tool-subagent'
    config:
      provider: claude-code
      toolName: subagent_claude_code
      backgroundMode: one-shot
  - id: tool-subagent-codex
    name: '@deepseek-ai/dsh-tool-subagent'
    config:
      provider: codex
      toolName: subagent_codex
      backgroundMode: one-shot
  - id: tool-subagent-kimi
    name: '@deepseek-ai/dsh-tool-subagent'
    config:
      provider: kimi
      toolName: subagent_kimi
      backgroundMode: one-shot
  - id: tool-subagent-opencode
    name: '@deepseek-ai/dsh-tool-subagent'
    config:
      provider: opencode
      toolName: subagent_opencode
      backgroundMode: one-shot
  - id: tool-subagent-hermes
    name: '@deepseek-ai/dsh-tool-subagent'
    config:
      provider: hermes
      toolName: subagent_hermes
      backgroundMode: one-shot
`

let out = src
if (!out.endsWith('\n')) out += '\n'
out += BLOCK
writeFileSync(target, out)
console.log(`[patched] five subagent tool routes appended: ${target}`)
