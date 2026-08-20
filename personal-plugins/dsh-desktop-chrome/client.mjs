/**
 * Client side of dsh-desktop-chrome — part window chrome, part QQ98-skin shim:
 *
 *  1. Retro titlebar: drag region + real min/max/close via the shell bridge.
 *  2. Skin contrast fixes (preview badge) and compact text density.
 *  3. Usage widget: rebuilds the dsh-usage-stats footer badge into a compact
 *     two-line dashboard for the CURRENT model only — session-window ring,
 *     cache-hit ring, reset time (or balance), and today's tokens in K/M/B.
 *     Data comes from the plugin's own loopback routes; the plugin's panel
 *     (badge click) is untouched.
 *
 * Script-format module (no ESM syntax), matching the skin's client bundle
 * contract: the factory returns a module object whose `apply(ctx)` mounts.
 */
window.__ModuleLoader__.load({
	id: "dsh-desktop-chrome",
	factory: () => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const STYLE_TEXT = `
.EGn-AW_retroTitlebar { -webkit-app-region: drag; }
.EGn-AW_retroTitlebarBtn { -webkit-app-region: no-drag; cursor: pointer; }
[class*="_previewBadge"] { color: var(--dsw-alias-label-primary) !important; }
/* footer row: let entries wrap so the usage badge always gets a full row
 * instead of being squeezed to 0px by full-width footer slot entries */
.hHd-Xa_footerActions { flex-wrap: wrap; row-gap: 4px; }
.usg_layer:not(.usg_rail) { height: 36px; flex: 1 1 100%; min-width: 0; margin: 2px 0 0 6px; }
/* dsh-chat-import's sidebar trigger ships width:100% inline — shrink it to
 * its content so it stops evicting every other footer entry */
button[aria-label="导入会话"] { width: auto !important; flex: 0 0 auto !important; }
.usg_layer:not(.usg_rail) .usg_badge { height: 36px; width: 100%; gap: 6px; }
.usg_layer:not(.usg_rail) .usg_badgeLabel,
.usg_layer:not(.usg_rail) .usg_badgeCount { display: none; }
.hHd-Xa_collapsed .hHd-Xa_footerActions { flex-direction: column; align-items: center; }
html { font-size: 93.75%; }
.usg_panel { width: var(--dshc-sidebar-w, 280px) !important; max-height: 62vh !important; font-size: 12px !important; }
.usg_statsRow { flex-wrap: wrap !important; }
.usg_statsRow .usg_stat { flex: 1 1 40% !important; min-width: 0; }
.usg_statsRow .usg_stat:last-child { flex-basis: 100% !important; }
.usg_day { gap: 6px !important; }
.usg_dayDate { width: auto !important; flex: none !important; }
.usg_dayTokens { flex: none !important; margin-left: auto !important; }
.usg_dayHit { flex: none !important; width: auto !important; }
.usg_panel .usg_header, .usg_panel section { padding: 8px 10px; }
#dshc-usage { display: flex; flex-direction: column; justify-content: center; gap: 2px; min-width: 0; flex: 1; text-align: left; line-height: 1; user-select: none; padding-right: 12px; }
#dshc-usage .dshc-row { display: flex; align-items: center; gap: 7px; font-size: 10px; color: var(--dsw-alias-label-primary); white-space: nowrap; }
#dshc-usage .dshc-row2 { font-size: 10px; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; padding-left: 1px; }
#dshc-usage .dshc-cell { display: inline-flex; align-items: center; gap: 2px; }
/* pin the green remaining-% at the row's right end: preceding cells may change
 * width (clock ticks, token counters), the % must not move */
#dshc-usage .dshc-row .dshc-cell:last-child { margin-left: auto; min-width: 34px; justify-content: flex-end; font-variant-numeric: tabular-nums; }
/* Safari blank-chip fix: the theme's gradient-clipped text leaves
 * -webkit-text-fill-color transparent when the gradient function is
 * unsupported (older Safari), painting the branch chip's label and chevron
 * invisible while the box stays clickable. Force the fill back to the
 * resolved currentColor. */
[data-gitgraph-chip], [data-gitgraph-chip] * { -webkit-text-fill-color: currentColor !important; }
[data-gitgraph-chip] { color: var(--dsw-alias-label-primary, #e3f4ec) !important; }
#dshc-usage .dshc-dim { color: var(--dsw-alias-label-primary); }
/* layout only — the glassy texture is synced live from the context-length
 * ring trigger so it follows theme switches and stays color-coordinated */
#dshc-model-rings { display:inline-flex; align-items:center; gap:7px; box-sizing:border-box; min-height:28px; padding:2px 8px; border-radius:4px; border:none; cursor:default; transition:filter .15s ease; }
#dshc-model-rings:hover { filter:brightness(1.25); }
/* frame the official context trigger so it reads as a zone; the injected
 * percentage sits right of the ring */
/* PATCH: user asked the native context-usage ring hidden */
button[aria-label^="上下文已用"] { display:inline-flex !important; align-items:center; gap:3px; box-sizing:border-box; min-height:28px; width:auto !important; padding:2px 6px; border:none; border-radius:4px; background:transparent; }
button[aria-label^="上下文已用"] svg { flex:none !important; }
#dshc-health-dot { animation: dshc-breathe 2.6s ease-in-out infinite; }
#dshc-health-dot[data-state="orange"] { animation-duration: 1.4s; }
#dshc-health-dot[data-state="red"] { animation-duration: .7s; }
@keyframes dshc-breathe { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .45; transform: scale(.8); } }
#dshc-model-rings span[title] { display:inline-flex; align-items:center; gap:2px; font-size:10px; line-height:1; color:var(--dsw-alias-label-secondary); font-variant-numeric:tabular-nums; }
.usg_layer.usg_rail #dshc-usage { display: none; }
[data-dshc-stats="1"], [data-dshc-stats="1"] * { white-space: normal !important; text-overflow: clip !important; overflow: visible !important; }
[data-dshc-stats="1"] { max-width: none !important; font-size: 11px !important; line-height: 15px !important; }

/* user prefs: bigger health dot, tightened composer spacing */
#dshc-health-dot { width: 10px !important; height: 10px !important; }

/* upgrade-proof dock alignment (2026-08-20): the shipped 8px inset is a
 * design default the user overrode to 0 (dock bars flush with the input
 * card). Pin the CSS variable at runtime so a dsh upgrade reinstalling the
 * official dist cannot silently revert it. */
[class*="_root"] { --dsh-composer-dock-inset: 0px !important; }
`;

		const WIDGET_ID = "dshc-usage";
		const REFRESH_MS = 30 * 1000;

		function fmtCompact(n) {
			if (!Number.isFinite(n)) return "—";
			if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
			if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
			if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
			return String(n);
		}

		function ringSvg(percent, color) {
			const p = Math.min(100, Math.max(0, percent));
			const r = 5, c = 2 * Math.PI * r;
			const off = c * (1 - p / 100);
			return '<svg width="14" height="14" viewBox="0 0 14 14" style="flex:none">'
				+ '<circle cx="7" cy="7" r="' + r + '" fill="none" stroke="rgba(128,128,128,.4)" stroke-width="2.4"/>'
				+ '<circle cx="7" cy="7" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '" transform="rotate(-90 7 7)"/>'
				+ "</svg>";
		}

		function ringColor(percent) {
			if (percent >= 95) return "#e85443";
			if (percent >= 80) return "#e8a543";
			return "#7fb2e5";
		}

		function fmtReset(iso) {
			try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }); }
			catch { return "—"; }
		}

		/** The composer's model trigger carries "选择模型，当前 <Display Name> …". */
		function currentModelName() {
			const btn = document.querySelector('button[aria-haspopup="menu"][aria-label^="选择模型，当前"]');
			if (btn === null) return null;
			const label = btn.getAttribute("aria-label") ?? "";
			// 官方 label 曾是 "MODEL (推理等级 X)"，现在是 "MODEL，推理等级 X"——
			// 只按 " (" 分割会让模型名带上"推理等级"尾巴，用量匹配永远失败
			// （2026-08-19 三环消失根因）。半角/全角括号、中文逗号都切。
			const name = label.replace(/^选择模型，当前\s*/, "").split(/[（(，]/)[0].trim().toLowerCase();
			return name.length > 0 ? name : null;
		}

		async function fetchJson(path) {
			const res = await fetch(path, { headers: { accept: "application/json" } });
			return res.json();
		}


// PATCH: today tokens from usage-pro (event-captured, accurate); legacy fallback.
async function fetchProTodayTokens() {
  try {
    const pro = await fetchJson("/dsh-local/usage-pro/summary");
    if (pro && pro.ok && pro.today) {
      const t = pro.today;
      return (Number(t.i)||0) + (Number(t.o)||0) + (Number(t.cr)||0) + (Number(t.cw)||0);
    }
  } catch {}
  return null;
}

async function buildRows() {
			const modelName = currentModelName();
			const [usageRes, providersRes] = await Promise.all([
				fetchJson("/api/usage-stats/usage"),
				fetchJson("/api/usage-stats/providers"),
			]);
			if (usageRes.ok !== true) throw new Error("usage route");
			const now = new Date(); const todayKey = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0"); // PATCH: local-day key (UTC key showed YESTERDAY 00:00-08:00 CST)
			const days = usageRes.days ?? [];
			const day = days.find((d) => d.date === todayKey) ?? null;
			// Days arrive oldest-first; the most recent day resolves the current
			// model's provider when today has no usage yet.
			const recent = day ?? days[days.length - 1] ?? null;

			// Current model only: match the display name against the per-model ids
			// ("<provider>/<model>") recorded in the usage log. A brand-new model
			// (no history yet) falls back to its family — "glm-5.3" → any "glm-*"
			// — to still resolve the provider.
			const family = modelName !== null ? modelName.split("-")[0] : null;
			const findEntry = (d, allowFamily) => {
				if (d === null || modelName === null) return null;
				const models = d.models ?? [];
				const byName = models.find((m) => m.model.toLowerCase().endsWith("/" + modelName))
					?? models.find((m) => m.model.toLowerCase().includes(modelName));
				if (byName !== undefined) return byName;
				if (allowFamily !== true || family === null) return null;
				return models.find((m) => m.model.split("/")[1]?.toLowerCase().startsWith(family)) ?? null;
			};
			const entry = findEntry(day, true) ?? findEntry(recent, true);
			const providerId = entry !== null ? entry.model.split("/")[0] : null;

			// Account snapshot for that provider (subscription windows / balance).
			// Usage records the routed provider id ("modlens-zai-coding-cn") while
			// the providers list carries the profile id ("zai-coding-cn") — match
			// by suffix when the exact id is absent.
			let account = null;
			let target = null;
			if (providersRes.ok === true) {
				const providers = providersRes.providers ?? [];
				const matched = providerId !== null
					? providers.find((p) => p.id === providerId) ?? providers.find((p) => providerId.endsWith(p.id))
					: undefined;
				if (matched !== undefined) target = matched.id;
				else {
					const okProvider = providers.find((p) => p.status === "ok");
					target = okProvider !== undefined ? okProvider.id : null;
				}
			}
			if (target !== null) {
				const res = await fetchJson("/api/usage-stats/account?provider=" + encodeURIComponent(target));
				if (res.ok === true) account = res.account;
			}

			const row1 = [];
			if (account !== null) {
				const sessionWindow = (account.windows ?? []).find((w) => w.kind === "session") ?? null;
				if (sessionWindow !== null) {
					// PATCH: 5h session-window usage ring removed per user request
					row1.push('<span class="dshc-cell dshc-dim" title="窗口重置">' + fmtReset(sessionWindow.resetsAt) + "</span>");
				}
				if (account.mode === "balance") {
					const value = account.alert?.value;
					if (Number.isFinite(value)) row1.push('<span class="dshc-cell" title="余额">¥' + value + "</span>");
				} else {
					const billing = (account.windows ?? []).find((w) => w.kind === "billing") ?? null;
					if (billing !== null && Number.isFinite(billing.remaining)) {
						row1.push('<span class="dshc-cell dshc-dim" title="计费周期余量">' + fmtCompact(billing.remaining) + "</span>");
					}
				}
			}
			const todayEntry = findEntry(day, false);
			const hitRate = (todayEntry ?? entry) !== null && Number.isFinite((todayEntry ?? entry).cacheHitRate) ? (todayEntry ?? entry).cacheHitRate : null;
   if (hitRate !== null) {
    row1.push('<span class="dshc-cell" title="缓存命中率">' + ringSvg(hitRate, "#7fb2e5") + Math.round(hitRate) + "%</span>");
   }
			const todayTokens = await fetchProTodayTokens() ?? (todayEntry !== null ? todayEntry.tokens : null);
			const row2 = "今日 " + (todayTokens !== null ? fmtCompact(todayTokens) : "—"); // PATCH: model name removed
			return { row1: row1.join(""), row2 };
		}

		/** Wrap each day bar in a fixed 36px track: the plugin sizes bars by an
		 * inline percentage of the row, which the compact 280px panel squeezes
		 * to nothing. Inside a track the same percentage stays proportional. */
		function wrapDayBars() {
			for (const bar of document.querySelectorAll(".usg_dayBar")) {
				const parent = bar.parentElement;
				if (parent === null || parent.dataset.dshcBarTrack === "1") continue;
				const track = document.createElement("span");
				track.dataset.dshcBarTrack = "1";
				track.style.cssText = "flex:none;width:36px;height:6px;border-radius:3px;background:rgba(127,154,181,.25);overflow:hidden;display:inline-block;";
				bar.replaceWith(track);
				track.appendChild(bar);
				// Keep the inline percentage — it now resolves against the track.
				const percentWidth = bar.style.width;
				bar.style.cssText = "display:block;height:100%;border-radius:0;width:" + percentWidth + ";";
			}
		}

		/** The panel's 今日/本月/累计 stats are all-model totals; restate them
		 * for the current model only (exact-name match per recorded day). */
		async function patchPanelStats() {
			const panel = document.querySelector(".usg_panel");
			if (panel === null) return;
			const values = [...panel.querySelectorAll(".usg_stat .usg_statValue")];
			if (values.length < 3) return;
			const modelName = currentModelName();
			if (modelName === null) return;
			try {
				const res = await fetchJson("/api/usage-stats/usage");
				if (res.ok !== true) return;
				const now = new Date(); const todayKey = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0"); // PATCH: local-day key (UTC key showed YESTERDAY 00:00-08:00 CST)
				const monthPrefix = todayKey.slice(0, 7);
				let today = 0, month = 0, total = 0;
				for (const d of res.days ?? []) {
					for (const m of d.models ?? []) {
						const id = m.model.toLowerCase();
						if (!id.endsWith("/" + modelName) && !id.includes(modelName)) continue;
						if (d.date === todayKey) today += m.tokens;
						if (d.date.startsWith(monthPrefix)) month += m.tokens;
						total += m.tokens;
					}
				}
				const nums = [today, month, total].map((n) => fmtCompact(n));
				values.forEach((el, index) => {
					if (nums[index] !== undefined && el.textContent !== nums[index]) el.textContent = nums[index];
				});
				const firstLabel = panel.querySelector(".usg_stat .usg_statLabel");
				if (firstLabel !== null && firstLabel.textContent === "今日") firstLabel.textContent = "今日·全部";
			} catch { /* plugin's own totals stay */ }
		}

		/** Compact units everywhere in the panel: rewrite every comma-grouped
		 * number (stats, day rows, model breakdowns, detail lines) to K/M/B. */
		function patchCompactNumbers() {
			if (document.querySelector('[class*="usg_"]') === null) return;
			// Body-wide walk, usg-scoped: covers the panel AND any tooltip or
			// popover the plugin portals outside it.
			const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
			for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
				if (node.parentElement?.closest('[class*="usg_"]') === null) continue;
				const raw = node.textContent ?? "";
				const replaced = raw.replace(/\b\d{1,3}(?:,\d{3})+\b/g, (m) => fmtCompact(Number(m.replace(/,/g, ""))));
				if (replaced !== raw) node.textContent = replaced;
			}
		}

		/** Full-width conversation: the official flow caps its column (and the
		 * composer/stats strip) at ~748px via hashed classes — match structurally
		 * (a `_column`/`_card`/`_stack` whose computed max-width sits in the
		 * capped range) and uncap. Runs on every mutation, so sidebar toggles
		 * re-apply it. (`_stack` covers the new-session welcome column, which
		 * newer builds render with a different hashed suffix.) */
		function widenConversation() {
			for (const el of document.querySelectorAll('[class*="_column"], [class*="_card"], [class*="_stack"]')) {
				if (el.dataset.dshcWide === "1") continue;
				const maxWidth = parseFloat(getComputedStyle(el).maxWidth);
				if (Number.isFinite(maxWidth) && maxWidth >= 600 && maxWidth <= 900) {
					el.style.maxWidth = "none";
					el.dataset.dshcWide = "1";
				}
			}
		}

		/** The session stats line under the composer ships as a single
		 * nowrap/ellipsis row capped at the chat content width — long sessions
		 * truncate. Let it wrap across the full width at a smaller size
		 * (matched structurally: nowrap + ellipsis + stats-like text). */
		function patchStatsLine() {
			for (const el of document.querySelectorAll("div, span")) {
				if (el.dataset.dshcStats === "1") continue;
				const text = el.textContent ?? "";
				// the full line carries both markers; segment spans alone don't
				if (!/轮/.test(text) || !/LLM/.test(text) || !/tok|缓存/i.test(text)) continue;
				const cs = getComputedStyle(el);
				if (cs.whiteSpace !== "nowrap" && cs.textOverflow !== "ellipsis") continue;
				el.dataset.dshcStats = "1";
			}
		}

		/** Cumulative totals appended to the session stats line: today for the
		 * current model, today for all models, and this session's running total
		 * (parsed from the line's own 输入/输出 figures). The span is wiped by
		 * React re-renders and rebuilt idempotently; fetches are throttled. */
		let statsSegEl = null;
		let statsTotalsAt = 0;

		function ensureStatsSegment() {
			// Only the composer's own stats line carries the totals segment —
			// per-window stats lines in the message flow stay untouched.
			const line = document.querySelector('[class*="composerStack"] [data-dshc-stats="1"]');
			if (line === null) return;
			if (statsSegEl !== null && statsSegEl.isConnected && statsSegEl.parentElement === line) return;
   // PATCH: React rebuilds the line on composer switches; stale segments
   // from previous lines survive and ACCUMULATE — sweep orphans first.
   for (const stale of line.querySelectorAll('[data-dshc-stats-totals="1"]')) stale.remove();
			statsSegEl = document.createElement("span");
			statsSegEl.dataset.dshcStatsTotals = "1";
			line.appendChild(statsSegEl);
			statsTotalsAt = 0;
			void updateStatsTotals();
		}

		function parseTokTokens(source, label) {
			const match = source.match(new RegExp(label + "\\s*([\\d.]+)\\s*([KMB])", "i"));
			if (match === null) return null;
			const scale = { K: 1e3, M: 1e6, B: 1e9 }[match[2].toUpperCase()] ?? 1;
			return Number(match[1]) * scale;
		}

		async function updateStatsTotals() {
			const now = Date.now();
			if (now - statsTotalsAt < 60_000) return;
			statsTotalsAt = now;
			const seg = statsSegEl;
			if (seg === null || !seg.isConnected) return;
			try {
				const res = await fetchJson("/api/usage-stats/usage");
				if (res.ok !== true) return;
				const now = new Date(); const todayKey = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0"); // PATCH: local-day key (UTC key showed YESTERDAY 00:00-08:00 CST)
				const day = (res.days ?? []).find((d) => d.date === todayKey) ?? null;
				const modelName = currentModelName();
				const entry = day !== null && modelName !== null
					? (day.models ?? []).find((m) => m.model.toLowerCase().endsWith("/" + modelName)) ?? (day.models ?? []).find((m) => m.model.toLowerCase().includes(modelName))
					: undefined;
				const parts = [];
				if (entry !== undefined) parts.push("今日·当前 " + fmtCompact(entry.tokens));
				if (day !== null) parts.push("今日·全部 " + fmtCompact(day.tokens));
				const text = parts.length > 0 ? "｜ " + parts.join(" · ") : "";
				if (seg.textContent !== text) seg.textContent = text;
			} catch { /* keep the previous text */ }
		}

		/** Sidebar-top chip row: the git branch dropdown (git-graph's chipWrap)
		 * lives in the sidebar header's logoRow, left of the collapse toggle —
		 * 2026-08-19 user instruction. The composer row below only carries the
		 * checklist dock; the goal bar stays in its official composer-stack dock. */
		function placeGoalGitRow() {
			// Hero (blank-session) phase: no composer row needed; the branch chip
			// still rides the sidebar top. Just drop any stale composer row.
			const heroStack = document.querySelector('[class*="composerStack"]');
			if (heroStack !== null && heroStack.className.includes("composerHero")) {
				const heroRow = document.getElementById("dshc-goal-git-row");
				if (heroRow !== null) heroRow.remove();
			}
			// the git plugin's own chip wrapper (hashed prefix, stable suffix)
			const chipAll = Array.from(document.querySelectorAll('[class*="chipWrap"]'));
			// 只认当前自然位置上可见的那个实例（插件在多个槽位挂载多个 chipWrap，
			// 搬错实例=搬走死节点，点击永远无反应）
			const chip = chipAll.find(c => c.getBoundingClientRect().width > 0 && getComputedStyle(c).display !== "none") ?? undefined;
			if (chip !== undefined) {
				const cluster = document.querySelector('[class*="toggleCluster"]');
				// 2026-08-19 终版方案：不搬节点（搬离 React 容器=事件委托断裂），
				// 直接 position:fixed 原地钉到右上角、与 tab 栏（对话/轨迹、
				// 石油项目智能体行）水平对齐；文件区展开时随会话区左移。
				const conv = document.querySelector('[class*="scrollBody"]');
				const tabs = document.querySelector('[role="tablist"]');
				if (cluster !== null) {
					const clusterRect = cluster.getBoundingClientRect();
					const convRight = conv !== null ? conv.getBoundingClientRect().right : Infinity;
					const rightEdge = Math.min(clusterRect.left - 8, convRight - 10);
					// 垂直对齐会话标题行（"PTC 模式" chip 所在行 = tablist 的上一个
					// 兄弟）；行不在时退回 tab 栏/收缩按钮行
					const titleRow = tabs !== null ? tabs.previousElementSibling : null;
					// patch(anchor-fallback): a collapsed panelHeader (height 0) yields
					// top = -12 and pins the git chips off-screen. Fall back to the tabs
					// row, then the cluster rect; clamp any remainder to the viewport top.
					let anchorRow = titleRow !== null ? titleRow.getBoundingClientRect() : (tabs !== null ? tabs.getBoundingClientRect() : clusterRect);
					if (anchorRow.height < 14) anchorRow = tabs !== null ? tabs.getBoundingClientRect() : clusterRect;
					if (anchorRow.height < 14) anchorRow = clusterRect;
					const top = Math.max(2, Math.round(anchorRow.top + (anchorRow.height - 24) / 2));
					// 水平：钉在标题行最右侧可见元素（"PTC 模式"或其他模式 chip）后面，
					// 按实测右缘排布，任何模式下都不与已有 chip 重叠。顺序 [分支][提交]。
					const commitChip = document.getElementById("dsh-git-commit-chip");
					let rowRight = 0;
					if (titleRow !== null) {
						// 上限取行宽 85%：子智能体下拉展开时其容器可能长到 600px+，
						// 60% 会漏掉导致按钮压住展开的列表；85% 仍排除整行容器
						const widthCap = anchorRow.width * 0.85;
						for (const c of titleRow.querySelectorAll('*')) {
							if (chip.contains(c) || (commitChip !== null && commitChip.contains(c))) continue;
							const cr = c.getBoundingClientRect();
							// 几何过滤：只认底边仍在标题行带内的元素——子代理下拉展开的
							// 面板垂到行下方（无论 absolute 还是流式），天然被排除，
							// 点开下拉不会推走按钮
							if (cr.bottom > anchorRow.bottom + 4) continue;
							// 只认 chip 尺寸的元素（宽<85% 行宽排除整行容器/长标题块，
							// 高≥14 排除装饰层）——无论模式/子代理 chip 多宽都取实测右缘
							if (cr.width > 0 && cr.width < widthCap && cr.height >= 14 && cr.right > rowRight) rowRight = cr.right;
						}
					}
					let branchLeft;
					if (rowRight > 0) {
						branchLeft = Math.round(rowRight + 8);
					} else {
						branchLeft = Math.round(rightEdge - (commitChip !== null ? commitChip.getBoundingClientRect().width + 6 : 0) - chip.getBoundingClientRect().width);
					}
					// patch(viewport-clamp): Safari/窄窗口下标题行元素的实测右缘可能
					// 越过视口，把分支 chip 钉到窗外不可见——钳回视口内（两侧各留 8px）。
					branchLeft = Math.max(8, Math.min(branchLeft, Math.round(window.innerWidth - chip.getBoundingClientRect().width - 8)));
					chip.style.position = "fixed";
					// patch(inline-chip-color): 某些 Safari 版本解析不了主题的渐变/
					// oklch 色函数，文字填充保持透明——内联颜色绕过整条 CSS 链，保底可见。
					chip.style.color = "#e3f4ec";
					chip.style.webkitTextFillColor = "#e3f4ec";
					const chipLabel = chip.querySelector("span");
					if (chipLabel !== null) { chipLabel.style.color = "#e3f4ec"; chipLabel.style.webkitTextFillColor = "#e3f4ec"; }
					chip.style.top = top + "px";
					chip.style.left = branchLeft + "px";
					chip.style.right = "";
					chip.style.zIndex = "35";
					chip.style.flex = "0 0 auto";
					if (commitChip !== null) {
						commitChip.style.position = "fixed";
						commitChip.style.top = top + "px";
						commitChip.style.left = Math.round(chip.getBoundingClientRect().right + 6) + "px";
						commitChip.style.right = "";
						commitChip.style.zIndex = "35";
					}
				} else {
					chip.style.position = "";
					chip.style.top = ""; chip.style.right = ""; chip.style.zIndex = "";
				}
			}
			if (heroStack !== null && heroStack.className.includes("composerHero")) return;
			// the row sits directly above the input card — the queue dock and
			// anything else in the input-dock stack stays above it (the queue
			// registers as the terminal dock entry; we take that spot instead)
			// 卡片查找：textarea 所在卡优先——data-dshc-wide 标记可能落在别的卡
			// （如 goal 面板）上，钉错参照整条错位（2026-08-20 实测）
			const card = document.querySelector("textarea")?.closest('[class*="_card"]')
				?? document.querySelector('[data-dshc-wide="1"][class*="_card"]')
				?? null;
			const host = card?.parentElement ?? undefined;
			if (host === undefined) return;
			// goal 条排堆叠最下（custom-ui 给 [data-goal-bar] 设 order:999）：
			// 输入卡根（host，flex 项）必须 order 更大，否则 goal 会排到卡片下面
			if (host.style.order !== "1000") host.style.order = "1000";
			// 卡片根自带 8px 顶部内边距，会让 goal↔卡片的视觉间距比条↔条多
			// 8px——清零后所有间距统一为堆叠 gap（2026-08-19 用户要求全一致）
			if (host.style.paddingTop !== "0px") host.style.paddingTop = "0";
			let row = document.getElementById("dshc-goal-git-row");
			if (row === null || row.parentElement !== host || row.nextElementSibling !== card) {
				if (row === null) {
					row = document.createElement("div");
					row.id = "dshc-goal-git-row";
					// flex:0 0 auto + explicit width (set in the align pass): the
					// host is align-items:center, so a shrink-to-fit row would
					// size to the uncapped goal bar and overflow the viewport
					row.style.cssText = "display:flex;align-items:center;gap:10px;flex:0 0 auto;min-width:0;";
				}
				host.insertBefore(row, card);
			}
			// 全宽通则：composerStack 的所有 dock 条目（任务横条、排队消息、goal
			// 条，穿过 display:contents 包装取真实 flex 项）逐像素对齐输入卡——
			// 实测卡片左缘差值 + 宽度双钉死。禁用 margin:auto 居中假设：host 被
			// 本插件改 order/padding 后居中失效，且 margin 简写会把 queue-dock
			// 钉好的 marginLeft 整体清掉（两个 MutationObserver 互踩=错位闪烁，
			// 2026-08-19）。这里只写 marginLeft/marginRight，垂直间距归各条目
			// 自身；queue-dock 插件对排队条做同样的钉死，写入值一致互不冲突。
			{
				const stackEl = document.querySelector('[class*="composerStack"]');
				// unified 2px rhythm (2026-08-20): stack gap pinned
				if (stackEl !== null && stackEl.style.gap !== "2px") stackEl.style.gap = "2px";
				if (stackEl !== null) {
					// 对齐参照 = 输入卡（2026-08-20 用户定稿：条与输入框左右边界对齐）
					const cr0 = card.getBoundingClientRect();
					const cardW = Math.round(cr0.width) + "px";
					const items = [];
					for (const w of stackEl.children) {
						if (getComputedStyle(w).display === "contents") {
							for (const it of w.children) items.push(it);
						} else {
							items.push(w);
						}
					}
					for (const it of items) {
						if (it === host || it === row) continue;
						// zero-height entries still consume a composerStack gap slot before
						// the card; negative margins cancel both surrounding gaps extra
						if (it.getBoundingClientRect().height <= 0) {
							if (it.style.marginTop !== "-2px") it.style.marginTop = "-2px";
							if (it.style.marginBottom !== "-2px") it.style.marginBottom = "-2px";
							continue;
						}
						const isGoal = it.hasAttribute("data-goal-bar") || it.querySelector("[data-goal-bar]") !== null;
						// 条目可能再包一层非 contents 的 DIV（如 agent-teams 的
						// OB_P1q_root），宽度限制在内层——宽度下探一层；左缘只钉
						// 外层（内层随外层 100% 填充，marginLeft 归零）
						const targets = isGoal ? [[it, true]] : [[it, true], [it.firstElementChild, false]];
						for (const [t, outer] of targets) {
							if (t === null || t === host || t === row) continue;
							if (t.getBoundingClientRect().height <= 0) continue;
							if (t.style.width !== cardW) t.style.width = cardW;
							if (t.style.maxWidth !== "none") t.style.maxWidth = "none";
							if (outer) {
								// 收敛式钉死：按当前实测误差自校正——相对公式（框左-
								// 父左）在条目已有自身定位或前次残留 margin 时双重偏移，
								// 两个 MutationObserver 互踩时复合把条推出屏幕
								const cur = t.getBoundingClientRect();
								const curML = parseFloat(getComputedStyle(t).marginLeft) || 0;
								const ml = Math.round(curML + (cr0.left - cur.left)) + "px";
								if (t.style.marginLeft !== ml) t.style.marginLeft = ml;
								if (t.style.marginRight !== "0px") t.style.marginRight = "0px";
							// 条目下间距统一 4px（排序间距目标，2026-08-20）
							if (t.style.marginBottom !== "0px") t.style.marginBottom = "0px";
							} else {
								if (t.style.marginLeft !== "0px") t.style.marginLeft = "0px";
								// pin inner to card width so the colored bg edges match the card
								if (t.style.width !== cardW) t.style.width = cardW;
								if (t.style.marginRight !== "0px") t.style.marginRight = "0px";
							}
						}
					}
				}
			}
			// match the input card's width and center on the same axis (the
			// host centers its children); recomputed per pass so sidebar
			// toggles re-align. Margin auto beats pixel math when the card
			// overflows the host's content box.
			if (card !== null) {
				// 与通用 pass / queue-dock 同一收敛式：按当前实测误差自校正到
				// 输入卡左缘（相对公式在行已有 margin 残留时双重偏移）。
				const cr = card.getBoundingClientRect();
				const w = Math.round(cr.width) + "px";
				if (row.style.width !== w) row.style.width = w;
				const rowCur = row.getBoundingClientRect();
				const rowML = parseFloat(getComputedStyle(row).marginLeft) || 0;
				const ml = Math.round(rowML + (cr.left - rowCur.left)) + "px";
				if (row.style.marginBottom !== "0px") row.style.marginBottom = "0px";
				if (row.style.marginLeft !== ml) row.style.marginLeft = ml;
				// breathing room under the queue dock when one is open above
				// (no gap when the row is the composer's first element)
				const prev = row.previousElementSibling;
				const top = prev !== null ? "4px" : "0px";
				if (row.style.marginTop !== top) row.style.marginTop = top;
				// 排队条几何由 dsh-queue-dock 插件独占钉死（左缘差值+宽度
				// 双钉死，margin 0 0 8px）；此处不再写入，避免第三个写入者
				// 的 margin 简写清掉已钉好的 marginLeft
			}
		}

		/** Real link health for the model trigger's dot, driven by the actual
		 * /api/respond outcomes (hooked fetch): green = ok, orange = degraded
		 * (429 / slow / single failure), red = circuit-broken (≥2 consecutive
		 * failures or auth rejection). The provider's account status floors it. */
		const health = { state: "green", detail: "尚无请求", consecutiveFailures: 0 };

		function setHealth(state, detail) {
			health.state = state;
			health.detail = detail;
			if (state === "green") health.consecutiveFailures = 0;
			renderHealthDot();
		}

		function renderHealthDot() {
			const dot = document.getElementById("dshc-health-dot");
			if (dot === null) return;
			const colors = { green: "#46a06e", orange: "#e0a03c", red: "#e85443" };
			const labels = { green: "正常", orange: "降级", red: "熔断" };
			let state = health.state;
			let detail = health.detail;
			// provider account trouble floors the live state at orange
			if (state === "green" && modelRingProviderStatus !== null && modelRingProviderStatus !== "ok") {
				state = "orange";
				detail = "供应商状态：" + modelRingProviderStatus;
			}
			dot.style.background = colors[state] ?? colors.green;
			dot.dataset.state = state;
			dot.title = "连接健康：" + (labels[state] ?? "正常") + " · " + detail;
		}

		let modelRingProviderStatus = null;

		function hookRespondFetch() {
			if (window.__dshcFetchHooked === true) return;
			window.__dshcFetchHooked = true;
			const originalFetch = window.fetch.bind(window);
			window.fetch = (input, init) => {
				const url = typeof input === "string" ? input : input?.url ?? "";
				if (!url.includes("/api/respond")) return originalFetch(input, init);
				const startedAt = Date.now();
				return originalFetch(input, init).then(
					(res) => {
						if (res.status === 429) setHealth("orange", "限流（429）");
						else if (res.status === 401 || res.status === 403) setHealth("red", "认证失败（" + res.status + "）");
						else if (res.status >= 500) {
							health.consecutiveFailures += 1;
							setHealth(health.consecutiveFailures >= 2 ? "red" : "orange", "服务错误（" + res.status + "）×" + health.consecutiveFailures);
						} else if (res.ok) {
							const seconds = (Date.now() - startedAt) / 1000;
							if (seconds > 45) setHealth("orange", "响应缓慢 " + seconds.toFixed(0) + "s");
							else setHealth("green", "最近请求 " + seconds.toFixed(1) + "s");
						}
						return res;
					},
					(error) => {
						health.consecutiveFailures += 1;
						setHealth(health.consecutiveFailures >= 2 ? "red" : "orange", "网络错误 ×" + health.consecutiveFailures);
						throw error;
					},
				);
			};
		}

		/** Two rings before the model name in the composer's model trigger:
		 * subscription providers → [5h window usage][time-to-reset]; balance
		 * providers → the remaining ¥. Data resolution mirrors the badge
		 * widget (same loopback routes, current model → provider). */
		const MODEL_WINDOW_MS = 5 * 3_600_000;
		let modelRingsEl = null;
		let modelRingsAt = 0;
		let modelRingMode = null;
		let modelRingUsed = 0;
		let modelRingResetAt = null;
		let modelRingBalance = null;
		let modelRingHit = null;

		function mountModelRings() {
			const button = document.querySelector('button[aria-haspopup="menu"][aria-label^="选择模型，当前"]');
			if (button === null) { modelRingsEl = null; return; }
			const host = button.parentElement;
			if (host === null) return;
			// own zone: a sibling BEFORE the model button, side by side — the
			// trigger root is block layout, so flex it when it only holds these two
			if (modelRingsEl !== null && modelRingsEl.isConnected && modelRingsEl.parentElement === host && modelRingsEl.nextElementSibling === button) return;
   // PATCH: React rebuilds the host on switches; stale rings/dots ACCUMULATE.
   const keepDot = document.getElementById("dshc-health-dot");
   for (const stale of host.querySelectorAll("#dshc-model-rings, #dshc-health-dot")) {
     if (stale !== modelRingsEl && stale !== keepDot) stale.remove();
   }
			// health dot as a sibling BEFORE the rings — never inside the React-
			// managed trigger: a foreign FIRST child shifts React's child indices
			// and breaks model switching / the picker menu
			let dot = document.getElementById("dshc-health-dot");
			if (dot === null || dot.parentElement !== host) {
				dot = document.createElement("span");
				dot.id = "dshc-health-dot";
				dot.style.cssText = "width:7px;height:7px;border-radius:50%;flex:none;";
				host.insertBefore(dot, host.firstChild);
			}
			modelRingsEl = document.createElement("span");
			modelRingsEl.id = "dshc-model-rings";
			modelRingsEl.style.cssText = "";
			host.insertBefore(modelRingsEl, button);
			dot.style.marginRight = "6px";
			host.style.display = "flex";
			host.style.alignItems = "center";
			host.style.gap = "6px";
			syncRingTexture();
			modelRingsAt = 0;
			renderModelRings();
			void refreshModelRings();
		}

		async function refreshModelRings() {
			const now = Date.now();
			if (now - modelRingsAt < 30_000) return;
			modelRingsAt = now;
			if (modelRingsEl === null || !modelRingsEl.isConnected) return;
			try {
				const modelName = currentModelName();
				const [usageRes, providersRes] = await Promise.all([
					fetchJson("/api/usage-stats/usage"),
					fetchJson("/api/usage-stats/providers"),
				]);
				if (usageRes.ok !== true || providersRes.ok !== true) return;
				const days = usageRes.days ?? [];
				const family = modelName !== null ? modelName.split("-")[0] : null;
				// scan newest-first across days: a model switched to mid-day has
				// no usage yet today, but its provider resolves from any history
				let entry;
				let familyEntry;
				for (const d of [...days].reverse()) {
					const models = d.models ?? [];
					if (entry === undefined && modelName !== null) {
						entry = models.find((m) => m.model.toLowerCase().endsWith("/" + modelName))
							?? models.find((m) => m.model.toLowerCase().includes(modelName));
					}
					if (familyEntry === undefined && family !== null) {
						familyEntry = models.find((m) => (m.model.split("/")[1] ?? "").toLowerCase().startsWith(family));
					}
					if (entry !== undefined) break;
				}
				entry ??= familyEntry;
				modelRingHit = Number.isFinite(entry?.cacheHitRate) ? entry.cacheHitRate : null;
				if (entry === undefined) {
					// usage still folding after a host restart, or a brand-new
					// model: render the neutral placeholder (dot + dim ring) and
					// retry on the next tick rather than falling back to an
					// unrelated provider's balance. 绝不能只清空——活跃会话频繁
					//重建按钮，空白态会永远刷不掉（2026-08-19 桌面端圆环消失事故）
					modelRingsAt = 0;
					modelRingMode = "none";
					renderModelRings();
					return;
				}
				const providerId = entry.model.split("/")[0];
				const providers = providersRes.providers ?? [];
				// "-vision" 等后缀变体（zai-coding-cn-vision）的用量条目：provider
				// 表里只有基座 id，endsWith 匹配不上（2026-08-19 三环消失末环），
				// 前缀匹配兜底
				const matched = providers.find((p) => p.id === providerId)
					?? providers.find((p) => providerId.startsWith(p.id) || providerId.endsWith(p.id));
				const target = matched?.id ?? null;
				if (target === null) return;
				modelRingProviderStatus = matched?.status ?? null;
				const res = await fetchJson("/api/usage-stats/account?provider=" + encodeURIComponent(target));
				if (res.ok !== true) return;
				const account = res.account;
				// real reachability check (host→provider, token-free): floors or
				// confirms the dot — this is the "check on model switch" path
				if (account.status !== undefined && account.status !== "ok") setHealth("orange", "供应商状态：" + account.status);
				else if (health.state === "green") setHealth("green", "供应商可达");
				if (account.mode === "balance") {
					modelRingMode = "balance";
					modelRingBalance = Number.isFinite(account.alert?.value) ? account.alert.value : null;
				} else {
					modelRingMode = "subscription";
					const window = (account.windows ?? []).find((w) => w.kind === "session") ?? null;
					modelRingUsed = window?.usedPercent ?? 0;
					modelRingResetAt = window?.resetsAt ?? null;
				}
				renderModelRings();
			} catch { /* keep the previous render */ }
		}

		function renderModelRings() {
			if (modelRingsEl === null || !modelRingsEl.isConnected) return;
			renderHealthDot();
			// 数据未就绪（新模型/宿主重启后用量折叠中）：占位环常驻，绝不空白
			if (modelRingMode !== "balance" && modelRingMode !== "subscription") {
				modelRingsEl.innerHTML = '<span title="用量数据载入中" style="font-size:10px;color:var(--dsw-alias-label-tertiary)">◌</span>';
				return;
			}
			const hitRing = modelRingHit !== null
				? '<span title="今日缓存命中率 ' + modelRingHit.toFixed(1) + '%">' + ringSvg(modelRingHit, "#46a06e") + modelRingHit.toFixed(1) + "%</span>"
				: "";
			if (modelRingMode === "balance") {
				modelRingsEl.innerHTML = (modelRingBalance !== null
					? '<span title="当前供应商余额 ¥' + modelRingBalance + '" style="font-size:11px;color:var(--dsw-alias-label-secondary)">¥' + modelRingBalance + "</span>"
					: "") + hitRing;
				return;
			}
			if (modelRingMode !== "subscription") return;
			let remainLabel = "";
			let remainMs = 0;
			if (modelRingResetAt !== null) {
				remainMs = new Date(modelRingResetAt).getTime() - Date.now();
				const minutes = Math.max(0, Math.round(remainMs / 60_000));
				remainLabel = Math.floor(minutes / 60) + ":" + String(minutes % 60).padStart(2, "0");
			}
			const resetAt = modelRingResetAt !== null
				? new Date(modelRingResetAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
				: "";
			// one button zone, three rings in distinct hues; mid-saturation
			// colors stay legible on both light and dark themes
			const usageColor = modelRingUsed >= 95 ? "#e85443" : "#4a90d9";
			let html = '<span title="5 小时窗口用量 ' + modelRingUsed.toFixed(1) + '%'
				+ (resetAt !== "" ? "，重置于 " + resetAt : "") + '">'
				+ ringSvg(modelRingUsed, usageColor) + modelRingUsed.toFixed(1) + "%</span>";
   if (remainLabel !== "") {
				// countdown ring: the remaining fraction depletes toward reset
				const remainingPct = Math.min(100, Math.max(0, (remainMs / MODEL_WINDOW_MS) * 100));
				html += '<span title="距重置还有 ' + remainLabel + "（5 小时窗口"
					+ (resetAt !== "" ? "，重置于 " + resetAt : "") + '）">'
					+ ringSvg(remainingPct, "#e0a03c") + remainLabel + "</span>";
			}
			modelRingsEl.innerHTML = html + hitRing;
		}

		/** Copy the context-length ring trigger's computed texture (gradient,
		 * inset highlight, shadow) so the bar matches in every theme. */
		function syncRingTexture() {
			if (modelRingsEl === null || !modelRingsEl.isConnected) return;
			const trigger = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? "").startsWith("上下文"));
			if (trigger === undefined) return;
			const cs = getComputedStyle(trigger);
			if (cs.backgroundImage !== modelRingsEl.style.backgroundImage) modelRingsEl.style.backgroundImage = cs.backgroundImage;
			if (cs.boxShadow !== modelRingsEl.style.boxShadow) modelRingsEl.style.boxShadow = cs.boxShadow;
		}

		/** Show the context ring's percentage as text inside the official
		 * context trigger (parsed from its aria-label, kept in sync). */
		function patchContextPercent() {
			const trigger = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? "").startsWith("上下文已用"));
			if (trigger === undefined) return;
			const match = trigger.getAttribute("aria-label")?.match(/上下文已用\s*(\d+)%/);
			if (match === null || match === undefined) return;
			let label = document.getElementById("dshc-ctx-pct");
			if (label === null || label.parentElement !== trigger) {
				label = document.createElement("span");
				label.id = "dshc-ctx-pct";
				label.style.cssText = "font-size:10px;line-height:1;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;margin-left:3px;";
				trigger.appendChild(label);
			}
			const text = match[1] + "%";
			if (label.textContent !== text) label.textContent = text;
  // PATCH: threshold colors — >80% red, >=50% orange, else green
  const pct = Number(match[1]);
  const ctxColor = pct > 80 ? "#e85443" : pct >= 50 ? "#e0a03c" : "#46a06e";
  const ctxSvg = trigger.querySelector("svg circle") ;
  if (ctxSvg !== null && ctxSvg.getAttribute("stroke") !== ctxColor) ctxSvg.setAttribute("stroke", ctxColor);
  if (label.style.color !== ctxColor) label.style.color = ctxColor;
		}

		function mountWidget() {
			const badge = document.querySelector(".usg_layer:not(.usg_rail) .usg_badge");
			if (badge === null) return false;
			if (badge.querySelector("#" + WIDGET_ID) !== null) return true;
			const widget = document.createElement("div");
			widget.id = WIDGET_ID;
			widget.innerHTML = '<div class="dshc-row"><span class="dshc-dim">…</span></div><div class="dshc-row2">…</div>';
			badge.appendChild(widget);
			void refreshWidget();
			return true;
		}

		let refreshInFlight = false;
		let refreshQueued = false;
		let lastModel = null;
		async function refreshWidget() {
			if (refreshInFlight) { refreshQueued = true; return; }
			refreshInFlight = true;
			try {
				const rows = await buildRows();
				const widget = document.getElementById(WIDGET_ID);
				if (widget !== null) {
					widget.innerHTML = '<div class="dshc-row">' + rows.row1 + '</div><div class="dshc-row2">' + rows.row2 + "</div>";
				}
			} catch { /* keep the previous render */ }
			finally {
				refreshInFlight = false;
				// A refresh requested mid-flight (e.g. the model trigger rendered
				// after mount) must not be dropped — run it trailing.
				if (refreshQueued) { refreshQueued = false; void refreshWidget(); }
			}
		}

		function apply(ctx) {
			// One-time migration: better-sidebar's old default width (360) was
			// wider than the official left sidebar; the new default floors at 280.
			try {
				for (const key of Object.keys(localStorage)) {
					if (!key.startsWith("dsh-sidebar:v1:")) continue;
					const value = JSON.parse(localStorage.getItem(key));
					if (value !== null && typeof value === "object" && value.width === 360) {
						value.width = 280;
						localStorage.setItem(key, JSON.stringify(value));
					}
				}
			} catch {}

			hookRespondFetch();
			const style = document.createElement("style");
			style.textContent = STYLE_TEXT;
			document.head.appendChild(style);

			const COMMANDS = ["minimize", "maximize", "close"];

			function wire() {
				const buttons = document.querySelectorAll(".EGn-AW_retroTitlebarBtn");
				buttons.forEach((button, index) => {
					if (button.dataset.dshChromeWired === "1") return;
					button.dataset.dshChromeWired = "1";
					button.title = COMMANDS[index] ?? "";
					button.addEventListener("click", () => {
						const command = COMMANDS[index];
						const bridge = window.dshDesktop;
						if (command !== undefined && bridge !== undefined) bridge.windowCommand(command);
					});
				});
			}

			wire();
			mountWidget();
			wrapDayBars();
			widenConversation();
			// The skin and the usage plugin re-render their DOM after this module
			// loads; keep wiring and the widget mounted, idempotently.
			// Streaming mutates the DOM constantly; the heavy passes (document
			// walks) are coalesced so the main thread stays free for the app's
			// own fetches — a per-mutation walk starved them into "Failed to
			// fetch" timeouts.
			let observerTimer = 0;
			/** Keep --dshc-sidebar-w in sync with the live sidebar width so the
			 * usage panel (.usg_panel) can match it. Writes only on change; the
			 * var lives on <html> (outside the body observer's subtree). */
			const syncSidebarWidthVar = () => {
				const col = document.querySelector('[class*="_sidebarCol"]');
				let w = col !== null ? col.getBoundingClientRect().width : 0;
				if (!(w >= 200)) w = 280; // collapsed rail / missing → sane default
				const val = Math.round(w) + "px";
				if (document.documentElement.style.getPropertyValue("--dshc-sidebar-w") !== val) {
					document.documentElement.style.setProperty("--dshc-sidebar-w", val);
				}
			};
			const runHeavyPatches = () => {
				observerTimer = 0;
				for (const patch of [wrapDayBars, placeGoalGitRow, widenConversation, patchStatsLine, ensureStatsSegment, patchCompactNumbers, mountModelRings, syncRingTexture, patchContextPercent, syncSidebarWidthVar]) {
					try { patch(); } catch (error) { console.warn("dshc:", patch.name, error?.message ?? error); }
				}
				if (document.querySelector(".usg_panel") !== null) void patchPanelStats();
				const model = currentModelName();
				if (model !== lastModel) {
					lastModel = model;
					modelRingsAt = 0;
					void refreshWidget();
					void refreshModelRings();
				}
			};
			const observer = new MutationObserver(() => {
				wire();
				mountWidget();
				if (observerTimer === 0) observerTimer = window.setTimeout(runHeavyPatches, 300);
			});
			observer.observe(document.body, { childList: true, subtree: true });
			const timer = window.setInterval(() => void refreshWidget(), REFRESH_MS);
			// 顶部 chips 定位依赖实时几何（toggleCluster/会话区右缘），mutation
			// observer 只看 childList，纯位置变化不触发——1s 低频重算兜底。
			let placeErrStreak = 0;
			const chipsTimer = window.setInterval(() => {
				try { placeGoalGitRow(); placeErrStreak = 0 } catch (e) {
					/* 布局中途的瞬态常见，但持续性失败不能静默——首错详记、其后每 20 次摘要 */
					placeErrStreak++;
					if (placeErrStreak === 1 || placeErrStreak % 20 === 0) console.warn('[dshc-align] pass failed (' + placeErrStreak + '):', e && e.message ? e.message : e);
				}
			}, 1000);
			const statsTimer = window.setInterval(() => void updateStatsTotals(), 60_000);
			const ringsTimer = window.setInterval(() => { renderModelRings(); void refreshModelRings(); }, 30_000);

			ctx.effect(() => () => {
				observer.disconnect();
				if (observerTimer !== 0) window.clearTimeout(observerTimer);
				window.clearInterval(timer);
				window.clearInterval(chipsTimer);
				window.clearInterval(statsTimer);
				window.clearInterval(ringsTimer);
				document.getElementById(WIDGET_ID)?.remove();
				document.getElementById("dshc-top-chips")?.remove();
				style.remove();
			}, "desktop-chrome: window chrome + usage widget");
		}
		exports.apply = apply;
		return module.exports;
	},
});
