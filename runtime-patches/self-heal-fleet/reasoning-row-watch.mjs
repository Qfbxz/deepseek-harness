/**
 * reasoning-row-watch — 运行中自愈：监听 dsh-client-ui-conversation/lib/client.js，
 * CLI 升级写入的瞬间自动重打 thinking 自动展开/完成折叠补丁（不等 dsh web 重启）。
 * 补丁逻辑与 core-hygiene 的 patchReasoning 同源（同锚点同正则），幂等：已打过零写入。
 * 背景：升级发生在服务运行中时，core-hygiene 只能下次启动重打，中间窗口页面刷新即加载无补丁文件。
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, watch } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
export const name = 'reasoning-row-watch'

const MARK = 'override ?? running'
const ANCHOR = 'function ReasoningRow'

function targetFile() {
  const nvm = join(homedir(), '.nvm', 'versions', 'node')
  try {
    for (const v of readdirSync(nvm)) {
      const f = join(nvm, v, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js')
      if (existsSync(f)) return f
    }
  } catch { }
  return null
}

function tryPatch(f, log) {
  try {
    const src = readFileSync(f, 'utf8')
    if (src.includes(MARK)) return false
    const i = src.indexOf(ANCHOR)
    if (i < 0) { log('anchor missing (upstream restructured) — needs manual review'); return false }
    const seg = src.slice(i, i + 2500)
    const ns = seg
      .replace(/const \[expanded, setExpanded\] = \(0, react\.useState\)\(false\);(\s*)const summaryRef/, 'const [override, setOverride] = (0, react.useState)(null);$1const expanded = override ?? running;$1(0, react.useEffect)(() => { setOverride(null); }, [running]);$1const summaryRef')
      .replace(/setExpanded\(\(value\) => !value\);/, 'setOverride((value) => value === null ? !running : !value);')
    if (ns === seg) { log('pattern not found in ReasoningRow window — needs manual review'); return false }
    writeFileSync(f, src.slice(0, i) + ns + src.slice(i + 2500))
    return true
  } catch (err) { log('ERROR ' + (err && err.message ? err.message : String(err))); return false }
}

export function apply(ctx) {
  const log = (line) => { try { writeFileSync(join(homedir(), '.dsh', 'reasoning-row-watch.log'), '[' + new Date().toISOString() + '] ' + line + '\n', { flag: 'a' }) } catch { } }
  try {
    const f = targetFile()
    if (f === null) { log('client.js not found — watch disabled'); return }
    if (tryPatch(f, log)) { log('patched at startup: ' + f); ctx?.logger?.warn?.('[reasoning-row-watch] re-patched at startup') }
    let timer = null
    watch(f, () => {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        if (tryPatch(f, log)) { log('patched on change: ' + f); ctx?.logger?.warn?.('[reasoning-row-watch] re-patched after CLI update') }
      }, 2000)
    })
    log('watching ' + f)
  } catch (err) { log('ERROR ' + (err && err.message ? err.message : String(err))) }
}
