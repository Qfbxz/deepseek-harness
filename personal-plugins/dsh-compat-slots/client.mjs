// dsh-compat-slots — 0.2.0-rc.2 插槽兼容垫片（self-heal 体系 client 前哨）。
// 背景：0.2.0-alpha 的插件卡座位（plugins.bundle.config / web-ui.plugin.item /
// settings.plugin.item）在 0.2.0-rc.2 被官方移除（改 settings.plugins.tab /
// plugins.detail.section），第三方生态（web-all 家族、chat-import、fork 三卡）
// 全部停在 alpha 座位 → register 抛 "not declared" → 卡不渲染。
// 本垫片：① 探测并调用 slots.factory 声明三个 alpha 座位（注册不再抛）；
// ② 在活座位 settings.section 挂"兼容插件卡"聚合分区，renderSlot 消费旧座位。
window.__ModuleLoader__.load({
  id: "dsh-compat-slots",
  factory: function (require) {
    var module = { exports: {} };
    var React = require("react");
    var LEGACY_SEATS = ["web-ui.plugin.item", "settings.plugin.item"]; // plugins.bundle.config 官方 rc.2 组件仍声明(SlotCore 撞声明硬throw连累 plugin-manager),留给官方;chat-import 走其 settings.section/sidebar 活座位

    // store→hook 适配(0.1.7 壳的 hooks.xxx store 由壳转 useXxx;0.2.0 壳无此层,垫片自建)
    function makeWrappedCard(Card, injectFn) {
      return function WrappedCard(wprops) {
        var extra = {};
        try { extra = injectFn() || {}; } catch (e) { extra = {}; }
        // t 永远 fallback(壳 props.t=undefined 传进卡是雷);inject() 的 actions 覆盖在后
        var merged = Object.assign({ t: function (k) { return k; } }, extra);
        merged.t = merged.t || function (k) { return k; };
        try { merged.t("x"); } catch (te) { merged.t = function (k) { return k; }; }
        var hooks = merged.hooks;
        if (hooks) {
          for (var hk in hooks) {
            (function (store) {
              var useName = "use" + hk.charAt(0).toUpperCase() + hk.slice(1);
              merged[useName] = function (selector) {
                var get = store.getSnapshot ? function () { return store.getSnapshot(); } : function () { return store.get(); };
                var sub = store.subscribe ? store.subscribe.bind(store) : function () { return function () {}; };
                return React.useSyncExternalStore(sub, function () { var s = get(); return selector ? selector(s) : s; }, function () { var s = get(); return selector ? selector(s) : s; });
              };
            })(hooks[hk]);
          }
          delete merged.hooks;
        }
        try {
          console.info("[compat-slots] Wrapped 渲染:", merged.t ? "t✓" : "t✗", "| merged keys:", Object.keys(merged).join(","), "| hooks:", merged.hooks ? Object.keys(merged.hooks).join(",") : "无");
          return React.createElement(Card, merged);
        } catch (e) {
          console.error("[compat-slots] 卡 createElement 抛:", e.message);
          return React.createElement("div", { style: { color: "#c00", fontSize: 12 } }, "卡渲染失败: " + e.message);
        }
      };
    }

    function CompatSection(props) {
      // 时序免疫:卡 client 注册晚于分区首渲,秒级 tick 强制重渲染读最新注册表
      var tick = React.useState(0);
      React.useEffect(function () {
        var timer = setInterval(function () { tick[1](function (x) { return x + 1; }); }, 1000);
        return function () { clearInterval(timer); };
      }, []);
      try {
        // 0.2.0 壳调用 section 组件不传 props(props===undefined 实锤)——自给自足渲染
        return CompatSectionInner(props || {});
      } catch (e) {
        console.error("[compat-slots] 分区渲染抛错:", e && e.message, e && e.stack);
        try {
          return React.createElement("div", { style: { padding: 12, color: "#c00", fontSize: 13 } },
            React.createElement("div", null, "插件配置卡渲染出错: " + (e && e.message)),
            React.createElement("div", { style: { marginTop: 6, color: "var(--dsw-alias-label-secondary, #888)", fontSize: 12, fontFamily: "monospace", whiteSpace: "pre-wrap" } }, String(e && e.stack).slice(0, 500)));
        } catch (e2) { return null; }
      }
    }
    function CompatSectionInner(props) {
      var t = props.t || function (k) { return k; };
      try { t("desc"); } catch (te) { t = function (k) { return k; }; }
      var children = [];
      children.push(React.createElement("p", { key: "desc", style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 13, margin: 0 } }, t("desc")));
      // 主路:全局注册表直接 React 组装(绕开 slots 渲染层)
      var cards = window.__compatCards || {};
      var injects = window.__compatCardsInject || {};
      var names = { "pawl": "爬虫", "context-ring": "上下文环", "bestharness-guard": "BestHarness 守卫" };
      var rendered = 0;
      Object.keys(names).forEach(function (ns, i) {
        var Card = cards[ns];
        if (typeof Card !== "function") {
          children.push(React.createElement("li", { key: ns, style: { color: "var(--dsw-alias-label-secondary)", fontSize: 12, listStyle: "none" } }, names[ns] + " 卡未就绪(等待其 client 装载)"));
          return;
        }
        try {
          var Wrapped = makeWrappedCard(Card, injects[ns] || function () { return {}; });
          children.push(React.createElement("li", { key: ns, style: { listStyle: "none" } },
            React.createElement(Wrapped, { t: t })));
          rendered++;
        } catch (e) {
          children.push(React.createElement("li", { key: ns + "-err", style: { color: "#c00", fontSize: 12, listStyle: "none" } }, names[ns] + " 渲染失败: " + e.message));
        }
      });
      if (rendered === 0 && !window.__compatCards) {
        children.push(React.createElement("p", { key: "diag", style: { color: "var(--dsw-alias-label-secondary)", fontSize: 12 } }, "卡注册表未就绪。"));
      }
      return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } }, children);
    }
    var inject = ["slots", "locale"];
    // 对照实验开关：false = 只挂聚合分区不声明座位（诊断 plugin-manager failed 是否由 factory 声明连带）
    var ENABLE_FACTORY = true;
    function apply(ctx) {
      var proto = Object.getPrototypeOf(ctx.slots);
      var api = proto ? Object.getOwnPropertyNames(proto).join(",") : "?";
      console.info("[compat-slots] React:", React.version, "| useState:", typeof React.useState, "| useSyncExternalStore:", typeof React.useSyncExternalStore);
      console.info("[compat-slots] slots API:", api);
      // ① 声明 alpha 座位（私有 API _registerFactory：rc 代 factory 注册的下划线面）
      try {
        if (ENABLE_FACTORY) {
        var factoryApi = typeof ctx.slots._registerFactory === "function" ? "_registerFactory" : "factory";
        if (typeof ctx.slots[factoryApi] === "function") {
          var children = {};
          for (var i = 0; i < LEGACY_SEATS.length; i++) children[LEGACY_SEATS[i]] = { kind: "multi" };
          var def = { name: "compat-slots-host", children: children, registrant: "dsh-compat-slots" };
          try { ctx.slots[factoryApi](def); }
          catch (e1) { ctx.slots[factoryApi]("compat-slots-host", def); }
          var specOk = LEGACY_SEATS.every(function (s) { return ctx.slots.spec(s) !== void 0; });
          console.info("[compat-slots] " + factoryApi + " 声明 " + (specOk ? "成功，座位可查" : "已提交(spec 查询未证实)"));
        } else {
          console.warn("[compat-slots] factory API 均不可用，垫片只能提供聚合分区");
        }
        }
      } catch (e) { console.warn("[compat-slots] factory 声明失败:", e.message); }
      // ② 聚合分区【停用 2026-10-01 终版】:generator(vision-router 形态)+props 兜底+hook 适配
      // +轮询重渲染全套都上了,rc.2 的 ModuleLoader 形态第三方 section 仍时灵时不灵
      // (同代码不同 boot:desc 时在时不在)——正式打包形态(vision-router 式 manifest+inject)
      // 才被 rc.2 稳定支持。三卡配置数据层完好;rc.3 稳定后取消本段注释即复活。
      // 已沉淀完整修复链:generator 注册/label 函数/props 兜底/useSyncExternalStore 适配/state 安全化。
      // ② 聚合分区 v2(2026-10-01):0.2.0 inject 挂钩要求 generator(yield)形态
      // ——vision-router 2.3.0 活样本实锤,旧普通函数 return 被视为无产出
      // try {
      // ctx.effect(function () {
      // return ctx.slots.inject("settings.section", function* () {
      // try {
      // yield ctx.slots.register({
      // name: "settings.section",
      // id: "compat-plugin-cards",
      // order: 125,
      // label: function () { return "插件配置卡"; },
      // locale: "compat-slots",
      // inject: function () { return {}; }
      // }, CompatSection);
      // } catch (e2) { console.warn("[compat-slots] 分区注册拒绝:", e2.message); return function () {}; }
      // });
      // }, "compat-slots: section");
      // ctx.effect(function () {
      // return ctx.locale.register("compat-slots", {
      // zh: { desc: "0.2.0 座位兼容垫片聚合的第三方插件卡(爬虫/上下文环/守卫)。" },
      // en: { desc: "Third-party plugin cards aggregated by the rc.2 seat compat shim." }
      // });
      // }, "compat-slots: dictionaries");
      // } catch (e) { console.warn("[compat-slots] 分区初始化失败:", e.message); }
    }
    module.exports.inject = inject;
    module.exports.apply = apply;
    return module.exports;
  }
});
