/** runtime-patches-autorun — 启动时自动重放 runtime-patches/ 全部补丁（CLI 升级后自愈）。
 * 单一事实源：直接调用仓库 replay-*.mjs（幂等；已打过 [skip]，产物结构变化会大声报错）。
 * 自动化边界：脚本抛错（锚点失配，多半是官方已修复/重构）只记日志提醒人工确认，不阻塞启动。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { autorunJobs } from './patches-table.mjs'
export const name = 'runtime-patches-autorun'

const REPO_RT = '/Users/boergege/compile/优秀仓库参考/DeepSeek-Harness/runtime-patches'

export function apply(ctx) {
  const log = (line) => { try { writeFileSync(join(homedir(), '.dsh', 'runtime-patches-autorun.log'), '[' + new Date().toISOString() + '] ' + line + '\n', { flag: 'a' }) } catch { } }
  // 延迟到就绪后执行：24 个子进程同步跑会阻塞插件加载、拖慢后端就绪（fix-boot 频繁
  // 60s 超时的根因）。重放幂等且看门狗兜底，延迟安全。
  const run = () => {
  try {
    if (!existsSync(REPO_RT)) { log('repo runtime-patches/ missing — skip'); return }
    // 作业清单来自 patches-table.mjs 单一事实源（2026-08-26 合并重构）
    const jobs = autorunJobs()
    let patched = 0, clean = 0; const failed = []
    for (const [script, args] of jobs) {
      try {
        const scriptPath = script.startsWith('/') ? script : join(REPO_RT, script)
        const out = execFileSync('node', [scriptPath, ...args], { encoding: 'utf8', timeout: 120000 })
        log(script + ': ' + (out || '').trim().split('\n').join(' | '))
        if ((out || '').includes('[patched]')) patched += 1; else clean += 1;
      } catch (err) {
        failed.push(script);
        log(script + ' ERROR (anchor changed? upstream fixed/restructured — needs manual review): ' + (err && err.message ? err.message.split('\n')[0] : String(err)));
      }
    }
    log('autorun done: patched=' + patched + ' already-ok=' + clean + ' failed=' + failed.length);
    // 2026-08-22: 配置漂移检查（webStartup 服务名/版本钉/个人插件依赖/
    // custom-ui 折叠 margin）并入本 autorun——与 replay 补丁同触发点，
    // 覆盖"重启+更新"两场景（postinstall 里也有一份，双保险）。
    try {
      const cfgOut = execFileSync('node', ['/Users/boergege/.dsh/apply-dsh-patches.mjs'], { encoding: 'utf8', timeout: 30000 })
      log('config-check: ' + (cfgOut || '').trim().split('\n').join(' | '))
    } catch (err) { log('config-check ERROR: ' + (err && err.message ? err.message.split('\n')[0] : String(err))) }
    if (patched > 0) ctx?.logger?.warn?.('[runtime-patches] re-patched ' + patched + ' patch(es) after CLI upgrade; log: ~/.dsh/runtime-patches-autorun.log');
    if (failed.length > 0) ctx?.logger?.warn?.('[runtime-patches] ' + failed.join(', ') + ' no longer applies — upstream changed, review manually');
    if (patched === 0 && failed.length === 0) ctx?.logger?.info?.('[runtime-patches] all ' + clean + ' patches verified in place');
  } catch (err) { log('ERROR ' + (err && err.message ? err.message : String(err))) }
  }
  setTimeout(run, 3000)
}
