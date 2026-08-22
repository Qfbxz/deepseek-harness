#!/usr/bin/env node
// 补丁 33：frostfin（kimi 主 loop 桥，pzc2004/dsh-frostfin 0.2.0）initialize 发空
// clientCapabilities，而 kimi acp 的 Bash 把 shell 路由给客户端 terminal/* 反向 RPC
// → "ACP terminal capability is unavailable"。实现 vendor 自本仓库
// packages/subagent/subagent-acp/lib/types/terminal.js（与 sdk 1.x 客户端方法名兼容）。
// 改动四文件：lib/terminal-pool.js（新增 vendor 副本）、acp-process.js（池 + 能力声明 +
// dispose 先 releaseAll）、index.js（Config 加 terminal/terminalOutputByteLimit）、
// factory.js（透传）。配置开关在 profile cordis.patch.yml 的 `- id: frostfin /
// config: {terminal: true}`（用户补丁层，插件升级不动它）。
// 用法：replay-frostfin-terminal.mjs <…/dsh-frostfin/lib/acp-process.js>
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const target = resolve(process.argv[2] ?? '')
if (!target) { console.error('usage: replay-frostfin-terminal.mjs <frostfin/lib/acp-process.js>'); process.exit(1) }
const root = dirname(dirname(target))
const poolSrc = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'subagent', 'subagent-acp', 'lib', 'types', 'terminal.js')
const poolDst = join(root, 'lib', 'terminal-pool.js')
const MARKER = 'patch(terminal-rpc)'

const ACP_EDITS = [
  {
    old: "import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, RequestError, } from '@agentclientprotocol/sdk';",
    new: "import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, RequestError, } from '@agentclientprotocol/sdk';\n// /*" + MARKER + "*/ terminal/* 反向 RPC 池，vendor 自本仓库\n// packages/subagent/subagent-acp/lib/types/terminal.js（与 sdk 1.x 客户端方法名兼容）。\nimport { AcpTerminalPool } from './terminal-pool.js';",
  },
  {
    old: "    const makeClient = (_agent) => ({\n        sessionUpdate(params) {\n            spec.onSessionUpdate(params.update);\n            return Promise.resolve();\n        },",
    new: "    // terminal/* 反向 RPC 族：仅在 spec.terminal 声明时存在；未声明时这些可选\n    // Client 方法缺位，SDK 对应答 methodNotFound（与 subagent-acp run.ts 同构）。\n    const terminalPool = spec.terminal\n        ? new AcpTerminalPool({\n            spawn: spec.spawn,\n            defaultCwd: spec.cwd,\n            graceMs: spec.disposeGraceMs,\n            outputByteLimit: spec.terminalOutputByteLimit ?? 1_000_000,\n        })\n        : undefined;\n    const makeClient = (_agent) => ({\n        sessionUpdate(params) {\n            spec.onSessionUpdate(params.update);\n            return Promise.resolve();\n        },",
  },
  {
    old: "            return { outcome: { outcome: 'cancelled' } };\n        },\n    });",
    new: "            return { outcome: { outcome: 'cancelled' } };\n        },\n        ...(terminalPool?.clientMethods() ?? {}),\n    });",
  },
  {
    old: "                await conn.initialize({\n                    protocolVersion: PROTOCOL_VERSION,\n                    // 不声明任何可选客户端能力（无 fs、无 terminal）：kimi 在自己的进程里自足，\n                    // fs/read_text_file 等反向 RPC 不会路由到本客户端。\n                    clientCapabilities: {},\n                });",
    new: "                await conn.initialize({\n                    protocolVersion: PROTOCOL_VERSION,\n                    // 声明 terminal 后 kimi 的 Bash 工具走本客户端的 terminal/* 反向 RPC\n                    //（kimi acp 不自足执行 shell）；fs 能力仍不声明。\n                    clientCapabilities: spec.terminal ? { terminal: true } : {},\n                });",
  },
  {
    old: "        dispose() {\n            disposal ??= disposeProcess();\n            return disposal;\n        },",
    new: "        dispose() {\n            // 终端进程树独立于 kimi 进程树：先走有界拆除升级并等退出证明，再跑子进程阶梯。\n            disposal ??= (async () => {\n                await terminalPool?.releaseAll();\n                await disposeProcess();\n            })();\n            return disposal;\n        },",
  },
]
const INDEX_EDIT = {
  old: "    disposeEofGraceMs: z.natural().description('stdin EOF 后等待协作退出的毫秒数').default(6000),\n    disposeGraceMs: z.natural().description('SIGTERM 后升级 SIGKILL 的毫秒数').default(3000),",
  new: "    disposeEofGraceMs: z.natural().description('stdin EOF 后等待协作退出的毫秒数').default(6000),\n    disposeGraceMs: z.natural().description('SIGTERM 后升级 SIGKILL 的毫秒数').default(3000),\n    terminal: z.boolean()\n        .description('声明 ACP terminal 客户端能力并服务 terminal/* 反向 RPC：kimi acp 的 Bash 工具把 shell 路由给客户端执行（不自足），不开启则报 \"ACP terminal capability is unavailable\"')\n        .default(false),\n    terminalOutputByteLimit: z.natural()\n        .description('每个终端保留输出的字节上限（create 请求未带 outputByteLimit 时的默认值，尾部保留）')\n        .default(1000000),",
}
const FACTORY_EDIT = {
  old: "            permission: this.config.permission,\n            disposeEofGraceMs: this.config.disposeEofGraceMs,\n            disposeGraceMs: this.config.disposeGraceMs,",
  new: "            permission: this.config.permission,\n            disposeEofGraceMs: this.config.disposeEofGraceMs,\n            disposeGraceMs: this.config.disposeGraceMs,\n            terminal: this.config.terminal,\n            terminalOutputByteLimit: this.config.terminalOutputByteLimit,",
}

const files = [
  { path: target, edits: ACP_EDITS },
  { path: join(root, 'lib', 'index.js'), edits: [INDEX_EDIT] },
  { path: join(root, 'lib', 'factory.js'), edits: [FACTORY_EDIT] },
]

let applied = 0
let anchorMiss = 0
for (const f of files) {
  let s = readFileSync(f.path, 'utf8')
  let changed = false
  for (const e of f.edits) {
    if (s.includes(e.new)) continue
    if (!s.includes(e.old)) { anchorMiss += 1; continue }
    s = s.replace(e.old, e.new)
    changed = true
    applied += 1
  }
  if (changed) {
    writeFileSync(f.path, s)
    execFileSync(process.execPath, ['--check', f.path], { stdio: 'pipe' })
  }
}
// 池文件与 marker 同进退：acp 已带 marker 而池文件缺失（半程覆盖）→ 补 vendor 副本。
const acpFinal = readFileSync(target, 'utf8')
if (acpFinal.includes(MARKER) && !existsSync(poolDst)) {
  if (!existsSync(poolSrc)) { console.error('terminal pool source missing:', poolSrc); process.exit(1) }
  copyFileSync(poolSrc, poolDst)
  applied += 1
  console.log('[patched] vendored terminal-pool.js')
}
if (applied > 0 && !acpFinal.includes(MARKER)) {
  console.error('partial apply: edits landed but marker absent — upstream restructured, review manually:', target)
  process.exit(1)
}
if (applied === 0 && acpFinal.includes(MARKER)) { console.log('[skip] already patched:', target); process.exit(0) }
if (applied === 0) { console.log('[skip] anchor missing (plugin updated):', target); process.exit(0) }
console.log('[patched]', target, '(' + applied + ' edit(s))')
