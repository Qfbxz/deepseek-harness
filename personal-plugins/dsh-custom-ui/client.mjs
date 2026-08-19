/**
 * dsh-custom-ui — browser half (standard paradigm v1, bilingual zh/en)
 *
 * F1  Session-log capsule → sidebar, beside the import button (grid layout,
 *     clone appended — React-owned nodes are NEVER moved).
 * F2  Hide quota percent row + desktop-chrome 计费周期余量 cell.
 * F4  Electron drag titlebar (dshDesktop bridge present, QQ98 absent).
 * F6  Auto-collapse the empty details column...
 */
/* global window, document, MutationObserver */
/* ⚠️ REWRITE RULE: the factory below MUST end with
 *   var module = {
      try { registerSshCard(ctx); } catch (e) {} exports: {} };
 *   module.exports.apply = function apply() {};
 *   return module.exports;
 * — see the comment at the bottom of the factory. Dropping it kills the UI. */
window.__ModuleLoader__.load({
  id: "dsh-custom-ui",
  factory: function () {
    "use strict";
    var FLAG = "data-dsh-custom-ui";

    //#region i18n
    var IMPORT_LABEL = { zh: "导入会话", en: "Import Sessions" };
    var STRINGS = {
      zh: {
        exportLabel: "导出会话",
        exportTitle: "导出会话（Session ZIP：本会话 + 子会话 + 附件）",
        minimize: "最小化",
        maximize: "最大化/还原",
        close: "关闭"
      },
      en: {
        exportLabel: "Export Session",
        exportTitle: "Export session (Session ZIP: this session + sub-sessions + attachments)",
        minimize: "Minimize",
        maximize: "Maximize/Restore",
        close: "Close",
      }
    };
    function detectLang() {
      if (document.querySelector('[aria-label="' + IMPORT_LABEL.zh + '"]')) return "zh";
      if (document.querySelector('[aria-label="' + IMPORT_LABEL.en + '"]')) return "en";
      return null;
    }
    function stringsOf() {
      return STRINGS[detectLang() === "en" ? "en" : "zh"];
    }
    //#endregion

    //#region CSS (P2)
    var CSS = [
      // F2
      ".usg_quotaValue{display:none !important;}",
      '[title="计费周期余量"]{display:none !important;}',
      // F1: hide the original header capsule (alive for click forwarding)
      "button.nL4_yW_sessionLogButton{display:none !important;}",
      // F1: clone styling
      ".dsh-custom-export{box-sizing:border-box;display:flex;align-items:center;gap:8px;background:transparent;border:none;color:var(--dsw-alias-label-primary);border-radius:12px;padding:6px 8px;min-height:34px;font-size:14px;line-height:22px;font-weight:400;cursor:pointer;justify-content:center;}",
      ".dsh-custom-export:hover{background:var(--dsw-alias-interactive-bg-hover);}",
      ".dsh-custom-export:disabled{opacity:.4;cursor:default;}",
      ".hHd-Xa_collapsed .dsh-custom-export{display:inline-flex !important;width:auto !important;padding:6px !important;justify-content:center !important;}",
      ".hHd-Xa_collapsed .dsh-custom-export > span{display:none !important;}",
      // F3 (grid): expanded — row1 import+export half/half, row2 others x3;
      // collapsed rail — everything stacks in ONE column.
      ".hHd-Xa_footerActions{display:grid !important;grid-template-columns:repeat(6,1fr) !important;gap:2px !important;row-gap:2px !important;}",


      'button[aria-label="移动端远程控制"]{grid-column:3/5 !important;grid-row:2 !important;justify-self:center !important;min-width:44px !important;}',
      '.hHd-Xa_footerActions > button[aria-label="导入会话"],.hHd-Xa_footerActions > button[aria-label="Import Sessions"]{grid-row:1 !important;grid-column:span 3 !important;width:auto !important;min-width:0 !important;margin:0 !important;flex:none !important;align-self:stretch;}',
      ".dsh-custom-export{grid-row:1 !important;grid-column:span 3 !important;align-self:stretch;}",
      '.hHd-Xa_footerActions > *:not(.dsh-custom-export):not(button[aria-label="导入会话"]):not(button[aria-label="Import Sessions"]):not(.usg_layer){grid-row:2 !important;grid-column:2 !important;justify-self:end !important;margin:0 !important;min-width:0 !important;align-self:stretch;}',
      '.hHd-Xa_footerActions > *:not(.dsh-custom-export):not(button[aria-label="导入会话"]):not(button[aria-label="Import Sessions"]):not(.usg_layer) > *{justify-content:center !important;padding:4px !important;min-width:28px !important;box-sizing:border-box;}',
      '.usg_layer:not(.usg_rail){grid-row:2 !important;grid-column:4/7 !important;}',
      ".usg_layer:not(.usg_rail){height:auto !important;min-height:36px;}",
      // collapsed rail: single column stack for ALL six buttons
      ".hHd-Xa_collapsed .hHd-Xa_footerActions{display:flex !important;flex-direction:column !important;align-items:center !important;gap:6px !important;grid-template-columns:none !important;}",
      ".hHd-Xa_collapsed .hHd-Xa_footerActions > *{grid-area:auto !important;width:auto !important;min-width:0 !important;margin:0 !important;}",
      ".hHd-Xa_collapsed .usg_layer:not(.usg_rail){width:auto !important;min-height:32px;height:32px;}",
      '[data-sidebar-collapsed] .hHd-Xa_footerActions{display:flex !important;flex-direction:column !important;align-items:center !important;gap:6px !important;grid-template-columns:none !important;}',
      '[data-sidebar-collapsed] .hHd-Xa_footerActions > *{grid-area:auto !important;width:auto !important;min-width:0 !important;margin:0 !important;}',
      ".hHd-Xa_footArea{padding-bottom:8px;}",
      ".hHd-Xa_footArea{padding-bottom:8px;}",
      ".hHd-Xa_footArea{padding-bottom:8px;}",
      // F7: hide the reasoning-effort tag on the model pill (GLM-5.2 Default → GLM-5.2)
      '[class*="_triggerEffort"]{display:none !important;}',
      // F8: 官方 rc.6 把 goal bar 注册进发送按钮后的 send-after 槽（priority 5）。
      // goal 只属于输入卡上方的原位 dock；send-after 里的实例整个隐藏
      // （2026-08-19 用户指令：发送按钮后面不可能显示 goal，彻底删除）。
      '[data-send-after] [data-goal-bar]{display:none !important;}',
      // F9: goal 条排堆叠最下（order:999，输入卡根由 desktop-chrome 设 order:1000）；
      // 宽度/边距几何由 desktop-chrome 的 pass 逐像素对齐输入卡（这里不设
      // margin/width，!important 会压过内联样式）。内层 pill 自带 max-width
      // 上限（748px < 卡片宽），一并解除。堆叠间距 6px → 3px。
      '[data-goal-bar]{max-width:none !important;order:999 !important;}',
      '[data-goal-bar] > div{width:100% !important;max-width:none !important;}',
      '[class*="composerStack"]{gap:4px !important;}',
      // F10: 右上角分支下拉+提交按钮统一高度（提交 chip 的 1px 边框曾让它比
      // 分支 chip 高 2px）。
      '[class*="chipWrap"], #dsh-git-commit-chip{box-sizing:border-box !important;height:24px !important;}',
      '',
      '.usg_panel{left:0 !important;border-radius:0 12px 12px 0 !important;}',
      // F4
      ".dsh-custom-titlebar{position:fixed;top:0;left:0;right:0;height:32px;z-index:2147483000;display:flex;align-items:center;gap:8px;box-sizing:border-box;padding:0 10px 0 14px;-webkit-app-region:drag;user-select:none;background:var(--dsw-alias-bg-base,var(--dsw-specific-sidebar-fill,#f5f6f7));border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));font-size:12px;color:var(--dsw-alias-label-secondary,#666);}",
      ".dsh-custom-titlebar .dsh-custom-tb-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;}",
      ".dsh-custom-titlebar .dsh-custom-tb-btn{-webkit-app-region:no-drag;cursor:pointer;width:28px;height:22px;border:none;border-radius:6px;background:transparent;color:inherit;font-size:12px;line-height:22px;text-align:center;padding:0;}",
      ".dsh-custom-titlebar .dsh-custom-tb-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.08));}",
      "body.dsh-custom-tb{padding-top:32px;}",
      // --- 底部行终版：[检查更新|移动端] 自然宽 + 用量条填满右侧（1px 间隙，两缘对齐设置按钮）---
      '.hHd-Xa_footerActions [class*="entryRow"]{grid-row:2 !important;grid-column:1 / span 2 !important;margin:0 0 0 4px !important;justify-self:start !important;}',
      '.hHd-Xa_footerActions .usg_layer{grid-row:2 !important;grid-column:3 / -1 !important;margin:0 -4px 0 10px !important;justify-self:stretch !important;width:auto !important;}',
      '.usg_layer .usg_footerButtons, .usg_layer .usg_badge{flex:1 1 auto !important;width:auto !important;min-width:0 !important;}',
      '.usg_layer button{width:100% !important;box-sizing:border-box !important;}',
      // --- 折叠态（窄栏）：底部按钮单列垂直居中对齐 ---
      '.hHd-Xa_settingsArea, .hHd-Xa_settingsArea button{margin-left:4px !important;}',
      '.hHd-Xa_footerActions{container-type:inline-size;}',
      '@container (max-width: 120px){',
      '  .hHd-Xa_footerActions{width:100% !important;margin:0 !important;justify-items:center !important;}',
      '  .hHd-Xa_footerActions [class*="entryRow"]{margin:0 0 0 -26px !important;}',
      '  .hHd-Xa_footerActions .usg_layer{margin:0 0 0 -26px !important;width:auto !important;}',
      '  .hHd-Xa_footerActions button[aria-label="导入会话"], .hHd-Xa_footerActions button[aria-label="Import Sessions"]{margin-left:-21px !important;}',
      '  .hHd-Xa_footerActions .dsh-custom-export, .hHd-Xa_footArea .dsh-custom-export{margin-left:-24px !important;}',
      '  .usg_layer .usg_footerButtons, .usg_layer .usg_badge{flex:0 1 auto !important;width:auto !important;}',
      '  .usg_layer button{width:auto !important;}',
      '}',
    ].join("");
    function injectCss() {
      if (document.querySelector("style[data-dsh-custom-ui]")) return;
      var tag = document.createElement("style");
      tag.setAttribute("data-dsh-custom-ui", "1");
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }
    //#endregion

    //#region F1: export capsule (clone appended, never move React nodes)
    function findOriginal() {
      return document.querySelector("button.nL4_yW_sessionLogButton");
    }
    function findImportButton() {
      return document.querySelector('[aria-label="' + IMPORT_LABEL.zh + '"]')
        || document.querySelector('[aria-label="' + IMPORT_LABEL.en + '"]');
    }
    function ensureExportClone() {
      var orig = findOriginal();
      var anchor = findImportButton();
      if (!orig || !anchor) return;
      var lang = detectLang() === "en" ? "en" : "zh";
      var s = STRINGS[lang];
      var actions = anchor.closest(".hHd-Xa_footerActions");
      if (actions === null || actions === undefined) return;
      // orphan sweep: exactly one clone, inside the live footerActions only
      var strays = document.querySelectorAll("button.dsh-custom-export");
      for (var j = 0; j < strays.length; j++) {
        if (strays[j].parentElement !== actions) strays[j].remove();
      }
      var clone = actions.querySelector(":scope > button.dsh-custom-export");
      if (clone === null) {
        clone = orig.cloneNode(true);
        clone.classList.add("dsh-custom-export");
        clone.classList.remove("nL4_yW_sessionLogButton");
        clone.setAttribute(FLAG, "1");
        clone.addEventListener("click", function () {
          var o = findOriginal();
          if (o) o.click();
        });
        actions.appendChild(clone); // append only
      }
      // JS inline fallback: pin both buttons to row 1 halves (belt for CSS regressions)
      anchor.style.gridArea = "1 / 1 / 2 / 4";
      clone.style.gridArea = "1 / 4 / 2 / 7";
      actions.style.display = "grid";
      actions.style.gridTemplateColumns = "repeat(6,1fr)";
      if (clone.getAttribute(FLAG + "-lang") !== lang) {
        clone.setAttribute(FLAG + "-lang", lang);
        clone.setAttribute("aria-label", s.exportLabel);
        clone.title = s.exportTitle;
        var span = clone.querySelector("span");
        if (span) span.textContent = s.exportLabel;
      }
    }
    //#endregion

    //#region F4: Electron titlebar
    var TB_ID = "dsh-custom-titlebar";
    function isElectron() {
      return typeof window.dshDesktop !== "undefined" && window.dshDesktop !== null;
    }
    function qq98Active() {
      return document.body.hasAttribute("data-dsh-retro");
    }
    function titlebarButtonTitles(bar) {
      var s = stringsOf();
      var keys = { minimize: s.minimize, maximize: s.maximize, close: s.close };
      for (var i = 0; i < bar.children.length; i++) {
        var cmd = bar.children[i].getAttribute(FLAG + "-cmd");
        if (cmd && keys[cmd]) bar.children[i].title = keys[cmd];
      }
    }
    function ensureTitlebar() {
      var want = isElectron() && !qq98Active();
      var bar = document.getElementById(TB_ID);
      if (!want) {
        if (bar) bar.remove();
        document.body.classList.remove("dsh-custom-tb");
        return;
      }
      if (bar) { titlebarButtonTitles(bar); return; }
      bar = document.createElement("div");
      bar.id = TB_ID;
      bar.className = "dsh-custom-titlebar";
      var title = document.createElement("span");
      title.className = "dsh-custom-tb-title";
      title.textContent = document.title || "DeepSeek Harness";
      bar.appendChild(title);
      var glyphs = [["\u2013", "minimize"], ["\u25A1", "maximize"], ["\u00D7", "close"]];
      for (var i = 0; i < glyphs.length; i++) {
        (function (pair) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "dsh-custom-tb-btn";
          btn.textContent = pair[0];
          btn.setAttribute(FLAG + "-cmd", pair[1]);
          btn.addEventListener("click", function () {
            try { window.dshDesktop.windowCommand(pair[1]); } catch (e) { /* bridge missing */ }
          });
          bar.appendChild(btn);
        })(glyphs[i]);
      }
      document.body.appendChild(bar);
      document.body.classList.add("dsh-custom-tb");
      titlebarButtonTitles(bar);
    }
    //#endregion


    //#region sidebar width var sync (usage panel follows the live sidebar width)
    function syncSidebarWidthVar() {
      var col = document.querySelector('[class*="sidebarCol"]');
      var w = col !== null ? col.getBoundingClientRect().width : 0;
      if (!(w >= 200)) w = 280;
      var val = Math.round(w) + "px";
      var root = document.documentElement;
      if (root.style.getPropertyValue("--dshc-sidebar-w") !== val) root.style.setProperty("--dshc-sidebar-w", val);
    }
    //#endregion
    //#region F7b: scrub effort labels (plain-text, CSS can't reach)
    function scrubEffortText() {
      var zones = document.querySelectorAll('[class*="_footerActions"], [class*="_footArea"], #dshc-usage');
      for (var z = 0; z < zones.length; z++) {
        var leaves = zones[z].querySelectorAll("span,div");
        for (var i = 0; i < leaves.length; i++) {
          var el = leaves[i];
          if (el.childElementCount !== 0) continue;
          var t = el.textContent.trim();
          if (t === "推理等级" || t === "Reasoning effort") {
            if (el.style.display !== "none") el.style.display = "none";
          } else if (el.classList.contains("dshc-row2") || /推理等级/.test(t)) {
            // the widget row2 renders "今日 X · model · 推理等级 default" as ONE
            // text run (innerHTML string) — strip the effort segment in place.
            var cleaned = t.replace(/\s*·?\s*推理等级\s*\S*\s*$/,"").replace(/\s*·?\s*Reasoning effort\s*\S*\s*$/,"").replace(/[\s,，·]+$/,"");
            if (cleaned !== t && el.textContent !== cleaned) el.textContent = cleaned;
          }
        }
      }
    }
    //#endregion
    //#region F6: collapse the empty details column — ROOT FIX
    // React rewrites the frame's inline grid-template-columns on every layout
    // state change, so any one-shot rewrite regresses ("宽度又不为0"). A
    // dedicated observer watches ONLY the frame's style attribute and
    // re-zeroes the details track the moment React writes a non-zero value
    // while the panel is empty. Single-element observer + write-only-on-change
    // = no feedback storm; instant response = no flicker. Track index = the
    // col's position among the frame's children (grid auto-placement), so
    // 3-track and 5-track layouts both work. The original width is remembered
    // and restored when the panel gains content.
    function detailsEmpty(col) {
      if (col.querySelector('[class*="_empty"]') !== null) return true;
      return col.textContent.trim() === "" && col.querySelectorAll("svg,img,canvas,button").length === 0;
    }
    function collapseDetailsTrack() {
      try {
        var col = document.querySelector('[class*="_detailsCol"]');
        if (col === null) return;
        var frame = col.parentElement;
        if (frame === null) return;
        var m = /grid-template-columns:\s*([^;]+)/.exec(frame.getAttribute("style") || "");
        if (m === null) return;
        var tracks = m[1].trim().split(/\s+/);
        var idx = Array.prototype.indexOf.call(frame.children, col);
        if (idx < 0 || idx >= tracks.length) return;
        if (!detailsEmpty(col)) {
          // content arrived — restore React's own width once, then stand down
          var saved = frame.getAttribute("data-dshc-details-w");
          if (saved !== null && tracks[idx] === "0px") {
            tracks[idx] = saved;
            frame.style.gridTemplateColumns = tracks.join(" ");
          }
          if (saved !== null) frame.removeAttribute("data-dshc-details-w");
          if (col.style.display === "none") if (col.style.display !== "") col.style.display = "";
          return;
        }
        if (tracks[idx] === "0px") return; // already collapsed — write nothing
        if (parseFloat(tracks[idx]) > 0) {
          frame.setAttribute("data-dshc-details-w", tracks[idx]);
          tracks[idx] = "0px";
          frame.style.gridTemplateColumns = tracks.join(" ");
        }
        if (col.style.display !== "none") col.style.display = "none";
      } catch (e) { /* never throw in observer */ }
    }
    function watchDetailsFrame() {
      var col = document.querySelector('[class*="_detailsCol"]');
      var frame = col !== null ? col.parentElement : null;
      if (frame === null || frame.getAttribute("data-dshc-details-watch") !== null) return;
      frame.setAttribute("data-dshc-details-watch", "1");
      new MutationObserver(function () { collapseDetailsTrack(); })
        .observe(frame, { attributes: true, attributeFilter: ["style"] });
    }
        //#endregion

    //#region boot + observer (P3)
    // 折叠态设置按钮对齐：settingsArea 不在 footerActions 容器查询作用域内，用 JS 切换
    function settingsCollapsedAlign() {
      var fa = document.querySelector('[class*="footerActions"]');
      var sa = document.querySelector('[class*="settingsArea"]');
      if (fa === null || sa === null) return;
      var collapsed = fa.getBoundingClientRect().width <= 120;
      var want = collapsed ? "-5px" : "4px";
      sa.style.setProperty('margin-left', want, 'important');
    }

    function tick() {
      var fns = [syncSidebarWidthVar, injectCss, ensureExportClone, ensureTitlebar, watchDetailsFrame, collapseDetailsTrack, scrubEffortText, settingsCollapsedAlign];
      for (var i = 0; i < fns.length; i++) {
        try { fns[i](); } catch (e) { /* per-feature isolation: one failure never kills the rest */ }
      }
    }
    function boot() {
      tick();
      // ⚠️ DEBOUNCED observer (300ms) — mandatory. Undebounced ticks that
      // touch the DOM (style writes, re-inserts) self-trigger as an infinite
      // microtask cascade and freeze the page (same class of bug as the
      // bocha cell freeze). The details frame has its OWN instant observer
      // (watchDetailsFrame) — this body observer only re-attaches it when the
      // frame re-mounts.
      var obsTimer = 0;
      new MutationObserver(function () {
        if (obsTimer !== 0) return;
        obsTimer = window.setTimeout(function () {
          obsTimer = 0;
          try { tick(); } catch (e) { /* observer must never throw */ }
        }, 300);
      }).observe(document.body, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ["data-dsh-retro", "aria-label", "style"]
      });
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
      boot();
    }
    //#endregion

    // ⚠️ MODULE LOADER CONTRACT — DO NOT REMOVE (breaks the whole UI if lost):
    // the factory MUST return a plugin object with an `apply` method, else the
    // loader throws "invalid plugin ... received undefined" and the error page
    // blocks the entire app. All behavior above runs eagerly at factory time.
    var module = { exports: {} };
    module.exports.apply = function apply() {};
    return module.exports;
  },
});
