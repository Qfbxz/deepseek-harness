/**
 * git-graph-slots-dead.test.mjs — p61（git-graph 注入槽改名死槽）注册/幂等/语义测试。
 * 取代已废弃的 P60 remote-fence-fallback（gitbar-v2 接管分支 UI 后 chip 永久禁用）。
 * 运行：node --test tests/git-graph-slots-dead.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RP = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(RP, 'replay-git-graph-slots-dead.mjs');
const LIVE = '/Users/boergege/.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-git-graph/lib/client.js';
const IND = '\t\t\t';

const anchor = [
  'const scope = { slots: { inject: () => () => {}, register: () => () => {} } };',
  IND + 'scope.slots.inject("conversation.input.selector.context", () => {',
  IND + '  return scope.slots.register({',
  IND + '    name: "conversation.input.selector.context",',
  IND + '  });',
  IND + '});',
  IND + 'scope.slots.inject("conversation.input.dock", () => {',
  IND + '  return scope.slots.register({',
  IND + '    name: "conversation.input.dock",',
  IND + '  });',
  IND + '});',
].join('\n');

test('patches-table 注册 p61', async () => {
  const table = await readFile(join(RP, 'self-heal-fleet/patches-table.mjs'), 'utf8');
  assert.match(table, /p61-git-graph-slots-dead/);
  assert.match(table, /replay-git-graph-slots-dead\.mjs/);
});

test('replay 幂等三态', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'p61-'));
  const target = join(dir, 'client.js');
  // 态A：已含 marker → skip
  await writeFile(target, 'x p44.dead.slot x');
  let out = execFileSync(process.execPath, [SCRIPT, target], { encoding: 'utf8' });
  assert.match(out, /\[skip\]/);
  // 态B：锚点在场 → 落盘且语法合法
  await writeFile(target, anchor);
  out = execFileSync(process.execPath, [SCRIPT, target], { encoding: 'utf8' });
  assert.match(out, /\[patched\]/);
  const patched = await readFile(target, 'utf8');
  assert.match(patched, /p44\.dead\.slot\.one/);
  assert.match(patched, /p44\.dead\.slot\.two/);
  assert.ok(!patched.includes('conversation.input.selector.context'));
  assert.ok(!patched.includes('conversation.input.dock'));
  // 态C：锚点缺失（插件更新）→ skip 不失败
  await writeFile(target, 'nothing here');
  out = execFileSync(process.execPath, [SCRIPT, target], { encoding: 'utf8' });
  assert.match(out, /\[skip\] anchor missing/);
});

test('p61 语义：live 文件双槽均已改名死槽', async () => {
  const live = await readFile(LIVE, 'utf8');
  assert.ok(live.includes('p44.dead.slot.one'), 'live 应含 p44.dead.slot.one');
  assert.ok(live.includes('p44.dead.slot.two'), 'live 应含 p44.dead.slot.two');
  assert.ok(!live.includes('conversation.input.selector.context'));
  assert.ok(!live.includes('conversation.input.dock'));
});
