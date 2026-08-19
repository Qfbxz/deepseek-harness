/** runtime-patches-autorun — 启动时自动重放 runtime-patches/ 全部补丁（CLI 升级后自愈）。
 * 单一事实源：直接调用仓库 replay-*.mjs（幂等；已打过 [skip]，产物结构变化会大声报错）。
 * 自动化边界：脚本抛错（锚点失配，多半是官方已修复/重构）只记日志提醒人工确认，不阻塞启动。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
export const name = 'runtime-patches-autorun'

const REPO_RT = '/Users/boergege/compile/优秀仓库参考/DeepSeek-Harness/runtime-patches'

export function apply(ctx) {
  const log = (line) => { try { writeFileSync(join(homedir(), '.dsh', 'runtime-patches-autorun.log'), '[' + new Date().toISOString() + '] ' + line + '\n', { flag: 'a' }) } catch { } }
  // 延迟到就绪后执行：24 个子进程同步跑会阻塞插件加载、拖慢后端就绪（fix-boot 频繁
  // 60s 超时的根因）。重放幂等且看门狗兜底，延迟安全。
  const run = () => {
  try {
    if (!existsSync(REPO_RT)) { log('repo runtime-patches/ missing — skip'); return }
    const G = join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@deepseek-ai/dsh/node_modules')
    const profilesShared = join(homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai/dsh-tool-bash/lib/index.js')
    const jobs = [
      ['replay-tool-bash-optional-description.mjs', [join(G, '@deepseek-ai/dsh-tool-bash/lib/index.js'), profilesShared]],
      ['replay-run-code-optional-description.mjs', [join(G, '@deepseek-ai/dsh-tools/lib/index.js')]],
      ['replay-worker-binding-omitted-args.mjs', [join(G, '@deepseek-ai/dsh-code-runtime-worker-thread/lib/worker.cjs')]],
      ['replay-code-runtime-parse-hint.mjs', [join(G, '@deepseek-ai/dsh-code-runtime-worker-thread/lib/index.js')]],
      ['replay-object-throw-serialization.mjs', []],
      ['replay-abort-reason-and-parse-locator.mjs', [join(G, '@deepseek-ai/dsh-code-runtime-worker-thread/lib/index.js')]],
      ['replay-skill-explorer-symlinks.mjs', [join(homedir(), '.dsh', 'profiles/web/node_modules/@linxin666/dsh-client-ui-skill-explorer/lib/index.js')]],
      ['replay-git-commit-panel-below.mjs', ['/Users/boergege/compile/优秀仓库参考/DeepSeek-Harness/personal-plugins/dsh-git-commit/client.mjs']],
      ['replay-desktop-chrome-anchor-fallback.mjs', ['/Users/boergege/compile/优秀仓库参考/DeepSeek-Harness/personal-plugins/dsh-desktop-chrome/client.mjs']],
      ['replay-git-graph-chip-always.mjs', [join(homedir(), '.dsh', 'profiles/web/node_modules/@linxin666/dsh-client-ui-git-graph/lib/client.js')]],
      ['replay-discard-diagnostic.mjs', [join(G, '@deepseek-ai/dsh-tools/lib/types/code-mode.js')]],
      ['replay-git-graph-popover-below.mjs', [join(homedir(), '.dsh', 'profiles/web/node_modules/@linxin666/dsh-client-ui-git-graph/lib/client.js')]],
      ['replay-auto-continue-slot-key.mjs', [join(homedir(), '.dsh', 'profiles/web/node_modules/dsh-client-auto-continue/lib/client.js')]],
      ['replay-auto-memory-settings-row.mjs', [join(homedir(), '.dsh', 'profiles/web/node_modules/@a9i5k4/dsh-auto-memory/lib/client.js')]],
      ['replay-ui-sidebar-settings-action.mjs', [join(G, '@deepseek-ai/dsh-client-ui-sidebar/lib/client.js')]],
      ['replay-mobile-nav-desktop-session-log.mjs', [join(homedir(), '.dsh', 'profiles/web/node_modules/@dsh-external/dsh-mobile-nav/lib/client.js')]],
      ['replay-usage-stats-settings-row.mjs', [join(homedir(), '.dsh', 'profiles/web/node_modules/dsh-usage-stats/lib/client.js')]],
      ['replay-chat-import-short-label.mjs', [join(homedir(), '.dsh', 'profiles/web/node_modules/dsh-chat-import/lib/client.js')]],
      ['/Users/boergege/compile/优秀仓库参考/DeepSeek-Harness/personal-plugins/dsh-experts-roster/convert-my-experts.mjs', []],
      ['/Users/boergege/compile/优秀仓库参考/DeepSeek-Harness/personal-plugins/dsh-experts-roster/sync-builtin-experts.mjs', []],
      ['replay-agency-own-roster.mjs', []],
      ['replay-worker-abort-object-message.mjs', []],
      ['replay-agency-list-experts-shape.mjs', []],
    ]
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
    if (patched > 0) ctx?.logger?.warn?.('[runtime-patches] re-patched ' + patched + ' patch(es) after CLI upgrade; log: ~/.dsh/runtime-patches-autorun.log');
    if (failed.length > 0) ctx?.logger?.warn?.('[runtime-patches] ' + failed.join(', ') + ' no longer applies — upstream changed, review manually');
    if (patched === 0 && failed.length === 0) ctx?.logger?.info?.('[runtime-patches] all ' + clean + ' patches verified in place');
  } catch (err) { log('ERROR ' + (err && err.message ? err.message : String(err))) }
  }
  setTimeout(run, 3000)
}
