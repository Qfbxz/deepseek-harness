/**
 * Client side of the Bocha status cell — standard paradigm v1, bilingual.
 *
 * Anchors itself AFTER the live-stats TPS element ([data-dsh-live-tps]) in
 * the composer stats line — no QQ98 skin dependency. Own self-contained
 * styling. Cell text follows the UI language (detected from the sidebar
 * import button's localized aria-label: 导入会话 / Import Sessions).
 * Re-injects itself if React re-renders the stats line away.
 * Script-format module (no ESM syntax).
 */
window.__ModuleLoader__.load({
	id: "dsh-bocha-status",
	factory: () => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		/** Selector of the live-stats TPS element we anchor after. */
		var TPS_SEL = "[data-dsh-live-tps]";
		/** DOM id of the injected cell. */
		var CELL_ID = "dsh-bocha-status-cell";
		/** Balance poll cadence; the host caches upstream for the same period. */
		var POLL_MS = 5 * 60 * 1000;
		/** DOM re-injection / language re-check cadence. */
		var DOM_MS = 5000;

		function detectLang() {
			if (document.querySelector('[aria-label="导入会话"]')) return "zh";
			if (document.querySelector('[aria-label="Import Sessions"]')) return "en";
			return null;
		}

		function ensureCell() {
			var cell = document.getElementById(CELL_ID);
			if (cell !== null && cell.isConnected) return cell;
			var anchor = document.querySelector(TPS_SEL);
			if (anchor === null) return null;
			cell = document.createElement("span");
			cell.id = CELL_ID;
			cell.setAttribute("data-dsh-custom-ui", "bocha");
			cell.style.cssText = [
				"display:inline-flex", "align-items:center", "gap:4px",
				"margin-left:8px", "padding-left:8px",
				"border-left:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35))",
				"font-size:11px", "line-height:1.4",
				"color:var(--dsw-alias-label-tertiary,#888)",
				"font-variant-numeric:tabular-nums",
				"white-space:nowrap", "user-select:none",
			].join(";");
			anchor.parentElement.insertBefore(cell, anchor.nextSibling);
			return cell;
		}

		var lastData = null;
		var lastLang = null;

		function render(data, lang) {
			var cell = ensureCell();
			if (cell === null) return;
			var used = data.count ?? 0;
			var quota = data.totalCalls !== undefined ? used + "/" + data.totalCalls : String(used);
			var warn = data.low === true ? "⚠ " : "";
			var at = new Date(data.updatedAt).toLocaleTimeString();
			if (lang === "en") {
				cell.textContent = warn + "Bocha " + quota + " used";
				cell.title = "Bocha search usage (local web_search count, excl. argo MCP) · updated " + at;
			} else {
				cell.textContent = warn + "博查 已用 " + quota + " 条";
				cell.title = "Bocha 搜索用量（本机 web_search 计数，不含 argo MCP）· 更新于 " + at;
			}
		}

		function apply(ctx) {
			async function refresh() {
				try {
					const response = await fetch("/dsh-local/bocha-balance", { cache: "no-store" });
					if (response.ok) {
						lastData = await response.json();
						lastLang = detectLang();
						render(lastData, lastLang);
						return;
					}
				}
				catch {
					// A failed poll keeps the last rendered value; the next one retries.
				}
				// fetch failed but language may have switched — re-render old data
				var lang = detectLang();
				if (lastData !== null && lang !== null && lang !== lastLang) {
					lastLang = lang;
					render(lastData, lang);
				}
			}
			const pollTimer = setInterval(refresh, POLL_MS);
			const domTimer = setInterval(() => {
				var lang = detectLang();
				if (document.getElementById(CELL_ID) === null) { void refresh(); return; }
				if (lastData !== null && lang !== null && lang !== lastLang) {
					lastLang = lang;
					render(lastData, lang);
				}
			}, DOM_MS);
			void refresh();
			ctx.effect(() => () => {
				clearInterval(pollTimer);
				clearInterval(domTimer);
				document.getElementById(CELL_ID)?.remove();
			}, "bocha-status: statusbar cell");
		}
		exports.apply = apply;
		return module.exports;
	}
});
