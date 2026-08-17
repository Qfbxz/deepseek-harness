/**
 * Client side of the Bocha status cell: clones the QQ98 skin's last statusbar
 * cell ("QQ2008 正式版") into a sibling that shows `博查 已用 N 条 · 余 ¥X.XX`,
 * refreshed from the same-origin host route. Re-injects itself if the skin
 * re-renders it away. Script-format module (no ESM syntax), matching the
 * skin's own client bundle contract.
 */
window.__ModuleLoader__.load({
	id: "dsh-bocha-status",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		/** Text of the skin cell we clone styling from. */
		const ANCHOR_TEXT = "QQ2008 正式版";
		/** DOM id of the injected cell. */
		const CELL_ID = "dsh-bocha-status-cell";
		/** Balance poll cadence; the host caches upstream for the same period. */
		const POLL_MS = 5 * 60 * 1000;
		/** DOM re-injection check cadence (the skin re-renders on route changes). */
		const DOM_MS = 5000;
		function apply(ctx) {
			async function refresh() {
				try {
					const response = await fetch("/dsh-local/bocha-balance", { cache: "no-store" });
					if (!response.ok) return;
					render(await response.json());
				}
				catch {
					// A failed poll keeps the last rendered value; the next one retries.
				}
			}
			function render(data) {
				let cell = document.getElementById(CELL_ID);
				if (cell === null) {
					const anchor = [...document.querySelectorAll("body *")]
						.find((el) => el.childElementCount === 0 && el.textContent === ANCHOR_TEXT);
					if (anchor === undefined) return;
					cell = anchor.cloneNode(false);
					cell.id = CELL_ID;
					anchor.after(cell);
				}
				const used = data.count ?? 0;
				cell.textContent = (data.low === true ? "⚠ " : "") + "博查 已用 "
					+ (data.totalCalls !== undefined ? used + "/" + data.totalCalls : used) + " 条";
				cell.title = "Bocha 搜索用量（本机 web_search 计数，不含 argo MCP）· 更新于 "
					+ new Date(data.updatedAt).toLocaleTimeString();
			}
			const pollTimer = setInterval(refresh, POLL_MS);
			const domTimer = setInterval(() => {
				if (document.getElementById(CELL_ID) === null) void refresh();
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
