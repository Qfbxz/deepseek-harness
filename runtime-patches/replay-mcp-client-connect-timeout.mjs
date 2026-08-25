#!/usr/bin/env node
// 补丁 50：dsh-mcp-client 连接尝试无界（2026-08-25 启动卡死根因）。
// 根因：rc.8 的 connectGeneration 对 generation.connect() + 初始工具同步没有任何
// 包级界限——MCP SDK 只给每个请求 60s 默认超时，而插件激活 await 整个首次尝试、
// Host boot 等插件树，一个"接受 spawn 后保持沉默"的 MCP 服务（如 npx 拉包遇
// github 直连不通）就把激活/启动拖满 SDK 预算甚至更久，重连预算也无法消耗。
// 修：每次连接尝试（握手+初始同步）与 deadline 竞速，超时按尝试失败处理（关闭
// 世代、计入重连预算）。界限读 config.connectTimeoutMs（rc.8 schema 不识别该键
// 时回落 30000ms；仓库源码版已带 schema 默认值与校验，见
// .agents/notes/implemented/bug-fix/2026-08-25-mcp-client-connect-timeout.md）。
// 幂等：含 patch(mcp-connect-timeout) 标记即跳过；锚点失配大声报错退役。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const target = process.argv[2]
if (!target) { console.error('usage: replay-mcp-client-connect-timeout.mjs <index.js>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('/*patch(mcp-connect-timeout)*/')) { console.log('[skip] already patched:', target); process.exit(0) }
const NL = s.includes('\r\n') ? '\r\n' : '\n'
const OLD_HEAD = [
  '\t\ttry {',
  '\t\t\tawait generation.connect(createTransport(config));',
  '\t\t\tif (hasClosed()) {',
  '\t\t\t\tattemptSettled = true;',
  '\t\t\t\tgenerationDown(generation);',
  '\t\t\t\treturn;',
  '\t\t\t}',
  '\t\t\tawait enqueueSync(generation, startup ? startupOpts : opts);',
  '\t\t} catch (error) {',
].join(NL)
const NEW_HEAD = [
  '\t\tconst __connectTimeoutMs = /*patch(mcp-connect-timeout)*/ config.connectTimeoutMs ?? 30000;',
  '\t\tconst __deadline = Promise.withResolvers();',
  '\t\tconst __attemptTimer = setTimeout(() => {',
  '\t\t\t__deadline.reject(new Error(`${label}: connection attempt timed out after ${__connectTimeoutMs}ms (connectTimeoutMs)`));',
  '\t\t}, __connectTimeoutMs);',
  '\t\t__attemptTimer.unref();',
  '\t\ttry {',
  '\t\t\tawait Promise.race([',
  '\t\t\t\t(async () => {',
  '\t\t\t\t\tawait generation.connect(createTransport(config));',
  '\t\t\t\t\tif (hasClosed()) return;',
  '\t\t\t\t\tawait enqueueSync(generation, startup ? startupOpts : opts);',
  '\t\t\t\t})(),',
  '\t\t\t\t__deadline.promise',
  '\t\t\t]);',
  '\t\t} catch (error) {',
].join(NL)
const OLD_TAIL = [
  '\t\t\tgenerationDown(generation);',
  '\t\t\treturn;',
  '\t\t}',
  '\t\tattemptSettled = true;',
].join(NL)
const NEW_TAIL = [
  '\t\t\tgenerationDown(generation);',
  '\t\t\treturn;',
  '\t\t} finally {',
  '\t\t\tclearTimeout(__attemptTimer);',
  '\t\t}',
  '\t\tattemptSettled = true;',
].join(NL)
for (const [name, old] of [['head', OLD_HEAD], ['tail', OLD_TAIL]]) {
  const n = s.split(old).length - 1
  if (n !== 1) { console.error(`[FAIL] ${name} anchor count ${n} != 1 — upstream restructured, review manually:`, target); process.exit(1) }
}
s = s.replace(OLD_HEAD, NEW_HEAD, 1).replace(OLD_TAIL, NEW_TAIL, 1)
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[ok] mcp-client connect-timeout patched (attempt deadline ' + 'connectTimeoutMs ?? 30000, NL=' + JSON.stringify(NL) + ')')
