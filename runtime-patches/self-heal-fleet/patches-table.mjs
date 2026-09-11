// patches-table — 舰队补丁单一事实源（2026-08-26 分类合并重构）。
// autorun（启动重放）与 watchdog（30s 巡检）都从本表派生，消除双注册漂移——
// p31 marker 错位空转、p35 死脚本引用、p17/p44 死条目三类事故的共同根因。
//
// 分类 cat：
//   A 官方包 bug 修复（仓库 src 同源；官方修复后 bad 消失 → watchdog 自动 RETIRED）
//   B 官方包行为偏好（无 src 对应的 bundle 调整；官方升级锚点失配需人工复核）
//   C 个人插件补丁（personal-plugins/ 源内补丁，未提交前 git checkout 即 wipe）
//   D 社区插件补丁（市场包就地补丁，包升级即 wipe，重放恢复）
//   E 配置层（cordis.patch.yml 自愈）
//   F 工具/同步（转换器、副本同步，非补丁）
//
// 字段：script=replay 脚本名（或绝对路径）；args=autorun 调用目标（缺省且非 bare
//   = 不进 autorun）；bare=true 无参调用（脚本自解析目标）；watch 条目进 watchdog
//   （file 主检文件 + marker 健康标记 + bad 未补丁形状 + extra 附加重放目标）。
//   bad 为常在信号（补丁前后都在）的条目 = marker 丢失即重放、永不自动退役。
// 幂等：所有 replay 脚本 marker 在场即 [skip]；锚点失配大声报错不写盘。
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const G = join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@deepseek-ai/dsh/node_modules')
const H = homedir()
const REPO = '/Users/boergege/compile/优秀仓库参考/DeepSeek-Harness'
const j = join

