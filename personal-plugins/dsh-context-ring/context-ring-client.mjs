/* ⚠️ REWRITE RULE: this file MUST use the __ModuleLoader__ script contract:
 * window.__ModuleLoader__.load({ id, factory }) with the factory returning
 * { apply }. Plain ESM exports are IGNORED by the client loader and break
 * the whole UI ("loaded without registering"). */
/* dsh-context-ring browser half: ring classifier ONLY — no sidebar entry,
 * no panel (settings live in the GUI 设置 page, namespace "context-ring").
 * Reads /api/context-ring/config, then classifies the ContextMeter ring's
 * stroke-dasharray (arc/circumference = percent) into warn/danger classes. */
window.__ModuleLoader__.load({
  id: "dsh-context-ring",
  factory: function () {
    var module = { exports: {} };
    var exports = module.exports;
    var cfg = { warnAt: 50, dangerAt: 80, warnColor: "#f59e0b", dangerColor: "#ef4444" };
    var liveStyle = null;

    function ensureStyle() {
      if (liveStyle && liveStyle.isConnected) return;
      liveStyle = document.createElement("style");
      liveStyle.setAttribute("data-context-ring", "");
      document.head.appendChild(liveStyle);
    }
    function applyLive() {
      ensureStyle();
      liveStyle.textContent =
        '.dsh-ring-warn circle[class*="_fill"]{stroke:' + cfg.warnColor + ' !important}' +
        '.dsh-ring-danger circle[class*="_fill"]{stroke:' + cfg.dangerColor + ' !important}';
    }
    function classify() {
      var svgs = document.querySelectorAll("svg");
      for (var i = 0; i < svgs.length; i++) {
        var svg = svgs[i];
        if (!svg.querySelector('circle[class*="_track"]')) continue;
        var fills = svg.querySelectorAll('circle[class*="_fill"]');
        for (var j = 0; j < fills.length; j++) {
          var dash = (fills[j].getAttribute("stroke-dasharray") || "").trim();
          if (!dash) continue;
          var parts = dash.split(/[\s,]+/).map(Number);
          if (parts.length < 2 || !parts[1]) continue;
          var pct = (parts[0] / parts[1]) * 100;
          var host = svg.closest('[class*="_trigger"], button') || svg;
          host.classList.remove("dsh-ring-warn", "dsh-ring-danger");
          if (pct >= Number(cfg.dangerAt)) host.classList.add("dsh-ring-danger");
          else if (pct >= Number(cfg.warnAt)) host.classList.add("dsh-ring-warn");
        }
      }
    }
    exports.apply = function apply() {
      applyLive();
      classify();
      var ob = new MutationObserver(function () { ensureStyle(); classify(); });
      ob.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["stroke-dasharray"] });
      fetch("/api/context-ring/config").then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.ok && j.config) {
          cfg = { warnAt: Number(j.config.warnAt), dangerAt: Number(j.config.dangerAt), warnColor: j.config.warnColor, dangerColor: j.config.dangerColor };
          applyLive();
          classify();
        }
      }).catch(function () {});
    };
    return module.exports;
  },
});
