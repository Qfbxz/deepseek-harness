/**
 * fleet-idempotency.test.mjs — 全舰队活体幂等测试（patches-table 驱动）。
 * 对每个 autorun 作业：在 live 目标上重放，必须幂等 skip；
 * 报错（锚点失配/文件缺失）或再次落盘（[patched]）均视为 fleet 漂移，RED。
 * 运行：node --test tests/fleet-idempotency.test.mjs
 */
import test from 'node:test';
import { autorunJobs } from '../self-heal-fleet/patches-table.mjs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS = dirname(fileURLToPath(import.meta.url));
const RP = dirname(TESTS); // 仓库 runtime-patches 根

for (const [script, args] of autorunJobs()) {
  const label = join(script, ...args.filter(a => a.startsWith('/')).map(a => a.split('node_modules/')[1] || a.split('/').slice(-2).join('/')));
  test('幂等: ' + label, () => {
    const exe = script.startsWith('/') ? script : join(RP, script);
    const out = execFileSync(process.execPath, [exe, ...args], { encoding: 'utf8', timeout: 60000, stdio: 'pipe' });
    // 幂等信号：skip / already / synced；[patched]/[ok] 在 live 上出现 = 之前漏打
    assertSkip(out, script);
    function assertSkip(o, s) {
      if (/\[patched\]|\[ok\]/.test(o)) throw new Error('live 上重复落盘（此前漏打）: ' + s);
      if (!/skip|already|synced|\[ok\]/i.test(o) && o.trim() === '') throw new Error('无输出，无法判定幂等: ' + s);
    }
  });
}
