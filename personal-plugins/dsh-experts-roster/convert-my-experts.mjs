#!/usr/bin/env node
// dsh-experts-roster — 把自有智能体（~/.agents 与 ~/.kimi-code/agents 的 .md）转换为
// agency-agents 插件的 persona 格式，写入 ~/.dsh/experts/0-masters/（分区名排序在
// academic 之前 → 名册置顶）。幂等：同名以 ~/.agents 优先，输出确定性。
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const TARGET = join(homedir(), '.dsh', 'experts', '0-masters')
const SOURCES = [join(homedir(), '.agents'), join(homedir(), '.kimi-code', 'agents')]
const PALETTE = ['purple', 'blue', 'green', 'orange', 'pink', 'cyan', 'yellow', 'red']
const EMOJI = [
  [/钻井|drilling/, '🛢️'], [/水力|hydraul/, '💧'], [/摩阻|扭矩|torque/, '🔧'], [/地质|力学|geomech/, '⛰️'],
  [/物理|physics/, '⚛️'], [/数据|data/, '📊'], [/可视化|visual|3d/i, '📈'], [/热|thermal/, '🌡️'],
  [/测井|petrophys/, '📡'], [/软件|架构|software|architect/i, '🏗️'], [/前端|frontend/i, '🎨'],
  [/后端|backend/i, '⚙️'], [/算法|algorithm/i, '🧮'], [/测试|qa|tester/i, '🧪'], [/文档|doc/i, '📝'],
  [/评审|review/i, '🔍'], [/产品|product/i, '🧭'], [/领导|leader/i, '👑'], [/实时|realtime/i, '🛰️'],
  [/代码|code/i, '💻'],
]

function parseAgentMd(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (m === null) return null
  const get = (key) => {
    const km = m[1].match(new RegExp(`^${key}\\s*:\\s*(.*)$`, 'm'))
    return km ? km[1].trim().replace(/^["']|["']$/g, '') : undefined
  }
  const name = get('name')
  const description = get('description')
  if (!name || !description) return null
  return { name, description, body: m[2].trim() }
}

function emojiFor(name, description) {
  const hay = name + ' ' + description
  for (const [re, e] of EMOJI) if (re.test(hay)) return e
  return '🎓'
}

mkdirSync(TARGET, { recursive: true })
const seen = new Set()
let written = 0
for (const src of SOURCES) {
  if (!existsSync(src)) continue
  for (const f of readdirSync(src)) {
    if (!f.endsWith('.md')) continue
    const parsed = parseAgentMd(readFileSync(join(src, f), 'utf8'))
    if (parsed === null) continue
    const slug = f.replace(/\.md$/, '')
    if (seen.has(parsed.name) || seen.has(slug)) continue
    seen.add(parsed.name); seen.add(slug)
    const vibe = parsed.description.split(/[。.；;]/)[0].slice(0, 80)
    const color = PALETTE[seen.size % PALETTE.length]
    const out = `---\nname: ${parsed.name}\ndescription: ${parsed.description}\ndescriptionEn: ${parsed.description}\ncolor: ${color}\nemoji: ${emojiFor(parsed.name, parsed.description)}\nvibe: ${vibe}\n---\n\n${parsed.body}\n`
    writeFileSync(join(TARGET, `${slug}.md`), out)
    written += 1
  }
}
console.log(`[experts] ${written} personas → ${TARGET}`)
