# Agent Note: SPE 文献流水线与多 agent skill 分发

Status: implemented

## Problem

SPE/IADC 类油气文献检索每个会话都要临时拼工具链：源被误判（scihub.net.cn 实为查重引流假站；petrowiki 索引存在但 WAF 拦一切自动化正文）、CF 墙挡 headless 浏览器、没有 agent 知道可用路线；DOI→PDF 无可复现路径。

## Decision

- 单一定本 skill `spe-lit-search` 放 ~/.cc-switch/skills/（中央库），软链分发至 claude/codex/zcode/opencode/agents 五处 skill 目录 + opencode subagent 定义。frontmatter 强触发 SPE/IADC/OTC/URTeC/AAPG/SEG/API-RP（排除 °API 计量单位与编程 API 语义）；硬规则：bocha 必须 `site:` 语法、scihub.net.cn 禁用。
- Cookie 桥 `~/.dsh/argo-pawl-bridge.mjs`：动态读 ~/.dsh/crawler-config.json 的 profileDir，Chromium SQLite cookie 导出 Netscape 格式并自检（403 ⇒ NEED_UNLOCK）。端到端验证：Johancsik 1984（2.6MB）与 Mitchell 1988（546KB）经 HTTP+cookie+UA 直取（无需 headless——一次性 crawler_unlock 的 clearance 在纯 HTTP 侧依然有效）。
- 源矩阵（2026-08-19 全实测）：发现层 bocha site: + argo 引擎（python3.14 PATH 软链 + SSL 证书修复后复活）；全文层 PMC/DOI 开放副本直抓、pawl browser（无 CF 站）、sci-hub.st→.fr cookie 桥（DOI→PDF 主力）、crawler_unlock 人工兜底。petrowiki 仅 summary（正文 WAF 500 恒拦）。

## Alternatives considered

- **argo 直连 pawl browser 引擎。** 否决：进程隔离（MCP 子进程 vs cordis 宿主）、argo 引擎注册表无浏览器模型、CF clearance 绑指纹——cookie 桥用纯 HTTP 达到同等效果。
- **编排做成 dsh 插件而非 skill。** 编排层否决：每步都是对抗性判断（哪堵墙、走哪个兜底），属于模型侧提示词职责；只有确定性动作（cookie 桥）落为代码。
- **bocha 单引擎。** 部分采纳：bocha `site:` 为一级发现层，但全文依赖免费开放副本（PMC/DOI）与 sci-hub 桥，bocha 仅 summary。

## Consequences

- 任何 agent 命中触发短语自动加载流水线；更新经软链从 cc-switch 单点传播全端。
- sci-hub 的 headless 路仍被 Turnstile 指纹墙拦——HTTP+cookie 为主路，unlock 重跑路径已写入 skill 自愈。

## Testing

两次完整 DOI→PDF 验证（%PDF magic + 字节数）；petrowiki 经 bocha/ddg 交叉验证；桥自检 302 通过。
