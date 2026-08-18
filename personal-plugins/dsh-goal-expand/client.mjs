// dsh-goal-expand — goal 目标编辑时自动展开为多行。
// 显示态保持官方 GoalBar 的单行样式不动；点击编辑后，在官方单行 input 旁注入
// 真正的 textarea（input 无法换行是 DOM 硬限制），值双向同步进 React 状态，
// Cmd/Ctrl+Enter 保存、Esc 取消，与官方按钮完全兼容。
//
// ⚠️ REWRITE RULE: 本文件是 ModuleLoader 脚本契约，不是裸 ESM。
// factory 必须 `return module.exports`，且 module.exports 必须带 .apply。
window.__ModuleLoader__.load({
  id: "dsh-goal-expand",
  factory: function () {
    var module = { exports: {} };

    var MARK = "data-dsh-goal-expand";
    var TA_MARK = "data-dsh-goal-expand-ta";

    var CSS = [
      "textarea[" + TA_MARK + "]{box-sizing:border-box;width:100%;min-height:96px;padding:8px 12px;",
      "border:1px solid var(--dsw-alias-border-l2, rgba(168,200,232,0.18));border-radius:8px;",
      "background:var(--dsw-alias-bg-module-platform, rgba(28,52,100,0.64));",
      "color:var(--dsw-alias-label-primary, inherit);font:inherit;font-size:13.5px;line-height:1.6;",
      "resize:vertical;outline:none;margin:6px 0}",
      "textarea[" + TA_MARK + "]:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, #4c8dff);outline-offset:-1px}"
    ].join("");

    function ensureStyle() {
      if (document.getElementById("dsh-goal-expand-style")) return;
      var st = document.createElement("style");
      st.id = "dsh-goal-expand-style";
      st.textContent = CSS;
      document.head.appendChild(st);
    }

    function findBar() {
      return document.querySelector("[data-goal-bar]");
    }

    function findEditInput() {
      var bar = findBar();
      if (bar === null) return null;
      var input = bar.querySelector("input[class*='objectiveInput']");
      return input !== null ? input : null;
    }

    function autosize(ta) {
      ta.style.height = "auto";
      ta.style.height = Math.max(96, ta.scrollHeight + 4) + "px";
    }

    function barButtons() {
      var bar = findBar();
      if (bar === null) return [];
      var actions = bar.querySelector("div[class*='actions']");
      var list = actions !== null ? actions.querySelectorAll("button") : bar.querySelectorAll("button");
      return Array.prototype.slice.call(list);
    }

    function mount() {
      var input = findEditInput();
      if (input === null) return;
      if (input.hasAttribute(MARK)) return; // 已包过
      input.setAttribute(MARK, "1");
      ensureStyle();

      var ta = document.createElement("textarea");
      ta.setAttribute(TA_MARK, "1");
      ta.value = input.value;
      ta.setAttribute("aria-label", input.getAttribute("aria-label") || "编辑目标");
      ta.spellcheck = false;

      var inputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;

      ta.addEventListener("input", function () {
        inputSetter.call(input, ta.value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        autosize(ta);
      });
      ta.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          var btns = barButtons();
          var cancel = btns[btns.length - 1]; // actions 里最后一个 = 取消
          if (cancel !== undefined) cancel.click();
          return;
        }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          var btns2 = barButtons();
          var save = btns2[0]; // 第一个 = 保存
          if (btns2.length > 0 && save !== undefined) save.click();
        }
      });

      // input 藏起来但留在 DOM（React 拥有它，值继续走它同步进 draft）
      input.style.display = "none";
      input.insertAdjacentElement("afterend", ta);
      // goal bar 是固定高度，textarea 会被下边输入卡盖住——编辑期间撑开容器
      var bar = input.closest("div[class*='bar']") || input.parentElement;
      if (bar !== null) {
        bar.style.height = "auto";
        bar.style.minHeight = "36px";
        bar.style.overflow = "visible";
      }
      var dockEl = input.closest("[data-goal-bar]");
      if (dockEl !== null) { dockEl.style.height = "auto"; dockEl.style.overflow = "visible"; }
      autosize(ta);
      ta.focus();
      var n = ta.value.length;
      ta.setSelectionRange(n, n);
    }

    function cleanup() {
      // 编辑态结束（保存/取消后 React 卸掉 input）：还原撑开的容器样式
      if (findEditInput() === null) {
        var dockEl = document.querySelector("[data-goal-bar]");
        if (dockEl !== null && dockEl.style.height === "auto") {
          dockEl.style.height = ""; dockEl.style.overflow = "";
          var bar = dockEl.querySelector("div[class*='bar']");
          if (bar !== null) { bar.style.height = ""; bar.style.minHeight = ""; bar.style.overflow = ""; }
        }
      }
      var ta = document.querySelector("textarea[" + TA_MARK + "]");
      if (ta !== null && findEditInput() === null) ta.remove();
      var marked = document.querySelector("input[" + MARK + "]");
      if (marked !== null && marked.style.display === "none" && ta === null) {
        // input 还在但 ta 没了（异常路径）：恢复显示避免不可见输入
        marked.style.display = "";
        marked.removeAttribute(MARK);
      }
    }

    var timer = null;
    var pendingSince = 0;
    function apply() {
      var obs = new MutationObserver(function () {
        var now = Date.now();
        if (pendingSince === 0) pendingSince = now;
        if (timer !== null) clearTimeout(timer);
        // 铁律 2b：300ms 防抖 + 800ms 最大等待（高频 mutation 会饿死纯防抖）
        var wait = now - pendingSince >= 800 ? 0 : 300;
        timer = setTimeout(function () {
          pendingSince = 0;
          cleanup();
          mount();
        }, wait);
      });
      obs.observe(document.body, { childList: true, subtree: true });
      cleanup();
      mount();
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
    m.import("dsh-goal-expand").then(function (exp) {
      if (exp && typeof exp.apply === "function") exp.apply();
    }).catch(function () {});
  } catch (e) {}
}, 3000);
