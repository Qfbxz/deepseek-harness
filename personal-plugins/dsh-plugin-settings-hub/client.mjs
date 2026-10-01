// dsh-plugin-settings-hub — 「插件配置」设置分区宿主（2026-10-02）。
// 背景：rc.2 下官方 plugins.bundle.config 座位的声明者（client-ui-plugin-manager）
// 未装配；三卡瞄的 settings.plugin.item 是垫片私有座位，渲染层不消费。
// 本包照 vision-router 2.3.0 的稳定注册法（ctx.effect + slots.inject generator）
// 提供一个 settings.section 分区，消费三卡的 window.__compatCards 全局注册表，
// 并内置博查搜索配置卡（GET/POST /dsh-local/bocha-search/config）。
//
// ⚠️ REWRITE RULE: 本文件是 ModuleLoader 脚本契约，不是裸 ESM。
// factory 必须 `return module.exports`，且 module.exports 必须带 .apply。
window.__ModuleLoader__.load({
  id: "dsh-plugin-settings-hub",
  factory: function (require) {
    var module = { exports: {} };
    var React = require("react");
    var h = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;

    var NS = "plugin-settings-hub";
    var zh = {
      nav: "插件配置", title: "插件配置",
      desc: "第三方插件配置卡聚合（爬虫/上下文环/守卫/博查）。",
      bocha: "博查搜索", bochaApiKey: "API Key", bochaBaseURL: "接口地址",
      bochaHasKey: "已配置 Key", bochaCalls: "累计调用", bochaUpdatedAt: "更新于",
      bochaSave: "保存", bochaSaved: "已保存", bochaSaving: "保存中…",
      bochaUnavailable: "配置服务不可达（插件未启用或路由未挂载）。",
      bochaHint: "Key 只写不读：留空表示保持不变。",
      empty: "暂无已注册的配置卡。"
    };
    var en = {
      nav: "Plugin Settings", title: "Plugin Settings",
      desc: "Aggregated third-party plugin configuration cards.",
      bocha: "Bocha Search", bochaApiKey: "API Key", bochaBaseURL: "Base URL",
      bochaHasKey: "Key configured", bochaCalls: "Total calls", bochaUpdatedAt: "Updated",
      bochaSave: "Save", bochaSaved: "Saved", bochaSaving: "Saving…",
      bochaUnavailable: "Config service unreachable (plugin disabled or route not mounted).",
      bochaHint: "Write-only key: leave blank to keep the current one.",
      empty: "No cards registered yet."
    };

    // 各卡的 locale 词典命名空间(标签翻译真源;hub 自己的 t 只做兜底)
    var CARD_NS = {
      "pawl": "dsh-crawler-settings",
      "context-ring": "dsh-ring-settings",
      "bestharness-guard": "dsh-bestharness-guard"
    };
    var CARD_TITLES = {
      "pawl": { zh: "爬虫 (pawl)", en: "Crawler (pawl)" },
      "context-ring": { zh: "上下文环", en: "Context Ring" },
      "bestharness-guard": { zh: "守卫 (bestharness)", en: "Guard (bestharness)" }
    };

    var boxStyle = {
      border: "1px solid color-mix(in srgb, currentColor 18%, transparent)",
      borderRadius: "10px",
      padding: "12px 14px",
      margin: "0 0 14px"
    };
    var headStyle = { margin: "0 0 10px", fontSize: "13px", fontWeight: 600, letterSpacing: "0.02em" };
    var fieldStyle = { display: "grid", gridTemplateColumns: "130px 1fr", gap: "6px 10px", alignItems: "center", fontSize: "13px" };
    var inputStyle = {
      padding: "5px 8px", borderRadius: "6px", border: "1px solid color-mix(in srgb, currentColor 25%, transparent)",
      background: "transparent", color: "inherit", fontSize: "13px", width: "100%", boxSizing: "border-box"
    };
    var btnStyle = {
      padding: "5px 14px", borderRadius: "6px", border: "1px solid color-mix(in srgb, currentColor 35%, transparent)",
      background: "transparent", color: "inherit", cursor: "pointer", fontSize: "13px"
    };

    // ---- 博查搜索卡（内置；GET/POST /dsh-local/bocha-search/config） ----
    function BochaCard(props) {
      var p = props || {};
      var t = typeof p.t === "function" ? p.t : function (k) { return k; };
      var st = useState({ status: "loading", apiKey: "", baseURL: "", hasKey: false, count: null, updatedAt: null, save: "" });
      var state = st[0], setState = st[1];
      useEffect(function () {
        fetch("/dsh-local/bocha-search/config").then(function (r) { return r.ok ? r.json() : null; }).then(function (v) {
          if (!v || typeof v !== "object") { setState({ status: "unavailable", apiKey: "", baseURL: "", hasKey: false, count: null, updatedAt: null, save: "" }); return; }
          setState({ status: "ready", apiKey: "", baseURL: String(v.baseURL || ""), hasKey: !!v.hasApiKey, count: (v.count != null ? v.count : (v.totalCalls != null ? v.totalCalls : null)), updatedAt: v.updatedAt || null, save: "" });
        }).catch(function () { setState({ status: "unavailable", apiKey: "", baseURL: "", hasKey: false, count: null, updatedAt: null, save: "" }); });
      }, []);
      var setBase = function (e) { setState(function (s) { return Object.assign({}, s, { baseURL: e.target.value }); }); };
      var setKey = function (e) { setState(function (s) { return Object.assign({}, s, { apiKey: e.target.value }); }); };
      var save = function () {
        setState(function (s) { return Object.assign({}, s, { save: "saving" }); });
        var body = { baseURL: state.baseURL, totalCalls: state.count || 0 };
        if (state.apiKey) body.apiKey = state.apiKey;
        fetch("/dsh-local/bocha-search/config", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
        }).then(function (r) { return r.ok ? r.json() : null; }).then(function (v) {
          setState(function (s) { return Object.assign({}, s, { save: "saved", status: "ready", hasKey: s.hasKey || !!state.apiKey, apiKey: "", updatedAt: (v && v.updatedAt) || s.updatedAt }); });
        }).catch(function () { setState(function (s) { return Object.assign({}, s, { save: "error" }); }); });
      };
      if (state.status === "loading") return h("p", { style: { opacity: 0.7, fontSize: "13px" } }, "…");
      if (state.status === "unavailable") return h("p", { style: { opacity: 0.8, fontSize: "13px" } }, t("bochaUnavailable"));
      return h("section", { style: boxStyle },
        h("h3", { style: headStyle }, t("bocha")),
        h("div", { style: fieldStyle },
          h("label", null, t("bochaBaseURL")),
          h("input", { style: inputStyle, value: state.baseURL, onInput: setBase, spellCheck: false }),
          h("label", null, t("bochaApiKey")),
          h("input", { style: inputStyle, value: state.apiKey, placeholder: state.hasKey ? "••••••••" : "", onInput: setKey, spellCheck: false }),
          h("label", null, t("bochaHasKey")),
          h("span", null, state.hasKey ? "✓" : "—"),
          h("label", null, t("bochaCalls")),
          h("span", null, String(state.count != null ? state.count : "—") + (state.updatedAt ? " · " + t("bochaUpdatedAt") + " " + state.updatedAt : ""))
        ),
        h("div", { style: { display: "flex", alignItems: "center", gap: "10px", marginTop: "10px" } },
          h("button", { style: btnStyle, onClick: save }, state.save === "saving" ? t("bochaSaving") : t("bochaSave")),
          state.save === "saved" ? h("span", { style: { fontSize: "12px", opacity: 0.8 } }, "✓ " + t("bochaSaved")) : null,
          h("span", { style: { fontSize: "12px", opacity: 0.6 } }, t("bochaHint"))
        )
      );
    }

    // ---- 卡片包装：hooks 适配（照垫片 v2 原文）+ 崩溃隔离 ----
    function makeUseHook(store) {
      return function (selector) {
        var get = store.getSnapshot ? function () { return store.getSnapshot(); } : function () { return store.get(); };
        var sub = store.subscribe ? store.subscribe.bind(store) : function () { return function () {}; };
        return React.useSyncExternalStore(sub, function () { var s = get(); return selector ? selector(s) : s; }, function () { var s = get(); return selector ? selector(s) : s; });
      };
    }
    var ErrorBoundary = class extends React.Component {
      constructor(props) { super(props); this.state = { err: null }; }
      static getDerivedStateFromError(err) { return { err: err }; }
      componentDidCatch(err) { try { console.warn("[settings-hub] 卡渲染失败:", err && err.message); } catch (e) {} }
      render() {
        if (this.state.err) return h("p", { style: { color: "#c66", fontSize: "12px", margin: "0 0 10px" } },
          "⚠ 卡渲染失败: " + String((this.state.err && this.state.err.message) || this.state.err));
        return this.props.children;
      }
    };
    // props.t 永远 fallback（壳可能不传 props）
    // ⚠️ 包装组件必须按 key 缓存：心跳重渲染时若现场新建组件函数，
    //    React 会拆装重挂（state 归零→卡永远停在折叠/加载态，只显示标题条）。
    var wrappedCache = {};
    function getWrapped(key, Card, injectFactory, tFallback) {
      if (!wrappedCache[key]) {
        var cardT = tFallback;
        try { if (localeSvc && CARD_NS[key]) cardT = localeSvc.bind(CARD_NS[key]); } catch (e) {}
        wrappedCache[key] = wrapCard(Card, injectFactory, cardT);
      }
      return wrappedCache[key];
    }
    function wrapCard(Card, injectFactory, tFallback) {
      return function (props) {
        var merged = {};
        try { if (typeof injectFactory === "function") merged = injectFactory() || {}; } catch (e) {}
        merged = Object.assign({}, merged, props);
        if (typeof merged.t !== "function") merged.t = tFallback;
        try { merged.t("x"); } catch (te) { merged.t = tFallback; }
        var hooks = merged.hooks;
        if (hooks) {
          for (var hk in hooks) {
            if (!Object.prototype.hasOwnProperty.call(hooks, hk)) continue;
            merged["use" + hk.charAt(0).toUpperCase() + hk.slice(1)] = makeUseHook(hooks[hk]);
          }
          delete merged.hooks;
        }
        return h(ErrorBoundary, null, h(Card, merged));
      };
    }

    // ---- 分区组件：消费 __compatCards 注册表（1s 心跳重扫，卡可能在后注册） ----
    function HubSection(props) {
      var p = props || {};
      var t = typeof p.t === "function" ? p.t : function (k) { return k; };
      var tk = useState(0); var setTick = tk[1];
      useEffect(function () {
        var iv = setInterval(function () { setTick(function (n) { return n + 1; }); }, 1000);
        return function () { clearInterval(iv); };
      }, []);
      var lang = "zh";
      try { var snap = p.locale && p.locale.getSnapshot && p.locale.getSnapshot(); if (snap && snap.language) lang = snap.language; } catch (e) {}
      var cards = (typeof window !== "undefined" && window.__compatCards) || {};
      var injects = (typeof window !== "undefined" && window.__compatCardsInject) || {};
      var items = [];
      for (var key in cards) {
        if (!Object.prototype.hasOwnProperty.call(cards, key)) continue;
        try { items.push({ key: key, Card: cards[key], inject: injects[key] }); } catch (e) {}
      }
      return h("div", { "data-plugin-settings-hub": "1", tick: tk[0] },
        items.length === 0 ? h("p", { style: { opacity: 0.7, fontSize: "13px" } }, t("empty")) : null,
        items.map(function (it) {
          var title = (CARD_TITLES[it.key] && CARD_TITLES[it.key][lang]) || it.key;
          return h("div", { key: it.key, style: boxStyle },
            h("h3", { style: headStyle }, title),
            h(getWrapped(it.key, it.Card, it.inject, t)));
        }),
        h(ErrorBoundary, null, h(BochaCard, { t: t })));
    }

    // ---- 接线：vision-router 稳定注册法 ----
    var inject = ["slots", "locale"];
    var localeSvc = null;
    function apply(ctx) {
      localeSvc = ctx.locale;
      var t = ctx.locale.bind(NS);
      ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, "plugin-settings-hub: dictionaries");
      ctx.effect(function () {
        return ctx.slots.inject("settings.section", function* () {
          yield ctx.slots.register({
            name: "settings.section",
            id: "plugin-settings-hub",
            order: 126,
            label: function () { return t("nav"); },
            locale: NS,
            inject: function () { return { t: t, locale: ctx.locale }; }
          }, HubSection);
        });
      }, "plugin-settings-hub: section");
    }

    module.exports.inject = inject;
    module.exports.apply = apply;
    return module.exports;
  }
});
