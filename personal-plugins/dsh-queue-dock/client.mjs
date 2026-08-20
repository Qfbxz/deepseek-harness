// dsh-queue-dock — 会话排队（排队消息 dock）双模式布局。
// 有 goal：独立行停在 goal 行上方，居中、宽度对齐输入卡；
// 无 goal：进 goal 行，git 分支/提交 chip 之后占右边余宽。
// 编辑排队消息时按正常文档流向上展开（不遮挡）。
//
// ⚠️ REWRITE RULE: 本文件是 ModuleLoader 脚本契约，不是裸 ESM。
// factory 必须 `return module.exports`，且 module.exports 必须带 .apply。
window.__ModuleLoader__.load({
  id: "dsh-queue-dock",
  factory: function () {
    var module = { exports: {} };

    // 官方 QueueDock 自带 data-queue-dock 属性——只认它，绝不碰 goal bar。
    // 旧版按 [class*="_dock"] 类名匹配会误抓 goal bar 的 dock 容器（同为
    // CSS-module *_dock 类名）：把它拽进 goal 行后 React 原位重渲染，出现
    // 两个目标条、提交按钮挤到目标条左边（2026-08-19 会话切换竞态实测）。
    function findQueueDock(host, row) {
      if (host === null) return null;
      for (var i = 0; i < host.children.length; i++) {
        var c = host.children[i];
        if (c === row || (row !== null && row.contains(c))) continue;
        // 真实排队 dock 渲染在插槽容器里：容器自身带 data-queue-dock，或内含该元素
        if (c.hasAttribute("data-queue-dock")) return c;
        if (c.querySelector("[data-queue-dock]") !== null) return c;
      }
      return null;
    }

    function findCard() {
      var ta = document.querySelector("textarea");
      return ta !== null ? ta.closest('[class*="_card"]') : null;
    }

    function place() {
      var row = document.getElementById("dshc-goal-git-row");
      var card = findCard();
      if (row === null || card === null) return;
      var host = card.parentElement;
      if (host === null) return;
      var qdock = findQueueDock(host, row);
      if (qdock === null) return;
      var goalBar = document.querySelector("[data-goal-bar]");
      if (goalBar === null) {
        // 无 goal：进 goal 行，chip 之后占余宽
        if (qdock.parentElement !== row) row.appendChild(qdock);
        if (qdock.style.flex !== "1 1 auto") qdock.style.flex = "1 1 auto";
        if (qdock.style.minWidth !== "0") qdock.style.minWidth = "0";
        if (qdock.style.width !== "") qdock.style.width = "";
        if (qdock.style.maxWidth !== "") qdock.style.maxWidth = "";
        if (qdock.style.margin !== "") qdock.style.margin = "";
      } else {
        // patch(hard-align): 独立行与会话数据框逐像素对齐——收敛式：按当前实测
        // 误差自校正（相对公式在条已有 margin 残留/自身定位时双重偏移出屏）
        if (qdock.parentElement !== host || qdock.nextElementSibling !== row) host.insertBefore(qdock, row);
        // 对齐参照 = 输入卡（2026-08-20 用户定稿：条与输入框左右边界对齐）
        var cr = card.getBoundingClientRect();
        var w = Math.round(cr.width) + "px";
        var qcur = qdock.getBoundingClientRect();
        var qML = parseFloat(getComputedStyle(qdock).marginLeft) || 0;
        var leftPx = Math.round(qML + (cr.left - qcur.left)) + "px";
        if (qdock.style.width !== w) qdock.style.width = w;
        if (qdock.style.maxWidth !== "none") qdock.style.maxWidth = "none";
        if (qdock.style.margin !== "0 0 0px") qdock.style.margin = "0 0 0px";
        if (qdock.style.marginLeft !== leftPx) qdock.style.marginLeft = leftPx;
        if (qdock.style.flex !== "0 0 auto") qdock.style.flex = "0 0 auto";
      }
    }

    var timer = null;
    var pendingSince = 0;
    function apply() {
      var obs = new MutationObserver(function () {
        var now = Date.now();
        if (pendingSince === 0) pendingSince = now;
        if (timer !== null) clearTimeout(timer);
        // 铁律 2b：300ms 防抖；但高频 mutation 页面（agent-teams 轮询等）会
        // 让防抖永远重置（饥饿）——超过 800ms 强制执行
        var wait = now - pendingSince >= 800 ? 0 : 300;
        timer = setTimeout(function () { pendingSince = 0; place(); }, wait);
      });
      obs.observe(document.body, { childList: true, subtree: true });
      place();
    }

    // 幂等闸：运行时应用或脚本体兜底，先到先得
    var applied = false;
    module.exports.apply = function () {
      if (applied) return;
      applied = true;
      apply();
    };
    return module.exports;
  }
});
// 兜底：装载器注册≠应用（运行时可能永不物化本模块）——3s 后自行 import 并应用。
// module.exports.apply 带幂等闸，运行时之后调用也不会双重应用。
setTimeout(function () {
  var m = window.__DSH_MODULES__;
  if (!m) return;
  try {
    m.import("dsh-queue-dock").then(function (exp) {
      if (exp && typeof exp.apply === "function") exp.apply();
    }).catch(function () {});
  } catch (e) {}
}, 3000);