// Retired 2026-08-28 — source now owns the behavior or the line went dead; scripts removed:
// p3 worker-binding-omitted-args (bootstrap.ts owns the normalization), p9 git-commit-panel-below,
// p11 git-graph-chip-always, p13 git-graph-popover-below, p32 git-commit-subagent-guard,
// p53 git-graph-body-portal (superseded by p61 slots-dead), p58 dsh-mobile-theme (plugin uninstalled),
// p24 auto-continue-inflight (script lost, watch-only).
export const PATCHES = [
  { id: 'p1', cat: 'A', script: 'replay-tool-bash-optional-description.mjs', args: [j(G, '@deepseek-ai/dsh-tool-bash/lib/index.js'), j(H, '.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-bash/lib/index.js')], file: j(G, '@deepseek-ai/dsh-tool-bash/lib/index.js'), marker: "function deriveBashDescription", bad: "invalid description: expected a non-empty string", extra: [j(H, '.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-bash/lib/index.js')] },
  { id: 'p2', cat: 'A', script: 'replay-run-code-optional-description.mjs', args: [j(G, '@deepseek-ai/dsh-tools/lib/index.js')], file: j(G, '@deepseek-ai/dsh-tools/lib/index.js'), marker: "function deriveRunCodeTitle", bad: "invalid description: expected a non-empty string", extra: [] },
  { id: 'p2-web', cat: 'A', script: 'replay-run-code-optional-description.mjs', args: [j(H, '.dsh/profiles/web/node_modules/@deepseek-ai/dsh-tools/lib/index.js')], file: j(H, '.dsh/profiles/web/node_modules/@deepseek-ai/dsh-tools/lib/index.js'), marker: "function deriveRunCodeTitle", bad: "invalid description: expected a non-empty string", extra: [] },
  { id: 'p4', cat: 'A', script: 'replay-code-runtime-parse-hint.mjs', args: [j(G, '@deepseek-ai/dsh-code-runtime-worker-thread/lib/index.js')], file: j(G, '@deepseek-ai/dsh-code-runtime-worker-thread/lib/index.js'), marker: "function unclosedLiteralHint", bad: "message: messageOf(error)", extra: [] },
  { id: 'p5-worker', cat: 'A', script: 'replay-object-throw-serialization.mjs', bare: true, file: j(G, '@deepseek-ai/dsh-code-runtime-worker-thread/lib/worker.cjs'), marker: "renderThrownValue", bad: "? detail : String(detail)", extra: [] },
  { id: 'p5-index', cat: 'A', script: 'replay-object-throw-serialization.mjs', autorun: null, /* watch-only：bare 调用已覆盖 */ file: j(G, '@deepseek-ai/dsh-tools/lib/index.js'), marker: "errorMessage(result.error)", bad: ".error.message}${logsText}", extra: [] },
  { id: 'p7-abort', cat: 'A', script: 'replay-abort-reason-and-parse-locator.mjs', args: [j(G, '@deepseek-ai/dsh-code-runtime-worker-thread/lib/index.js')], file: j(G, '@deepseek-ai/dsh-code-runtime-worker-thread/lib/index.js'), marker: "function renderAbortReason", bad: "String(request.signal?.reason)", extra: [] },
  { id: 'p38-driver-agents', cat: 'A', script: 'replay-subagent-driver-agents-access.mjs', args: [j(G, '@deepseek-ai/dsh-subagent-in-process-driver/lib/index.js')], file: j(G, '@deepseek-ai/dsh-subagent-in-process-driver/lib/index.js'), marker: "patch(driver-agents)", bad: "parent.ctx.agents.create", extra: [j(H, '.dsh/profiles/node_modules/@deepseek-ai/dsh-subagent-in-process-driver/lib/index.js')] },
  { id: 'p10-chip-anchor', cat: 'C', script: 'replay-desktop-chrome-anchor-fallback.mjs', args: [j(REPO, 'personal-plugins/dsh-desktop-chrome/client.mjs')], file: j(REPO, 'personal-plugins/dsh-desktop-chrome/client.mjs'), marker: "patch(anchor-fallback)", bad: "const top = Math.round(anchorRow.top + (anchorRow.height - 24) / 2);", extra: [] },
  { id: 'p12-binding-clamp', cat: 'A', script: 'replay-discard-diagnostic.mjs', args: [j(G, '@deepseek-ai/dsh-tools/lib/index.js'), j(H, '.dsh/profiles/node_modules/@deepseek-ai/dsh-tools/lib/index.js'), j(H, '.dsh/profiles/web/node_modules/@deepseek-ai/dsh-tools/lib/index.js')], file: j(G, '@deepseek-ai/dsh-tools/lib/index.js'), marker: "function clampBindingValue", bad: "value: result.value\n\t\t\t\t\t\t});\n\t\t\t\t\t\tconst agent = exec.agent;", extra: [j(H, '.dsh/profiles/node_modules/@deepseek-ai/dsh-tools/lib/index.js'), j(H, '.dsh/profiles/web/node_modules/@deepseek-ai/dsh-tools/lib/index.js')] },
  { id: 'p14-auto-continue-slot-key', cat: 'D', script: 'replay-auto-continue-slot-key.mjs', args: [j(H, '.dsh/profiles/web/node_modules/dsh-client-auto-continue/lib/client.js')], file: j(H, '.dsh/profiles/web/node_modules/dsh-client-auto-continue/lib/client.js'), marker: "patch(slot-key)", bad: "name: \"settings.plugin.item\",\n        id: SETTINGS_NS,", extra: [] },
  { id: 'p15-auto-memory-settings-row', cat: 'D', script: 'replay-auto-memory-settings-row.mjs', args: [j(H, '.dsh/profiles/web/node_modules/@a9i5k4/dsh-auto-memory/lib/client.js')], file: j(H, '.dsh/profiles/web/node_modules/@a9i5k4/dsh-auto-memory/lib/client.js'), marker: "patch(settings-row)", bad: "slots.inject('sidebar.footer.action'", extra: [] },
  { id: 'p16-ui-sidebar-settings-action', cat: 'A', script: 'replay-ui-sidebar-settings-action.mjs', args: [j(G, '@deepseek-ai/dsh-client-ui-sidebar/lib/client.js')], file: j(G, '@deepseek-ai/dsh-client-ui-sidebar/lib/client.js'), marker: "sidebar.settings.action", bad: "sidebar.footer.action", extra: [] },
   { id: 'p20-agency-own-roster', cat: 'D', script: 'replay-agency-own-roster.mjs', bare: true, file: j(H, '.dsh/profiles/web/node_modules/@michengai/dsh-agency-agents/lib/client.js'), marker: "/*patch(own-roster)*/", bad: "const ROSTER = [\n\t\t\t{\n\t\t\t\t\"slug\": \"academic-anthropologist\"", extra: [] },
  { id: 'p21-worker-abort-object', cat: 'A', script: 'replay-worker-abort-object-message.mjs', bare: true, file: j(G, '@deepseek-ai/dsh-code-runtime-worker-thread/lib/worker.cjs'), marker: "abort-[object Object] fix", bad: "entry.reject(new CapturedError(message.message));", extra: [] },
  // [封存 2026-09-03 alpha.5 升级案] 2026-09-03 alpha.5: watchdog 判 upstream shape gone（official fix）
  // { id: 'p22-list-experts-shape', cat: 'D', script: 'replay-agency-list-experts-shape.mjs', bare: true, file: j(H, '.dsh/profiles/web/node_modules/@michengai/dsh-agency-agents/lib/index.js'), marker: "patch(list-experts-shape)", bad: "Call this before summon_expert when you need an exact expert slug.\"", extra: [] },
  { id: 'p30-scrollbody-center', cat: 'B', script: 'replay-scrollbody-center-fix.mjs', bare: true, file: j(G, '@deepseek-ai/dsh-client-ui-conversation/lib/client.js'), marker: "patch(center-fix)", bad: "scrollBody{justify-content:center;overflow-y:auto}", extra: [] },
  { id: 'p23-agency-enabled-first', cat: 'D', script: 'replay-agency-enabled-first-summon.mjs', bare: true, file: j(H, '.dsh/profiles/web/node_modules/@michengai/dsh-agency-agents/lib/src-CtqSbp2k.js'), marker: "patch(enabled-first-summon)", bad: "const expert = resolveExpert([...experts.values()], query, locale);", extra: [] },
  { id: 'p31-dock-inset-zero', cat: 'B', script: 'replay-dock-inset-zero.mjs', args: [j(G, '@deepseek-ai/dsh-client-ui-conversation/lib/client.js')], file: j(G, '@deepseek-ai/dsh-client-ui-conversation/lib/client.js'), marker: "dock-inset:0px", bad: "scrollBody{scrollbar-gutter:stable", extra: [] },
  { id: 'p33-scrollbody-overscroll', cat: 'B', script: 'replay-scrollbody-overscroll-contain.mjs', args: [j(G, '@deepseek-ai/dsh-client-ui-conversation/lib/client.js')], file: j(G, '@deepseek-ai/dsh-client-ui-conversation/lib/client.js'), marker: "overscroll-behavior:contain", bad: "scrollBody{scrollbar-gutter:stable", extra: [] },
  // 2026-09-01 封存：dsh-frostfin 包已从 web profile 删除，replay 每轮 ENOENT 噪音透传 host 日志；重装 frostfin 后取消本行注释即可
  // { id: 'p34-frostfin-terminal', cat: 'D', script: 'replay-frostfin-terminal.mjs', args: [j(H, '.dsh/profiles/web/node_modules/dsh-frostfin/lib/acp-process.js')], file: j(H, '.dsh/profiles/web/node_modules/dsh-frostfin/lib/acp-process.js'), marker: "patch(terminal-rpc)", bad: "不声明任何可选客户端能力", extra: [] },
  { id: 'p35-desktop-chrome-fixed-escape', cat: 'C', script: 'replay-desktop-chrome-fixed-v.mjs', args: [j(REPO, 'personal-plugins/dsh-desktop-chrome/client.mjs')], file: j(REPO, 'personal-plugins/dsh-desktop-chrome/client.mjs'), marker: "patch(fixed-v)", bad: "width - 8)));\n\t\t\t\t\tchip.style.position = \"fixed\";", extra: [] },
  { id: 'p40-dsh-tools-render-fallback', cat: 'A', script: 'replay-dsh-tools-render-fallback.mjs', args: [j(G, '@deepseek-ai/dsh-tools/lib/index.js')], file: j(G, '@deepseek-ai/dsh-tools/lib/index.js'), marker: "patch(render-fallback)", bad: "const userRender = options.output.render;", extra: [j(H, '.dsh/profiles/web/node_modules/@deepseek-ai/dsh-tools/lib/index.js')] },
  { id: 'p41-subagent-tool-routes', cat: 'E', script: 'replay-subagent-tool-routes.mjs', args: [j(H, '.dsh/profiles/web/cordis.patch.yml')], file: j(H, '.dsh/profiles/web/cordis.patch.yml'), marker: "id: tool-subagent-claude-code", bad: "# Your patch layer", extra: [] },
  { id: 'p41-desktop-chrome-hidden-guard', cat: 'C', script: 'replay-desktop-chrome-hidden-guard.mjs', args: [j(REPO, 'personal-plugins/dsh-desktop-chrome/client.mjs')], file: j(REPO, 'personal-plugins/dsh-desktop-chrome/client.mjs'), marker: "patch(hidden-guard)", bad: "function placeGoalGitRow", extra: [] },
  { id: 'p42-queue-dock-hidden-guard', cat: 'C', script: 'replay-dsh-queue-dock-hidden-guard.mjs', args: [j(H, '.dsh/profiles/web/node_modules/dsh-queue-dock/client.mjs')], file: j(H, '.dsh/profiles/web/node_modules/dsh-queue-dock/client.mjs'), marker: "patch(hidden-guard)", bad: "var qML = parseFloat(getComputedStyle(qdock).marginLeft) || 0;", extra: [] },
  { id: 'p43-queue-dock-geo-observer', cat: 'C', script: 'replay-dsh-queue-dock-geo-observer.mjs', args: [j(H, '.dsh/profiles/web/node_modules/dsh-queue-dock/client.mjs')], file: j(H, '.dsh/profiles/web/node_modules/dsh-queue-dock/client.mjs'), marker: "patch(geo-observer)", bad: "var qML = parseFloat(getComputedStyle(qdock).marginLeft) || 0;", extra: [] },
   // [封存 2026-09-08] chat-import 0.11.x 重构 client.js（图标化 patch 锚点失配）；重推需按 0.11.x 结构重定位锚点
  // { id: 'p56-sidebar-footer', cat: 'D', script: 'replay-sidebar-footer.mjs', args: [j(G, '@deepseek-ai/dsh-session-log-export/lib/client.js'), j(H, '.dsh/profiles/node_modules/@deepseek-ai/dsh-session-log-export/lib/client.js'), j(H, '.dsh/profiles/web/node_modules/dsh-chat-import/lib/client.js')], file: j(H, '.dsh/profiles/web/node_modules/dsh-chat-import/lib/client.js'), marker: '/*patch(sidebar-icon-only)*/', bad: '!rail && t("trigger.label")),', extra: [j(G, '@deepseek-ai/dsh-session-log-export/lib/client.js'), j(H, '.dsh/profiles/node_modules/@deepseek-ai/dsh-session-log-export/lib/client.js')] },
  { id: 'p56b-sidebar-export', cat: 'D', script: 'replay-sidebar-footer.mjs', args: [j(G, '@deepseek-ai/dsh-session-log-export/lib/client.js')], file: j(G, '@deepseek-ai/dsh-session-log-export/lib/client.js'), marker: '/*patch(export-sidebar)*/', bad: 'ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({', extra: [] },
  { id: 'p61-git-graph-slots-dead', cat: 'D', script: 'replay-git-graph-slots-dead.mjs', args: [j(H, '.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-git-graph/lib/client.js')], file: j(H, '.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-git-graph/lib/client.js'), marker: 'p44.dead.slot', bad: 'scope.slots.inject("conversation.input.selector.context"', extra: [] },
  { id: 'p57-ui-theme-body-pin', cat: 'B', script: 'replay-ui-theme-body-pin.mjs', args: [j(G, '@deepseek-ai/dsh-client-ui-theme/lib/client.js'), j(H, '.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js')], file: j(G, '@deepseek-ai/dsh-client-ui-theme/lib/client.js'), marker: 'html,body{overscroll-behavior:none;height:100%;overflow:hidden}', bad: 'var base_css_default = \":root{--dsw-font-family', extra: [j(H, '.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js')] },
  // [封存 2026-09-03 alpha.5 升级案] 2026-09-03 alpha.5: watchdog 判 upstream shape gone（0.3.x 样式案终结）
  // { id: 'p45-better-sidebar-host-clip', cat: 'D', script: 'replay-better-sidebar-host-clip.mjs', args: [j(H, '.dsh/profiles/web/node_modules/dsh-better-sidebar/lib/client.js')], file: j(H, '.dsh/profiles/web/node_modules/dsh-better-sidebar/lib/client.js'), marker: "patch(host-clip)", bad: "[data-dsh-panel-host]{z-index:40;pointer-events:none;position:fixed;inset:0}", extra: [] },
  { id: 'p46-desktop-chrome-launcher-pin', cat: 'C', script: 'replay-desktop-chrome-launcher-pin.mjs', args: [j(REPO, 'personal-plugins/dsh-desktop-chrome/client.mjs')], file: j(REPO, 'personal-plugins/dsh-desktop-chrome/client.mjs'), marker: "placeLauncherButton", bad: "moveUsageToMemoryRow]) {", extra: [] },
  // [封存 2026-09-08] desktop-launcher 包已从 web profile 卸载，replay 每轮 ENOENT 崩掉 autorun 子进程（watchdog 不退役文件消失类）；重装 launcher 后取消本行注释即可
  // { id: 'p25-launcher-power-top', cat: 'D', script: 'replay-launcher-power-top.mjs', bare: true, file: j(H, '.dsh/profiles/web/node_modules/@linxin666/dsh-desktop-launcher/lib/client.js'), marker: "patch(power-top)", bad: "position:fixed;bottom:24px;right:24px}", extra: [] },
  // [封存 2026-09-08] 使命完成：修的是 auto-memory 0.1.29 greet 路由漏 readJsonBody，上游 0.1.30+ 已修；现包 2.2.4 结构全变
  // { id: 'p47-auto-memory-greet-body', cat: 'D', script: 'replay-auto-memory-greet-body.mjs', args: [j(H, '.dsh/profiles/web/node_modules/@a9i5k4/dsh-auto-memory/lib/index.js')], file: j(H, '.dsh/profiles/web/node_modules/@a9i5k4/dsh-auto-memory/lib/index.js'), marker: "patch(greet-body)", bad: "const ws = body && body.ws ? body.ws : ''", extra: [] },
  // [2026-09-11 v3 rc.2 移植] replay 脚本已按 0.1.5-rc.2 新流循环重写四锚点（D: let started = false; / A1: live.push(chunk); / A2: startCall / A3: executeToolCalls 挂载），语义同 v2。
  // bad=startCall 行=rc.2 常在信号：升级冲掉 marker 即重放、永不误退休。
  { id: 'p63-goal-align', cat: 'B', script: 'replay-goal-align.mjs', args: [j(G, '@deepseek-ai/dsh-client-ui-goal/lib/client.js')], file: j(G, '@deepseek-ai/dsh-client-ui-goal/lib/client.js'), marker: '/*patch(goal-align)*/', bad: '.nLMEza_dock{', extra: [] },
  { id: 'p49-agent-loop-streaming-dispatch', cat: 'A', script: 'replay-agent-loop-streaming-tool-dispatch.mjs', args: [j(G, '@deepseek-ai/dsh-agent-loop/lib/index.js'), j(H, '.dsh/profiles/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js')], file: j(G, '@deepseek-ai/dsh-agent-loop/lib/index.js'), marker: "patch(streaming-tool-dispatch)", bad: "const startCall = async (index) => {", extra: [j(H, '.dsh/profiles/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js')] },
  { id: 'p51-preset-wrap', cat: 'B', script: 'replay-better-sidebar-preset-wrap.mjs', args: [j(G, '@deepseek-ai/dsh-client-ui-agent-preset/lib/client.js')], file: j(G, '@deepseek-ai/dsh-client-ui-agent-preset/lib/client.js'), marker: "/*patch(preset-wrap)*/", bad: "cardDesc{color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis;font-size:11px;line-height:16px;overflow:hidden}", extra: [] },
  { id: 'util', cat: 'F', script: 'replay-dsh-tools-sync-web-local.mjs', args: [j(G, '@deepseek-ai/dsh-tools'), j(H, '.dsh/profiles/web/node_modules/@deepseek-ai/dsh-tools')] },
  { id: 'p54-usage-row', cat: 'C', script: 'replay-desktop-chrome-usage-row.mjs', args: [j(REPO, 'personal-plugins/dsh-desktop-chrome/client.mjs')], file: j(REPO, 'personal-plugins/dsh-desktop-chrome/client.mjs'), marker: "/*patch(usage-row)*/", bad: "while (n !== null && n.parentElement !== settingsArea) n = n.parentElement;", extra: [] },
  { id: 'util', cat: 'F', script: '/Users/boergege/compile/优秀仓库参考/DeepSeek-Harness/personal-plugins/dsh-experts-roster/convert-my-experts.mjs', bare: true },
  { id: 'util', cat: 'F', script: '/Users/boergege/compile/优秀仓库参考/DeepSeek-Harness/personal-plugins/dsh-experts-roster/sync-builtin-experts.mjs', bare: true },
  { id: 'util', cat: 'F', script: 'replay-search-pool-schema.mjs', bare: true },
  // [封存 2026-09-03 alpha.5 升级案] 2026-09-03 alpha.5: watchdog 判 upstream shape gone（model-selection 重构）
  // { id: 'p52-model-select', cat: 'B', script: 'replay-model-select-mode-filter.mjs', args: [j(H, '.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js')], file: j(H, '.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js'), marker: "/*patch(mode-filter)*/", bad: "const { current, routable, groups, failures } = result.value;", extra: [] },
  { id: 'util', cat: 'A', script: 'replay-subagent-driver-agents-access.mjs', args: [j(H, '.dsh/profiles/node_modules/@deepseek-ai/dsh-subagent-in-process-driver/lib/index.js')] },
  { id: 'util', cat: 'A', script: 'replay-dsh-tools-render-fallback.mjs', args: [j(H, '.dsh/profiles/node_modules/@deepseek-ai/dsh-tools/lib/index.js')] },
  { id: 'util', cat: 'A', script: 'replay-dsh-tools-render-fallback.mjs', args: [j(H, '.dsh/profiles/web/node_modules/@deepseek-ai/dsh-tools/lib/index.js')] },
  { id: 'p50-mcp-connect-timeout', cat: 'A', script: 'replay-mcp-client-connect-timeout.mjs', args: [j(G, '@deepseek-ai/dsh-mcp-client/lib/index.js')], file: j(G, '@deepseek-ai/dsh-mcp-client/lib/index.js'), marker: "/*patch(mcp-connect-timeout)*/", bad: "await generation.connect(createTransport(config));", extra: [] },
  { id: 'p62-better-sidebar-embed-fallback', cat: 'D', script: 'replay-better-sidebar-embed-fallback.mjs', args: [j(H, '.dsh/profiles/web/node_modules/dsh-better-sidebar/lib/client.js')], file: j(H, '.dsh/profiles/web/node_modules/dsh-better-sidebar/lib/client.js'), marker: 'patch(embed-fallback)', bad: 'api.browserProbe(url).then((probe) => {', extra: [] },
  // [封存 2026-09-03 alpha.5 升级案] 2026-09-03 alpha.5: discoverModels 原生实现 live listing（fetch /models + Bearer），补丁使命结束
  // { id: 'p60-discovery-live', cat: 'A', script: 'replay-pi-ai-discovery-live.mjs', args: [j(G, '@deepseek-ai/dsh-llm-pi-ai/lib/index.js'), j(H, '.dsh/profiles/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js')], file: j(G, '@deepseek-ai/dsh-llm-pi-ai/lib/index.js'), marker: 'patch(discovery-live)', bad: 'if (installed.size > 0) return [...installed.values()].map((model) => ({', extra: [j(H, '.dsh/profiles/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js')] },
]

// autorun 作业：每条 autorun 非 null 的条目一个作业（多目标脚本不循环 argv，保持逐条）。
export function autorunJobs() {
  return PATCHES.filter(p => p.bare || p.args).map(p => [p.script, p.bare ? [] : p.args])
}

// watchdog 检查：watch 条目 1:1 映射（file/extra 即重放参数）。
export function watchdogChecks() {
  return PATCHES.filter(p => p.file !== undefined && p.marker !== undefined)
    .map(p => ({ id: p.id, file: p.file, marker: p.marker, bad: p.bad, script: p.script, extra: p.extra || [] }))
}
