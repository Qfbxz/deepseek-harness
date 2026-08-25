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
import { watchdogChecks } from './patches-table.mjs'
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
    // 检查清单来自 patches-table.mjs 单一事实源（2026-08-26 合并重构）
    const checks = watchdogChecks();
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
    const safePatrol = () => { try { patrol() } catch (err) { log('PATROL-ERROR ' + (err && err.message ? err.message : String(err))) } };
    safePatrol();
    const timer = setInterval(safePatrol, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    log('watchdog started: interval=' + intervalMs + 'ms targets=' + checks.length);
  } catch (err) { log('ERROR ' + (err && err.message ? err.message : String(err))) }
}
