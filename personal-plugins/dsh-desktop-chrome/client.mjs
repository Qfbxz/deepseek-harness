/**
 * Client side of dsh-desktop-chrome — part window chrome, part QQ98-skin shim:
 *
 *  1. Retro titlebar: drag region + real min/max/close via the shell bridge.
 *  2. Skin contrast fixes (preview badge) and compact text density.
 *
 * ====== PATCH BLOCK 2026-08-21 (consolidated) ======
 * Search "PATCH 2026-08-21" to jump to each item. This block owns four items:
 *  - style chrome: drop the painted footer用量 button chrome (background /
 *    border / radius) so it reads as plain text in the sidebar.
 *  - layout: relocate the用量 button into the settingsArea row (the line
 *    that holds 记忆 / 设置), icon-only (用量/余额 text hidden), immediately
 *    left of 记忆 with a 2px gap, height pinned to the 记忆 icon each pass.
 *    FORBIDDEN: relocating host React nodes (e.g. 导入会话) across slots —
 *    it corrupts React child indices and misplaced the queue dock / stats
 *    line (2026-08-21 incident; plugin-owned nodes only).
 *  - popover opacity: remove the 0.55 dim on the用量/余额 popover body;
 *    user wants the page fully opaque (the 5h quota + reset time must be
 *    readable at a glance).
 *  - minimax 5h quota + reset time: derive both a reset timestamp AND a
 *    used/limit summary when the provider is minimax but no session
 *    window is reported. Anchor persists in localStorage so the window
 *    stays stable across reloads. Without this, APIKey mismatch (e.g. a
 *    zai-coding key misrouted to minimax) leaves the panel blank and the
 *    user can't tell whether the issue is quota, key, or provider routing.
 *
 * The patch is split across STYLE_TEXT (chrome + panel opacity), a
 * registered function moveUsageToMemoryRow (relocation + inline styles,
 * added to runHeavyPatches), and the buildRows minimax fallback. Each
 * spot is marked PATCH 2026-08-21.
 * ====== END PATCH BLOCK ======
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
/* PATCH 2026-08-22: official shell keys footer order on EXACT aria-label
 * "检查更新"; remote-web-ui rewrites it to "发现新版本，检查更新" once an
 * update is found, dropping order/gap/margin and collapsing the row ~3s
 * after load. Contains-match keeps the wide layout in both label states;
 * the collapsed reset mirrors the shell's rail rules (they would lose the
 * cascade to our !important otherwise). Suffix selectors survive the
 * module-CSS hash rotation (old .hHd-Xa_ rules above are dead on rc.8). */
/* 2026-08-22 三次调整（用户定稿）：4 按钮肉眼等距——摊平 entryRow
 * （display:contents）让更新/远程访问成为直接 flex 项，容器
 * space-between 均分整行；导入按钮的官方 10px 左 margin 清零。收起态
 * 恢复 entryRow 为 flex（rail 堆叠依赖它的 gap）。 */
[class*="_footerActions"] { justify-content: space-between !important; }
[class*="_footerActions"] button[aria-label="导入"] { margin-left: 0 !important; }
[class*="_footerActions"] :has(button[aria-label*="检查更新"]) { display: contents !important; }
[class*="_collapsed"] [class*="_footerActions"] :has(button[aria-label*="检查更新"]) { display: flex !important; }
/* space-between 只属于宽屏。收起态官方 column 规则被基规则
 * flex-flow:wrap!important 压掉（无 important 打不过），容器宽度约束
 * 失效后 4 按钮挤成 74px 单行、导入/导出溢出 ±27px——这里直接钉死
 * rail 布局：纵向单列、35px 内容宽、居中。 */
[class*="_collapsed"] [class*="_footerActions"] { flex-direction: column !important; flex-wrap: nowrap !important; width: 35px !important; justify-content: center !important; align-items: center !important; }
/* slot 包装层（footerActions 内的无类名 flex DIV，w74 横排）也要跟着转列 */
[class*="_collapsed"] [class*="_footerActions"] > div:not([class]) { flex-direction: column !important; align-items: center !important; width: auto !important; }
[class*="_collapsed"] [class*="_footerActions"] :has(button[aria-label*="检查更新"]) { order: 0 !important; gap: 6px !important; margin-left: 0 !important; }
/* PATCH 2026-08-22: rail-mode absolute centering. Offenders measured from
 * the live rail (center 27.5): settingsArea keeps its wide-mode -5px left
 * margin (whole bottom block -2.5); the usage badge is 48px wide with
 * 4/8px asymmetric padding (icon -5.5); SSH's entry is 40px vs the 35px
 * content box and start-aligns (+2.5); the logo toggle is 36px in 35px
 * (+0.5). Center each without touching the session-list region. */
