# Agent Note: SPE literature pipeline and multi-agent skill distribution

Status: implemented

## Problem

Literature search for SPE/IADC-class petroleum sources required ad-hoc tool chains each session: sources were misclassified (scihub.net.cn is a paywall-nav fake, petrowiki indexes exist but WAF-blocks all automated正文), CF walls blocked headless browsers, and no agent knew the working route. DOI→PDF had no reproducible path.

## Decision

- Single-source-of-truth skill `spe-lit-search` in ~/.cc-switch/skills/ (central library), symlinked into claude/codex/zcode/opencode/agents skill dirs + an opencode subagent definition. Frontmatter triggers on SPE/IADC/OTC/URTeC/AAPG/SEG/API-RP (excludes °API unit and programming-API senses); hard rules: bocha must use `site:` syntax, scihub.net.cn banned.
- Cookie bridge `~/.dsh/argo-pawl-bridge.mjs`: dynamically reads pawl profileDir from ~/.dsh/crawler-config.json, exports Chromium SQLite cookies to Netscape format, self-probes (403 ⇒ NEED_UNLOCK). Verified end-to-end: Johancsik 1984 (2.6MB) and Mitchell 1988 (546KB) PDFs via HTTP+cookie+UA (no headless browser needed — clearance from a one-time crawler_unlock survives into plain HTTP).
- Source matrix (all tested 2026-08-19): bocha site: + argo engines (after python3.14 PATH link + SSL certs fix) for discovery; PMC/DOI open copies direct-fetch; pawl browser for non-CF sites; sci-hub.st→.fr cookie bridge for DOI→PDF; crawler_unlock as the manual fallback. petrowiki: summary-only (WAF blocks正文 at 500).

## Alternatives considered

- **Wire argo straight into pawl's browser engine.** Rejected: separate processes (MCP child vs cordis host), no browser model in argo's engine registry, and CF clearance is fingerprint-bound — the cookie bridge achieves the same result over plain HTTP.
- **Orchestrate the chain as a dsh plugin instead of a skill.** Rejected for the orchestration layer: every step is adversarial judgment (which wall, which fallback), which belongs in model-side prompting; only the deterministic cookie bridge became code.
- **bocha as the sole engine.** Partially adopted: bocha `site:` is tier-1 discovery, but free open copies (PMC/DOI) and the sci-hub bridge cover full-text where bocha only summarizes.

## Consequences

- Any agent hitting a trigger phrase loads the pipeline automatically; updates propagate from the single cc-switch copy through symlinks.
- sci-hub headless browser stays blocked by Turnstile (fingerprint-bound) — HTTP+cookie route is the primary; unlock re-run documented as self-heal in the skill.

## Testing

Two full DOI→PDF runs verified (%PDF magic, byte counts); petrowiki verified via bocha/ddg cross-check; bridge self-probe OK (302).
