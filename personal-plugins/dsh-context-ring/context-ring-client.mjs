/* ⚠️ __ModuleLoader__ contract. context-ring settings card (auto-continue
 * pattern, bridge data plane) + live ring classifier. */
window.__ModuleLoader__.load({
  id: "dsh-context-ring",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    "use strict";
    var import_react = require("react");
    function createSnapshotStore() {
      var snap = { available: false, rows: [] };
      var subs = [];
      return {
        subscribe: function (f) { subs.push(f); return function () { subs = subs.filter(function (x) { return x !== f; }); }; },
        get: function () { return snap; },
        set: function (next) { snap = next; for (var i = 0; i < subs.length; i++) subs[i](); },
      };
    }

    var NS = "context-ring";
    var SETTINGS_NS = "context-ring";
    var API = "/api/dsh-web-ui-settings";

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

    function BridgeScope() {
      var snap = { status: "pending", writable: true, value: {}, base: {}, user: {}, revision: 0 };
      var subs = [];
      function emit() { for (var i = 0; i < subs.length; i++) subs[i](); }
      function reload() {
        fetch(API + "/describe", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            var list = (j.value && j.value.namespaces) || [];
            var ns = null;
            for (var i = 0; i < list.length; i++) if (list[i].ns === SETTINGS_NS) ns = list[i];
            if (!ns) { snap = Object.assign({}, snap, { status: "absent" }); emit(); return; }
            var v = ns.value || {};
            cfg = { warnAt: Number(v.warnAt != null ? v.warnAt : 50), dangerAt: Number(v.dangerAt != null ? v.dangerAt : 80), warnColor: v.warnColor || "#f59e0b", dangerColor: v.dangerColor || "#ef4444" };
            applyLive(); classify();
            snap = { status: "ready", writable: true, value: v, base: ns.base || v, user: ns.user || {}, revision: ns.revision || 0 };
            emit();
          })
          .catch(function () { snap = Object.assign({}, snap, { status: "absent" }); emit(); });
      }
      reload();
      return {
        subscribe: function (f) { subs.push(f); return function () { subs = subs.filter(function (x) { return x !== f; }); }; },
        getSnapshot: function () { return snap; },
        set: function (field, value) {
          return fetch(API + "/mutate", { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ ns: SETTINGS_NS, ops: [{ op: "replace", path: "/" + field, value: value }] }) })
            .then(function (r) { return r.json(); }).then(function (j) { if (!j.ok) throw new Error(j.message || "mutate failed"); reload(); });
        },
        unset: function (field) {
          return fetch(API + "/mutate", { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ ns: SETTINGS_NS, ops: [{ op: "remove", path: "/" + field }] }) })
            .then(function (r) { return r.json(); }).then(function (j) { if (!j.ok) throw new Error(j.message || "mutate failed"); reload(); });
        },
      };
    }

    function formatNum(v) { return typeof v === "number" ? String(v) : ""; }
    function parseNum(t) { var n = Number(t); if (!Number.isFinite(n) || n < 0) return undefined; return { kind: "set", value: n }; }
    function formatStr(v) { return typeof v === "string" ? v : ""; }
    function parseHex(t) { return /^#[0-9a-fA-F]{6}$/.test(t) ? { kind: "set", value: t } : undefined; }

    var FIELDS = [
      { field: "warnAt", fmt: formatNum, prs: parseNum, kind: "number" },
      { field: "dangerAt", fmt: formatNum, prs: parseNum, kind: "number" },
      { field: "warnColor", fmt: formatStr, prs: parseHex, kind: "color" },
      { field: "dangerColor", fmt: formatStr, prs: parseHex, kind: "color" },
    ];
    var ZH = {
      title: "上下文圆环变色", description: "按占用率分段变色：阈值与颜色",
      f_warnAt: "阈值一 (%)", f_dangerAt: "阈值二 (%)", f_warnColor: "警告色 (#rrggbb)", f_dangerColor: "危险色 (#rrggbb)",
    };

    function Controller(scope) {
      var staged = new Map();
      var saving = false; var failed = false;
      var store = createSnapshotStore();
      store.set(project());
      scope.subscribe(function () { staged.clear(); failed = false; publish(); });
      function project() {
        var snap = scope.getSnapshot();
        var rows = [];
        for (var i = 0; i < FIELDS.length; i++) {
          var f = FIELDS[i];
          var st = staged.get(f.field);
          var val = (snap.value || {})[f.field];
          rows.push({
            field: f.field, kind: f.kind, label: ZH["f_" + f.field] || f.field,
            text: st ? st.text : f.fmt(val),
            overridden: Object.prototype.hasOwnProperty.call(snap.user || {}, f.field),
            invalid: st ? f.prs(st.text) === undefined : false,
          });
        }
        return {
          available: snap.status === "ready", writable: snap.writable === true,
          dirty: staged.size > 0, invalid: rows.some(function (r) { return r.invalid; }),
          saving: saving, failed: failed, rows: rows,
        };
      }
      function publish() { store.set(project()); return store.get(); }
      function doSave() {
        if (saving) return;
        var work = [];
        staged.forEach(function (st, field) {
          var f = FIELDS.find(function (x) { return x.field === field; });
          var write = f.prs(st.text);
          if (write === undefined) return;
          work.push(write.kind === "clear" ? scope.unset(field) : scope.set(field, write.value));
        });
        saving = true; failed = false; publish();
        Promise.all(work).then(function () { staged.clear(); saving = false; publish(); })
          .catch(function () { saving = false; failed = true; publish(); });
      }
      return {
        inject: function () {
          var a = {
            edit: function (field, text) { staged.set(field, { text: text, clear: false }); publish(); },
            resetField: function (field) { var f = FIELDS.find(function (x) { return x.field === field; }); staged.set(field, { text: f.fmt((scope.getSnapshot().base || {})[field]), clear: true }); publish(); },
            save: doSave,
            discard: function () { if (staged.size === 0 && !failed) return; staged.clear(); failed = false; publish(); },
          };
          return { hooks: { contextRingCard: store }, props: a, actions: a };
        },
      };
    }

    function Card(props) {
      var t = props.t || function (k) { return ZH[k] || k; };
      var useCard = props.useContextRingCard;
      var state = useCard ? useCard(function (s) { return s; }) : { available: false, rows: [] };
      var open = import_react.useState(false);
      var setOpen = open[1]; open = open[0];
      if (!state.available) return null;
      var blocked = !state.dirty || state.invalid || state.saving;
      var h = import_react.createElement;
      var rows = (state.rows || []).map(function (r) {
        var input = r.kind === "color"
          ? h("input", { type: "color", value: /^#[0-9a-fA-F]{6}$/.test(r.text) ? r.text : "#f59e0b", onChange: function (e) { props.edit(r.field, e.target.value); }, style: { width: 54, height: 26, padding: 0, border: "none", background: "none", cursor: "pointer" } })
          : h("input", { value: r.text, onChange: function (e) { props.edit(r.field, e.target.value); }, style: { width: 150, padding: "4px 8px", fontSize: 12 } });
        return h("label", { key: r.field, style: { display: "flex", alignItems: "center", gap: 8, padding: "6px 0" } },
          h("span", { style: { minWidth: 190, fontSize: 12 } }, r.label), input,
          r.kind === "color" ? h("span", { style: { fontSize: 12, fontFamily: "monospace" } }, r.text) : null);
      });
      return h("li", { style: { border: "1px solid rgba(128,128,128,.35)", borderRadius: 10, padding: 12, listStyle: "none" } },
        h("button", { type: "button", onClick: function () { setOpen(!open); }, style: { all: "unset", cursor: "pointer", display: "flex", gap: 10, alignItems: "baseline", width: "100%" } },
          h("span", { style: { fontWeight: 600 } }, t("title")),
          h("span", { style: { fontSize: 12, color: "#888" } }, t("description")),
          state.dirty ? h("span", { style: { fontSize: 11, color: "#f59e0b" } }, "未保存") : null),
        open ? h("div", { style: { marginTop: 8 } }, rows,
          h("div", { style: { display: "flex", gap: 8, marginTop: 8 } },
            h("button", { disabled: blocked, onClick: props.save, style: { padding: "5px 14px" } }, "保存"),
            h("button", { disabled: !state.dirty, onClick: props.discard, style: { padding: "5px 14px" } }, "放弃"),
            state.failed ? h("span", { style: { fontSize: 12, color: "#ef4444" } }, "保存失败") : null)) : null);
    }

    exports.inject = ["slots", "locale"];
    exports.apply = function apply(ctx) {
      applyLive();
      classify();
      var ob = new MutationObserver(function () { ensureStyle(); classify(); });
      ob.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["stroke-dasharray"] });

      /* BISECT-OFF: slots+locale disabled to isolate the loader error */
      try {
        window.__ringDiag = { hasSlots: !!ctx.slots, hasLocale: !!ctx.locale };
      } catch (e) { window.__ringDiag = { err: String(e) }; }
    };
    return module.exports;
  },
});