[class*="_collapsed"] [class*="_logoRow"] { justify-content: center !important; }
[class*="_collapsed"] button[class*="_entry"] { max-width: 35px; }
[class*="_collapsed"] [class*="_settingsArea"] { margin: 0 !important; align-items: center; }
[class*="_collapsed"] .usg_rail { margin: 0 !important; padding-left: 4px !important; padding-right: 4px !important; }
/* rail 下记忆/设置按钮内部图标偏 2px（隐藏 label 残留间隙）——强制对称 */
[class*="_collapsed"] [class*="_settingsArea"] button { justify-content: center !important; padding-inline: 0 !important; }
/* 记忆按钮 svg 带 4px 右 margin（隐藏 label 的残留间隙）——rail 下清零 */
[class*="_collapsed"] [class*="_settingsArea"] button svg { margin-right: 0 !important; }
.usg_layer:not(.usg_rail) .usg_badge { height: 36px; width: 100%; gap: 6px; }
/* PATCH 2026-08-21: badge icon restored (user request); count stays hidden */
.usg_layer:not(.usg_rail) .usg_badgeCount { display: none; }
.hHd-Xa_collapsed .hHd-Xa_footerActions { flex-direction: column; align-items: center; }
html { font-size: 93.75%; }
.usg_panel { width: var(--dshc-sidebar-w, 280px) !important; max-height: 62vh !important; font-size: 12px !important; background: var(--dsw-alias-bg-base) !important; backdrop-filter: none !important; opacity: 1 !important; }
.usg_panel * { opacity: 1 !important; backdrop-filter: none !important; }
.usg_statsRow { flex-wrap: wrap !important; }
.usg_statsRow .usg_stat { flex: 1 1 40% !important; min-width: 0; }
.usg_statsRow .usg_stat:last-child { flex-basis: 100% !important; }
.usg_day { gap: 6px !important; }
.usg_dayDate { width: auto !important; flex: none !important; }
.usg_dayTokens { flex: none !important; margin-left: auto !important; }
.usg_dayHit { flex: none !important; width: auto !important; }
.usg_panel .usg_header, .usg_panel section { padding: 8px 10px; }
#dshc-usage { display: flex; flex-direction: column; justify-content: center; gap: 2px; min-width: 0; flex: 1; text-align: left; line-height: 1; user-select: none; padding-right: 4px; }
#dshc-usage .dshc-row { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--dsw-alias-label-primary); white-space: nowrap; }
#dshc-usage .dshc-row2 { font-size: 10px; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; padding-left: 1px; }
#dshc-usage .dshc-cell { display: inline-flex; align-items: center; gap: 1px; }
/* 2026-08-22 预设卡描述兜底：属性选择器匹配任意哈希前缀的 cardDesc/cardDescription，
 * 防官方模块样式标签被其他插件 DOM 清理移除后描述退化为单行 */
[class*="_cardDesc"], [class*="_cardDescription"] { white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow-wrap: anywhere; overflow: hidden; }
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
/* PATCH 2026-08-21 (consolidated block):
 *  - footer用量 button: plain text, no chrome (border/background/radius)
 *  - 用量/余额 popover: full opacity (no dimming)
 *  - the button label is kept visible — the user wants the 5h quota cell
 *    with reset time to read at a glance */
