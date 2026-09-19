#!/usr/bin/env node
// dsh-experts-roster — 把 agency-agents 插件内置的 17 个分区镜像同步到
// ~/.dsh/experts/（不动 0-masters/）。插件升级后重跑即得最新内置名册；
// 版本一致时零拷贝快速返回。戳文件 .builtin-version 记录已同步版本。
import { readFileSync, writeFileSync, rmSync, cpSync, mkdirSync, existsSync, readFileSync as rf } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'

const DIVISIONS = ['academic', 'design', 'engineering', 'finance', 'game-development', 'gis', 'healthcare', 'integrations', 'marketing', 'paid-media', 'product', 'project-management', 'sales', 'security', 'spatial-computing', 'specialized', 'support', 'testing']
const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
const CANDIDATES = [
  join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', '@michengai', 'dsh-agency-agents'),
  join(globalRoot, '@deepseek-ai/dsh/node_modules/@michengai/dsh-agency-agents'),
]
const PLUGIN = CANDIDATES.find((p) => existsSync(join(p, 'package.json')))
if (PLUGIN === undefined) throw new Error('agency-agents plugin not found in profile or global install')
const ASSETS = join(PLUGIN, 'assets', 'agency-agents')
const TARGET = join(homedir(), '.dsh', 'experts')
const STAMP = join(TARGET, '.builtin-version')

const version = JSON.parse(rf(join(PLUGIN, 'package.json'), 'utf8')).version
if (existsSync(STAMP) && readFileSync(STAMP, 'utf8').trim() === version) {
  console.log(`[experts] builtin already at ${version}`)
  process.exit(0)
}
mkdirSync(TARGET, { recursive: true })
for (const d of DIVISIONS) {
  const src = join(ASSETS, d)
  if (!existsSync(src)) continue
  rmSync(join(TARGET, d), { recursive: true, force: true })
  cpSync(src, join(TARGET, d), { recursive: true })
}
writeFileSync(STAMP, version)
console.log(`[experts] builtin ${version} → ${TARGET}`)
