/**
 * dsh-bocha-search — browser half (standard paradigm v1, bilingual).
 *
 * Statusbar cell appended AFTER the live-stats TPS line ([data-dsh-live-tps]).
 * Click the cell → floating settings panel: apiKey (write-only, blank keeps
 * the stored key), baseURL, totalCalls, current count (editable), reset.
 * Data via this plugin's own host routes (/dsh-local/bocha-search/*).
 */
/* global window, document, MutationObserver */
window.__ModuleLoader__.load({
  id: "dsh-bocha-search",
  factory: function () {
    "use strict";
    var CELL_ID = "dsh-bocha-cell";
    var PANEL_ID = "dsh-bocha-panel";
    var POLL_MS = 60_000;

    var STRINGS = {
      zh: {
        prefix: "搜索 ",
        tip: "搜索用量 · 更新于 ",
        settings: "搜索设置",
        apiKey: "API Key",
        apiKeySet: "已配置——留空保留原 Key",
        apiKeyUnset: "未配置",
        baseURL: "API 地址",
        totalCalls: "总条数",
        count: "目前条数",
        save: "保存",
        cancel: "取消",
        reset: "计数归零",
        saved: "已保存",
        resetDone: "已归零",
        close: "关闭"
      },
      en: {
        prefix: "Search ",
        tip: "Search usage · updated ",
        settings: "Search Settings",
        apiKey: "API Key",
        apiKeySet: "Configured — leave blank to keep",
        apiKeyUnset: "Not configured",
        baseURL: "API Base URL",
        totalCalls: "Total calls",
        count: "Current count",
        save: "Save",
        cancel: "Cancel",
        reset: "Reset count",
        saved: "Saved",
        resetDone: "Reset done",
        close: "Close"
      }
    };
    function detectLang() {
      if (document.querySelector('[aria-label="导入会话"]')) return "zh";
      if (document.querySelector('[aria-label="Import Sessions"]')) return "en";
      return null;
    }
    function S() { return STRINGS[detectLang() === "en" ? "en" : "zh"]; }

    var CSS = [
      "#" + CELL_ID + "{box-sizing:border-box;display:inline-flex;align-items:center;gap:2px;margin:0 0 0 6px;padding:0;transform:translateY(-1px);font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary,#888);font-variant-numeric:tabular-nums;white-space:nowrap;user-select:none;cursor:pointer;}",
      "#" + CELL_ID + ":hover{color:var(--dsw-alias-label-secondary,#666);}",
      "#dshc-model-rings{margin-right:0 !important;gap:4px !important;padding:2px 8px !important;}",
      "div:has(> #dshc-health-dot){gap:6px !important;row-gap:6px !important;}",
      "span[title]{margin:0 2px !important;}",
      "#" + CELL_ID + "[data-warn]{color:var(--dsh-warn,#d97706);}",
      "#" + PANEL_ID + "{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483200;width:340px;max-width:calc(100vw - 32px);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base,#fff));border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.25);padding:16px;font-size:13px;color:var(--dsw-alias-label-primary,#222);display:flex;flex-direction:column;gap:10px;}",
      "#" + PANEL_ID + " .bocha-title{font-size:14px;font-weight:600;margin:0;}",
      "#" + PANEL_ID + " .bocha-row{display:flex;flex-direction:column;gap:4px;}",
      "#" + PANEL_ID + " .bocha-label{font-size:12px;color:var(--dsw-alias-label-secondary,#666);}",
      "#" + PANEL_ID + " .bocha-label small{color:var(--dsw-alias-label-tertiary,#999);font-weight:400;}",
      "#" + PANEL_ID + " input{box-sizing:border-box;width:100%;height:30px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:inherit;padding:0 10px;font-size:13px;outline:none;}",
      "#" + PANEL_ID + " input:focus{border-color:var(--dsw-alias-state-business-primary,#2563eb);}",
      "#" + PANEL_ID + " .bocha-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:4px;}",
      "#" + PANEL_ID + " button{cursor:pointer;border:none;border-radius:8px;font-size:13px;padding:6px 14px;}",
      "#" + PANEL_ID + " .bocha-primary{background:var(--dsw-alias-state-business-primary,#2563eb);color:#fff;}",
      "#" + PANEL_ID + " .bocha-ghost{background:transparent;color:var(--dsw-alias-label-secondary,#666);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));}",
      "#" + PANEL_ID + " .bocha-status{font-size:12px;color:var(--dsw-alias-label-tertiary,#999);min-height:16px;}",
      "#" + PANEL_ID + " .bocha-close{position:absolute;top:10px;right:10px;background:transparent;color:var(--dsw-alias-label-tertiary,#999);padding:2px 8px;font-size:15px;}",
    ].join("");
    function injectCss() {
      if (document.querySelector("style[data-dsh-bocha-search]")) return;
      var tag = document.createElement("style");
      tag.setAttribute("data-dsh-bocha-search", "1");
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    var data = null; // { baseURL, totalCalls, hasApiKey, count, updatedAt }

    function ensureCell() {
      // Anchor: right AFTER the connection-health green dot (desktop-chrome's
      // #dshc-health-dot, in the stats row). Fallback: after the TPS line when
      // the dot is absent (different view / desktop-chrome not loaded).
      // Re-insert whenever React re-rendering moved/removed the cell — write
      // only on position change (observer loop safety, see renderCell).
      var dot = document.getElementById("dshc-health-dot");
      var anchor, anchorParent;
      if (dot !== null && dot.isConnected && dot.parentElement !== null) {
        anchor = dot;
        anchorParent = dot.parentElement;
      } else {
        var tps = document.querySelector("[data-dsh-live-tps]");
        if (tps === null || tps.parentElement === null) return null;
        anchor = tps;
        anchorParent = tps.parentElement;
      }
      var cell = document.getElementById(CELL_ID);
      if (cell !== null && cell.isConnected
          && cell.parentElement === anchorParent
          && cell.previousElementSibling === anchor) return cell;
      if (cell === null) {
        cell = document.createElement("span");
        cell.id = CELL_ID;
        cell.setAttribute("data-dsh-bocha-search", "1");
        cell.addEventListener("click", openPanel);
      }
      anchorParent.insertBefore(cell, anchor.nextSibling);
      return cell;
    }

    function renderCell() {
      var cell = ensureCell();
      if (cell === null || data === null) return;
      var s = S();
      var total = data.totalCalls;
      var used = Math.round((data.count / total) * 100);
      // ⚠️ Write ONLY on change: this runs inside a MutationObserver on
      // document.body — an unconditional textContent write replaces the text
      // node, fires the observer again, and freezes the page in an infinite
      // microtask loop.
      var next = s.prefix + data.count + "/" + total;
      if (cell.textContent !== next) cell.textContent = next;
      var nextTitle = s.tip + (data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString() : "");
      if (cell.title !== nextTitle) cell.title = nextTitle;
      if (used >= 90) { if (cell.getAttribute("data-warn") !== "1") cell.setAttribute("data-warn", "1"); }
      else cell.removeAttribute("data-warn");
    }

    function closePanel() {
      var p = document.getElementById(PANEL_ID);
      if (p) p.remove();
    }

    function openPanel() {
      closePanel();
      var s = S();
      var p = document.createElement("div");
      p.id = PANEL_ID;

      function row(label, inputEl, hint) {
        var r = document.createElement("div");
        r.className = "bocha-row";
        var l = document.createElement("span");
        l.className = "bocha-label";
        l.textContent = label;
        if (hint) {
          var sm = document.createElement("small");
          sm.textContent = " · " + hint;
          l.appendChild(sm);
        }
        r.appendChild(l);
        r.appendChild(inputEl);
        return r;
      }

      var title = document.createElement("h3");
      title.className = "bocha-title";
      title.textContent = s.settings;

      var close = document.createElement("button");
      close.className = "bocha-close";
      close.textContent = "\u00D7";
      close.title = s.close;
      close.addEventListener("click", closePanel);

      var apiKey = document.createElement("input");
      apiKey.type = "password";
      apiKey.placeholder = data && data.hasApiKey ? s.apiKeySet : s.apiKeyUnset;
      var apiKeyRow = row(s.apiKey, apiKey);

      var baseURL = document.createElement("input");
      baseURL.type = "text";
      baseURL.value = data ? data.baseURL : "";
      var baseRow = row(s.baseURL, baseURL);

      var total = document.createElement("input");
      total.type = "number";
      total.min = "1";
      total.value = data ? data.totalCalls : 2000;
      var totalRow = row(s.totalCalls, total);

      var count = document.createElement("input");
      count.type = "number";
      count.min = "0";
      count.value = data ? data.count : 0;
      var countRow = row(s.count, count);

      var status = document.createElement("div");
      status.className = "bocha-status";

      var actions = document.createElement("div");
      actions.className = "bocha-actions";
      var resetBtn = document.createElement("button");
      resetBtn.className = "bocha-ghost";
      resetBtn.textContent = s.reset;
      resetBtn.addEventListener("click", async function () {
        try {
          var res = await fetch("/dsh-local/bocha-search/reset", { method: "POST" });
          if (res.ok) { status.textContent = s.resetDone; count.value = "0"; await refresh(); }
        } catch (e) { status.textContent = String(e); }
      });
      var cancelBtn = document.createElement("button");
      cancelBtn.className = "bocha-ghost";
      cancelBtn.textContent = s.cancel;
      cancelBtn.addEventListener("click", closePanel);
      var saveBtn = document.createElement("button");
      saveBtn.className = "bocha-primary";
      saveBtn.textContent = s.save;
      saveBtn.addEventListener("click", async function () {
        try {
          var body = {
            baseURL: baseURL.value.trim(),
            totalCalls: parseInt(total.value, 10) || 0,
            count: parseInt(count.value, 10)
          };
          if (apiKey.value !== "") body.apiKey = apiKey.value.trim();
          var res = await fetch("/dsh-local/bocha-search/config", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body)
          });
          if (res.ok) { status.textContent = s.saved; await refresh(); }
        } catch (e) { status.textContent = String(e); }
      });
      actions.appendChild(resetBtn);
      actions.appendChild(cancelBtn);
      actions.appendChild(saveBtn);

      p.appendChild(title);
      p.appendChild(close);
      p.appendChild(apiKeyRow);
      p.appendChild(baseRow);
      p.appendChild(totalRow);
      p.appendChild(countRow);
      p.appendChild(status);
      p.appendChild(actions);
      document.body.appendChild(p);
    }

    async function refresh() {
      try {
        var res = await fetch("/dsh-local/bocha-search/config", { cache: "no-store" });
        if (res.ok) {
          data = await res.json();
          renderCell();
        }
      } catch (e) { /* host route not up yet; next poll retries */ }
    }

    function apply() {
      injectCss();
      renderCell();
      // ⚠️ DEBOUNCED observer (300ms) — mandatory. The cell lives inside a
      // React-reconciled stats row; React displaces it, we re-insert, React
      // reacts again. Without the setTimeout break this war runs as an
      // infinite microtask cascade and FREEZES the page.
      var obsTimer = 0;
      new MutationObserver(function () {
        if (obsTimer !== 0) return;
        obsTimer = window.setTimeout(function () {
          obsTimer = 0;
          try { injectCss(); renderCell(); } catch (e) { /* never throw */ }
        }, 300);
      }).observe(document.body, { childList: true, subtree: true });
      void refresh();
      window.setInterval(function () { void refresh(); }, POLL_MS);
    }
    // ⚠️ MODULE LOADER CONTRACT — DO NOT REMOVE: the factory must return a
    // plugin object with an `apply` method. `exports` does NOT exist in this
    // scope — build the module object explicitly.
    var module = { exports: {} };
    module.exports.apply = apply;
    return module.exports;
  },
});
