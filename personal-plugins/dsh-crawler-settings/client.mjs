// dsh-crawler-settings — 把 dsh-crawler（pawl）的配置卡注册进设置页「插件配置」
// （settings.plugin.item 插槽），编辑 pawl 命名空间。
// 正规方式：React 组件 + ctx.slots.register + ctx.settingsScope + ctx.locale，
// 参考 dsh-client-auto-continue 的自包含卡片模式。
//
// ⚠️ REWRITE RULE: 本文件是 ModuleLoader 脚本契约，不是裸 ESM。
// factory 必须 `return module.exports`，且 module.exports 必须带 .apply。
window.__ModuleLoader__.load({
  id: "dsh-crawler-settings",
  factory: function (require) {
    var module = { exports: {} };
    var React = require("react");
    var useState = React.useState;
    var createSnapshotStore = require("@deepseek-ai/dsh-client-runtime/client").createSnapshotStore;

    var NS = "dsh-crawler-settings";
    var SETTINGS_NS = "pawl";
    var P = "dshCs";

    // ---- 样式：DSH 设计令牌，跟随主题 ----
    (function injectStyles() {
      if (document.getElementById("dsh-crawler-settings-style")) return;
      var st = document.createElement("style");
      st.id = "dsh-crawler-settings-style";
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
        "." + P + "Input,." + P + "Select{appearance:none;box-sizing:border-box;width:100%;height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:13.5px}",
        "." + P + "Input:focus-visible,." + P + "Select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}",
        "." + P + "InputInvalid{border-color:var(--dsw-alias-label-error)}",
        "." + P + "Input:disabled,." + P + "Select:disabled{opacity:.5}",
        "." + P + "Hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}",
        "." + P + "Invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}"
      ].join("\n");
      document.head.appendChild(st);
    })();

    // ---- 字段规格：存储值 ↔ 暂存草稿文本 ----
    function numberField(field, min) {
      return {
        field: field,
        format: function (v) { return typeof v === "number" ? String(v) : ""; },
        parse: function (text) {
          var t = text.trim();
          if (t === "") return { kind: "clear" };
          var n = Number(t);
          if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) return undefined;
          return { kind: "set", value: n };
        }
      };
    }
    function textField(field) {
      return {
        field: field,
        format: function (v) { return typeof v === "string" ? v : ""; },
        parse: function (text) {
          var t = text.trim();
          return t === "" ? { kind: "clear" } : { kind: "set", value: t };
        }
      };
    }
    function booleanField(field) {
      return {
        field: field,
        format: function (v) { return typeof v === "boolean" ? String(v) : ""; },
        parse: function (text) {
          var t = text.trim();
          if (t === "") return { kind: "clear" };
          if (t === "true") return { kind: "set", value: true };
          if (t === "false") return { kind: "set", value: false };
          return undefined;
        }
      };
    }
    function selectField(field, options) {
      return {
        field: field,
        format: function (v) { return typeof v === "string" && options.indexOf(v) >= 0 ? v : ""; },
        parse: function (text) {
          var t = text.trim();
          if (t === "") return { kind: "clear" };
          if (options.indexOf(t) >= 0) return { kind: "set", value: t };
          return undefined;
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
    var ENGINES = ["auto", "http", "crawl4ai", "browser"];
    var FIELDS = [
      { spec: booleanField("enabled"), labelKey: "enabledLabel", hintKey: "enabledHint", kind: "bool" },
      { spec: selectField("engine", ENGINES), labelKey: "engineLabel", hintKey: "engineHint", kind: "enum", options: ENGINES },
      { spec: booleanField("headless"), labelKey: "headlessLabel", hintKey: "headlessHint", kind: "bool" },
      { spec: booleanField("autoClick"), labelKey: "autoClickLabel", hintKey: "autoClickHint", kind: "bool" },
      { spec: numberField("minDelayMs", 0), labelKey: "minDelayMsLabel", hintKey: "minDelayMsHint", kind: "number", numeric: true },
      { spec: textField("outdir"), labelKey: "outdirLabel", hintKey: "outdirHint", kind: "text" },
      { spec: textField("profileDir"), labelKey: "profileDirLabel", hintKey: "profileDirHint", kind: "text" }
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
      var face = { hooks: { crawlerSettingsCard: this.store } };
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

    function FieldShell(props, control) {
      return h("div", { className: P + "Field" },
        h("div", { className: P + "Head" },
          h("label", { className: P + "Label", htmlFor: props.id }, props.label),
          props.overridden ? h("span", { className: P + "Badges" },
            h("span", { className: P + "Badge" }, props.t("overridden")),
            h("button", { type: "button", className: P + "Reset", disabled: props.disabled, onClick: props.onReset }, props.t("reset"))) : null),
        control,
        h("p", { className: props.invalid ? P + "Invalid" : P + "Hint" },
          props.invalid ? props.t("invalidValue") : props.hint));
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
      return FieldShell(props, input);
    }

    function SelectField(props) {
      var options = [h("option", { key: "", value: "" }, props.t("inherit"))];
      props.options.forEach(function (opt) {
        options.push(h("option", { key: opt, value: opt }, opt));
      });
      var select = h("select", {
        id: props.id,
        className: P + "Select",
        value: props.text,
        disabled: props.disabled,
        onChange: function (e) { props.onEdit(e.target.value); }
      }, options);
      return FieldShell(props, select);
    }

    function BooleanField(props) {
      var options = [
        h("option", { key: "", value: "" }, props.t("inherit")),
        h("option", { key: "true", value: "true" }, props.t("on")),
        h("option", { key: "false", value: "false" }, props.t("off"))
      ];
      var select = h("select", {
        id: props.id,
        className: P + "Select",
        value: props.text,
        disabled: props.disabled,
        onChange: function (e) { props.onEdit(e.target.value); }
      }, options);
      return FieldShell(props, select);
    }

    function CrawlerSettingsCard(props) {
      var state = props.useCrawlerSettingsCard(function (s) { return s; });
      var t = props.t;
      var children = [];
      for (var i = 0; i < FIELDS.length; i++) {
        (function (f) {
          var key = f.spec.field;
          var common = {
            key: key, id: "dsh-crawler-settings-" + key,
            label: t(f.labelKey), hint: t(f.hintKey),
            text: state[key].text, overridden: state[key].overridden, invalid: state[key].invalid,
            disabled: !state.writable, t: t,
            onEdit: function (text) { props.edit(key, text); },
            onReset: function () { props.resetField(key); }
          };
          if (f.kind === "bool") children.push(h(BooleanField, common));
          else if (f.kind === "enum") children.push(h(SelectField, Object.assign({}, common, { options: f.options })));
          else children.push(h(ValueField, Object.assign({}, common, { numeric: f.numeric, placeholder: f.kind === "text" ? "留空使用默认" : "" })));
        })(FIELDS[i]);
      }
      return h(SettingsCard, { t: t, state: state, onSave: props.save, onDiscard: props.discard }, children);
    }

    // ---- 文案 ----
    var zh = {
      title: "爬虫", description: "网页抓取引擎与行为（dsh-crawler / pawl）。",
      expand: "展开设置", collapse: "收起设置", unsaved: "未保存", readOnly: "当前部署只读，无法保存。",
      saveFailed: "保存失败，请重试。", saved: "已保存", discard: "放弃修改", save: "保存", saving: "保存中…",
      overridden: "已覆盖", reset: "重置", invalidValue: "该值不被接受，请检查格式。",
      inherit: "继承", on: "开", off: "关",
      enabledLabel: "启用爬虫", enabledHint: "关闭后移除爬虫工具与侧边栏卡片。",
      engineLabel: "抓取引擎", engineHint: "auto 按目标站点自动选择；http 最快；crawl4ai 渲染 JS；browser 全浏览器。",
      headlessLabel: "无头模式", headlessHint: "browser 引擎是否隐藏浏览器窗口。",
      autoClickLabel: "自动点击", autoClickHint: "browser 引擎自动点击 cookie/同意类弹窗。",
      minDelayMsLabel: "最小间隔（毫秒）", minDelayMsHint: "批量抓取时两次请求的最小间隔。",
      outdirLabel: "输出目录", outdirHint: "抓取结果保存目录，留空用默认。",
      profileDirLabel: "浏览器配置目录", profileDirHint: "browser 引擎的用户数据目录（登录态），留空用默认。"
    };
    var en = {
      title: "Crawler", description: "Web-fetch engine and behavior (dsh-crawler / pawl).",
      expand: "Expand", collapse: "Collapse", unsaved: "Unsaved", readOnly: "This deployment is read-only.",
      saveFailed: "Save failed, please retry.", saved: "Saved", discard: "Discard", save: "Save", saving: "Saving…",
      overridden: "Overridden", reset: "Reset", invalidValue: "This value is not accepted; check the format.",
      inherit: "Inherit", on: "On", off: "Off",
      enabledLabel: "Enable crawler", enabledHint: "Turn off to remove the crawler tools and sidebar card.",
      engineLabel: "Fetch engine", engineHint: "auto picks per site; http is fastest; crawl4ai renders JS; browser is full-browser.",
      headlessLabel: "Headless", headlessHint: "Hide the browser window for the browser engine.",
      autoClickLabel: "Auto-click", autoClickHint: "Auto-click cookie/consent popups in the browser engine.",
      minDelayMsLabel: "Min delay (ms)", minDelayMsHint: "Minimum delay between batch requests.",
      outdirLabel: "Output directory", outdirHint: "Where results are saved; empty for default.",
      profileDirLabel: "Browser profile dir", profileDirHint: "User-data dir (login state) for the browser engine; empty for default."
    };

    // ---- 接线 ----
    var inject = ["slots", "locale", "settingsScope"];
    function apply(ctx) {
      ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, "crawler-settings: dictionaries");
      var scope = ctx.settingsScope.bind({ namespace: SETTINGS_NS });
      var controller = new Controller(scope);
      ctx.slots.inject("settings.plugin.item", function () {
        return ctx.slots.register(
          { name: "settings.plugin.item", id: SETTINGS_NS, key: SETTINGS_NS, locale: NS, inject: function () { return controller.inject(); } },
          CrawlerSettingsCard);
      });
    }

    module.exports.inject = inject;
    module.exports.apply = apply;
    return module.exports;
  }
});
