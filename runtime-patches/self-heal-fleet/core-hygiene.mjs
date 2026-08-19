/** Core hygiene sentinel v2 — dsh-tools 调度器符号统一 + ReasoningRow 思考自动展开补丁。见 ~/.dsh/INCIDENT-2026-08-16-prepare-error.md */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
export const name = 'core-hygiene'
const GOOD = 'Symbol.for("@deepseek-ai/dsh-tools.scheduler")'
const BAD = 'Symbol("@deepseek-ai/dsh-tools.scheduler")'
const REL = ['node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js']
const listDir = (dir) => { try { return readdirSync(dir) } catch { return [] } }
function candidateCopies() {
  const home = homedir(); const out = []; const seen = new Set()
  const push = (p) => { if (!seen.has(p)) { seen.add(p); out.push(p) } }
  const profiles = join(home, '.dsh', 'profiles')
  for (const p of listDir(profiles)) {
    push(join(profiles, p, ...REL))
    const pn = join(profiles, p, 'node_modules', '.pnpm')
    for (const e of listDir(pn)) { if (e.startsWith('@deepseek-ai+dsh-tools@')) push(join(pn, e, 'node_modules', ...REL)) }
  }
  const res = '/Applications/DeepSeek Harness.app/Contents/Resources'
  push(join(res, 'host', ...REL))
  for (const e of listDir(res)) { if (e.startsWith('host.bak-')) push(join(res, e, ...REL)) }
  const nvm = join(home, '.nvm', 'versions', 'node')
  for (const v of listDir(nvm)) push(join(nvm, v, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', ...REL))
  return out
}
function scanAndPatch() {
  let checked = 0, patched = 0; const unknown = []
  for (const path of candidateCopies()) {
    if (!existsSync(path)) continue
    checked += 1; let src
    try { src = readFileSync(path, 'utf8') } catch { unknown.push(path); continue }
    if (src.includes(GOOD)) continue
    if (src.includes(BAD)) { try { writeFileSync(path, src.replace(BAD, GOOD)); patched += 1 } catch { unknown.push(path) } }
    else unknown.push(path)
  }
  return { checked, patched, unknown }
}
/** 思考块自动展开/完成折叠补丁（CLI 更新后自动重打，幂等）。 */
function patchReasoning() {
  const home = homedir(); let patched = 0, already = 0; const unknown = []
  const nvm = join(home, '.nvm', 'versions', 'node')
  for (const v of listDir(nvm)) {
    const f = join(nvm, v, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js')
    if (!existsSync(f)) continue
    let src
    try { src = readFileSync(f, 'utf8') } catch { unknown.push(f); continue }
    if (src.includes('override ?? running')) { already += 1; continue }
    const i = src.indexOf('function ReasoningRow')
    if (i < 0) { unknown.push(f); continue }
    const seg = src.slice(i, i + 2500)
    const ns = seg
      .replace(/const \[expanded, setExpanded\] = \(0, react\.useState\)\(false\);(\s*)const summaryRef/, 'const [override, setOverride] = (0, react.useState)(null);$1const expanded = override ?? running;$1(0, react.useEffect)(() => { setOverride(null); }, [running]);$1const summaryRef')
      .replace(/setExpanded\(\(value\) => !value\);/, 'setOverride((value) => value === null ? !running : !value);')
    if (ns === seg) { unknown.push(f); continue }
    try { writeFileSync(f, src.slice(0, i) + ns + src.slice(i + 2500)); patched += 1 } catch { unknown.push(f) }
  }
  return { patched, already, unknown }
}
/** 注册表包补丁 1：dsh-client-auto-continue 的 slots.register 用了 key: 而运行时要求 id:（重装后自动重打，幂等）。 */
function patchAutoContinue() {
  const home = homedir(); let patched = 0, already = 0; const unknown = []
  const targets = []
  const profiles = join(home, '.dsh', 'profiles')
  for (const p of listDir(profiles)) {
    targets.push(join(profiles, p, 'node_modules', 'dsh-client-auto-continue', 'lib', 'client.js'))
    targets.push(join(profiles, p, 'node_modules', 'dsh-client-auto-continue', 'src', 'client', 'index.ts'))
  }
  for (const f of targets) {
    if (!existsSync(f)) continue
    let s
    try { s = readFileSync(f, 'utf8') } catch { unknown.push(f); continue }
    if (!s.includes('key: SETTINGS_NS,') || s.includes('id: SETTINGS_NS,')) { already += 1; continue }
    try { writeFileSync(f, s.replace('key: SETTINGS_NS,', 'id: SETTINGS_NS,')); patched += 1 } catch { unknown.push(f) }
  }
  return { patched, already, unknown }
}

/** 注册表包补丁 2：git-graph 0.2.x 把分支 chip 限制在空白会话——改回始终显示（repo===null 时组件自身仍会隐藏；上游改了此行则静默跳过）。 */
function patchGitGraph() {
  const home = homedir(); let patched = 0, already = 0; const unknown = []
  const BAD_LINE = 'const showBranchSelector = dockSeat ? heroSeat : blankSession;'
  const GOOD_MARK = 'patched 2026-08-18: chip always shows'
  const profiles = join(home, '.dsh', 'profiles')
  for (const p of listDir(profiles)) {
    const f = join(profiles, p, 'node_modules', '@linxin666', 'dsh-client-ui-git-graph', 'lib', 'client.js')
    if (!existsSync(f)) continue
    let s
    try { s = readFileSync(f, 'utf8') } catch { unknown.push(f); continue }
    if (s.includes(GOOD_MARK)) { already += 1; continue }
    if (!s.includes(BAD_LINE)) { unknown.push(f); continue }
    const replacement = '// ' + GOOD_MARK + '\n\t\t\tconst showBranchSelector = true;'
    try { writeFileSync(f, s.replace(BAD_LINE, replacement)); patched += 1 } catch { unknown.push(f) }
  }
  return { patched, already, unknown }
}

export function apply(ctx) {
  const log = (line) => { try { writeFileSync(join(homedir(), '.dsh', 'core-hygiene.log'), `[${new Date().toISOString()}] ${line}\n`, { flag: 'a' }) } catch { } }
  try {
    const sym = scanAndPatch(); const rea = patchReasoning()
    const ac = patchAutoContinue(); const gg = patchGitGraph()
    log(`symbols checked=${sym.checked} patched=${sym.patched} | reasoning patched=${rea.patched} already=${rea.already} | auto-continue patched=${ac.patched} already=${ac.already} | git-graph patched=${gg.patched} already=${gg.already} unknown=${sym.unknown.length + rea.unknown.length + ac.unknown.length + gg.unknown.length}`)
    if (sym.unknown.length) log('symbol unknown: ' + sym.unknown.join(' | '))
    if (rea.unknown.length) log('reasoning unknown: ' + rea.unknown.join(' | '))
    if (ac.unknown.length) log('auto-continue unknown: ' + ac.unknown.join(' | '))
    if (gg.unknown.length) log('git-graph unknown: ' + gg.unknown.join(' | '))
    const total = sym.patched + rea.patched + ac.patched + gg.patched
    if (total > 0) ctx?.logger?.warn?.(`[core-hygiene] re-patched ${total} file(s)`)
    else ctx?.logger?.info?.('[core-hygiene] all clean')
  } catch (err) { log('ERROR ' + (err && err.message ? err.message : String(err))) }
}