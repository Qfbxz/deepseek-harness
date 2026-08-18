/* ⚠️ __ModuleLoader__ contract. pawl settings card — auto-continue pattern,
 * data plane = web-ui-settings bridge (namespace "pawl"). */
window.__ModuleLoader__.load({
  id: "dsh-crawler",
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

    var NS = "pawl";
    var SETTINGS_NS = "pawl";
    var API = "/api/dsh-web-ui-settings";

    /* bridge-backed scope: same surface the official settingsScope offers
       (subscribe/getSnapshot/set/unset), one namespace. */
    function BridgeScope() {
      var snap = { status: "pending", writable: true, value: {}, base: {}, user: {}, revision: 0 };
      var subs = [];
      function emit() { for (var i = 0; i < subs.length; i++) subs[i](); }
      function reload() {
        return fetch(API + "/describe", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            var list = (j.value && j.value.namespaces) || [];
            var ns = null;
            for (var i = 0; i < list.length; i++) if (list[i].ns === SETTINGS_NS) ns = list[i];
            if (!ns) { snap = Object.assign({}, snap, { status: "absent" }); emit(); return; }
            snap = { status: "ready", writable: true, value: ns.value || {}, base: ns.base || ns.value || {}, user: ns.user || {}, revision: ns.revision || 0 };
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

    /* staged form (auto-continue CardForm pattern, verbatim behavior) */
    function formatBool(v) { return typeof v === "boolean" ? String(v) : ""; }
    function parseBool(t) { if (t === "true") return { kind: "set", value: true }; if (t === "false") return { kind: "set", value: false }; return undefined; }
    function formatNum(v) { return typeof v === "number" ? String(v) : ""; }
    function parseNum(t) { var n = Number(t); if (!Number.isFinite(n) || n < 0) return undefined; return { kind: "set", value: n }; }
    function formatStr(v) { return typeof v === "string" ? v : ""; }
    function parseStr(t) { return t === "" ? { kind: "clear" } : { kind: "set", value: t }; }

    var FIELDS = [
      { field: "enabled", fmt: formatBool, prs: parseBool, kind: "boolean" },
      { field: "engine", fmt: formatStr, prs: parseStr, kind: "text" },
      { field: "headless", fmt: formatBool, prs: parseBool, kind: "boolean" },
      { field: "autoClick", fmt: formatBool, prs: parseBool, kind: "boolean" },
      { field: "minDelayMs", fmt: formatNum, prs: parseNum, kind: "number" },
      { field: "outdir", fmt: formatStr, prs: parseStr, kind: "text" },
      { field: "profileDir", fmt: formatStr, prs: parseStr, kind: "text" },
    ];
    var ZH = {
      title: "爬虫 pawl", description: "通用网页爬虫设置",
      f_enabled: "启用插件", f_engine: "默认引擎 (auto/http/crawl4ai/browser)", f_headless: "无头模式",
      f_autoClick: "自动过人机验证", f_minDelayMs: "抓取间隔 (ms)", f_outdir: "存储文件夹", f_profileDir: "浏览器 profile 目录",
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
          return { hooks: { pawlCard: store }, props: a, actions: a };
        },
      };
    }

    function Card(props) {
      var t = props.t || function (k) { return ZH[k] || k; };
      var useCard = props.usePawlCard;
      var state = useCard ? useCard(function (s) { return s; }) : { available: false, rows: [] };
      var open = import_react.useState(false);
      var setOpen = open[1]; open = open[0];
      if (!state.available) return null;
      var blocked = !state.dirty || state.invalid || state.saving;
      var h = import_react.createElement;
      var rows = (state.rows || []).map(function (r) {
        if (r.kind === "boolean") {
          return h("label", { key: r.field, style: { display: "flex", alignItems: "center", gap: 8, padding: "6px 0" } },
            h("select", { value: r.text, onChange: function (e) { props.edit(r.field, e.target.value); } },
              h("option", { value: "" }, "—"), h("option", { value: "true" }, "开"), h("option", { value: "false" }, "关")),
            h("span", null, r.label));
        }
        return h("label", { key: r.field, style: { display: "flex", alignItems: "center", gap: 8, padding: "6px 0" } },
          h("span", { style: { minWidth: 210, fontSize: 12 } }, r.label),
          h("input", { value: r.text, onChange: function (e) { props.edit(r.field, e.target.value); }, style: { flex: 1, maxWidth: 340, padding: "4px 8px", fontSize: 12 } }));
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
      ctx.effect(function () {
        return ctx.locale.register(NS, {
          zh: { title: ZH.title, description: ZH.description },
          en: { title: "Crawler pawl", description: "Universal web crawler settings" },
        });
      }, NS + ": dict");
      var scope = BridgeScope();
      var controller = Controller(scope);
      ctx.slots.inject("settings.plugin.item", function () {
        var unregister = ctx.slots.register({
          name: "settings.plugin.item", id: "dsh-crawler", order: 92, locale: NS,
          inject: function () { return controller.inject(); },
        }, Card);
        return function () { unregister(); };
      });
    };
    return module.exports;
  },
});
