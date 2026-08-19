#!/usr/bin/env node
// dsh-experts-roster — 把自有智能体（~/.agents 与 ~/.kimi-code/agents 的 .md）转换为
// agency-agents 插件的 persona 格式，写入 ~/.dsh/experts/0-masters/（分区名排序在
// academic 之前 → 名册置顶）。幂等：同名以 ~/.agents 优先。
// CURATED 按 slug 提供插件范式的精炼元数据（展示名/一句话中文/一句话英文/emoji/色），
// 未收录的新文件回退到自动推导。
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const TARGET = join(homedir(), '.dsh', 'experts', '0-masters')
const SOURCES = [join(homedir(), '.agents'), join(homedir(), '.kimi-code', 'agents')]
const PALETTE = ['purple', 'blue', 'green', 'orange', 'pink', 'cyan', 'yellow', 'red']

/** 插件原范式：展示名 + 精炼中文一句话 + 英文一句话 + emoji + 色。 */
const CURATED = {
  'domain-master-drilling-engineering': ['钻井工程领域大师', '钻井工程最高专业把关：套管三轴校核、轨迹防碰、固井、井控、BHA 与钻头选型，持专业否决权。', 'Drilling engineering gatekeeper: casing design, anti-collision, cementing, well control, BHA and bit selection.', '🛢️', 'purple'],
  'domain-master-hydraulics': ['钻井流体力学大师', '水力学全链路把关：六流变模型、ECD、激动抽吸、HPHT 温压耦合，API RP 13D 起草人级别。', 'Drilling hydraulics and rheology master: six rheology models, ECD, surge/swab, HPHT coupling.', '💧', 'blue'],
  'domain-master-torque-drag': ['管柱力学与摩阻扭矩大师', 'T&D 全链路把关：软杆/硬杆/混合模型、螺旋屈曲、磨损与疲劳，Shell/Landmark 专家级。', 'Torque & drag master: soft/stiff/hybrid models, helical buckling, wear and fatigue.', '🔧', 'orange'],
  'domain-master-geomechanics': ['石油地质力学大师', '四压力预测全链路把关：孔隙/破裂/坍塌/漏失、BMA 融合、井壁稳定，Zoback/Aadnoy 级。', 'Petroleum geomechanics master: four-pressure prediction, BMA fusion, wellbore stability.', '⛰️', 'green'],
  'domain-master-dynamics-vibration': ['钻柱动力学与振动大师', '钻柱振动全链路把关：纵横扭耦合、共振规避、黏滑与涡动诊断，经典文献全覆盖。', 'Drill-string dynamics master: axial/torsional/lateral coupling, resonance avoidance, stick-slip diagnosis.', '🌀', 'pink'],
  'domain-master-thermal': ['井筒温度场与传热学大师', '井筒传热把关：循环温度瞬态、稳态/瞬态模型、温度对 ECD 与水泥浆性能的修正。', 'Wellbore thermal master: circulating temperature transients, steady/transient models, ECD correction.', '🌡️', 'red'],
  'domain-master-petrophysics': ['测井解释与地层评价大师', '岩石物理把关：Archie/印尼/双水模型、饱和度与渗透率评价、Pickett 图版。', 'Petrophysics master: Archie/Indonesia/dual-water models, saturation and permeability evaluation.', '📡', 'cyan'],
  'domain-master-data-science': ['数据科学与石油 AI 大师', 'ML 全链路把关：LightGBM/贝叶斯/卡尔曼/LSTM、特征工程与不确定性量化。', 'Data science and petroleum AI master: ML pipelines, Bayesian methods, uncertainty quantification.', '📊', 'yellow'],
  'domain-master-3d-visualization': ['3D 可视化与图形学大师', 'WebGL/Three.js/Cesium/glTF 与有限元后处理把关，性能与渲染正确性并重。', '3D visualization master: WebGL/Three.js/Cesium/glTF, FEM post-processing performance.', '📈', 'purple'],
  'domain-master-software-architecture': ['企业级软件架构大师', '.NET 8/Vue 3/DDD/微服务/CI-CD 架构把关，演进能力与合规并重。', 'Enterprise architecture master: .NET/Vue/DDD/microservices, evolution and compliance.', '🏗️', 'blue'],
  'drilling-realtime-analyst': ['钻井实时分析决策专家', '录井曲线与日报实时分析：七项计算模拟、异常诊断、下步措施建议，输出结构化日报。', 'Realtime drilling analyst: curve and daily-report analysis, seven simulation checks, next-step advice.', '🛰️', 'green'],
  'algorithm-dev': ['算法工程师', '工程数值算法开发与移植：公式必须有权威文献出处，保障物理正确与数值稳定。', 'Algorithm engineer: numerical algorithms with authoritative literature backing.', '🧮', 'cyan'],
  'physics-reviewer': ['物理审核员', '验证公式出处、量纲一致性、SI 单位、数值精度与守恒律，持物理正确性否决权。', 'Physics reviewer: formula provenance, dimensional consistency, SI units, conservation laws.', '⚛️', 'purple'],
  'backend-dev': ['后端开发工程师', '服务端 API、业务逻辑与全生命周期数据库设计（模型/索引/分区/迁移治理）。', 'Backend engineer: APIs, business logic, full-lifecycle database design.', '⚙️', 'blue'],
  'frontend-dev': ['前端开发工程师', '页面与组件开发，兼全链路国际化（vue-i18n/resx/键值架构/术语一致）。', 'Frontend engineer: pages and components, plus end-to-end i18n.', '🎨', 'pink'],
  'code-reviewer': ['代码审查员', '合入前全面审查：正确性、安全、性能、架构合规、测试覆盖，兼静态安全审计。', 'Code reviewer: correctness, security, performance, architecture compliance audits.', '🔍', 'orange'],
  'plan-reviewer': ['方案审核专家', '实现前审核方案：边界条件、性能隐患、安全漏洞、架构冲突，输出分级报告。', 'Plan reviewer: pre-implementation design audits with graded reports.', '🧭', 'yellow'],
  'product-manager': ['产品经理', '需求转 PRD：功能清单、用户故事、验收标准；兼全项目文档治理。', 'Product manager: PRDs with acceptance criteria, plus documentation governance.', '📋', 'green'],
  'qa': ['质量保障工程师', 'E2E 测试、视觉回归、发布把关与 CI/CD 流水线搭建。', 'QA engineer: E2E testing, visual regression, release gates, CI/CD.', '🧪', 'red'],
  'tester': ['测试工程师', '单元与集成测试：算法正确性、类型安全、国际化与单位制一致性。', 'Test engineer: unit and integration tests across logic, types, i18n, units.', '✅', 'cyan'],
  'software-doc-writer': ['软件文档工程师', '按 GB/T 8567 编写验收级交付文档：概设/详设/操作手册/自评报告。', 'Software documentation writer: GB/T 8567 delivery documents.', '📝', 'yellow'],
  'leader': ['团队负责人', '接收需求、拆解分发、先审后派、汇总交付，统筹全流程进度与质量。', 'Team leader: requirement breakdown, review-first dispatch, delivery.', '👑', 'orange'],
}

