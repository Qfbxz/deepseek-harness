/**
 * deps-supply-chain.test.mjs — dsh-desktop-chrome 依赖供应链守卫。
 *
 * 背景（2026-08-31）：1.1.0 曾声明 "dsh-usage-stats": "github:Ychris12138/dsh-usage-stats#v0.1.2"，
 * 作为子依赖被 DSH 更新器 blockExoticSubdeps 策略拦截（ERR_PNPM_EXOTIC_SUBDEP，
 * pnpm 仅放行 NON_EXOTIC_RESOLVED_VIA：custom-resolver/jsr-registry/local-filesystem/
 * nodejs.org/npm-registry/workspace）。现改为 file: 本地 vendor（同 commit f7b0a36）。
 * 本测试防回退：任何 git/github/tarball/http 依赖 specifier 再次出现即失败。
 *
 * 运行：node --test tests/deps-supply-chain.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const EXOTIC = /^(git\+|git:|github:|gitlab:|bitbucket:|https?://|.*\.tgz(\?|#|$))/i;

test('穷举：dependencies 无 exotic specifier（blockExoticSubdeps 合规）', () => {
  const entries = Object.entries(pkg.dependencies || {});
  assert.ok(entries.length > 0, '依赖表非空');
  for (const [name, spec] of entries) {
    assert.ok(!EXOTIC.test(spec), `${name}=${spec} 是 exotic specifier，会被 blockExoticSubdeps 拦截`);
  }
});

test('file: 依赖目标存在且 vendor 注记在案', async () => {
  for (const [name, spec] of Object.entries(pkg.dependencies || {})) {
    if (!spec.startsWith('file:')) continue;
    const target = fileURLToPath(new URL(spec.slice(5) + '/package.json', 'file://' + process.cwd() + '/../'));
    assert.ok(existsSync(target), `${name} 的 file: 目标不存在：${target}`);
  }
  // vendor 溯源注记（dsh-usage-stats/.gitignore 首行）
  const gi = await readFile(new URL('../../dsh-usage-stats/.gitignore', import.meta.url), 'utf8');
  assert.match(gi, /v0\.1\.2.*f7b0a36/);
});
