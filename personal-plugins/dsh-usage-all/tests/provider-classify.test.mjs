/**
 * provider-classify.test.mjs — 供应商计费制分组（数据看板）分类逻辑测试。
 *
 * 背景（2026-08-26 用户报告）：看板供应商分区把 dflash-local（DFlash2 Local，
 * baseURL=http://127.0.0.1:8770，本地推理服务）归入「余额制 · Token 计费」，
 * 而它与 lm-studio 一样是本地/免费供应商，应归入「本地 / 免费 · 按模型计量」。
 *
 * 旧根因：client.js isLocalOrFree 只认硬编码 id 白名单（lm-stu* / opencode）。
 * 新口径：baseURL 主机为环回地址（127.0.0.1/localhost/0.0.0.0/[::1]）即本地；
 * id 白名单保留作为过渡期兜底（服务端 baseURL 字段需宿主重启后才下发）。
 *
 * 运行：node --test tests/provider-classify.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveAccountSpec, createAccountService } from '../lib/accounts.js';

// ── 1) 客户端分类逻辑：直接从 client.js 提取 sentinel 块，测线上真实代码 ──
async function loadClassifier() {
  const src = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  const m = src.match(/\/\/\s*#provider-classify:start([\s\S]*?)\/\/\s*#provider-classify:end/);
  assert.ok(m, 'client.js 缺少 #provider-classify sentinel 块（分类逻辑未内联标记）');
  return new Function(m[1] + '\nreturn { isLoopbackBaseURL, isLocalOrFree };')();
}

test('看板分类：本地/环回供应商进「本地 / 免费 · 按模型计量」组', async () => {
  const { isLocalOrFree, isLoopbackBaseURL } = await loadClassifier();
  const local = [
    { id: 'dflash-local', displayName: 'DFlash2 Local', mode: 'balance', baseURL: 'http://127.0.0.1:8770/v1' },
    { id: 'lm-stuido', displayName: 'LM Studio', mode: 'balance', baseURL: 'http://127.0.0.1:1234/v1' },
    { id: 'ollama', displayName: 'Ollama', mode: 'balance', baseURL: 'http://127.0.0.1:11434' },
    { id: 'vllm-box', displayName: 'vLLM', mode: 'balance', baseURL: 'http://localhost:8000/v1' },
    { id: 'any-local', mode: 'balance', baseURL: 'http://[::1]:1234/v1' },
    { id: 'any-local2', mode: 'balance', baseURL: 'http://0.0.0.0:9000' },
    // 过渡期兜底：宿主未重启、/dash-api/providers 尚无 baseURL 字段时按 id 判定
    { id: 'dflash-local', mode: 'balance' },
    { id: 'lm-stuido', mode: 'balance' },
    { id: 'ollama', mode: 'balance' },
    // OpenCode Zen 免费套餐（原有行为保持）
    { id: 'opencode', mode: 'balance', baseURL: 'https://opencode.ai/zen/v1' },
  ];
  for (const p of local) assert.equal(isLocalOrFree(p), true, '应判定为本地/免费: ' + JSON.stringify(p));
});

test('看板分类：远程付费供应商不得进本地组（负例穷举）', async () => {
  const { isLocalOrFree } = await loadClassifier();
  const remote = [
    { id: 'deepseek-official', mode: 'balance', baseURL: 'https://api.deepseek.com' },
    { id: 'zai-coding-cn', mode: 'subscription', baseURL: 'https://open.bigmodel.cn/api/coding/paasa/v4' },
    { id: 'minimax-cn', mode: 'subscription', baseURL: 'https://api.minimaxi.com/v1' },
    { id: 'kimi-coding', mode: 'subscription', baseURL: 'https://api.moonshot.cn/v1' },
    { id: 'opencode-go', mode: 'subscription', baseURL: 'https://opencode-go.example/v1' },
    // 局域网地址不是环回——保守不归类（现有口径无 LAN 白名单）
    { id: 'lan-box', mode: 'balance', baseURL: 'http://192.168.1.10:8080/v1' },
    // 环回前缀伪造域名不得命中
    { id: 'evil', mode: 'balance', baseURL: 'http://127.0.0.1.evil.com/v1' },
    { id: 'evil2', mode: 'balance', baseURL: 'http://localhost.evil.com/v1' },
    // 非法/空 baseURL 容错
    { id: 'weird', mode: 'balance', baseURL: 'not a url' },
    { id: 'weird2', mode: 'balance', baseURL: '' },
    { id: 'weird3', mode: 'balance', baseURL: null },
    { id: 'weird4', mode: 'balance' },
  ];
  for (const p of remote) assert.equal(isLocalOrFree(p), false, '不得判定为本地/免费: ' + JSON.stringify(p));
});

test('isLoopbackBaseURL 单元：环回判定边界', async () => {
  const { isLoopbackBaseURL } = await loadClassifier();
  assert.equal(isLoopbackBaseURL('http://127.0.0.1:8770/v1'), true);
  assert.equal(isLoopbackBaseURL('http://localhost:8765'), true);
  assert.equal(isLoopbackBaseURL('http://[::1]:1234/v1'), true);
  assert.equal(isLoopbackBaseURL('http://0.0.0.0:9000'), true);
  assert.equal(isLoopbackBaseURL('https://api.deepseek.com'), false);
  assert.equal(isLoopbackBaseURL('http://127.0.0.1.evil.com/v1'), false);
  assert.equal(isLoopbackBaseURL(''), false);
  assert.equal(isLoopbackBaseURL(undefined), false);
  assert.equal(isLoopbackBaseURL(null), false);
});

// ── 2) server 半边：baseURL 必须沿 providerViews → /dash-api/providers 透出 ──
test('resolveAccountSpec 保留 providerBaseURL（回归保护）', () => {
  const spec = resolveAccountSpec(
    { id: 'dflash-local', displayName: 'DFlash2 Local', baseURL: 'http://127.0.0.1:8770/v1', models: ['Qwen3.8-27B-MLX-4bit'] },
    { monitors: {} },
  );
  assert.equal(spec.providerBaseURL, 'http://127.0.0.1:8770/v1');
  assert.equal(spec.id, 'dflash-local');
});

test('providerViews 透出 baseURL 字段（供看板环回分类）', async () => {
  const svc = createAccountService({
    credentials: { resolve: async () => ({ value: '' }) },
    getProviders: async () => [
      { id: 'dflash-local', displayName: 'DFlash2 Local', baseURL: 'http://127.0.0.1:8770/v1', models: ['Qwen3.8-27B-MLX-4bit'] },
      { id: 'deepseek-official', displayName: 'DeepSeek', baseURL: 'https://api.deepseek.com', apiKeyEnv: 'DEEPSEEK_API_KEY' },
    ],
    config: { monitors: {} },
    deps: { includeLegacyProviders: false },
  });
  const views = await svc.providerViews();
  const dflash = views.find((v) => v.id === 'dflash-local');
  const official = views.find((v) => v.id === 'deepseek-official');
  assert.ok(dflash, 'dflash-local 应在 views 中');
  assert.equal(dflash.baseURL, 'http://127.0.0.1:8770/v1');
  assert.equal(official.baseURL, 'https://api.deepseek.com');
});

test('board.mjs /dash-api/providers 输出携带 baseURL（静态管线断言）', async () => {
  const src = await readFile(new URL('../lib/board.mjs', import.meta.url), 'utf8');
  // providers 处理器的 out.push 必须把 baseURL 带给客户端（handler 内嵌
  // 127.0.0.1:3080 回环抓取，无法离线起桩，故以源码断言钉住管线）
  assert.match(src, /baseURL:\s*p\.baseURL\s*\?\?\s*null/, 'board.mjs providers 输出缺 baseURL 透传');
});
