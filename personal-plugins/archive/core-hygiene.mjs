/**
 * Core hygiene sentinel — 2026-08-16 prepare 事故根治层之一。
 *
 * 根因：市场插件（如 @anweat/dsh-browser）以正式依赖拉取
 * @deepseek-ai/dsh-tools@rc.6；nodeLinker: hoisted 会把该副本平铺到 profile
 * 根。rc.6 用裸 Symbol() 做调度器键——每个物理副本各持一个身份，
 * agent-loop 拿 A 副本符号去 B 副本取 ToolRuntime 调度器得到 undefined，
 * 该上下文所有工具调用报 "Cannot read properties of undefined (reading
 * 'prepare')"。Symbol.for 走全局注册表，跨副本同身份，多副本无害。
 *
 * 本哨兵在每次 profile 启动时扫描所有 dsh-tools 物理副本（profile 根、
 * .pnpm 嵌套、App 内置、host.bak-*、nvm 全局 CLI），把裸 Symbol 副本
 * 就地补丁为 Symbol.for，并记录 ~/.dsh/core-hygiene.log。
 * 注意：若 App 进程已加载坏副本，补丁自下次启动生效（日志会注明）。
 * rc.7+（原生 Symbol.for）上线后本哨兵自动成为空操作。
 * @module dsh-local/core-hygiene
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'core-hygiene'

const GOOD = 'Symbol.for("@deepseek-ai/dsh-tools.scheduler")'
const BAD = 'Symbol("@deepseek-ai/dsh-tools.scheduler")'
const REL = ['node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js']

function listDir(dir) {
  try { return readdirSync(dir) } catch { return [] }
}

/** 枚举本机所有 dsh-tools lib/index.js 物理副本。 */
function candidateCopies() {
  const home = homedir()
  const out = []
  const seen = new Set()
  const push = (p) => { if (!seen.has(p)) { seen.add(p); out.push(p) } }

  // 1) 各 profile 根部副本（市场插件安装产生，最常出新版本）
  const profiles = join(home, '.dsh', 'profiles')
  for (const p of listDir(profiles)) {
    push(join(profiles, p, ...REL))
    // 2) isolated 链接器模式下的 .pnpm 嵌套副本（若未来切换 nodeLinker）
    const pn = join(profiles, p, 'node_modules', '.pnpm')
    for (const e of listDir(pn)) {
      if (e.startsWith('@deepseek-ai+dsh-tools@')) {
        push(join(pn, e, 'node_modules', ...REL))
      }
    }
  }
  // 3) 桌面 App 内置宿主 + 重建备份
  const res = '/Applications/DeepSeek Harness.app/Contents/Resources'
  push(join(res, 'host', ...REL))
  for (const e of listDir(res)) {
    if (e.startsWith('host.bak-')) push(join(res, e, ...REL))
  }
  // 4) nvm 全局 dsh CLI
  const nvm = join(home, '.nvm', 'versions', 'node')
  for (const v of listDir(nvm)) {
    push(join(nvm, v, 'lib', 'node_modules', '@deepseek-ai', 'dsh', ...REL))
  }
  return out
}

/** 扫描并就地补丁；返回统计。绝不抛错（卫生哨兵不能破坏启动）。 */
function scanAndPatch() {
  let checked = 0, patched = 0
  const unknown = []
  for (const path of candidateCopies()) {
    if (!existsSync(path)) continue
    checked += 1
    let src
    try { src = readFileSync(path, 'utf8') } catch { unknown.push(path); continue }
    if (src.includes(GOOD)) continue
    if (src.includes(BAD)) {
      try { writeFileSync(path, src.replace(BAD, GOOD)); patched += 1 } catch { unknown.push(path) }
    } else {
      unknown.push(path) // 版本变动，符号定义未找到，需人工检查
    }
  }
  return { checked, patched, unknown }
}

/** @param ctx {import('cordis').Context} */
export function apply(ctx) {
  const log = (line) => {
    try {
      writeFileSync(join(homedir(), '.dsh', 'core-hygiene.log'),
        `[${new Date().toISOString()}] ${line}\n`, { flag: 'a' })
    } catch { /* 日志失败不影响主流程 */ }
  }
  try {
    const { checked, patched, unknown } = scanAndPatch()
    const note = patched > 0 ? '（已就地补丁；若宿主进程已加载坏副本，自下次启动生效）' : ''
    log(`checked=${checked} patched=${patched} unknown=${unknown.length} ${note}`)
    if (unknown.length) log('unknown 副本(需人工检查): ' + unknown.join(' | '))
    if (patched > 0) ctx?.logger?.warn?.(`[core-hygiene] patched ${patched} bare-Symbol dsh-tools cop` + (patched > 1 ? 'ies' : 'y') + note)
    else ctx?.logger?.info?.(`[core-hygiene] ${checked} cop` + (checked === 1 ? 'y' : 'ies') + ' identity-safe')
  } catch (err) {
    log('ERROR ' + (err && err.message ? err.message : String(err)))
    ctx?.logger?.warn?.('[core-hygiene] scan failed: ' + (err && err.message ? err.message : err))
  }
}
