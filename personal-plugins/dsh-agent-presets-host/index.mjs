// dsh-agent-presets-host — 用户 preset 发现层的 host 宿主（bundles 通道）。
// 本体：personal-plugins/dsh-agent-presets（@deepseek-ai/dsh-agent-presets 0.1.6-alpha.2
// fork + settings.register 守卫）。desktop patch 的 insert 行在 0.1.7 下不装载，
// bundles 是实锤活通道（auto-memory 等全家），故包化走 bundles。
import { appendFileSync } from 'node:fs'
import AgentPresets from '/Users/boergege/compile/优秀仓库参考/DeepSeek-Harness/personal-plugins/dsh-agent-presets/lib/index.js'

export const name = 'dsh-agent-presets-host'

export function apply(ctx) {
  try {
    const svc = new AgentPresets(ctx, { includeUserRoot: true, default: 'standard' })
    appendFileSync('/tmp/aph.log', `[${new Date().toISOString()}] AgentPresets 实例化成功(bundles 通道) config=default:${svc?.config?.default} roots:${svc?.config?.roots?.length}\n`)
    ctx.effect(() => () => {
      try { svc.close?.() ?? svc[Symbol.dispose]?.() } catch {}
    }, 'agent-presets-host')
  } catch (e) {
    appendFileSync('/tmp/aph.log', `[${new Date().toISOString()}] 实例化失败: ${e?.message}\n${e?.stack ?? ''}\n`)
  }
}
