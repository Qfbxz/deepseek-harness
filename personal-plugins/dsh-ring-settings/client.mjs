// dsh-ring-settings — 把 dsh-context-ring 的配置卡注册进设置页「插件配置」
// （settings.plugin.item 插槽），编辑 context-ring 命名空间。
// 正规方式：React 组件 + ctx.slots.register + ctx.settingsScope + ctx.locale，
// 参考 dsh-client-auto-continue 的自包含卡片模式。
//
// ⚠️ REWRITE RULE: 本文件是 ModuleLoader 脚本契约，不是裸 ESM。
// factory 必须 `return module.exports`，且 module.exports 必须带 .apply。
window.__ModuleLoader__.load({
  id: "dsh-ring-settings",
  factory: function (require) {
    var module = { exports: {} };
    var React = require("react");
    var useState = React.useState;
    var createSnapshotStore = require("@deepseek-ai/dsh-client-runtime/client").createSnapshotStore;

    var NS = "dsh-ring-settings";
    var SETTINGS_NS = "context-ring";
    var P = "dshRs";

    // ---- 样式：DSH 设计令牌，跟随主题 ----
    (function injectStyles() {
      if (document.getElementById("dsh-ring-settings-style")) return;
      var st = document.createElement("style");
      st.id = "dsh-ring-settings-style";
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
        "." + P + "Field{flex-direction:column;gap:6px;padding:12px 0;display:flex}",
        "." + P + "Field+." + P + "Field{border-top:1px solid var(--dsw-alias-border-l2)}",
        "." + P + "Head{align-items:center;gap:8px;display:flex}",
        "." + P + "Label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}",
        "." + P + "Badges{align-items:center;gap:8px;display:inline-flex}",
        "." + P + "Badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}",
        "." + P + "Reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:none;border:none;padding:0;font-size:12px;line-height:17px}",
        "." + P + "Reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}",
        "." + P + "Input{appearance:none;box-sizing:border-box;width:100%;height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:13.5px}",
        "." + P + "Input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}",
        "." + P + "InputInvalid{border-color:var(--dsw-alias-label-error)}",
        "." + P + "Input:disabled{opacity:.5}",
        "." + P + "ColorRow{align-items:center;gap:8px;display:flex}",
        "." + P + "Swatch{flex:none;width:34px;height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}",
        "." + P + "Hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}",
        "." + P + "Invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}"
      ].join("\n");
      document.head.appendChild(st);
    })();

    // ---- 字段规格：存储值 ↔ 暂存草稿文本 ----
    function numberField(field, min, max) {
      return {
        field: field,
        format: function (v) { return typeof v === "number" ? String(v) : ""; },
        parse: function (text) {
          var t = text.trim();
          if (t === "") return { kind: "clear" };
          var n = Number(t);
          if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || (max !== undefined && n > max)) return undefined;
          return { kind: "set", value: n };
        }
      };
    }
    function colorField(field) {
      return {
        field: field,
        format: function (v) { return typeof v === "string" ? v : ""; },
        parse: function (text) {
          var t = text.trim();
          if (t === "") return { kind: "clear" };
          if (!/^#[0-9a-fA-F]{6}$/.test(t)) return undefined;
          return { kind: "set", value: t.toLowerCase() };
        }
      };
    }

    // ---- 暂存表单：草稿只在保存时写入，Host 是唯一权威 ----
    function CardForm(scope, specs) {
      this.scope = scope;
      this.specs = {};
      for (var i = 0; i < specs.length; i++) this.specs[specs[i].field] = specs[i];
      this.staged = {};
      this.listeners = [];
      this.saving = false;
      this.failed = false;
      this.saved = false;
      var self = this;
      this.scope.subscribe(function () { self.publish(); });
    }
    CardForm.prototype.bind = function (project) {
      var store = createSnapshotStore(project());
      var self = this;
      this.listeners.push(function () { store.set(project()); });
      return store;
    };
    CardForm.prototype.shell = function () {
      var snap = this.scope.getSnapshot();
      var plan = this.plan();
      var invalid = plan.some(function (item) { return item.run === undefined; });
      return { available: snap.status === "ready", writable: snap.writable, dirty: plan.length > 0, invalid: invalid, saving: this.saving, failed: this.failed, saved: this.saved };
    };
    CardForm.prototype.field = function (field) {
      var spec = this.specs[field];
      var staged = this.staged[field];
      if (staged === undefined) {
        return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false };
      }
      var write = staged.clear ? { kind: "clear" } : spec.parse(staged.text);
      return { text: staged.text, overridden: write !== undefined && write.kind === "set", invalid: write === undefined };
    };
    CardForm.prototype.actions = function () {
      var self = this;
      return {
        edit: function (field, text) { self.staged[field] = { text: text, clear: false }; self.failed = false; self.saved = false; self.publish(); },
        resetField: function (field) { self.staged[field] = { text: self.specs[field].format(self.baseValue(field)), clear: true }; self.failed = false; self.publish(); },
        save: function () { self.save(); },
        discard: function () {
          var keys = Object.keys(self.staged);
          if (keys.length === 0 && !self.failed) return;
          self.staged = {}; self.failed = false; self.publish();
        }
      };
    };
    CardForm.prototype.save = function () {
      var self = this;
      var plan = this.plan();
      var writes = [];
      var ok = true;
      for (var i = 0; i < plan.length; i++) { if (plan[i].run === undefined) ok = false; else writes.push(plan[i]); }
      if (plan.length === 0 || this.saving || !ok) return;
      this.saving = true; this.failed = false; this.publish();
      var chain = Promise.resolve(true);
      writes.forEach(function (item) {
        chain = chain.then(function (prev) { return prev ? item.run() : false; });
      });
      chain.then(function (landed) {
        if (landed) for (var j = 0; j < writes.length; j++) delete self.staged[writes[j].field];
        self.saving = false; self.failed = !landed; self.saved = landed; self.publish();
        if (landed) setTimeout(function () { self.saved = false; self.publish(); }, 2000);
      }).catch(function () {
        self.saving = false; self.failed = true; self.publish();
      });
    };
    CardForm.prototype.plan = function () {
      var self = this;
      var plan = [];
      Object.keys(this.staged).forEach(function (field) {
        var staged = self.staged[field];
        var spec = self.specs[field];
        if (staged.clear) {
          if (self.stored(field)) plan.push({ field: field, run: function () { return self.clear(field); } });
          return;
        }
        if (staged.text === spec.format(self.sectionValue(field))) return;
        var write = spec.parse(staged.text);
        if (write === undefined) plan.push({ field: field, run: undefined });
        else if (write.kind === "clear") plan.push({ field: field, run: function () { return self.clear(field); } });
        else plan.push({ field: field, run: function () { return self.store(field, write.value); } });
      });
      return plan;
    };
    CardForm.prototype.clear = function (field) {
      var self = this;
      return this.scope.unset(field).then(function () { return !self.stored(field); });
    };
    CardForm.prototype.store = function (field, value) {
      var self = this;
      return this.scope.set(field, value).then(function () {
        var user = self.scope.getSnapshot().user;
        return user !== undefined && user[field] === value;
      });
    };
    CardForm.prototype.sectionValue = function (field) {
      var v = this.scope.getSnapshot().value;
      return v !== undefined && v !== null ? v[field] : undefined;
    };
    CardForm.prototype.baseValue = function (field) {
      var b = this.scope.getSnapshot().base;
      return b !== undefined && b !== null ? b[field] : undefined;
    };
    CardForm.prototype.stored = function (field) {
      var user = this.scope.getSnapshot().user;
      return user !== undefined && Object.prototype.hasOwnProperty.call(user, field);
    };
    CardForm.prototype.publish = function () {
      for (var i = 0; i < this.listeners.length; i++) this.listeners[i]();
    };

    // ---- 控制器：scope → 暂存表单 → 快照仓库 ----
    var FIELDS = [
      { spec: numberField("warnAt", 0, 100), labelKey: "warnAtLabel", hintKey: "warnAtHint", numeric: true },
      { spec: numberField("dangerAt", 0, 100), labelKey: "dangerAtLabel", hintKey: "dangerAtHint", numeric: true },
      { spec: colorField("warnColor"), labelKey: "warnColorLabel", hintKey: "warnColorHint", color: true },
      { spec: colorField("dangerColor"), labelKey: "dangerColorLabel", hintKey: "dangerColorHint", color: true }
    ];
    function Controller(scope) {
      this.form = new CardForm(scope, FIELDS.map(function (f) { return f.spec; }));
      var self = this;
      this.store = this.form.bind(function () { return self.projection(); });
    }
    Controller.prototype.projection = function () {
      var out = this.form.shell();
      for (var i = 0; i < FIELDS.length; i++) out[FIELDS[i].spec.field] = this.form.field(FIELDS[i].spec.field);
      return out;
    };
    Controller.prototype.inject = function () {
      var face = { hooks: { ringSettingsCard: this.store } };
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

    function ValueField(props) {
      var input = h("input", {
        id: props.id,
        className: props.invalid ? P + "Input " + P + "InputInvalid" : P + "Input",
        type: "text",
        inputMode: props.numeric ? "numeric" : undefined,
        "aria-invalid": props.invalid || undefined,
        value: props.text,
        placeholder: props.placeholder || "",
        disabled: props.disabled,
        onChange: function (e) { props.onEdit(e.target.value); }
      });
      return h("div", { className: P + "Field" },
        h("div", { className: P + "Head" },
          h("label", { className: P + "Label", htmlFor: props.id }, props.label),
          props.overridden ? h("span", { className: P + "Badges" },
            h("span", { className: P + "Badge" }, props.t("overridden")),
            h("button", { type: "button", className: P + "Reset", disabled: props.disabled, onClick: props.onReset }, props.t("reset"))) : null),
        props.color && /^#[0-9a-fA-F]{6}$/.test(props.text)
          ? h("div", { className: P + "ColorRow" }, h("span", { className: P + "Swatch", style: { background: props.text } }), input)
          : input,
        h("p", { className: props.invalid ? P + "Invalid" : P + "Hint" },
          props.invalid ? props.t(props.color ? "invalidColor" : "invalidNumber") : props.hint));
    }

    function RingSettingsCard(props) {
      var state = props.useRingSettingsCard(function (s) { return s; });
      var t = props.t;
      var children = [];
      for (var i = 0; i < FIELDS.length; i++) {
        (function (f) {
          var key = f.spec.field;
          children.push(h(ValueField, {
            key: key, id: "dsh-ring-settings-" + key,
            label: t(f.labelKey), hint: t(f.hintKey),
            numeric: f.numeric, color: f.color, placeholder: f.color ? "#rrggbb" : "",
            text: state[key].text, overridden: state[key].overridden, invalid: state[key].invalid,
            disabled: !state.writable, t: t,
            onEdit: function (text) { props.edit(key, text); },
            onReset: function () { props.resetField(key); }
          }));
        })(FIELDS[i]);
      }
      return h(SettingsCard, { t: t, state: state, onSave: props.save, onDiscard: props.discard }, children);
    }

    // ---- 文案 ----
    var zh = {
      title: "圆环配色", description: "上下文圆环的预警/危险阈值与颜色（dsh-context-ring）。",
      expand: "展开设置", collapse: "收起设置", unsaved: "未保存", readOnly: "当前部署只读，无法保存。",
      saveFailed: "保存失败，请重试。", saved: "已保存", discard: "放弃修改", save: "保存", saving: "保存中…",
      overridden: "已覆盖", reset: "重置", invalidNumber: "请输入范围内的整数。", invalidColor: "请输入 #rrggbb 格式的颜色。",
      warnAtLabel: "预警阈值（%）", warnAtHint: "上下文占比达到该值时圆环变为警告色。0–100，步进 5。",
      dangerAtLabel: "危险阈值（%）", dangerAtHint: "上下文占比达到该值时圆环变为危险色。0–100，步进 5。",
      warnColorLabel: "警告色", warnColorHint: "如 #f59e0b（橙）。清空则恢复默认。",
      dangerColorLabel: "危险色", dangerColorHint: "如 #ef4444（红）。清空则恢复默认。"
    };
    var en = {
      title: "Ring colors", description: "Warn/danger thresholds and colors for the context ring (dsh-context-ring).",
      expand: "Expand", collapse: "Collapse", unsaved: "Unsaved", readOnly: "This deployment is read-only.",
      saveFailed: "Save failed, please retry.", saved: "Saved", discard: "Discard", save: "Save", saving: "Saving…",
      overridden: "Overridden", reset: "Reset", invalidNumber: "Enter an integer within range.", invalidColor: "Enter a color as #rrggbb.",
      warnAtLabel: "Warn threshold (%)", warnAtHint: "Ring turns warn-colored at this context usage. 0–100, step 5.",
      dangerAtLabel: "Danger threshold (%)", dangerAtHint: "Ring turns danger-colored at this context usage. 0–100, step 5.",
      warnColorLabel: "Warn color", warnColorHint: "e.g. #f59e0b. Clear to restore the default.",
      dangerColorLabel: "Danger color", dangerColorHint: "e.g. #ef4444. Clear to restore the default."
    };

    // ---- 接线 ----
    var inject = ["slots", "locale", "settingsScope"];
    function apply(ctx) {
      ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, "ring-settings: dictionaries");
      var scope = ctx.settingsScope.bind({ namespace: SETTINGS_NS });
      var controller = new Controller(scope);
      ctx.slots.inject("settings.plugin.item", function () {
        return ctx.slots.register(
          { name: "settings.plugin.item", id: SETTINGS_NS, locale: NS, inject: function () { return controller.inject(); } },
          RingSettingsCard);
      });
    }

    module.exports.inject = inject;
    module.exports.apply = apply;
    return module.exports;
  }
});
