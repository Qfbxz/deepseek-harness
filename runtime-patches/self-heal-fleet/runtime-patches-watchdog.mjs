/**
 * runtime-patches-watchdog — 运行时看护：周期巡检 5 个补丁标记，缺失即自动重放对应 replay 脚本。
 * 补全 runtime-patches-autorun（仅启动触发）的盲区：dsh web 运行中发生 npm 全局重装/升级，
 * 补丁被冲掉后无需重启、无需手动重放，下一个巡检周期自动恢复。
 * 幂等：标记在位零动作；replay 脚本自身亦幂等。日志 ~/.dsh/runtime-patches-watchdog.log。
 * 配置：cordis config intervalMs（默认 30000）；apply(ctx, config) 第二参数可覆盖（测试用）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'
export const name = 'runtime-patches-watchdog'

const REPO_RT = '/Users/boergege/compile/优秀仓库参考/DeepSeek-Harness/runtime-patches'

function globalRoot() {
  return join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@deepseek-ai/dsh/node_modules')
}

function read(f) { try { return readFileSync(f, 'utf8') } catch { return null } }
function log(line) { try { writeFileSync(join(homedir(), '.dsh', 'runtime-patches-watchdog.log'), '[' + new Date().toISOString() + '] ' + line + '\n', { flag: 'a' }) } catch { } }

export function apply(ctx, config) {
  try {
    if (!existsSync(REPO_RT)) { log('repo runtime-patches/ missing — watchdog disabled'); return }
    const intervalMs = Math.max(5000, Number(config && config.intervalMs) || 30000);
    const G = globalRoot();
    // badPattern is the upstream's own broken shape — the idempotency
    // baseline. marker present → patched, ok. marker missing but badPattern
    // present → upstream still broken, replay. Both missing → upstream fixed
    // or restructured away → RETIRED (auto, one log line, never retried).
    const checks = [
      { id: 'p1', file: join(G, '@deepseek-ai/dsh-tool-bash/lib/index.js'), marker: 'function deriveBashDescription', bad: 'invalid description: expected a non-empty string', script: 'replay-tool-bash-optional-description.mjs', extra: [join(homedir(), '.dsh', 'profiles/node_modules/@deepseek-ai/dsh-tool-bash/lib/index.js')] },
      { id: 'p2', file: join(G, '@deepseek-ai/dsh-tools/lib/index.js'), marker: 'function deriveRunCodeTitle', bad: 'invalid description: expected a non-empty string', script: 'replay-run-code-optional-description.mjs', extra: [] },
      { id: 'p3', file: join(G, '@deepseek-ai/dsh-code-runtime-worker-thread/lib/worker.cjs'), marker: 'var callArgs = args === void 0 ? {} : args;', bad: 'snapshotCodeJsonValue(args)', script: 'replay-worker-binding-omitted-args.mjs', extra: [] },
      // p4 has no unique text-level bad shape (its broken form is a bare SyntaxError
      // catch; the only 'message: messageOf(error)' line also exists in the reply
      // builder on both patched and official builds). bad therefore uses that
      // always-present line as an always-on signal: marker missing → always replay
      // (idempotent; official-fix detection is left to the replay's own anchor
      // mismatch, which surfaces as a needs-manual log instead of a silent retire).
      { id: 'p4', file: join(G, '@deepseek-ai/dsh-code-runtime-worker-thread/lib/index.js'), marker: 'function unclosedLiteralHint', bad: 'message: messageOf(error)', script: 'replay-code-runtime-parse-hint.mjs', extra: [] },
      { id: 'p5-worker', file: join(G, '@deepseek-ai/dsh-code-runtime-worker-thread/lib/worker.cjs'), marker: 'renderThrownValue', bad: '? detail : String(detail)', script: 'replay-object-throw-serialization.mjs', extra: [] },
      { id: 'p5-index', file: join(G, '@deepseek-ai/dsh-tools/lib/index.js'), marker: 'errorMessage(result.error)', bad: '.error.message}${logsText}', script: 'replay-object-throw-serialization.mjs', extra: [] },
      // p7: abort reason rendered losslessly (was String(reason) → [object Object])
      // plus parse-error suspicious-line locator. bad = the old collapsing call.
      { id: 'p7-abort', file: join(G, '@deepseek-ai/dsh-code-runtime-worker-thread/lib/index.js'), marker: 'function renderAbortReason', bad: 'String(request.signal?.reason)', script: 'replay-abort-reason-and-parse-locator.mjs', extra: [] },
      // p8: skill-explorer follows symlinks when scanning skill roots (Dirent
      // describes the link itself; a symlinked skill dir silently vanished).
      { id: 'p8-explorer-symlink', file: join(homedir(), '.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-skill-explorer/lib/index.js'), marker: 'patch(symlink-support)', bad: 'else if (entry.isFile() && name.endsWith(".md")) file = join(root, name);', script: 'replay-skill-explorer-symlinks.mjs', extra: [] },
      // p9: dsh-git-commit panel opens downward (was upward, clipped by tab bar).
      { id: 'p9-git-panel-below', file: '/Users/boergege/compile/优秀仓库参考/DeepSeek-Harness/personal-plugins/dsh-git-commit/client.mjs', marker: 'patch(panel-below)', bad: 'var top = r.top - p.offsetHeight - 8;', script: 'replay-git-commit-panel-below.mjs', extra: [] },
      // p10: desktop-chrome git-chip anchor fallback (collapsed panelHeader
      // pinned the chips at y=-12, off-screen).
      { id: 'p10-chip-anchor', file: '/Users/boergege/compile/优秀仓库参考/DeepSeek-Harness/personal-plugins/dsh-desktop-chrome/client.mjs', marker: 'patch(anchor-fallback)', bad: 'const top = Math.round(anchorRow.top + (anchorRow.height - 24) / 2);', script: 'replay-desktop-chrome-anchor-fallback.mjs', extra: [] },
      // p11: git-graph branch chip always renders (non-git sessions showed
      // nothing; now a disabled placeholder).
      { id: 'p11-chip-always', file: join(homedir(), '.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-git-graph/lib/client.js'), marker: 'patch(chip-always)', bad: 'if (!showBranchSelector || repo === void 0 || repo === null) return null;', script: 'replay-git-graph-chip-always.mjs', extra: [] },
      // p12: run_code discard diagnostic names the tool outcome (errored vs
      // succeeded + JSON size signature) and binding results clamp at 24k
      // chars so a huge payload cannot overflow the output ledger.
      { id: 'p12-discard-diagnostic', file: join(G, '@deepseek-ai/dsh-tools/lib/types/code-mode.js'), marker: 'clampBindingValue', bad: 'result discarded', script: 'replay-discard-diagnostic.mjs', extra: [] },
      // p13: git-graph branch popover opens downward (was anchored above the
      // top-bar chip, rendering the whole picker off-screen).
      { id: 'p13-popover-below', file: join(homedir(), '.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-git-graph/lib/client.js'), marker: 'patch(popover-below)', bad: 'bottom:calc(100% + 4px);left:0', script: 'replay-git-graph-popover-below.mjs', extra: [] },
      // p14: auto-continue registers its settings card into the keyed slot
      // without options.key — the loader rejects the whole plugin.
      { id: 'p14-auto-continue-slot-key', file: join(homedir(), '.dsh/profiles/web/node_modules/dsh-client-auto-continue/lib/client.js'), marker: 'patch(slot-key)', bad: 'name: "settings.plugin.item",\n        id: SETTINGS_NS,', script: 'replay-auto-continue-slot-key.mjs', extra: [] },
      // p15: auto-memory's 「记忆」 button rides the settings row (new
      // sidebar.settings.action hole) with a brain icon; upstream adoption of
      // either part retires it via the bad pattern.
      { id: 'p15-auto-memory-settings-row', file: join(homedir(), '.dsh/profiles/web/node_modules/@a9i5k4/dsh-auto-memory/lib/client.js'), marker: 'patch(settings-row)', bad: "slots.inject('sidebar.footer.action'", script: 'replay-auto-memory-settings-row.mjs', extra: [] },
      // p16: repo-built ui-sidebar carries the sidebar.settings.action hole;
      // official builds lack it (bad = the ever-present footer.action decl),
      // so a wipe always re-syncs until upstream ships the hole.
      { id: 'p16-ui-sidebar-settings-action', file: join(G, '@deepseek-ai/dsh-client-ui-sidebar/lib/client.js'), marker: 'sidebar.settings.action', bad: 'sidebar.footer.action', script: 'replay-ui-sidebar-settings-action.mjs', extra: [] },
      // p17: mobile-nav's session export shows on desktop too, renamed 导出会话
      // with an outward arrow (no tray); explorer stays mobile-only.
      { id: 'p17-desktop-session-log', file: join(homedir(), '.dsh/profiles/web/node_modules/@dsh-external/dsh-mobile-nav/lib/client.js'), marker: 'patch(desktop-session-log)', bad: '  [data-mobile-nav="session-log"],', script: 'replay-mobile-nav-desktop-session-log.mjs', extra: [] },
      // p18: usage badge rides the settings row (order 1, before auto-memory)
      // and its column-forcing side effect is disabled.
      { id: 'p18-usage-settings-row', file: join(homedir(), '.dsh/profiles/web/node_modules/dsh-usage-stats/lib/client.js'), marker: 'patch(settings-seat)', bad: 'ctx.slots.inject("sidebar.footer.action"', script: 'replay-usage-stats-settings-row.mjs', extra: [] },
      // p19: chat-import's trigger shortens to 导入 (tooltip keeps the long form).
      { id: 'p19-chat-import-short-label', file: join(homedir(), '.dsh/profiles/web/node_modules/dsh-chat-import/lib/client.js'), marker: '"trigger.label": "导入",', bad: '"trigger.label": "导入会话",', script: 'replay-chat-import-short-label.mjs', extra: [] },
      // p20: the agency-agents client hardcodes its 271-expert ROSTER (the picker
      // never reads the host catalog); inject our 0-masters personas into
      // ROSTER/DIVISION_ORDER/ZH_NAME/ZH_DIVISION so the picker matches the
      // settings page. Marker blocks self-refresh on rerun.
      { id: 'p20-agency-own-roster', file: join(homedir(), '.dsh/profiles/web/node_modules/@michengai/dsh-agency-agents/lib/client.js'), marker: '/*patch(own-roster)*/', bad: 'const ROSTER = [\n\t\t\t{\n\t\t\t\t"slug": "academic-anthropologist"', script: 'replay-agency-own-roster.mjs', extra: [] },
      // p21: worker binding replies String() a non-string host error message into
      // "[object Object]", surfacing as opaque code run failed (abort).
      { id: 'p21-worker-abort-object', file: join(G, '@deepseek-ai/dsh-code-runtime-worker-thread/lib/worker.cjs'), marker: 'abort-[object Object] fix', bad: 'entry.reject(new CapturedError(message.message));', script: 'replay-worker-abort-object-message.mjs', extra: [] },
      // p22: list_experts description documents the return shape and the custom
      // division keys, so models stop guessing r.experts (TypeError) and the
      // builtin engineering division (all disabled).
      { id: 'p22-list-experts-shape', file: join(homedir(), '.dsh/profiles/web/node_modules/@michengai/dsh-agency-agents/lib/index.js'), marker: 'patch(list-experts-shape)', bad: 'Call this before summon_expert when you need an exact expert slug."', script: 'replay-agency-list-experts-shape.mjs', extra: [] },
      // p24: dsh-git-commit 提交 chip 不应显示在子代理页面（子代理不提交）。
      { id: 'p24-git-commit-subagent-guard', file: '/Users/boergege/compile/优秀仓库参考/DeepSeek-Harness/personal-plugins/dsh-git-commit/client.mjs', marker: 'patch(subagent-guard)', bad: '      if (document.getElementById(CHIP_ID) === null) {\n        document.body.appendChild(buildChip());\n      }', script: 'replay-git-commit-subagent-guard.mjs', extra: [] },
    ];
    // State-aware logging: an anchor-mismatch failure after an upstream
    // restructure repeats every patrol; log the first failure in detail and
    // then only every 50th retry plus the recovery transition, so a stale
    // patch cannot flood the log while still staying observable.
    const failStreaks = new Map();
    // retiredIds: upstream's own broken shape is gone (official fix shipped
    // or code restructured away) — auto-retired, logged once, never retried.
    const retiredIds = new Set();
    function patrol() {
      const missing = [];
      for (const c of checks) {
        if (retiredIds.has(c.id)) continue;
        const src = read(c.file);
        if (src === null) { missing.push(c); continue; }
        if (src.includes(c.marker)) continue;
        // marker missing — decide by the upstream broken shape, not by our fix:
        const badPresent = c.bad !== '' && src.includes(c.bad);
        if (!badPresent) {
          retiredIds.add(c.id);
          log('RETIRED ' + c.id + ': upstream broken shape gone (official fix or restructure) — patch no longer needed');
          continue;
        }
        missing.push(c);
      }
      if (missing.length === 0) {
        for (const [script, n] of failStreaks) if (n > 0) log('recovered after ' + n + ' failed replay attempt(s): ' + script);
        failStreaks.clear();
        return;
      }
      const done = new Set();
      for (const c of missing) {
        if (done.has(c.script)) continue;
        done.add(c.script);
        try {
          const out = execFileSync('node', [join(REPO_RT, c.script), c.file, ...c.extra], { encoding: 'utf8', timeout: 60000 });
          log('restored ' + c.id + ' via ' + c.script + ': ' + (out || '').trim().split('\n').join(' | '));
        } catch (err) {
          const n = (failStreaks.get(c.script) || 0) + 1;
          failStreaks.set(c.script, n);
          if (n === 1 || n % 50 === 0) {
            log('FAILED (' + n + ') ' + c.id + ' via ' + c.script + ' — anchor changed? upstream fixed/restructured, review manually: ' + (err && err.message ? String(err.message).split('\n')[0] : String(err)));
          }
        }
      }
      const restoredCount = done.size - failStreaks.size;
      if (restoredCount > 0) ctx?.logger?.warn?.('[runtime-patches-watchdog] restored patch(es) after detecting wipe');
    }
    patrol();
    const timer = setInterval(patrol, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    log('watchdog started: interval=' + intervalMs + 'ms targets=' + checks.length);
  } catch (err) { log('ERROR ' + (err && err.message ? err.message : String(err))) }
}
