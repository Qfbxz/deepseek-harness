/** peer-range-autofix — 启动时修复 profile 插件 peerDependencies 的 prerelease 语义漂移。
 * 引擎复用 ~/.dsh/fix-peer-ranges.mjs（判定逻辑与 dshmarket check.js 同源）。
 * 场景：全局 dsh 升级后 resolved 版本变化，第三方插件的 peer range 声明过时。
 * 幂等；日志 ~/.dsh/peer-range-autofix.log；失败不阻塞启动。
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
export const name = 'peer-range-autofix'
export function apply(ctx) {
  const log = (line) => { try { writeFileSync(join(homedir(), '.dsh', 'peer-range-autofix.log'), '[' + new Date().toISOString() + '] [plugin] ' + line + '\n', { flag: 'a' }) } catch { } }
  try {
    const out = execFileSync('node', [join(homedir(), '.dsh', 'fix-peer-ranges.mjs')], { encoding: 'utf8', timeout: 30000 })
    const m = /fixed=(\d+)/.exec(out || '')
    const fixed = m ? Number(m[1]) : 0;
    if (fixed > 0) ctx?.logger?.warn?.('[peer-range-autofix] widened ' + fixed + ' stale peer range(s); see ~/.dsh/peer-range-autofix.log')
    else ctx?.logger?.info?.('[peer-range-autofix] all peer ranges ok')
  } catch (err) { log('ERROR ' + (err && err.message ? err.message : String(err))) }
}
