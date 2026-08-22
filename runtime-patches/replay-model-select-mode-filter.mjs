#!/usr/bin/env node
// 补丁 37:模型选择器按会话模式隔离分组 —— frostfin(kimi-code 路由)会话只显示
// kimi 通道模型组;原生会话隐藏 kimi 组。判断依据 = 目录加载结果里的 current
// .provider(种子日志保证 frostfin 会话从诞生起就是 kimi-code,无需额外状态)。
// 幂等:已含 patch(mode-filter) 标记即跳过;锚点失配大声报错(官方重构需人工)。
// 用法: replay-model-select-mode-filter.mjs <ui-model-selection/lib/client.js>
import { readFileSync, writeFileSync } from 'node:fs'
const target = process.argv[2]
if (!target) { console.error('usage: replay-model-select-mode-filter.mjs <client.js>'); process.exit(1) }
let s = readFileSync(target, 'utf8')
if (s.includes('/*patch(mode-filter)*/')) { console.log('[skip] already patched:', target); process.exit(0) }

// 锚点:目录加载成功后写 store 的位置。在此对 groups 按当前路由过滤。
const OLD = `
				const { current, routable, groups, failures } = result.value;
				this.store.update((s) => {
					s.current = current;
					s.routable = routable;
					s.groups = groups;
`.replace(/\t/g, String.fromCharCode(9))
const NEW = `
\t\t\t\tconst { current, routable, groups, failures } = result.value;
\t\t\t\t/*patch(mode-filter)*/const isKimi = current !== null && current.provider === 'kimi-code';
\t\t\t\tconst filteredGroups = groups.filter((g) => isKimi ? g.id === 'kimi-code' : g.id !== 'kimi-code');
\t\t\t\tthis.store.update((s) => {
\t\t\t\t\ts.current = current;
\t\t\t\t\ts.routable = routable;
\t\t\t\t\ts.groups = filteredGroups;
`.replace(/\\t/g, String.fromCharCode(9))
if (!s.includes(OLD)) { console.error('[FAIL] anchor missing — upstream restructured, review manually:', target); process.exit(1) }
writeFileSync(target, s.replace(OLD, NEW))
console.log('[ok] mode-filter patched (kimi sessions see only kimi group; native sessions hide it)')
