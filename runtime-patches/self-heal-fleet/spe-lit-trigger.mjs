import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
export const name = 'spe-lit-trigger'
const SKILL_FILE = join(homedir(), '.cc-switch/skills/spe-lit-search/SKILL.md')
export function apply(ctx) {
  const log = (t) => { try { ctx?.logger?.info?.(t) } catch { } }
  try {
    if (!existsSync(SKILL_FILE)) { log('[spe-lit-trigger] skill file missing — skip'); return }
    const md = readFileSync(SKILL_FILE, 'utf8')
    const fm = md.match(/^---\n([\s\S]*?)\n---/);
    const descLine = fm ? (fm[1].split('\n').find(l => l.startsWith('description:')) || '') : ''
    const descText = descLine.replace(/^description:\s*/, '').trim() || 'SPE/IADC/OTC/URTeC/AAPG/SEG/API-RP 油气文献检索与 DOI-PDF';
    const instruction = [
      '【文献链路强制调度】' + descText,
      '任何 agent（含 subagent/workflow/团队分片）收到含上述触发词的任务时：先读取 ' + SKILL_FILE + ' 加载完整编排，按其源矩阵与降级链执行，禁止裸调搜索工具。',
    ].join('\n')
    let injected = false;
    try {
      ctx.inject(['settings'], (sctx) => {
        sctx.settings.register('spe-lit-trigger', undefined, { instructions: [instruction] });
        injected = true;
        log('[spe-lit-trigger] instruction injected via settings namespace');
      }, 'spe-lit-trigger');
    } catch { }
    if (!injected) {
      const injFile = join(homedir(), '.dsh/agent-instructions-spe-lit.md');
      writeFileSync(injFile, instruction + '\n');
      log('[spe-lit-trigger] fallback instruction file: ' + injFile);
    }
  } catch (err) {
    try { ctx?.logger?.warn?.('[spe-lit-trigger] ERROR ' + String(err && err.message ? err.message : err)) } catch { }
  }
}
