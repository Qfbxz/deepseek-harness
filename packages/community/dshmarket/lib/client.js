// dsh-market browser half: settings panel 'Plugin Market' card.
// Fetches /dsh-market/{registry,installed,status,updates,logs}, POSTs to
// /dsh-market/{install,uninstall,update,setup-pnpm}. One settings.section list
// entry owns the whole panel: registry above (with per-row install/open),
// installed below (with uninstall/update). Status strip exposes pnpm,
// busy/lastLine, and boot id, plus a link to /dsh-market/logs for issue reports.
//
// Conventions: AMD bundle exported through window.__ModuleLoader__.load, react
// createElement as 'h', CSS injected through the data-plugin-css document-head
// pattern (so reloads never duplicate). Same-origin fetch over the local
// webserver, no auth — the host routes already require same-origin POST.

if (typeof window !== "undefined") {
  window.__ModuleLoader__.load({
    id: "@deepseek-ai/dsh-market",
    factory: (require) => {
      var module = { exports: {} };
      var exports = module.exports;
      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
      var react = require("react");
      var h = react.createElement;
      var slotsMod = require("@deepseek-ai/dsh-client-ui-slots");
      var runtimeMod = require("@deepseek-ai/dsh-client-runtime/client");

      // ── styles (data-plugin-css injection, idempotent) ─────────────────────
      var CSS_ID = "@deepseek-ai/dsh-market/section.css";
      var cssText = [
        ".dsm-section{flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary);display:flex}",
        ".dsm-status{flex-wrap:wrap;align-items:center;gap:8px;padding:8px 12px;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font-size:12px;line-height:18px;display:flex}",
        ".dsm-status-label{color:var(--dsw-alias-label-tertiary)}",
        ".dsm-status-val{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}",
        ".dsm-status-pill{border-radius:999px;padding:2px 8px;font-size:11px;font-weight:500;line-height:16px}",
        ".dsm-status-pill-ok{background:var(--dsw-alias-state-success-bg,transparent);color:var(--dsw-alias-state-success-primary)}",
        ".dsm-status-pill-warn{background:var(--dsw-alias-state-warn-bg,transparent);color:var(--dsw-alias-state-warn-label)}",
        ".dsm-status-pill-bad{background:var(--dsw-alias-state-error-bg,transparent);color:var(--dsw-alias-state-error-primary)}",
        ".dsm-head{flex-direction:column;gap:4px;display:flex}",
        ".dsm-title{margin:0;font-size:15px;font-weight:500;line-height:22px}",
        ".dsm-sub{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
        ".dsm-block{flex-direction:column;gap:8px;display:flex}",
        ".dsm-block-head{flex-wrap:wrap;align-items:center;gap:8px;display:flex}",
        ".dsm-actions{margin-left:auto;flex-wrap:wrap;align-items:center;gap:8px;display:flex}",
        ".dsm-input{box-sizing:border-box;height:30px;min-width:0;flex:1;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);padding:0 10px;font-family:inherit;font-size:13px}",
        ".dsm-row{align-items:flex-start;gap:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;display:flex}",
        ".dsm-row-main{flex-direction:column;gap:4px;min-width:0;flex:1;display:flex}",
        ".dsm-row-id{flex-wrap:wrap;align-items:center;gap:6px;display:inline-flex}",
        ".dsm-row-name{font-size:14px;font-weight:500;line-height:20px}",
        ".dsm-row-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
        ".dsm-row-desc{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:18px}",
        ".dsm-row-buttons{flex:none;flex-wrap:wrap;gap:6px;align-items:center;display:flex}",
        ".dsm-tag{border:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);border-radius:4px;flex:none;padding:1px 6px;font-size:11px;line-height:16px}",
        ".dsm-btn{box-sizing:border-box;height:30px;border:none;border-radius:15px;justify-content:center;align-items:center;gap:4px;padding:0 12px;font-family:inherit;font-size:13px;line-height:20px;cursor:pointer;display:inline-flex;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}",
        ".dsm-btn:disabled{opacity:.5;cursor:default}",
        ".dsm-btn-secondary{background:transparent;border:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary)}",
        ".dsm-btn-danger{background:transparent;border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}",
        ".dsm-error{color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:18px}",
        ".dsm-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:18px;padding:8px 12px}",
        ".dsm-progress{align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;display:inline-flex}",
        ".dsm-progress-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-info-primary);flex:none;animation:dsm-pulse 1.2s ease-in-out infinite}",
        "@keyframes dsm-pulse{0%,100%{opacity:.3}50%{opacity:1}}",
        ".dsm-link{color:var(--dsw-alias-state-info-primary,var(--dsw-alias-label-secondary));text-decoration:none;font-size:12px}",
        ".dsm-link:hover{text-decoration:underline}",
        ".dsm-logs{max-height:220px;flex-direction:column;gap:2px;padding:8px;overflow:auto;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:16px;display:flex}",
        ".dsm-logs-empty{color:var(--dsw-alias-label-tertiary);padding:2px}",
        ".dsm-logs-line{white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-secondary)}"
      ].join("");
      if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + CSS_ID + "\"]") === null) {
        var tag = document.createElement("style");
        tag.dataset.plugin = "@deepseek-ai/dsh-market";
        tag.dataset.pluginCss = CSS_ID;
        tag.textContent = cssText;
        document.head.appendChild(tag);
      }

      // ── helpers ─────────────────────────────────────────────────────────────
      function getApiBase() {
        return (typeof window !== "undefined" && window.__DSH_API_BASE__) || "";
      }
      function api(path, opts) {
        var init = opts || {};
        if (init.body && typeof init.body !== "string") init.body = JSON.stringify(init.body);
        if (init.body && !init.headers) init.headers = { "content-type": "application/json" };
        init.credentials = "same-origin";
        return fetch(getApiBase() + path, init).then(function (r) {
          var ctype = r.headers.get("content-type") || "";
          var parse = ctype.indexOf("application/json") >= 0 ? r.json() : r.text();
          return parse.then(function (data) {
            if (!r.ok) {
              var msg = (data && data.error) || ("HTTP " + r.status);
              var err = new Error(String(msg));
              err.response = data;
              err.status = r.status;
              throw err;
            }
            return data;
          });
        });
      }
      function reloadRegistered() { window.location.reload(); }

      function pickDescription(desc, locale) {
        if (!desc) return "";
        if (typeof desc === "string") return desc;
        var keys = [];
        if (locale) keys.push(locale);
        if (locale && locale.indexOf("-") > 0) keys.push(locale.split("-")[0]);
        keys.push("en", "default", "zh-CN", "zh");
        for (var i = 0; i < keys.length; i++) {
          if (desc[keys[i]]) return desc[keys[i]];
        }
        var first = Object.keys(desc)[0];
        return first ? desc[first] : "";
      }

      // ── component ───────────────────────────────────────────────────────────
      function MarketSection() {
        var sRegistry = react.useState({ loading: true, source: "", data: null, error: null });
        var registry = sRegistry[0]; var setRegistry = sRegistry[1];
        var sInstalled = react.useState({ loading: true, map: {}, error: null });
        var installed = sInstalled[0]; var setInstalled = sInstalled[1];
        var sStatus = react.useState({ loading: true, data: null, error: null });
        var status = sStatus[0]; var setStatus = sStatus[1];
        var sUpdates = react.useState({ data: null, error: null });
        var updates = sUpdates[0]; var setUpdates = sUpdates[1];
        var sBusies = react.useState({});
        var busies = sBusies[0]; var setBusies = sBusies[1];
        var sLogs = react.useState({ open: false, loading: false, text: "" });
        var logsState = sLogs[0]; var setLogsState = sLogs[1];
        var sFilter = react.useState("");
        var filter = sFilter[0]; var setFilter = sFilter[1];

        function setBusy(url, val) {
          setBusies(function (prev) {
            var next = Object.assign({}, prev);
            if (val) next[url] = true; else delete next[url];
            return next;
          });
        }
        function busyFor(url) { return !!busies[url]; }

        function refreshAll(opts) {
          var includeUpdates = (opts && opts.updates) === true;
          setRegistry(function (r) { return Object.assign({}, r, { loading: true, error: null }); });
          api("/dsh-market/registry").then(function (j) {
            setRegistry({ loading: false, source: (j && j.source) || "", data: (j && j.registry) || null, error: null });
          }).catch(function (e) { setRegistry({ loading: false, source: "", data: null, error: String((e && e.message) || e) }); });
          api("/dsh-market/installed").then(function (j) {
            setInstalled({ loading: false, map: (j && j.installed) || {}, error: null });
          }).catch(function (e) { setInstalled({ loading: false, map: {}, error: String((e && e.message) || e) }); });
          api("/dsh-market/status").then(function (j) {
            setStatus({ loading: false, data: j || null, error: null });
            if (j && j.installed) setInstalled({ loading: false, map: j.installed, error: null });
          }).catch(function (e) { setStatus({ loading: false, data: null, error: String((e && e.message) || e) }); });
          if (includeUpdates) {
            api("/dsh-market/updates?force=1").then(function (j) { setUpdates({ data: (j && j.updates) || [], error: null }); }).catch(function (e) { setUpdates({ data: [], error: String((e && e.message) || e) }); });
          }
        }

        react.useEffect(function () {
          var cancelled = false;
          function tick() { if (cancelled) return; refreshAll(); }
          tick();
          var t = setInterval(tick, 4000);
          return function () { cancelled = true; clearInterval(t); };
        }, []);

        react.useEffect(function () {
          var active = status.data && status.data.active;
          if (!active) return;
          var t = setInterval(function () {
            api("/dsh-market/status").then(function (j) {
              setStatus({ loading: false, data: j || null, error: null });
              if (j && j.installed) setInstalled({ loading: false, map: j.installed, error: null });
            }).catch(function () {});
          }, 1000);
          return function () { clearInterval(t); };
        }, [status.data && status.data.active, status.data && status.data.target]);

        function install(entry) {
          var url = entry.url;
          setBusy(url, true);
          api("/dsh-market/install", { method: "POST", body: { url: url } }).then(function (j) {
            setBusy(url, false);
            refreshAll({ updates: true });
            if (!j || j.ok !== true) {
              window.alert("Install failed: " + ((j && (j.error || j.stderr)) || "unknown error"));
              return;
            }
            if (!j.hot) reloadRegistered();
          }).catch(function (e) { setBusy(url, false); window.alert("Install failed: " + String((e && e.message) || e)); });
        }
        function uninstall(name) {
          if (!window.confirm("Uninstall '" + name + "'? This cannot be undone.")) return;
          setBusy("name:" + name, true);
          api("/dsh-market/uninstall", { method: "POST", body: { name: name } }).then(function (j) {
            setBusy("name:" + name, false);
            refreshAll({ updates: true });
            if (!j || j.ok !== true) {
              window.alert("Uninstall failed: " + ((j && (j.error || j.stderr)) || "unknown error"));
              return;
            }
            if (!j.hot) reloadRegistered();
          }).catch(function (e) { setBusy("name:" + name, false); window.alert("Uninstall failed: " + String((e && e.message) || e)); });
        }
        function updateOne(name) {
          setBusy("update:" + name, true);
          api("/dsh-market/update", { method: "POST", body: { name: name } }).then(function (j) {
            setBusy("update:" + name, false);
            refreshAll({ updates: true });
            if (!j || j.ok !== true) {
              window.alert("Update failed: " + ((j && (j.error || j.stderr)) || "unknown error"));
              return;
            }
            if (!j.hot) reloadRegistered();
          }).catch(function (e) { setBusy("update:" + name, false); window.alert("Update failed: " + String((e && e.message) || e)); });
        }
        function setupPnpm() {
          setBusy("setup-pnpm", true);
          api("/dsh-market/setup-pnpm", { method: "POST" }).then(function (j) {
            setBusy("setup-pnpm", false);
            refreshAll();
            if (!j || j.ok !== true) window.alert("pnpm prepare failed; retry later");
          }).catch(function (e) { setBusy("setup-pnpm", false); window.alert("pnpm prepare failed: " + String((e && e.message) || e)); });
        }
        function toggleLogs() {
          if (logsState.open) { setLogsState({ open: false, loading: false, text: "" }); return; }
          setLogsState({ open: true, loading: true, text: "" });
          fetch(getApiBase() + "/dsh-market/logs").then(function (r) { return r.text(); }).then(function (t) {
            setLogsState({ open: true, loading: false, text: t || "(no events)" });
          }).catch(function (e) { setLogsState({ open: true, loading: false, text: "load failed: " + String((e && e.message) || e) }); });
        }
        function copyLogs() {
          if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(logsState.text || "").catch(function () {});
          }
        }

        // ── render ─────────────────────────────────────────────────────────────
        var nodes = [];
        var instMap = installed.map || {};
        var regData = registry.data;
        var sData = status.data;
        var pnpmOK = !!(sData && sData.pnpm);
        var pnpmBusy = !!busies["setup-pnpm"];
        var filterLc = filter.trim().toLowerCase();

        var statusBits = [];
        statusBits.push(h("span", { key: "pnpm", className: "dsm-status-label" }, "pnpm:"));
        if (sData && sData.loading) statusBits.push(h("span", { key: "pnpmv", className: "dsm-status-val" }, "checking..."));
        else if (pnpmOK) statusBits.push(h("span", { key: "pnpmv", className: "dsm-status-val" }, "ready"));
        else statusBits.push(h("button", { key: "pnpmb", className: "dsm-btn dsm-btn-secondary", disabled: pnpmBusy, onClick: setupPnpm, style: { height: "24px", padding: "0 10px", fontSize: "12px" } }, pnpmBusy ? "preparing..." : "Provision"));
        if (sData && sData.profile) statusBits.push(h("span", { key: "prof", className: "dsm-status-label" }, "\u00b7 profile: " + sData.profile));
        if (sData && sData.boot) statusBits.push(h("span", { key: "boot", className: "dsm-status-label" }, "\u00b7 boot: " + sData.boot));
        if (sData && sData.active) statusBits.push(h("span", { key: "act", className: "dsm-progress" }, h("span", { className: "dsm-progress-dot" }), "installing: " + (sData.target || "") + " \u00b7 " + String(sData.seconds || 0) + "s" + (sData.lastLine ? " \u00b7 " + sData.lastLine : "")));
        var sourceLabel = registry.source;
        if (sourceLabel) statusBits.push(h("span", { key: "src", className: "dsm-status-label" }, "\u00b7 source: " + sourceLabel));
        nodes.push(h("div", { key: "status", className: "dsm-status" }, statusBits));

        var regBlock = [];
        regBlock.push(h("div", { key: "rh", className: "dsm-block-head" }, h("div", { className: "dsm-head" }, h("h3", { className: "dsm-title" }, "Plugin Registry"), h("p", { className: "dsm-sub" }, "Curated list from awesome-dsh-plugin.com. Click Install to download into the current profile.")), h("div", { className: "dsm-actions" }, h("input", { className: "dsm-input", placeholder: "Search plugins...", value: filter, onChange: function (e) { setFilter(e.target.value || ""); } }), h("button", { className: "dsm-btn dsm-btn-secondary", onClick: function () { refreshAll({ updates: true }); } }, "Refresh"))));
        if (registry.error) regBlock.push(h("div", { key: "re", className: "dsm-error" }, "Registry load failed: " + registry.error));
        else if (registry.loading && !regData) regBlock.push(h("div", { key: "rl", className: "dsm-empty" }, "Loading registry..."));
        else if (!regData || !Array.isArray(regData.plugins) || regData.plugins.length === 0) regBlock.push(h("div", { key: "re", className: "dsm-empty" }, "Registry is empty."));
        else {
          var locale = (typeof navigator !== "undefined" && ((navigator.languages && navigator.languages[0]) || navigator.language)) || "";
          var installedNames = Object.keys(instMap);
          var rows = regData.plugins;
          if (filterLc) rows = rows.filter(function (p) { return ((p.name || "") + " " + (p.owner || "") + " " + (p.category || "") + " " + pickDescription(p.description, locale)).toLowerCase().indexOf(filterLc) >= 0; });
          if (rows.length === 0) regBlock.push(h("div", { key: "rf", className: "dsm-empty" }, "No matching plugins."));
          else regBlock.push(h("div", { key: "rows", className: "dsm-block" }, rows.map(function (p) {
            var installedEntry = installedNames.indexOf(p.name) >= 0 ? instMap[p.name] : null;
            var installedSpec = installedEntry ? (typeof installedEntry === "string" ? installedEntry : (installedEntry.spec || installedEntry.install || "")) : "";
            var updateInfo = (updates.data || []).find(function (u) { return u.name === p.name; });
            var isBusy = busyFor(p.url);
            var tags = [];
            if (p.category) tags.push(h("span", { key: "c", className: "dsm-tag" }, p.category));
            if (typeof p.stars === "number") tags.push(h("span", { key: "s", className: "dsm-tag", title: "GitHub stars" }, "\u2605 " + p.stars));
            if (installedEntry) tags.push(h("span", { key: "i", className: "dsm-tag", title: installedSpec || "" }, "installed"));
            if (updateInfo && updateInfo.updateAvailable) tags.push(h("span", { key: "u", className: "dsm-tag", title: (updateInfo.latest || "") + " \u2192 installed " + (updateInfo.current || "") }, "update available"));
            var buttons = [];
            if (installedEntry) {
              if (updateInfo && updateInfo.updateAvailable) buttons.push(h("button", { key: "u", className: "dsm-btn", disabled: isBusy || pnpmBusy || !!busies["update:" + p.name], onClick: function () { updateOne(p.name); } }, busies["update:" + p.name] ? "Updating..." : "Update"));
              buttons.push(h("button", { key: "rm", className: "dsm-btn dsm-btn-danger", disabled: isBusy, onClick: function () { uninstall(p.name); } }, "Uninstall"));
            } else {
              buttons.push(h("button", { key: "i", className: "dsm-btn", disabled: isBusy || pnpmBusy, onClick: function () { install(p); } }, isBusy ? "Installing..." : "Install"));
            }
            if (p.url) buttons.push(h("a", { key: "open", className: "dsm-link", href: p.url, target: "_blank", rel: "noreferrer", style: { marginLeft: "6px" } }, "Open on GitHub \u2197"));
            return h("div", { key: p.url, className: "dsm-row" }, h("div", { className: "dsm-row-main" }, h("div", { className: "dsm-row-id" }, h("span", { className: "dsm-row-name" }, p.name || p.url), tags), h("div", { className: "dsm-row-meta" }, [p.owner ? "by " + p.owner : "", p.added ? "\u00b7 added " + String(p.added).slice(0, 10) : "", installedSpec ? "\u00b7 " + installedSpec : ""].filter(Boolean).join(" ")), h("div", { className: "dsm-row-desc", title: pickDescription(p.description, locale) }, pickDescription(p.description, locale) || "(no description)")), h("div", { className: "dsm-row-buttons" }, buttons));
          })));
        }
        nodes.push(h("div", { key: "reg", className: "dsm-block" }, regBlock));

        var installedNames2 = Object.keys(instMap);
        var regNames = regData && Array.isArray(regData.plugins) ? regData.plugins.map(function (p) { return p.name; }) : [];
        var regNameSet = new Set(regNames);
        var unmanaged = installedNames2.filter(function (n) { return !regNameSet.has(n) && n !== "dsh-market" && n !== "dshmarket"; });
        var installedBlock = [];
        installedBlock.push(h("div", { key: "ih", className: "dsm-block-head" }, h("div", { className: "dsm-head" }, h("h3", { className: "dsm-title" }, "Installed"), h("p", { className: "dsm-sub" }, "Plugins in this profile that are not in the curated registry."))));
        if (installed.error) installedBlock.push(h("div", { key: "ie", className: "dsm-error" }, installed.error));
        else if (installedNames2.length === 0) installedBlock.push(h("div", { key: "iz", className: "dsm-empty" }, "No plugins installed."));
        else if (unmanaged.length === 0) installedBlock.push(h("div", { key: "il", className: "dsm-empty" }, "All installed plugins come from the curated registry."));
        else installedBlock.push(h("div", { key: "il", className: "dsm-block" }, unmanaged.map(function (name) {
          var spec = instMap[name];
          var specTxt = typeof spec === "string" ? spec : (spec && (spec.spec || spec.install)) || "";
          var u = (updates.data || []).find(function (x) { return x.name === name; });
          var isBusy = busyFor("name:" + name);
          var isUpdating = busyFor("update:" + name);
          return h("div", { key: name, className: "dsm-row" }, h("div", { className: "dsm-row-main" }, h("div", { className: "dsm-row-id" }, h("span", { className: "dsm-row-name" }, name), u && u.updateAvailable ? h("span", { className: "dsm-tag" }, "update available") : null), h("div", { className: "dsm-row-meta", title: specTxt }, specTxt || "")), h("div", { className: "dsm-row-buttons" }, u && u.updateAvailable ? h("button", { className: "dsm-btn", disabled: isUpdating, onClick: function () { updateOne(name); } }, isUpdating ? "Updating..." : "Update") : null, h("button", { className: "dsm-btn dsm-btn-danger", disabled: isBusy, onClick: function () { uninstall(name); } }, "Uninstall")));
        })));
        nodes.push(h("div", { key: "inst", className: "dsm-block" }, installedBlock));

        var logBits = [];
        logBits.push(h("div", { key: "lh", className: "dsm-block-head" }, h("div", { className: "dsm-head" }, h("h3", { className: "dsm-title" }, "Diagnostics Log")), h("div", { className: "dsm-actions" }, logsState.open ? h("button", { className: "dsm-btn dsm-btn-secondary", onClick: copyLogs }, "Copy") : null, h("button", { className: "dsm-btn dsm-btn-secondary", onClick: toggleLogs }, logsState.open ? "Hide" : (logsState.loading ? "Loading..." : "View")))));
        if (logsState.open) {
          if (logsState.loading) logBits.push(h("div", { key: "ll", className: "dsm-empty" }, "Loading..."));
          else if (!logsState.text) logBits.push(h("div", { key: "lz", className: "dsm-empty" }, "(no events)"));
          else {
            var lines = logsState.text.split("\n");
            logBits.push(h("pre", { key: "lp", className: "dsm-logs" }, lines.map(function (line, i) { return h("div", { key: i, className: "dsm-logs-line" }, line || " "); })));
          }
        }
        nodes.push(h("div", { key: "logs", className: "dsm-block" }, logBits));

        return h("div", { className: "dsm-section" }, nodes);
      }

      // ── cordis entry: register settings.section list cell ───────────────────
      function apply(ctx) {
        if (ctx.slots && typeof ctx.slots.inject === "function" && typeof ctx.slots.register === "function") {
          ctx.slots.inject("settings.section", function () {
            return ctx.slots.register({
              name: "settings.section",
              id: "dsh-market",
              order: 910,
              label: "Plugin Market"
            }, MarketSection);
          });
          return;
        }
        var Slots = (slotsMod && (slotsMod.SlotCore || (slotsMod.default && slotsMod.default.SlotCore))) || null;
        if (typeof Slots !== "function") return;
        try {
          ctx.slots = new Slots();
          ctx.slots.register({ name: "settings.section", id: "dsh-market", order: 910, label: "Plugin Market" }, MarketSection);
        } catch (_) {}
      }

      exports.apply = apply;
      exports.inject = ["@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-runtime"];
      exports.name = "@deepseek-ai/dsh-market";
      return module.exports;
    }
  });
}
