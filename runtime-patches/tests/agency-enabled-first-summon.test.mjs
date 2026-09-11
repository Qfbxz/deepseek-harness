/**
 * agency-enabled-first-summon.test.mjs — p23（summon 启用优先）注册/幂等/语义测试。
 * 2026-09 上游 bundle 拆分后，锚点迁移至 lib/src-CtqSbp2k.js（OLD2）；旧 index.js 锚点（OLD）兼容保留。
 * 运行：node --test tests/agency-enabled-first-summon.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RP = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(RP, 'replay-agency-enabled-first-summon.mjs');
const NODE = process.execPath;
const IND = '\t\t';
const OLD2 = [
  IND + 'const expert = resolveExpert((await library.catalog()).experts.filter((expert) => !expert.conflict), query, locale);',
  IND + 'if (!enabledSet().has(expert.slug)) throw new Error(formatHost(locale, "error.expertDisabled", { name: localizedExpertName(expert, locale) }));',
].join('\n');
// 最小合法骨架：OLD2 在函数体内
const fixture = [
  'export async function summon(query, locale) {',
  OLD2,
  IND + 'return expert;',
  '}',
].join('\n');

test('replay 幂等三态（新锚点 OLD2）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'p23-'));
  const target = join(dir, 'index.js');
  // 态A：已含 marker → skip
  await writeFile(target, '/*patch(enabled-first-summon)*/ x');
  let out = execFileSync(NODE, [SCRIPT, target], { encoding: 'utf8' });
  assert.match(out, /\[skip\] already patched/);
  // 态B：旧死胡同锚点在场 → patched 且语义正确
  await writeFile(target, fixture);
  out = execFileSync(NODE, [SCRIPT, target], { encoding: 'utf8' });
  assert.match(out, /\[patched\]/);
  const patched = await readFile(target, 'utf8');
  assert.match(patched, /patch\(enabled-first-summon\)/);
  assert.match(patched, /enabledPool/);
  assert.match(patched, /list_experts/);
  assert.ok(!patched.includes(OLD2), '旧死胡同逻辑应被整块替换');
  // 态C：锚点缺失 → skip（插件再度更新时不写盘不失败）
  await writeFile(target, 'nothing here');
  out = execFileSync(NODE, [SCRIPT, target], { encoding: 'utf8' });
  assert.match(out, /\[skip\] anchor missing/);
});

test('patches-table p23 监视目标已指向 src chunk', async () => {
  const table = await readFile(join(RP, 'self-heal-fleet/patches-table.mjs'), 'utf8');
  const line = table.split('\n').find(l => l.includes("id: 'p23-agency-enabled-first'") && !l.trim().startsWith('//'));
  assert.ok(line, 'p23 条目应在册且未封存');
  assert.match(line, /src-CtqSbp2k\.js/);
});

test('p23 语义：live chunk 已启用优先、死胡同消失', async () => {
  const live = await readFile('/Users/boergege/.dsh/profiles/web/node_modules/@michengai/dsh-agency-agents/lib/src-CtqSbp2k.js', 'utf8');
  assert.ok(live.includes('patch(enabled-first-summon)'), 'live 应含 marker');
  assert.ok(live.includes('enabledPool'), '应含启用池优先解析');
  assert.ok(!live.includes('const expert = resolveExpert((await library.catalog())'), '旧直查全册逻辑应消失');
});
