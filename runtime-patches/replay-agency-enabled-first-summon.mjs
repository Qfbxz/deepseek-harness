#!/usr/bin/env node
// 补丁 23：summon_expert 停用死胡同。原逻辑在全册（292 位）解析，模型按名字召内置
// "前端开发者"（停用）→ 只报"已停用"无出路。改为启用优先：先在已启用名册内解析
// （近名自动命中，如"前端"→前端开发工程师）；落空才查全册，命中停用者时报错附
// 同分区已启用替代与 list_experts 指引。
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CANDIDATES = [
  join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', '@michengai', 'dsh-agency-agents', 'lib', 'index.js'),
  join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@deepseek-ai/dsh/node_modules/@michengai/dsh-agency-agents/lib/index.js'),
]
const target = process.argv[2] ?? CANDIDATES.find(p => { try { readFileSync(p); return true } catch { return false } })
if (!target) { console.error('usage: replay-agency-enabled-first-summon.mjs <index.js>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('patch(enabled-first-summon)')) { console.log('[skip] already patched:', target); process.exit(0) }
const OLD = '\t\tconst expert = resolveExpert([...experts.values()], query, locale);\n\t\tif (!enabledSet().has(expert.slug)) throw new Error(formatHost(locale, "error.expertDisabled", { name: localizedExpertName(expert, locale) }));'
const NEW = [
  '\t\t/*patch(enabled-first-summon)*/',
  '\t\tconst enabledList = [...experts.values()].filter((e) => enabledSet().has(e.slug));',
  '\t\tlet expert;',
  '\t\ttry {',
  '\t\t\texpert = resolveExpert(enabledList, query, locale);',
  '\t\t} catch {',
  '\t\t\tconst full = resolveExpert([...experts.values()], query, locale);',
  '\t\t\tif (enabledSet().has(full.slug)) expert = full;',
  '\t\t\telse {',
  '\t\t\t\tconst pool = enabledList.filter((e) => e.division === full.division);',
  '\t\t\t\tconst alts = (pool.length > 0 ? pool : enabledList).slice(0, 6).map((e) => e.slug).join(", ");',
  '\t\t\t\tthrow new Error(formatHost(locale, "error.expertDisabled", { name: localizedExpertName(full, locale) }) + "；可用替代（已启用）：" + alts + "。先调用 list_experts() 查看已启用名册。");',
  '\t\t\t}',
  '\t\t}',
].join('\n')
if (!s.includes(OLD)) { console.log('[skip] anchor missing (plugin updated):', target); process.exit(0) }
s = s.replace(OLD, NEW)
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log('[patched]', target)
