// dsh-bestharness-guard — 浏览器半边：把「BestHarness 守卫」设置卡注册进设置页
// 「插件配置」标签（settings.plugin.item 插槽），编辑 bestharness-guard 命名空间的
// 三个 section（doom 防死循环梯子 / budget turn token 预算 / summary 子代理摘要门）。
// 设置服务是唯一数据源：scope.set 整段写入、unset 整段重置；卡片只做暂存草稿。
// 自包含卡片模式参考 dsh-ring-settings / dsh-client-auto-continue。
//
// ⚠️ REWRITE RULE: 本文件是 ModuleLoader 脚本契约，不是裸 ESM。
// factory 必须 `return module.exports`，且 module.exports 必须带 .apply。
window.__ModuleLoader__.load({
  id: "dsh-bestharness-guard",
  factory: function (require) {
    var module = { exports: {} };
    // ===== inline-heal（2026-10-01）：webUiSettings 服务缺失时的 bridge 兜底 =====
    // 蒸馏自 web-all 0.4.4 BridgeScopeController（/api/dsh-web-ui-settings 同源路由）。
    // 本卡因此零外部服务依赖：官方 webUiSettings 可用时优先官方，否则直连 bridge。
    var PREFIX = "/api/dsh-plugin-settings-hub";

    // ---- bridge fetch（同源 loopback；网络错误一律收敛为 ok:false 信封，绝不抛进激活链） ----
    function isBridgeResult(value) {
      if (typeof value !== "object" || value === null) return false;
      if (typeof value.ok !== "boolean") return false;
      if (value.ok) return typeof value.value === "object" && value.value !== null;
      return typeof value.code === "string" && typeof value.message === "string";
    }
    async function post(path, body) {
      try {
        var response = await fetch(PREFIX + path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        });
        if (!response.ok) return { ok: false, code: "internal", message: "bridge HTTP " + response.status };
        var parsed = await response.json();
        if (!isBridgeResult(parsed)) return { ok: false, code: "internal", message: "bridge malformed response" };
        return parsed;
      } catch {
        return { ok: false, code: "internal", message: "settings bridge unreachable" };
      }
    }

    // ---- 极简快照仓（subscribe / getSnapshot / update→notify，契约对齐 dsh-client-store） ----
    function createStore(initial) {
      var snapshot = initial;
      var listeners = [];
      return {
        getSnapshot: function () { return snapshot; },
        subscribe: function (listener) {
          listeners.push(listener);
          return function () {
            listeners = listeners.filter(function (l) { return l !== listener; });
          };
        },
        update: function (mutate) {
          var draft = {};
          for (var k in snapshot) draft[k] = snapshot[k];
          mutate(draft);
          snapshot = draft;
          for (var i = 0; i < listeners.length; i++) {
            try { listeners[i](); } catch (e) { console.error("[webuisettings-heal] listener", e); }
          }
        }
      };
    }

    // ---- 兼容 scope：对外即 webUiSettings.bind() 的返回值 ----
    // 协议（蒸馏自 web-all 0.4.4 BridgeScopeController，消费面以三卡为准）：
    //   subscribe(fn) / getSnapshot() / load() / set(field, value) / unset(field)
    //   mutateBatch(fields, expectedRevision) / get() / watch(fn)
    function makeScope(namespace) {
      var store = createStore({ status: "loading", value: undefined, user: undefined, base: undefined, revision: undefined, writable: true });
      var tail = Promise.resolve();
      var disposed = false;
      var entryId;

      function enqueue(operation) {
        if (disposed) return Promise.resolve(undefined);
        var task = tail.then(function () { return disposed ? undefined : operation(); });
        tail = task.catch(function () {});
        return task;
      }
      function accept(value, view, writable) {
        entryId = view.entryId;
        store.update(function (draft) {
          draft.revision = view.revision;
          draft.base = view.base;
          draft.user = view.user;
          if (writable !== undefined) draft.writable = writable;
          draft.status = "ready";
          draft.value = value;
        });
      }
      function read() {
        return enqueue(async function () {
          var result = await post("/describe", {});
          if (disposed) return;
          if (!result.ok) { store.update(function (d) { d.status = "unavailable"; }); return; }
          var view = (result.value.namespaces || []).find(function (c) { return c.ns === namespace; });
          if (view === undefined) {
            entryId = undefined;
            store.update(function (d) { d.status = "unavailable"; d.writable = result.value.writable; });
            return;
          }
          accept(view.value, view, result.value.writable);
        });
      }
      function writeOps(ops) {
        return enqueue(async function () {
          var revision = store.getSnapshot().revision;
          var payload = { ns: namespace, ops: ops };
          if (revision !== undefined) payload.expectedRevision = revision;
          var result = await post("/mutate", payload);
          if (disposed) return { ok: false, fields: [] };
          if (!result.ok) { await read(); return { ok: false, fields: [], code: result.code, message: result.message }; }
          accept(result.value.value, result.value, undefined);
          return { ok: true, fields: ops.map(function (op) { return { field: op.path.join("."), op: op.op, landed: true }; }) };
        });
      }
      var scope = {
        getSnapshot: function () { return store.getSnapshot(); },
        subscribe: function (fn) { return store.subscribe(fn); },
        watch: function (fn) { return store.subscribe(fn); },
        get: function () { return store.getSnapshot().value; },
        load: function () { return read(); },
        set: function (field, value) { return writeOps([{ op: "set", path: [field], value: value }]).then(function (r) { return r.ok; }); },
        unset: function (field) { return writeOps([{ op: "unset", path: [field] }]).then(function (r) { return r.ok; }); },
        mutate: function (fields) { return writeOps(fields.map(function (f) { return "value" in f ? { op: f.op, path: f.path || [f.field], value: f.value } : { op: f.op, path: f.path || [f.field] }; })).then(function (r) { return r.ok; }); },
        mutateBatch: function (fields, expectedRevision) { return writeOps(fields.map(function (f) { return "value" in f ? { op: f.op, path: f.path || [f.field], value: f.value } : { op: f.op, path: f.path || [f.field] }; })); },
        entryId: function () { return entryId; },
        dispose: async function () { disposed = true; await tail; }
      };
      read(); // 初始装载，卡激活后即有数据
      return scope;
    }

    function healBindScope(ctx, ns) {
      // 2026-10-02: 家族 binder 只认 linxin666 别名表——第三方 ns 必 unavailable,直连 settings-hub 桥
      return makeScope(ns);
    }

    var React = require("react");
    var useState = React.useState;
    var createSnapshotStore = require("@deepseek-ai/dsh-client-store").createSnapshotStore;

    var NS = "dsh-bestharness-guard";
    var SETTINGS_NS = "bestharness-guard";
    var P = "dshBh";

    // ---- 样式：DSH 设计令牌，跟随主题 ----
    (function injectStyles() {
      if (document.getElementById("dsh-bestharness-guard-style")) return;
      var st = document.createElement("style");
      st.id = "dsh-bestharness-guard-style";
      st.textContent = [
        "." + P + "Card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}",
        "." + P + "Card:hover{border-color:var(--dsw-alias-label-dimmed)}",
        "." + P + "CardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}",
        "." + P + "Header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:none;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}",
        "." + P + "Header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}",
        "." + P + "HeadText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}",
        "." + P + "Name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}",
        "." + P + "Description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}",
        "." + P + "Chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}",
        "." + P + "ChevronOpen{transform:rotate(180deg)}",
        "." + P + "Pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}",
        "." + P + "Body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}",
        "." + P + "ReadOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}",
        "." + P + "Footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}",
        "." + P + "Failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}",
        "." + P + "Saved{min-width:0;color:var(--dsw-alias-state-success-primary);flex:1;margin:0;font-size:12px;line-height:1.5}",
        "." + P + "Discard,." + P + "Save{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}",
        "." + P + "Discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:none}",
        "." + P + "Discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}",
        "." + P + "Save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}",
        "." + P + "Discard:disabled,." + P + "Save:disabled{opacity:.4;cursor:default}",
        "." + P + "Discard:focus-visible,." + P + "Save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
        "." + P + "Section{padding:12px 0;display:flex;flex-direction:column;gap:6px}",
        "." + P + "Section+" + P + "Section{border-top:1px solid var(--dsw-alias-border-l2)}",
        "." + P + "SectionHead{align-items:center;gap:8px;display:flex}",
        "." + P + "SectionTitle{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:600;line-height:1.5}",
        "." + P + "Badges{align-items:center;gap:8px;display:inline-flex}",
        "." + P + "Badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}",
        "." + P + "Reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:none;border:none;padding:0;font-size:12px;line-height:17px}",
        "." + P + "Reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}",
        "." + P + "Field{flex-direction:column;gap:6px;padding:8px 0 4px;display:flex}",
        "." + P + "Head{align-items:center;gap:8px;display:flex}",
        "." + P + "Label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}",
        "." + P + "Input{appearance:none;box-sizing:border-box;width:100%;height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:13.5px}",
        "." + P + "Input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}",
        "." + P + "InputInvalid{border-color:var(--dsw-alias-label-error)}",
        "." + P + "Input:disabled{opacity:.5}",
        "." + P + "Select{appearance:none;box-sizing:border-box;width:100%;height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:13.5px}",
        "." + P + "Select:disabled{opacity:.5}",
        "." + P + "Hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}",
        "." + P + "Invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}"
      ].join("\n");
      document.head.appendChild(st);
    })();

    // ---- 字段元数据：与 index.mjs 的 schemastery schema 同域 ----
    var SECTIONS = [
      {
        key: "doom", titleKey: "doomTitle", hintKey: "doomHint",
        fields: [
          { k: "enabled", type: "bool", labelKey: "doom.enabled", hintKey: "doom.enabledHint" },
          { k: "gentleAt", type: "int", min: 2, labelKey: "doom.gentleAt", hintKey: "doom.gentleAtHint" },
          { k: "detailedAt", type: "int", min: 3, labelKey: "doom.detailedAt", hintKey: "doom.detailedAtHint" },
          { k: "stopHintAt", type: "int", min: 4, labelKey: "doom.stopHintAt", hintKey: "doom.stopHintAtHint" },
          { k: "forceStopAt", type: "int", min: 6, labelKey: "doom.forceStopAt", hintKey: "doom.forceStopAtHint" },
          { k: "argumentsPreviewChars", type: "int", min: 50, labelKey: "doom.argumentsPreviewChars", hintKey: "doom.argumentsPreviewCharsHint" },
          { k: "include", type: "list", labelKey: "doom.include", hintKey: "doom.includeHint" },
          { k: "exclude", type: "list", labelKey: "doom.exclude", hintKey: "doom.excludeHint" }
        ]
      },
      {
        key: "budget", titleKey: "budgetTitle", hintKey: "budgetHint",
        fields: [
          { k: "enabled", type: "bool", labelKey: "budget.enabled", hintKey: "budget.enabledHint" },
          { k: "turnTokens", type: "int", min: 10000, labelKey: "budget.turnTokens", hintKey: "budget.turnTokensHint" },
          { k: "completionThreshold", type: "float", min: 0.5, max: 0.99, labelKey: "budget.completionThreshold", hintKey: "budget.completionThresholdHint" },
          { k: "diminishingDelta", type: "int", min: 50, labelKey: "budget.diminishingDelta", hintKey: "budget.diminishingDeltaHint" }
        ]
      },
      {
        key: "summary", titleKey: "summaryTitle", hintKey: "summaryHint",
        fields: [
          { k: "enabled", type: "bool", labelKey: "summary.enabled", hintKey: "summary.enabledHint" },
          { k: "minChars", type: "int", min: 50, labelKey: "summary.minChars", hintKey: "summary.minCharsHint" }
        ]
      }
    ];

    function fieldOf(sectionKey, fieldKey) {
      for (var i = 0; i < SECTIONS.length; i++) {
        if (SECTIONS[i].key !== sectionKey) continue;
        for (var j = 0; j < SECTIONS[i].fields.length; j++) {
          if (SECTIONS[i].fields[j].k === fieldKey) return SECTIONS[i].fields[j];
        }
      }
      return undefined;
    }

    // 草稿文本 ↔ 存储值。bool 用 "true"/"false"；list 用逗号分隔文本。
    function formatValue(meta, v) {
      if (meta.type === "bool") return v === true ? "true" : "false";
      if (meta.type === "list") return Array.isArray(v) ? v.join(", ") : "";
      return typeof v === "number" ? String(v) : "";
    }
    function parseValue(meta, text) {
      var t = text.trim();
      if (meta.type === "bool") return t === "true" ? { ok: true, value: true } : { ok: true, value: false };
      if (meta.type === "list") {
        if (t === "") return { ok: true, value: [] };
        return { ok: true, value: t.split(",").map(function (s) { return s.trim(); }).filter(function (s) { return s !== ""; }) };
      }
      if (t === "") return { ok: false };
      var n = Number(t);
      if (!Number.isFinite(n)) return { ok: false };
      if (meta.type === "int" && !Number.isInteger(n)) return { ok: false };
      if (n < meta.min) return { ok: false };
      if (meta.max !== undefined && n > meta.max) return { ok: false };
      return { ok: true, value: n };
    }

    // ---- 暂存表单：section 级整段写入，Host 是唯一权威 ----
    function GuardForm(scope) {
      this.scope = scope;
      this.staged = {}; // section -> { fieldKey: draftText }
      this.listeners = [];
      this.saving = false;
      this.failed = false;
      this.saved = false;
      var self = this;
      this.scope.subscribe(function () { self.publish(); });
    }
    GuardForm.prototype.bind = function (project) {
      var store = createSnapshotStore(project());
      var self = this;
      this.listeners.push(function () { store.set(project()); });
      return store;
    };
    GuardForm.prototype.sectionValue = function (sectionKey) {
      var v = this.scope.getSnapshot().value;
      return v !== undefined && v !== null && v[sectionKey] !== undefined ? v[sectionKey] : {};
    };
    GuardForm.prototype.stored = function (sectionKey) {
      var user = this.scope.getSnapshot().user;
      return user !== undefined && Object.prototype.hasOwnProperty.call(user, sectionKey);
    };
    // 一个 section 的暂存计划：{dirty, invalid, writes: {fieldKey: value}}
    GuardForm.prototype.sectionPlan = function (sectionKey) {
      var draft = this.staged[sectionKey];
      var effective = this.sectionValue(sectionKey);
      if (draft === undefined) return { dirty: false, invalid: false, writes: {} };
      var writes = {};
      var invalid = false;
      var dirty = false;
      for (var k in draft) {
        var meta = fieldOf(sectionKey, k);
        if (meta === undefined) continue;
        var parsed = parseValue(meta, draft[k]);
        if (!parsed.ok) { invalid = true; continue; }
        var current = formatValue(meta, effective[k]);
        if (draft[k] === current) continue;
        dirty = true;
        writes[k] = parsed.value;
      }
      return { dirty: dirty, invalid: invalid, writes: writes };
    };
    GuardForm.prototype.shell = function () {
      var snap = this.scope.getSnapshot();
      var dirty = false, invalid = false;
      for (var s in this.staged) {
        var plan = this.sectionPlan(s);
        dirty = dirty || plan.dirty;
        invalid = invalid || plan.invalid;
      }
      return { available: snap.status === "ready", writable: snap.writable, dirty: dirty, invalid: invalid, saving: this.saving, failed: this.failed, saved: this.saved };
    };
    // 一个字段的展示态：暂存草稿优先，否则生效值
    GuardForm.prototype.field = function (sectionKey, fieldKey) {
      var meta = fieldOf(sectionKey, fieldKey);
      var draft = this.staged[sectionKey];
      var text = draft !== undefined && draft[fieldKey] !== undefined
        ? draft[fieldKey]
        : formatValue(meta, this.sectionValue(sectionKey)[fieldKey]);
      var invalid = draft !== undefined && draft[fieldKey] !== undefined && !parseValue(meta, draft[fieldKey]).ok;
      return { text: text, invalid: invalid };
    };
    GuardForm.prototype.actions = function () {
      var self = this;
      return {
        edit: function (sectionKey, fieldKey, text) {
          if (self.staged[sectionKey] === undefined) self.staged[sectionKey] = {};
          self.staged[sectionKey][fieldKey] = text;
          self.failed = false; self.saved = false; self.publish();
        },
        resetSection: function (sectionKey) {
          // 整段 unset：回到 schema 默认（用户覆盖层删除）
          if (!self.stored(sectionKey)) return;
          self.saving = true; self.failed = false; self.publish();
          self.scope.unset(sectionKey).then(function () {
            self.saving = false; self.saved = true; self.publish();
            setTimeout(function () { self.saved = false; self.publish(); }, 2000);
          }).catch(function () {
            self.saving = false; self.failed = true; self.publish();
          });
        },
        save: function () { self.save(); },
        discard: function () {
          if (Object.keys(self.staged).length === 0 && !self.failed) return;
          self.staged = {}; self.failed = false; self.publish();
        }
      };
    };
    GuardForm.prototype.save = function () {
      var self = this;
      var sections = [];
      var invalid = false;
      for (var s in this.staged) {
        var plan = this.sectionPlan(s);
        if (plan.invalid) invalid = true;
        else if (plan.dirty) sections.push({ key: s, writes: plan.writes });
      }
      if (sections.length === 0 || this.saving || invalid) return;
      this.saving = true; this.failed = false; this.publish();
      var chain = Promise.resolve(true);
      sections.forEach(function (item) {
        chain = chain.then(function (prev) {
          if (!prev) return false;
          var merged = Object.assign({}, self.sectionValue(item.key), item.writes);
          return self.scope.set(item.key, merged).then(function () {
            var user = self.scope.getSnapshot().user;
            return user !== undefined && user[item.key] !== undefined;
          });
        });
      });
      chain.then(function (landed) {
        if (landed) self.staged = {};
        self.saving = false; self.failed = !landed; self.saved = landed; self.publish();
        if (landed) setTimeout(function () { self.saved = false; self.publish(); }, 2000);
      }).catch(function () {
        self.saving = false; self.failed = true; self.publish();
      });
    };
    GuardForm.prototype.publish = function () {
      for (var i = 0; i < this.listeners.length; i++) this.listeners[i]();
    };

    // ---- 控制器 ----
    function Controller(scope) {
      this.form = new GuardForm(scope);
      var self = this;
      this.store = this.form.bind(function () { return self.projection(); });
    }
    Controller.prototype.projection = function () {
      var out = this.form.shell();
      var self = this;
      SECTIONS.forEach(function (section) {
        var view = { overridden: self.form.stored(section.key), fields: {} };
        section.fields.forEach(function (f) { view.fields[f.k] = self.form.field(section.key, f.k); });
        out[section.key] = view;
      });
      return out;
    };
    Controller.prototype.inject = function () {
      var face = { hooks: { bestharnessGuardCard: this.store } };
      var actions = this.form.actions();
      for (var k in actions) face[k] = actions[k];
      return face;
    };

    // ---- React 卡片 ----
    var h = React.createElement;

    function SettingsCard(props) {
      var openState = useState(false);
      var open = openState[0], setOpen = openState[1];
      var state = props.state;
      if (!state.available) return null;
      var blocked = !state.dirty || state.invalid || state.saving;
      return h("li", { className: open ? P + "Card " + P + "CardOpen" : P + "Card" },
        h("button", {
          type: "button", className: P + "Header", "aria-expanded": open,
          "aria-label": props.t(open ? "collapse" : "expand") + ": " + props.t("title"),
          onClick: function () { setOpen(!open); }
        },
          h("span", { className: P + "HeadText" },
            h("span", { className: P + "Name" }, props.t("title")),
            h("span", { className: P + "Description" }, props.t("description"))),
          state.dirty ? h("span", { className: P + "Pending" }, props.t("unsaved")) : null,
          h("span", { className: open ? P + "Chevron " + P + "ChevronOpen" : P + "Chevron" }, "▾")),
        open ? h("div", { className: P + "Body" },
          !state.writable ? h("p", { className: P + "ReadOnly", role: "status" }, props.t("readOnly")) : null,
          props.children,
          h("div", { className: P + "Footer" },
            state.failed ? h("p", { className: P + "Failed", role: "status" }, props.t("saveFailed")) : null,
            state.saved && !state.failed ? h("p", { className: P + "Saved", role: "status" }, props.t("saved")) : null,
            h("button", { type: "button", className: P + "Discard", disabled: !state.dirty || state.saving, onClick: props.onDiscard }, props.t("discard")),
            h("button", { type: "button", className: P + "Save", disabled: blocked, onClick: props.onSave }, props.t(state.saving ? "saving" : "save")))) : null);
    }

    function SectionBlock(props) {
      var section = props.section;
      var view = props.state[section.key];
      var t = props.t;
      var children = [];
      for (var i = 0; i < section.fields.length; i++) {
        (function (f) {
          var id = "dsh-bh-" + section.key + "-" + f.k;
          var fieldState = view.fields[f.k];
          var common = {
            key: f.k, id: id, label: t(f.labelKey), hint: t(f.hintKey),
            text: fieldState.text, invalid: fieldState.invalid,
            disabled: !props.state.writable, t: t,
            onEdit: function (text) { props.edit(section.key, f.k, text); }
          };
          if (f.type === "bool") {
            children.push(h("div", { className: P + "Field", key: f.k },
              h("div", { className: P + "Head" }, h("label", { className: P + "Label", htmlFor: id }, t(f.labelKey))),
              h("select", {
                id: id, className: P + "Select", value: fieldState.text, disabled: !props.state.writable,
                onChange: function (e) { props.edit(section.key, f.k, e.target.value); }
              },
                h("option", { value: "true" }, t("on")),
                h("option", { value: "false" }, t("off"))),
              h("p", { className: P + "Hint" }, t(f.hintKey))));
          } else {
            children.push(h("div", { className: P + "Field", key: f.k },
              h("div", { className: P + "Head" }, h("label", { className: P + "Label", htmlFor: id }, t(f.labelKey))),
              h("input", {
                id: id,
                className: fieldState.invalid ? P + "Input " + P + "InputInvalid" : P + "Input",
                type: "text",
                inputMode: f.type === "int" || f.type === "float" ? "decimal" : undefined,
                "aria-invalid": fieldState.invalid || undefined,
                value: fieldState.text,
                disabled: !props.state.writable,
                onChange: function (e) { props.edit(section.key, f.k, e.target.value); }
              }),
              h("p", { className: fieldState.invalid ? P + "Invalid" : P + "Hint" },
                fieldState.invalid ? t("invalidValue") : t(f.hintKey))));
          }
        })(section.fields[i]);
      }
      return h("div", { className: P + "Section" },
        h("div", { className: P + "SectionHead" },
          h("span", { className: P + "SectionTitle" }, t(section.titleKey)),
          view.overridden ? h("span", { className: P + "Badges" },
            h("span", { className: P + "Badge" }, t("overridden")),
            h("button", {
              type: "button", className: P + "Reset", disabled: !props.state.writable,
              onClick: function () { props.resetSection(section.key); }
            }, t("reset"))) : null),
        h("p", { className: P + "Hint" }, t(section.hintKey)),
        children);
    }

    function BestharnessGuardCard(props) {
      var state = props.useBestharnessGuardCard(function (s) { return s; });
      if (!state || typeof state !== "object") state = { writable: false };
      if (typeof FIELDS !== "undefined" && FIELDS && FIELDS.length) {
        state = Object.assign({}, state);
        for (var fi = 0; fi < FIELDS.length; fi++) {
          var fk2 = FIELDS[fi].spec ? FIELDS[fi].spec.field : FIELDS[fi].field;
          if (!fk2) continue;
          if (!state[fk2] || typeof state[fk2] !== "object") state[fk2] = { text: "", overridden: false, invalid: false };
        }
      }
      var t = props.t;
      var children = [];
      for (var i = 0; i < SECTIONS.length; i++) {
        children.push(h(SectionBlock, {
          key: SECTIONS[i].key, section: SECTIONS[i], state: state, t: t,
          edit: props.edit, resetSection: props.resetSection
        }));
      }
      return h(SettingsCard, { t: t, state: state, onSave: props.save, onDiscard: props.discard }, children);
    }

    // ---- 文案 ----
    var zh = {
      title: "BestHarness 守卫", description: "防死循环梯子 + turn token 预算 + 子代理摘要质量门（五家 harness 源码分析结晶）。",
      expand: "展开设置", collapse: "收起设置", unsaved: "未保存", readOnly: "当前部署只读，无法保存。",
      saveFailed: "保存失败，请重试。", saved: "已保存", discard: "放弃修改", save: "保存", saving: "保存中…",
      overridden: "已覆盖", reset: "重置默认", on: "开启", off: "关闭", invalidValue: "请输入合法范围内的数值。",
      doomTitle: "四级防死循环梯子", doomHint: "同一工具同参数连续重复时逐级干预：温和提醒 → 详细提醒 → 强停提示 → block 拦截（Kimi CLI 语义）。",
      "doom.enabled": "启用防死循环", "doom.enabledHint": "关闭后完全不干预重复调用。",
      "doom.gentleAt": "温和提醒阈值（次）", "doom.gentleAtHint": "连续重复达到该次数时注入温和提醒。≥2。",
      "doom.detailedAt": "详细提醒阈值（次）", "doom.detailedAtHint": "附工具名/次数/参数预览的强提醒。≥3。",
      "doom.stopHintAt": "强停提示阈值（次）", "doom.stopHintAtHint": "要求停止工具调用、输出纯文本分析。≥4。",
      "doom.forceStopAt": "强制拦截阈值（次）", "doom.forceStopAtHint": "直接 block 该调用并要求收尾。≥6。",
      "doom.argumentsPreviewChars": "参数预览长度（字符）", "doom.argumentsPreviewCharsHint": "详细提醒里参数 JSON 的截断长度。≥50。",
      "doom.include": "只监控这些工具", "doom.includeHint": "逗号分隔工具名（支持 * 通配）。留空 = 监控全部。",
      "doom.exclude": "排除这些工具", "doom.excludeHint": "逗号分隔工具名（支持 * 通配）。优先于 include。",
      budgetTitle: "Turn Token 预算", budgetHint: "turn 级输出 token 预算与边际递减检测（Claude Code 语义）。默认关闭。",
      "budget.enabled": "启用 token 预算", "budget.enabledHint": "只在步边界注入一条 nudge，不硬停。",
      "budget.turnTokens": "turn 预算（tokens）", "budget.turnTokensHint": "单 turn 累计输出 token 上限。≥10000。",
      "budget.completionThreshold": "完成度阈值", "budget.completionThresholdHint": "输出进度达到该比例视为接近完成，放宽干预。0.5–0.99。",
      "budget.diminishingDelta": "边际递减阈值（tokens）", "budget.diminishingDeltaHint": "相邻步输出增量低于该值判定边际递减。≥50。",
      summaryTitle: "子代理摘要质量门", summaryHint: "子代理返回摘要过短时注入扩写指令（Kimi 语义）。默认关闭。",
      "summary.enabled": "启用摘要质量门", "summary.enabledHint": "每个子代理 turn 至多注入一次扩写指令。",
      "summary.minChars": "最短摘要长度（字符）", "summary.minCharsHint": "低于该长度触发扩写指令。≥50。"
    };
    var en = {
      title: "BestHarness Guard", description: "Doom-loop ladder + turn token budget + subagent summary gate (distilled from five harness codebases).",
      expand: "Expand", collapse: "Collapse", unsaved: "Unsaved", readOnly: "This deployment is read-only.",
      saveFailed: "Save failed, please retry.", saved: "Saved", discard: "Discard", save: "Save", saving: "Saving…",
      overridden: "Overridden", reset: "Reset", on: "On", off: "Off", invalidValue: "Enter a value within range.",
      doomTitle: "Doom-loop ladder", doomHint: "Escalating intervention on identical repeated calls: gentle → detailed → stop hint → block (Kimi CLI semantics).",
      "doom.enabled": "Enable doom guard", "doom.enabledHint": "Off = no intervention on repeats at all.",
      "doom.gentleAt": "Gentle reminder at (calls)", "doom.gentleAtHint": "Consecutive identical calls before a gentle nudge. >=2.",
      "doom.detailedAt": "Detailed reminder at (calls)", "doom.detailedAtHint": "Strong reminder with tool/count/args preview. >=3.",
      "doom.stopHintAt": "Stop hint at (calls)", "doom.stopHintAtHint": "Ask for text-only analysis, no more tool calls. >=4.",
      "doom.forceStopAt": "Force block at (calls)", "doom.forceStopAtHint": "Block the call and require wrap-up. >=6.",
      "doom.argumentsPreviewChars": "Args preview chars", "doom.argumentsPreviewCharsHint": "Truncation length for the args JSON in reminders. >=50.",
      "doom.include": "Include tools", "doom.includeHint": "Comma-separated tool names (* wildcard). Empty = all.",
      "doom.exclude": "Exclude tools", "doom.excludeHint": "Comma-separated tool names (* wildcard). Wins over include.",
      budgetTitle: "Turn token budget", budgetHint: "Per-turn output token budget with diminishing-delta detection (Claude Code semantics). Off by default.",
      "budget.enabled": "Enable token budget", "budget.enabledHint": "Injects one nudge per step boundary, never hard-stops.",
      "budget.turnTokens": "Turn budget (tokens)", "budget.turnTokensHint": "Output tokens allowed per turn. >=10000.",
      "budget.completionThreshold": "Completion threshold", "budget.completionThresholdHint": "Progress ratio treated as near-complete. 0.5-0.99.",
      "budget.diminishingDelta": "Diminishing delta (tokens)", "budget.diminishingDeltaHint": "Step-over-step output delta below this = diminishing returns. >=50.",
      summaryTitle: "Subagent summary gate", summaryHint: "Inject an expansion instruction when a subagent summary is too short (Kimi semantics). Off by default.",
      "summary.enabled": "Enable summary gate", "summary.enabledHint": "At most one expansion instruction per subagent turn.",
      "summary.minChars": "Minimum summary chars", "summary.minCharsHint": "Shorter summaries trigger the instruction. >=50."
    };

    // ---- 接线 ----（2026-10-01 settingsScope→webUiSettings，与 crawler-settings/ring-settings fork 同代）
    var inject = ["slots", "locale"];
    function apply(ctx) {
      ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, "bestharness-guard: dictionaries");
      var scope = healBindScope(ctx, SETTINGS_NS);
      var controller = new Controller(scope);
      // 2026-10-02: 立即发布到全局注册表（settings-hub 分区消费，不依赖死座位）
      (window.__compatCards = window.__compatCards || {})["bestharness-guard"] = BestharnessGuardCard;
      (window.__compatCardsInject = window.__compatCardsInject || {})["bestharness-guard"] = function () { return controller.inject(); };
      // 2026-10-01: slots.inject 挂钩可能不认垫片 _registerFactory 私有声明的座位——
      // 改轮询 spec 就绪后直接 register(带 try/catch 防撞已注册)
      var tryReg = function () {
        try {
          if (ctx.slots.spec("settings.plugin.item") === void 0) return false;
          ctx.slots.register(
            { name: "settings.plugin.item", id: SETTINGS_NS, key: SETTINGS_NS, locale: NS, inject: function () { return controller.inject(); } },
            BestharnessGuardCard);
          console.info("[bestharness-guard] 卡已注册到 settings.plugin.item");
          // 全局注册表(slots 渲染层绕行):垫片 CompatSection 直接 React 组装
          (window.__compatCards = window.__compatCards || {})["bestharness-guard"] = BestharnessGuardCard;
          (window.__compatCardsInject = window.__compatCardsInject || {})["bestharness-guard"] = function () { return controller.inject(); };
          return true;
        } catch (e) { if (/already/.test(e.message)) return true; console.warn("[bestharness-guard] 注册失败:", e.message); return false; }
      };
      if (!tryReg()) {
        var regTimer = setInterval(function () { if (tryReg()) clearInterval(regTimer); }, 500);
        setTimeout(function () { clearInterval(regTimer); }, 30000);
      }
    }

    module.exports.inject = inject;
    module.exports.apply = apply;
    return module.exports;
  }
});
