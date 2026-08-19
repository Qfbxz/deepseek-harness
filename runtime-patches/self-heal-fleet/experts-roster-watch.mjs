/** experts-roster-watch — 每 60s 比对 agency-agents 插件版本与 ~/.dsh/experts 的
 * .builtin-version 戳，不一致即重跑仓库同步脚本（插件升级后自动拉最新内置名册；
 * 版本一致时脚本零拷贝快速返回）。日志 ~/.dsh/experts-roster-watch.log。 */
import { writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'
export const name = 'experts-roster-watch'

const REPO = '/Users/boergege/compile/优秀仓库参考/DeepSeek-Harness/personal-plugins/dsh-experts-roster'

function log(line) {
  try {
    writeFileSync(join(homedir(), '.dsh', 'experts-roster-watch.log'), `[${new Date().toISOString()}] ${line}\n`, { flag: 'a' })
  } catch { }
}

export function apply(ctx) {
  try {
    if (!existsSync(REPO)) { log('repo dsh-experts-roster missing — watch disabled'); return }
    const check = () => {
      try {
        const out = execFileSync('node', [join(REPO, 'sync-builtin-experts.mjs')], { encoding: 'utf8', timeout: 60000 })
        if (!out.includes('already')) log(out.trim())
      } catch (e) {
        log('sync failed: ' + String(e && e.message ? e.message : e).split('\n')[0])
      }
    }
    check()
    const timer = setInterval(check, 60000)
    if (typeof timer.unref === 'function') timer.unref()
  } catch (e) {
    log('ERROR ' + String(e && e.message ? e.message : e))
  }
}