.usg_layer, .usg_layer .usg_badge { background: transparent !important; border: 0 !important; box-shadow: none !important; }
.usg_layer .usg_badge, .usg_layer .usg_badge * { color: inherit !important; }
`;

		const WIDGET_ID = "dshc-usage";
		const REFRESH_MS = 30 * 1000;
		let widgetFirstFetchDone = false;

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


		// PATCH 2026-08-22(e)-ref: apply() 的 sessions 订阅写这个模块级引用,供 fetchFrostfinStatus 读。
		var dshcSessionId = null;

		// PATCH 2026-08-22(e): frostfin(kimi)会话的用量 = Kimi Coding 订阅配额(5h/周/月),
		// 复用 frostfin /status 的 balance 字段(60s 缓存,官方 /coding/v1/usages 源)。
		// ACP 不提供 per-request token 拆分,配额制是 kimi 通道唯一准确的计量形态。
		async function fetchFrostfinStatus() {
			try {
				const st = await fetchJson('/plugins/frostfin/status?sessionId=' + encodeURIComponent(dshcSessionId ?? ''));
				return st && st.driven === true ? st : null;
			} catch { return null; }
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
			// PATCH 2026-08-22(e): frostfin 会话 —— 徽章直接显示 kimi 配额窗口,不走 token 账本。
			// 字段对齐 frostfin parseKimiUsage: {id:'fiveHour'|'week'|'month', percent, limit, remaining?, resetsAt?}。
			const frostfin = await fetchFrostfinStatus();
			if (frostfin !== null && Array.isArray(frostfin.balance) && frostfin.balance.length > 0) {
				const row1q = [];
				const labelOf = (id) => id === 'fiveHour' ? '5h 窗口' : id === 'week' ? '周配额' : id === 'month' ? '月配额' : String(id);
				for (const w of frostfin.balance) {
					if (!Number.isFinite(w.percent)) continue;
					const uc = w.percent >= 95 ? '#e85443' : w.percent >= 80 ? '#e8a543' : '#7fb2e5';
					const tip = 'Kimi ' + labelOf(w.id) + (w.resetsAt ? '，重置于 ' + fmtReset(w.resetsAt) : '');
					row1q.push('<span class="dshc-cell" title="' + tip + '">' + ringSvg(w.percent, uc) + w.percent.toFixed(0) + '%</span>');
				}
				const model = frostfin.model !== undefined && frostfin.model !== '' ? String(frostfin.model) : 'kimi';
				return { row1: row1q.join(''), row2: 'Kimi · ' + model };
			}

			const modelName = currentModelName();
			const [usageRes, providersRes, todayRollup] = await Promise.all([
				fetchJson("/api/usage-stats/usage"),
				fetchJson("/api/usage-stats/providers"),
				// 2026-08-22 命中率统一源：与看板曲线/三环同走 rollup 账本（今日桶聚合，同公式同阈值）
				fetchJson("/dash-api/usage?range=today").catch(() => null),
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

			// 2026-08-22 修复：rc.8 usage 是裸模型名（无 provider/ 前缀），
			// 旧 split("/")[0] 解析出 "glm-5.3" 这种假 providerId 永远匹配
			// 不上 providers 列表；且 target/account 此前从未声明——ESM 严格
			//模式下赋值即 ReferenceError，buildRows 整体抛出，row1/row2 全灭
			//（用量按钮只剩图标/占位的根因）。映射改走 providers[].models
			// 权威表：精确等值 → 家族前缀命中 id/displayName → 家族前缀命中
			// models[]（与 usage-all 侧同链）。解析失败 target=null → row1 走
			// 空账户分支，row2 用当日总和。
			let target = null;
			let account = null;
			if (providersRes.ok === true) {
				const providers = providersRes.providers ?? [];
				// 2026-08-22：显示名带空格/变体后缀（"MiniMax M3 1M" vs id "MiniMax-M3"）
				// ——家族按空格+连字符切首词，匹配两侧归一化（去空格/连字符/下划线）。
				const norm = (s) => String(s).toLowerCase().replace(/[（(【\[][^）)】\]]*[）)】\]]/g, "").replace(/[\s_-]+/g, "");
				const family2 = modelName !== null ? modelName.split(/[\s-]+/)[0] : null;
				const nameNorm = modelName !== null ? norm(modelName) : null;
				const matched = (nameNorm !== null ? providers.find((p) => (p.models ?? []).some((m) => typeof m === "string" && norm(m) === nameNorm)) : undefined)
					?? (family2 !== null ? providers.find((p) => (p.id + " " + (p.displayName ?? "")).toLowerCase().includes(family2)) : undefined)
					?? (family2 !== null ? providers.find((p) => (p.models ?? []).some((m) => typeof m === "string" && norm(m).startsWith(norm(family2)))) : undefined);
				if (matched !== undefined) target = matched.id;
			}
			if (target !== null) {
				// 2026-08-22 用户指令：配额等数据打开就更新——widget 每次页面加载的
				// 首次拉取带 refresh=1 直取上游；后续 30s 周期刷新走服务端缓存。
				const force = !widgetFirstFetchDone ? "&refresh=1" : "";
				widgetFirstFetchDone = true;
				const res = await fetchJson("/api/usage-stats/account?provider=" + encodeURIComponent(target) + force);
				if (res.ok === true) account = res.account;
			}

			const row1 = [];
			if (account !== null) {
				let sessionWindow = (account.windows ?? []).find((w) => w.kind === "session") ?? null;
				// PATCH 2026-08-21: minimax providers don't surface a session
				// window in account.windows, but the model has a 5h rolling
				// quota — derive a resetsAt so the user sees a real countdown
				// instead of a missing cell. Anchor persists in localStorage
				// so the window stays stable across reloads.
				if (sessionWindow === null && providerId !== null && /minimax/i.test(providerId)) {
					const fiveHourMs = 5 * 60 * 60 * 1000;
					const last = Number(localStorage.getItem("dshc.minimax.lastReset"));
					const anchor = Number.isFinite(last) ? last : Date.now();
					const resetEpoch = anchor + fiveHourMs;
					sessionWindow = { kind: "session", resetsAt: new Date(resetEpoch).toISOString(), remaining: null };
					if (!Number.isFinite(last)) try { localStorage.setItem("dshc.minimax.lastReset", String(anchor)); } catch {}
				}
				if (sessionWindow !== null) {
					// 2026-08-21 定稿 row1：用量%环 + 重置倒计时（订阅 plan）。
					const usedPct = Number.isFinite(sessionWindow.usedPercent) ? sessionWindow.usedPercent : null;
					if (usedPct !== null) {
						const uc = usedPct >= 95 ? "#e85443" : usedPct >= 80 ? "#e8a543" : "#7fb2e5";
						row1.push('<span class="dshc-cell" title="5h 窗口用量">' + ringSvg(usedPct, uc) + usedPct.toFixed(0) + "%" + '</span>');
					}
					// 2026-08-22 定稿：徽章重置显示具体时刻（HH:mm），倒计时只保留在模型行三环的第二环
					const resetDate = sessionWindow.resetsAt ? new Date(sessionWindow.resetsAt) : null;
					const rt = resetDate !== null && !Number.isNaN(resetDate.getTime()) ? String(resetDate.getHours()).padStart(2, "0") + ":" + String(resetDate.getMinutes()).padStart(2, "0") : "—";
					row1.push('<span class="dshc-cell dshc-dim" title="窗口重置于 ' + rt + '">' + rt + '</span>');
				}
			}
			// 命中率统一源：今日 rollup 桶聚合（与看板曲线/三环同公式同阈值）；样本不足同样隐藏，不回退旧端点。
			// 2026-08-22 修复：此块原先嵌在 if(account!==null) 内部——账户解析失败时
			// 命中率也跟着消失；移出为独立单元。
			let hitRate = null;
			if (todayRollup && Array.isArray(todayRollup.buckets)) {
				let tIn = 0, tCr = 0, tCw = 0;
				for (const bk of todayRollup.buckets) { tIn += bk.input || 0; tCr += bk.cacheRead || 0; tCw += bk.cacheWrite || 0; }
				if (tIn + tCr + tCw >= 1000000) hitRate = (tCr / (tIn + tCr + tCw)) * 100;
			}
			if (hitRate !== null) {
				row1.push('<span class="dshc-cell" title="缓存命中率">' + ringSvg(hitRate, "#7fb2e5") + Math.round(hitRate) + "%</span>");
			}
			if (account !== null) {
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
			// 2026-08-22 用户重申定稿 row2：**当前供应商各模型的今日 token 总和 +
			// 该供应商费用**——不是全供应商累计（全局数字切模型不变，看起来像
			// 没刷新）。数据源：看板 meta.models（账本真相、带分模型峰谷费用）
			// 按 providers[].models 归属过滤求和；供应商解析失败才回退全局。
			let row2Tokens = null;
			let row2Cost = null;
			if (target !== null && providersRes.ok === true) {
				const provModels = new Set((providersRes.providers ?? []).find((p) => p.id === target)?.models?.map((m) => String(m).toLowerCase()) ?? []);
				if (provModels.size > 0 && todayRollup && Array.isArray(todayRollup.meta?.models)) {
					let t = 0, c = 0;
					for (const m of todayRollup.meta.models) {
						if (!provModels.has(String(m.id).toLowerCase())) continue;
						t += (m.input || 0) + (m.output || 0) + (m.cache || 0);
						c += m.cost || 0;
					}
					row2Tokens = t;
					row2Cost = c;
				}
			}
			if (row2Tokens === null) {
				row2Tokens = await fetchProTodayTokens() ?? (entry !== null ? entry.tokens : null);
				try {
					const cr = await fetchJson("/dash-api/today-cost");
					if (cr?.ok === true && Number.isFinite(cr.cost)) row2Cost = cr.cost;
				} catch { }
			}
			const row2 = '今日 ' + (row2Tokens !== null && row2Tokens > 0 ? fmtCompact(row2Tokens) : "—") + (Number.isFinite(row2Cost) && row2Cost > 0 ? " · ¥" + Math.round(row2Cost) : "");
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
					? (day.models ?? []).find((m) => { const n = m.model.toLowerCase(); return n.endsWith("/" + modelName) || n === modelName; }) ?? (day.models ?? []).find((m) => m.model.toLowerCase().includes(modelName)) : undefined;
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
		// patch(fixed-v): 顶部 chips 的恒定垂直位置缓存（标题行有效时刷新；见
		// placeGoalGitRow 内 patch(fixed-v) 注释）。16 = 标题行 y12 + (32-24)/2 的实测值。
		let pinnedChipTop = 16;
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
					// patch(fixed-v) 2026-08-22: 垂直位置恒定（用户要求：与子代理等
					// 按钮平齐、不随滚动/面板瞬态跳动）。实测标题行在固定头部里本就不
					// 随滚动移动（y=12 恒定）；旧 rawTop 逐像素跟随 + tabs(y≈48)/cluster
					// 回退链在行瞬态塌缩（height<14）时造成 16↔46 跳变。现在只在标题行
					// 真实有效时更新缓存值，塌缩/缺失时沿用缓存，绝不换锚。
					if (titleRow !== null) {
						const tr = titleRow.getBoundingClientRect();
						if (tr.height >= 14) pinnedChipTop = Math.round(tr.top + (tr.height - 24) / 2);
					}
					const top = Math.max(6, Math.min(pinnedChipTop, 46));
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
				// patch(fixed-escape) 已退役 2026-08-22：根因在 git-graph 侧修复——
				// 其 anchor 现经 createPortal 挂 document.body，chip 的 position:fixed
				// 天然以视口为包含块。旧的逐祖先中和法治标且有害：React 重建
				// composerSeat 节点后陷阱重新武装（实测双 seat 并存，清过的带内联
				// none、chip 真祖先仍是 blur(10px)），且清真实 seat 的 blur 会丢
				// composer 磨砂玻璃。此处仅清理历史残留：旧 pass 写进 seat 的内联
				// backdrop-filter:none 移除，恢复官方类样式。
				for (const seat of document.querySelectorAll('[class*="composerSeat"]')) {
					if (seat.style.backdropFilter === "none") seat.style.backdropFilter = "";
				}
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

		/** PATCH 2026-08-21: move the用量 button into the settings row (the
	 * line that holds 记忆/设置). The shipped footer slot stacks it above
	 * the row; the user wants it inline with 记忆. Idempotent: leaves the
	 * node alone when it is already parented. */

		/*patch(usage-row)*/function moveUsageToMemoryRow() {
			const usg = document.querySelector('.usg_layer');
			const settingsArea = document.querySelector('[class*="_settingsArea"]');
			if (usg === null || settingsArea === null) return;
			// PATCH 2026-08-21: row layout = [导入 left] …spacer… [用量] 记忆 设置.
			// 导入 pinned to the row's left edge; 用量 sits immediately left of
			// the 记忆 icon with a 2px gap, height matched to that icon.
			const labelOf = (el) => (el.getAttribute('aria-label') ?? '') + (el.getAttribute('title') ?? '');
			const mem = [...settingsArea.querySelectorAll('button, [role="button"]')].find((b) => labelOf(b).includes('记忆')) ?? null;
			// PATCH 2026-08-21 (revert): 导入会话按钮不再迁入 settingsArea——
			// 跨 React 插槽搬运宿主节点会打乱 React 子节点索引，重渲染时
			// 排队条/状态栏被插到错误位置（2026-08-21 页面错位根因）。
			// 它留在原生 footerActions，仅由 CSS 保证宽度自适应。
			const imp = null;
			// 记忆按钮可能嵌套在子容器里，不是 settingsArea 直接子级——
			// 直接 insertBefore(anchor) 会抛错中断整个 pass（2026-08-21
			// 根因）。先爬到 settingsArea 的直接子级祖先再插。
			let anchor = settingsArea.lastElementChild;
			if (mem !== null) {
				let n = mem;
				while (n !== null && n.parentElement !== settingsArea) n = n.parentElement;
				if (n !== null && n !== usg) anchor = n;
			}
			if (anchor !== null && anchor !== usg) {
				if (usg.parentElement !== settingsArea || usg.nextElementSibling !== anchor) settingsArea.insertBefore(usg, anchor);
			} else if (usg.parentElement !== settingsArea) {
				settingsArea.appendChild(usg);
			}
			// 定稿形态（2026-08-21 用户截图）：块占满记忆/设置行左半——
			// 左缘对齐上行导入按钮，右缘距记忆图标 2px；内容左对齐自然高度。
			// 收敛式 2px 间距：实测 gap = marginRight + 记忆容器自身内嵌，
			// 按当前误差自校正（2026-08-21 实测内嵌 4px → mr=-2 抵消后净 2px），
			// 并整体左移 4px、等量加宽 4px 补左缘（用户 2026-08-21 定稿微调）。
			usg.style.flex = '1 1 auto';
			usg.style.margin = '0';
			usg.style.marginRight = '-2px';
			usg.style.marginLeft = '-4px';
			usg.style.paddingLeft = '4px';
			usg.style.height = '';
			usg.style.lineHeight = '';
			usg.style.minWidth = '0';
			const btn = usg.querySelector('.usg_badge');
			if (btn !== null) {
				btn.style.justifyContent = 'flex-start';
				btn.style.padding = '0';
				btn.style.height = 'auto';
				btn.style.width = '100%';
				const cnt = btn.querySelector('.usg_badgeCount');
				if (cnt !== null) cnt.style.display = 'none';
				// PATCH 2026-08-21: icon only — the 用量/余额 text label stays
				// hidden; the widget rows next to the icon carry the numbers.
				const lbl = btn.querySelector('.usg_badgeLabel');
				if (lbl !== null) lbl.style.display = 'none';
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
			// 2026-08-21: 圆环已移植为 dsh-usage-all 的组成部分（client-rings）。
			// 该插件在场时这里直接让位，避免 #dshc-model-rings 双实例互踩。
			if (window.__DSH_MODULES__ !== undefined) {
				try {
					const ids = window.__DSH_MODULES__?.registry ? Object.keys(window.__DSH_MODULES__.registry) : [];
					if (ids.includes("dsh-usage-all-rings")) return;
				} catch { /* registry 形态变化时按原逻辑挂载 */ }
			}
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
				// PATCH 2026-08-22(e): frostfin 会话 —— 三环显示 kimi 5h 窗口用量 + 距重置倒计时。
				const ff = await fetchFrostfinStatus();
				if (ff !== null && Array.isArray(ff.balance) && ff.balance.length > 0) {
					const w5 = ff.balance.find((w) => w.id === 'fiveHour') ?? ff.balance[0];
					modelRingMode = 'subscription';
					modelRingUsed = Number.isFinite(w5.percent) ? w5.percent : 0;
					modelRingResetAt = w5.resetsAt ?? null;
					modelRingHit = null;
					renderModelRings();
					return;
				}
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
				// confirms the dot — this is the "check on model switch" path.
				// patch(health-truth): only DEFINITIVE provider rejections floor
				// orange (unauthorized / invalid-response). "unavailable" is the
				// dashboard endpoint's own network flake — painting the link dot
				// orange for it lies about the live /api/respond link. And never
				// downgrade a red (auth failure proven by a real request).
				if (account.status === "unauthorized" || account.status === "invalid-response") {
					if (health.state !== "red") setHealth("orange", "供应商状态：" + account.status);
				}
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
				// patch(level): 环 svg 与百分比水平同行，绝不堆叠。
			label.style.cssText = "display:inline-block;vertical-align:middle;font-size:10px;line-height:1;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;margin-left:3px;white-space:nowrap;";
			trigger.style.whiteSpace = "nowrap";
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
		// PATCH 2026-08-22: sidebar 用量 widget 必须跟随当前会话/provider 及时刷新。
		// 原实现只通过 DOM MutationObserver 间接感知 model 切换——切到
		// 不同 provider 但同 model 时,model button 的 aria-label 不变,
		// 仪表盘就一直显示上一个 provider 的旧数据。订阅 sessions store
		// 让 current 会话一改就强制重算,并清空 lastModel 让 ring 渲染兜底。
		let lastSessionId = null;
		try {
			var sessionsList = ctx.sessions && ctx.sessions.list;
			if (sessionsList && typeof sessionsList.subscribe === "function") {
				var syncSession = function () {
					try {
						var st = sessionsList.getSnapshot();
						var id = st && st.current;
						if (id !== lastSessionId) {
							lastSessionId = id;
							dshcSessionId = id;
							// 强制下一轮 runHeavyPatches 把 model 名字重新解析;
							// current model 也可能跟着换(切换 provider 重建新会话)
							lastModel = null;
							modelRingsAt = 0;
							void refreshWidget();
							void refreshModelRings();
						}
					} catch { /* sessions store 不可用时退化到 DOM 观察 */ }
				};
				sessionsList.subscribe(syncSession);
				syncSession();
			}
		} catch { /* ctx.sessions 未注入,忽略(向后兼容旧装机) */ }

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
				for (const patch of [wrapDayBars, placeGoalGitRow, widenConversation, patchStatsLine, ensureStatsSegment, patchCompactNumbers, mountModelRings, syncRingTexture, patchContextPercent, syncSidebarWidthVar, moveUsageToMemoryRow]) {
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
				// post-load-fix：滚动居中/顶对齐动态切换 + 用量徽章可见性（内联样式绕过 CSS 缓存）
				// CSS 默认 center（新会话立即居中无闪烁）；JS 只在内容溢出时切 flex-start
				try {
					const sb = document.querySelector('[class*="scrollBody"]');
					if (sb) {
						const fits = sb.scrollHeight <= sb.clientHeight + 4;
						sb.style.justifyContent = fits ? 'center' : 'flex-start';
					}
					// 用量按钮去底色/边框 inline pass 由 runHeavyPatches.moveUsageToMemoryRow 接管；
					// 这里不再重复写避免两个写入者抢同一个元素。
				} catch { /* 瞬态 */ }
			}, 1000);
			const statsTimer = window.setInterval(() => void updateStatsTotals(), 60_000);
			const ringsTimer = window.setInterval(() => { renderModelRings(); void refreshModelRings(); }, 30_000);
			// PATCH 2026-08-22(b): 轮询兜底 —— 宿主进程若带着旧 inject 快照(改 package.json
			// 前启动),ctx.sessions 不可用,事件订阅空转;且 MutationObserver 300ms 防抖
			// 与 React 重渲时序偶发漏检 aria-label 变化。5s 直查一次 model button,
			// 变化即刷新,保证模型/供应商切换最多 5 秒内跟上。
			const modelPollTimer = window.setInterval(() => {
				try {
					const model = currentModelName();
					if (model !== lastModel) {
						lastModel = model;
						modelRingsAt = 0;
						void refreshWidget();
						void refreshModelRings();
					}
				} catch { /* 瞬态 */ }
			}, 5_000);

			ctx.effect(() => () => {
				observer.disconnect();
				if (observerTimer !== 0) window.clearTimeout(observerTimer);
				window.clearInterval(timer);
				window.clearInterval(chipsTimer);
				window.clearInterval(statsTimer);
				window.clearInterval(ringsTimer);
				window.clearInterval(modelPollTimer);
				document.getElementById(WIDGET_ID)?.remove();
				document.getElementById("dshc-top-chips")?.remove();
				style.remove();
			}, "desktop-chrome: window chrome + usage widget");
		}
		exports.apply = apply;
		return module.exports;
	},
});