/** 与内置名册的 slug 冲突规避：改写输出文件名（curated 键随之变化）。 */
const SLUG_OVERRIDES = { 'product-manager': 'product-manager-pro' }

const EMOJI = [
  [/钻井|drilling/, '🛢️'], [/水力|hydraul/, '💧'], [/物理|physics/, '⚛️'], [/数据|data/, '📊'],
  [/测试|qa|tester/i, '🧪'], [/文档|doc/i, '📝'], [/实时|realtime/i, '🛰️'], [/领导|leader/i, '👑'],
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
const produced = new Set()
let written = 0
for (const src of SOURCES) {
  if (!existsSync(src)) continue
  for (const f of readdirSync(src)) {
    if (!f.endsWith('.md')) continue
    const parsed = parseAgentMd(readFileSync(join(src, f), 'utf8'))
    if (parsed === null) continue
    const sourceSlug = f.replace(/\.md$/, '')
    if (seen.has(parsed.name) || seen.has(sourceSlug)) continue
    seen.add(parsed.name); seen.add(sourceSlug)
    const slug = SLUG_OVERRIDES[sourceSlug] ?? sourceSlug
    const cur = CURATED[sourceSlug]
    const displayName = cur ? cur[0] : parsed.name
    const desc = cur ? cur[1] : parsed.description.split(/[。；;]/)[0] + '。'
    const descEn = cur ? cur[2] : parsed.description.split(/[。；;]/)[0]
    const emoji = cur ? cur[3] : emojiFor(parsed.name, parsed.description)
    const color = cur ? cur[4] : PALETTE[seen.size % PALETTE.length]
    const vibe = desc.split(/[：:，,]/)[0].slice(0, 24)
    const out = `---\nname: ${displayName}\ndescription: ${desc}\ndescriptionEn: ${descEn}\ncolor: ${color}\nemoji: ${emoji}\nvibe: ${vibe}\n---\n\n${parsed.body}\n`
    writeFileSync(join(TARGET, `${slug}.md`), out)
    produced.add(`${slug}.md`)
    written += 1
  }
}
// 清掉本轮未产出的陈旧文件（如 slug 改名后的旧文件，避免与内置名册冲突）
for (const f of readdirSync(TARGET)) {
  if (f.endsWith('.md') && !produced.has(f)) rmSync(join(TARGET, f))
}
console.log(`[experts] ${written} personas → ${TARGET}`)
