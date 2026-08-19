#!/usr/bin/env node
// 补丁 20：agency-agents 客户端把 271 内置专家硬编码在 ROSTER 常量里，picker 只认
// 这份静态清单（设置页才是动态的）——把 ~/.dsh/experts/0-masters/ 的自有专家注入
// ROSTER/DIVISION_ORDER/ZH_NAME/ZH_DIVISION 四处，picker 与设置页一致置顶。
// 标记块可整体替换：自有名册变化后重跑即刷新。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'

const CANDIDATES = [
  join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', '@michengai', 'dsh-agency-agents', 'lib', 'client.js'),
  join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@deepseek-ai/dsh/node_modules/@michengai/dsh-agency-agents/lib/client.js'),
]
const target = process.argv[2] ?? CANDIDATES.find(p => { try { readFileSync(p); return true } catch { return false } })
if (!target) { console.error('usage: replay-agency-own-roster.mjs <client.js>'); process.exit(1) }

const SRC_ROOT = join(homedir(), '.dsh', 'experts')
const OWN_DIVISIONS = [
  { dir: '0-domain-masters', zh: '石油领域专家' },
  { dir: '0-engineering', zh: '工程 IT 专家' },
]
const personas = []
for (const d of OWN_DIVISIONS) {
  const dir = join(SRC_ROOT, d.dir)
  for (const f of readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
    const raw = readFileSync(join(dir, f), 'utf8')
    const m = raw.match(/^---\n([\s\S]*?)\n---/)
    if (m === null) continue
    const get = (k) => { const km = m[1].match(new RegExp(`^${k}\\s*:\\s*(.*)$`, 'm')); return km ? km[1].trim() : '' }
    personas.push({ slug: f.replace(/\.md$/, ''), name: get('name'), desc: get('description'), descEn: get('descriptionEn'), emoji: get('emoji'), division: d.dir })
  }
}
if (personas.length === 0) throw new Error('no personas under ' + SRC_ROOT)

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
const rosterEntries = personas.map(p => `\t\t\t{\n\t\t\t\t"slug": "${p.slug}",\n\t\t\t\t"nameEn": "${esc(p.name)}",\n\t\t\t\t"emoji": "${p.emoji}",\n\t\t\t\t"division": "${p.division}",\n\t\t\t\t"description": "${esc(p.desc)}",\n\t\t\t\t"descriptionEn": "${esc(p.descEn)}"\n\t\t\t},\n`).join('')
const zhNames = personas.map(p => `\t\t\t"${p.slug}": "${esc(p.name)}",\n`).join('')
const zhDivisions = OWN_DIVISIONS.map(d => `\t\t\t"${d.dir}": "${d.zh}",\n`).join('')
const divisionOrder = OWN_DIVISIONS.map(d => `"${d.dir}",`).join('\n')

let s = readFileSync(target, 'utf8')
const MARK = '/*patch(own-roster)*/'
const block = (body) => `\t\t${MARK} ${body} /*end-own-roster*/\n`
const injections = [
  ['const ROSTER = [\n', block(rosterEntries)],
  ['const DIVISION_ORDER = [\n', block(divisionOrder)],
  ['const ZH_DIVISION = {\n', block(zhDivisions)],
  ['const ZH_NAME = {\n', block(zhNames)],
  ['"division.academic": ZH_DIVISION.academic,\n', block(OWN_DIVISIONS.map(d => `"division.${d.dir}": ZH_DIVISION[${JSON.stringify(d.dir)}],`).join('\n'))],
  ['"division.academic": EN_DIVISION.academic,\n', block(OWN_DIVISIONS.map(d => `"division.${d.dir}": ${JSON.stringify(d.zh)},`).join('\n'))],
]
// 先剥掉旧标记块（重跑刷新），再逐点注入
s = s.replace(/^\t\t\/\*patch\(own-roster\)\*\/[\s\S]*?\/\*end-own-roster\*\/\n/gm, '')
let injected = 0
for (const [anchor, blk] of injections) {
  if (!s.includes(anchor)) throw new Error('anchor missing: ' + anchor.trim())
  s = s.replace(anchor, anchor + blk)
  injected += 1
}
// 菜单向上展开时顶部会超出视口（首组专家不可达）——钳制高度为 55vh，内部滚动可达全部
const MH_OLD = 'max-height:calc(100vh - 24px);overflow-y:auto'
const MH_NEW = '/*patch(own-roster)*/max-height:55vh;overflow-y:auto'
if (s.includes(MH_OLD)) { s = s.replace(MH_OLD, MH_NEW); injected += 1 }
writeFileSync(target, s)
execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
console.log(`[patched] ${target} (${personas.length} experts, ${injected} injection points)`)
