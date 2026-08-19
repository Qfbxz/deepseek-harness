#!/usr/bin/env node
// 自愈舰队恢复：~/.dsh/profiles 重建（升级/重装）后，看护插件与配置全部丢失——
// 本脚本从仓库快照一键重建：dsh-local 插件文件 + cordis.patch.yml 的舰队注册段 +
// settings.yaml 的专家启用段。幂等：已存在的内容跳过。
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const SRC = join(dirname(fileURLToPath(import.meta.url)))
const PLUGINS = join(homedir(), '.dsh', 'profiles', 'web', 'plugins', 'dsh-local')
const PATCH_YML = join(homedir(), '.dsh', 'profiles', 'web', 'cordis.patch.yml')
const SETTINGS = join(homedir(), '.dsh', 'settings.yaml')

// 1. 插件文件
mkdirSync(PLUGINS, { recursive: true })
let copied = 0
for (const f of readdirSync(SRC).filter(f => f.endsWith('.mjs'))) {
  const dst = join(PLUGINS, f)
  if (!existsSync(dst)) { copyFileSync(join(SRC, f), dst); copied += 1 }
}
// 2. cordis.patch.yml 舰队注册段（以 autorun 注册为标记）
const FLEET_BLOCK = `
# --- 自愈舰队（runtime-patches/self-heal-fleet 恢复）---
- insert:
    - id: core-hygiene
      name: ./plugins/dsh-local/core-hygiene.mjs
- insert:
    - id: peer-range-autofix
      name: ./plugins/dsh-local/peer-range-autofix.mjs
- insert:
    - id: runtime-patches-autorun
      name: ./plugins/dsh-local/runtime-patches-autorun.mjs
- insert:
    - id: reasoning-row-watch
      name: ./plugins/dsh-local/reasoning-row-watch.mjs
- insert:
    - id: runtime-patches-watchdog
      name: ./plugins/dsh-local/runtime-patches-watchdog.mjs
- insert:
    - id: experts-roster-watch
      name: ./plugins/dsh-local/experts-roster-watch.mjs
`
let patchAdded = false
if (existsSync(PATCH_YML)) {
  const yml = readFileSync(PATCH_YML, 'utf8')
  if (!yml.includes('id: runtime-patches-autorun')) { writeFileSync(PATCH_YML, yml + FLEET_BLOCK); patchAdded = true }
} else { writeFileSync(PATCH_YML, FLEET_BLOCK); patchAdded = true }
// 3. settings.yaml 专家启用段
const EXPERTS_BLOCK = `
agency-agents:
  enabled:
    - domain-master-drilling-engineering
    - domain-master-hydraulics
    - domain-master-torque-drag
    - domain-master-geomechanics
    - domain-master-dynamics-vibration
    - domain-master-thermal
    - domain-master-petrophysics
    - domain-master-data-science
    - drilling-realtime-analyst
    - domain-master-3d-visualization
    - domain-master-software-architecture
    - algorithm-dev
    - physics-reviewer
    - backend-dev
    - frontend-dev
    - code-reviewer
    - plan-reviewer
    - product-manager-pro
    - qa
    - tester
    - software-doc-writer
    - leader
`
let settingsAdded = false
if (existsSync(SETTINGS)) {
  const s = readFileSync(SETTINGS, 'utf8')
  if (!s.includes('agency-agents:')) { writeFileSync(SETTINGS, s + EXPERTS_BLOCK); settingsAdded = true }
} else { writeFileSync(SETTINGS, EXPERTS_BLOCK); settingsAdded = true }
console.log(`[fleet-restored] plugins copied=${copied} patchBlock=${patchAdded ? 'added' : 'present'} expertsBlock=${settingsAdded ? 'added' : 'present'}`)
console.log('next: bash ~/.dsh/fix-boot.sh 重启后端，舰队即接管全部 23 个补丁的自愈')
