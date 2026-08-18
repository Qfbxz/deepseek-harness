// dsh-task-checklist — 输入卡上方的任务清单（checklist）停靠条。
// 单行摘要常驻；点开显示条目；条目点击进入多行编辑（自动增高）；
// 勾选/添加/删除；localStorage 持久化。位置规则：有 goal 时停在 goal 行
// 上方并留间隔，无 goal 时占 goal 的位置；全部正常文档流——展开时下方
// 内容同步下移，收起时同步上移，绝不遮挡。
//
// ⚠️ REWRITE RULE: 本文件是 ModuleLoader 脚本契约，不是裸 ESM。
// factory 必须 `return module.exports`，且 module.exports 必须带 .apply。
window.__ModuleLoader__.load({
  id: "dsh-task-checklist",
  factory: function () {
    var module = { exports: {} };

    var KEY = "dsh.taskChecklist.v1";
    var DOCK_ID = "dsh-checklist-dock";
    var P = "dshCl";

    var CSS = [
      "#" + DOCK_ID + "{display:flex;flex-direction:column;flex:0 0 auto;min-width:0;box-sizing:border-box;font:inherit;position:relative;z-index:5}",
      "html{scrollbar-gutter:stable}",
      "." + P + "Bar{display:flex;align-items:center;gap:8px;height:36px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2, rgba(168,200,232,0.18));border-radius:10px;background:var(--dsw-alias-bg-layer-3, transparent);cursor:pointer;user-select:none}",
      "." + P + "Bar:hover{border-color:var(--dsw-alias-label-dimmed, rgba(168,200,232,0.4))}",
      "." + P + "Glyph{flex:none;font-size:14px;line-height:1;color:var(--dsw-alias-label-secondary, #a5b3da)}",
      "." + P + "Summary{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--dsw-alias-label-primary, inherit)}",
      "." + P + "Summary .done{color:var(--dsw-alias-label-tertiary, #8896bd)}",
      "." + P + "Count{flex:none;font-size:11px;font-weight:500;line-height:17px;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-module-platform, rgba(127,150,190,0.15));color:var(--dsw-alias-label-secondary, #a5b3da)}",
      "." + P + "Chev{flex:none;transition:transform .15s ease;color:var(--dsw-alias-label-tertiary, #8896bd);background:none;border:0;font:inherit;font-size:12px;cursor:pointer;padding:2px}",
      "#" + DOCK_ID + "[data-open='1'] ." + P + "Chev{transform:rotate(180deg)}",
      "." + P + "List{display:none;flex-direction:column;gap:2px;margin-top:6px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2, rgba(168,200,232,0.18));border-radius:10px;background:var(--dsw-alias-bg-layer-2, transparent);max-height:40vh;overflow-y:auto}",
      "#" + DOCK_ID + "[data-open='1'] ." + P + "List{display:flex}",
      "." + P + "Item{display:flex;align-items:flex-start;gap:8px;padding:4px 2px;border-radius:6px}",
      "." + P + "Item:hover{background:var(--dsw-alias-bg-module-platform, rgba(127,150,190,0.08))}",
      "." + P + "Check{flex:none;margin-top:3px;accent-color:var(--dsw-alias-brand-primary, #4c8dff);cursor:pointer}",
      "." + P + "Grip{flex:none;cursor:grab;color:var(--dsw-alias-label-tertiary, #8896bd);font-size:13px;line-height:1.4;padding:0 2px;user-select:none}",
      "." + P + "Grip:active{cursor:grabbing}",
      "." + P + "Item.dragging{opacity:.35}",
      "." + P + "Item.dragover{box-shadow:0 -2px 0 0 var(--dsw-alias-brand-primary, #4c8dff)}",
      "." + P + "Text{flex:1;min-width:0;font-size:13px;line-height:1.55;color:var(--dsw-alias-label-primary, inherit);white-space:pre-wrap;word-break:break-word;cursor:text}",
      "." + P + "Text.done{text-decoration:line-through;color:var(--dsw-alias-label-tertiary, #8896bd)}",
      "." + P + "Del{flex:none;background:none;border:0;color:var(--dsw-alias-label-tertiary, #8896bd);font:inherit;font-size:14px;cursor:pointer;padding:0 4px;border-radius:4px;visibility:hidden}",
      "." + P + "Item:hover ." + P + "Del{visibility:visible}",
      "." + P + "Del:hover{color:var(--dsw-alias-label-error, #ef4444)}",
      "." + P + "Edit{display:flex;flex-direction:column;gap:6px;padding:6px 2px}",
      "." + P + "Ta{box-sizing:border-box;width:100%;min-height:72px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l2, rgba(168,200,232,0.18));border-radius:8px;background:var(--dsw-alias-bg-module-platform, rgba(28,52,100,0.64));color:var(--dsw-alias-label-primary, inherit);font:inherit;font-size:13px;line-height:1.6;resize:vertical;outline:none}",
      "." + P + "Ta:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, #4c8dff);outline-offset:-1px}",
      "." + P + "Actions{display:flex;justify-content:flex-end;gap:8px}",
      "." + P + "Btn{padding:4px 12px;border-radius:8px;font:inherit;font-size:12.5px;cursor:pointer;border:1px solid transparent}",
      "." + P + "Cancel{background:none;border-color:var(--dsw-alias-border-l2, rgba(168,200,232,0.18));color:var(--dsw-alias-label-secondary, #a5b3da)}",
      "." + P + "Ok{background:var(--dsw-alias-label-primary, #d8e5f5);color:var(--dsw-alias-bg-layer-3, #1c3464)}",
      "." + P + "New{align-self:flex-start;background:none;border:0;color:var(--dsw-alias-label-secondary, #a5b3da);font:inherit;font-size:12.5px;cursor:pointer;padding:4px 2px;border-radius:6px}",
      "." + P + "New:hover{color:var(--dsw-alias-label-primary, inherit);background:var(--dsw-alias-bg-module-platform, rgba(127,150,190,0.12))}",
      "." + P + "Empty{font-size:12.5px;color:var(--dsw-alias-label-tertiary, #8896bd);padding:2px 2px 4px}"
    ].join("");

    // ---------- 存储 ----------
    function load() {
      try {
        var raw = localStorage.getItem(KEY);
        if (raw === null) return [];
        var arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.filter(function (t) { return t && typeof t.id === "string" && typeof t.text === "string"; }) : [];
      } catch { return []; }
    }
    function save(tasks) {
      try { localStorage.setItem(KEY, JSON.stringify(tasks)); } catch { /* 存储满等异常：静默，内存态继续工作 */ }
    }

    // ---------- 状态 ----------
    var tasks = load();
    var open = false;
    var editingId = null;   // 正在编辑的条目 id；"__new__" 表示新条目
    var dragId = null;      // 拖拽排序中的条目 id
    var draft = "";

    function uid() { return "cl-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }

    // ---------- DOM ----------
    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }

    function summaryText() {
      if (tasks.length === 0) return "任务清单（空）";
      var done = tasks.filter(function (t) { return t.done; }).length;
      var next = null;
      for (var i = 0; i < tasks.length; i++) if (!tasks[i].done) { next = tasks[i]; break; }
      var head = "清单 " + done + "/" + tasks.length;
      if (next !== null) {
        var first = String(next.text).split("\n")[0];
        if (first.length > 40) first = first.slice(0, 40) + "…";
        return head + " · 下一步：" + first;
      }
      return head + " · 全部完成 ✓";
    }

    function autosize(ta) {
      ta.style.height = "auto";
      ta.style.height = Math.max(72, ta.scrollHeight + 4) + "px";
    }

    function buildEdit(item) {
      var wrap = el("div", P + "Edit");
      var ta = el("textarea", P + "Ta");
      ta.value = draft;
      ta.setAttribute("aria-label", "编辑任务清单条目");
      ta.spellcheck = false;
      var actions = el("div", P + "Actions");
      var cancel = el("button", P + "Btn " + P + "Cancel", "放弃");
      cancel.type = "button";
      var ok = el("button", P + "Btn " + P + "Ok", "保存");
      ok.type = "button";
      actions.appendChild(cancel); actions.appendChild(ok);
      wrap.appendChild(ta); wrap.appendChild(actions);

      var commit = function () {
        var text = ta.value.trim();
        if (text === "") { cancelEdit(); return; }
        if (editingId === "__new__") {
          tasks.push({ id: uid(), text: text, done: false });
        } else {
          for (var i = 0; i < tasks.length; i++) if (tasks[i].id === editingId) tasks[i].text = text;
        }
        editingId = null; draft = "";
        save(tasks); render();
      };
      var cancelEdit = function () { editingId = null; draft = ""; render(); };
      ok.addEventListener("click", commit);
      cancel.addEventListener("click", cancelEdit);
      ta.addEventListener("input", function () { autosize(ta); });
      ta.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
      });
      // 构建完成后聚焦（等 DOM 挂载）
      setTimeout(function () { ta.focus(); var n = ta.value.length; ta.setSelectionRange(n, n); autosize(ta); }, 0);
      return wrap;
    }

    function buildList() {
      var list = el("div", P + "List");
      if (tasks.length === 0 && editingId === null) {
        list.appendChild(el("p", P + "Empty", "还没有条目。点下方「＋ 添加条目」开始。"));
      }
      tasks.forEach(function (t) {
        if (t.id === editingId) { list.appendChild(buildEdit(t)); return; }
        var item = el("div", P + "Item");
        item.setAttribute("data-cl-id", t.id);
        var grip = el("span", P + "Grip", "\u2825");
        grip.title = "拖拽排序";
        grip.setAttribute("draggable", "true");
        grip.addEventListener("dragstart", function (e) {
          dragId = t.id;
          item.classList.add("dragging");
          try { e.dataTransfer.setData("text/plain", t.id); e.dataTransfer.effectAllowed = "move"; } catch {}
        });
        grip.addEventListener("dragend", function () {
          dragId = null;
          item.classList.remove("dragging");
          var marks = document.querySelectorAll("." + P + "Item.dragover");
          for (var m = 0; m < marks.length; m++) marks[m].classList.remove("dragover");
        });
        item.addEventListener("dragover", function (e) {
          if (dragId === null || dragId === t.id) return;
          e.preventDefault();
          item.classList.add("dragover");
        });
        item.addEventListener("dragleave", function () { item.classList.remove("dragover"); });
        item.addEventListener("drop", function (e) {
          e.preventDefault();
          item.classList.remove("dragover");
          if (dragId === null || dragId === t.id) return;
          var from = -1, to = -1;
          for (var i = 0; i < tasks.length; i++) {
            if (tasks[i].id === dragId) from = i;
            if (tasks[i].id === t.id) to = i;
          }
          if (from < 0 || to < 0) return;
          var moved = tasks.splice(from, 1)[0];
          tasks.splice(to, 0, moved);
          dragId = null;
          save(tasks); render();
        });
        var check = el("input", P + "Check");
        check.type = "checkbox";
        check.checked = !!t.done;
        check.setAttribute("aria-label", t.done ? "标记未完成" : "标记完成");
        check.addEventListener("change", function () {
          for (var i = 0; i < tasks.length; i++) if (tasks[i].id === t.id) tasks[i].done = check.checked;
          save(tasks); render();
        });
        var text = el("div", P + "Text" + (t.done ? " done" : ""), t.text);
        text.title = "点击编辑（多行）";
        text.addEventListener("click", function () {
          editingId = t.id; draft = t.text; render();
        });
        var del = el("button", P + "Del", "×");
        del.type = "button";
        del.setAttribute("aria-label", "删除条目");
        del.addEventListener("click", function () {
          tasks = tasks.filter(function (x) { return x.id !== t.id; });
          if (editingId === t.id) { editingId = null; draft = ""; }
          save(tasks); render();
        });
        item.appendChild(grip); item.appendChild(check); item.appendChild(text); item.appendChild(del);
        list.appendChild(item);
      });
      if (editingId === "__new__") list.appendChild(buildEdit(null));
      var add = el("button", P + "New", "＋ 添加条目");
      add.type = "button";
      add.addEventListener("click", function () { editingId = "__new__"; draft = ""; render(); });
      list.appendChild(add);
      return list;
    }

    function buildDock() {
      var dock = el("div");
      dock.id = DOCK_ID;
      dock.setAttribute("data-open", open ? "1" : "0");

      var bar = el("div", P + "Bar");
      bar.setAttribute("role", "button");
      bar.setAttribute("aria-expanded", open ? "true" : "false");
      bar.title = open ? "收起任务清单" : "展开任务清单";
      var glyph = el("span", P + "Glyph", "☑");
      var summary = el("span", P + "Summary");
      summary.id = DOCK_ID + "-summary";
      var count = el("span", P + "Count");
      count.id = DOCK_ID + "-count";
      var chev = el("button", P + "Chev", "▾");
      chev.type = "button";
      chev.setAttribute("aria-label", open ? "收起任务清单" : "展开任务清单");
      bar.appendChild(glyph); bar.appendChild(summary); bar.appendChild(count); bar.appendChild(chev);
      bar.addEventListener("click", function () {
        open = !open; updateOpen();
      });
      dock.appendChild(bar);

      var list = buildList();
      list.id = DOCK_ID + "-list";
      dock.appendChild(list);
      return dock;
    }

    // 开关展开/收起只改属性，绝不重建 DOM（重建会闪烁）
    function updateOpen() {
      var dock = document.getElementById(DOCK_ID);
      if (dock === null) { render(); return; }
      dock.setAttribute("data-open", open ? "1" : "0");
      var bar = dock.querySelector("." + P + "Bar");
      if (bar !== null) {
        bar.setAttribute("aria-expanded", open ? "true" : "false");
        bar.title = open ? "收起任务清单" : "展开任务清单";
      }
      var chev = dock.querySelector("." + P + "Chev");
      if (chev !== null) chev.setAttribute("aria-label", open ? "收起任务清单" : "展开任务清单");
    }

    function fillSummary(dock) {
      var summary = dock.querySelector("#" + DOCK_ID + "-summary");
      var count = dock.querySelector("#" + DOCK_ID + "-count");
      if (summary !== null) summary.textContent = summaryText();
      if (count !== null) count.textContent = tasks.length === 0 ? "0" : tasks.filter(function (t) { return t.done; }).length + "/" + tasks.length;
    }

    // 全量重建（条目少，代价可忽略；避免细粒度 DOM 同步的拉锯风险）
    function render() {
      var old = document.getElementById(DOCK_ID);
      var host = findHost();
      if (host === null) return;
      var next = old !== null ? old.nextElementSibling : null;
      var dock = buildDock();
      fillSummary(dock);
      if (old !== null) host.replaceChild(dock, old);
      else place(dock, host);
      void next;
    }

    function findHost() {
      var card = document.querySelector('[data-dshc-wide="1"][class*="_card"]')
        ?? (document.querySelector("textarea:not(." + P + "Ta)") !== null ? document.querySelector("textarea:not(." + P + "Ta)").closest('[class*="_card"]') : null);
      var host = card !== null ? card.parentElement : null;
      return host;
    }

    // 位置规则：有 goal → 独立整行停 goal 行上方（净间距 8px）；
    // 无 goal → 收窄挪进 goal 行（git chip 左、清单占余宽，即 goal 原本的位置）
    function place(dock, host) {
      var card = document.querySelector('[data-dshc-wide="1"][class*="_card"]')
        ?? (document.querySelector("textarea:not(." + P + "Ta)") !== null ? document.querySelector("textarea:not(." + P + "Ta)").closest('[class*="_card"]') : null);
      if (card === null) return;
      var goalRow = document.getElementById("dshc-goal-git-row");
      var goalBar = document.querySelector("[data-goal-bar]");
      var rowInHost = goalRow !== null && goalRow.parentElement === host;
      if (!goalBar && rowInHost) {
        // 无 goal：进 goal 行，chip 之后、占余宽（收窄）
        if (dock.parentElement !== goalRow) goalRow.appendChild(dock);
        if (dock.style.flex !== "1 1 auto") dock.style.flex = "1 1 auto";
        if (dock.style.minWidth !== "0") dock.style.minWidth = "0";
        if (dock.style.width !== "") dock.style.width = "";
        if (dock.style.margin !== "") dock.style.margin = "";
        if (dock.style.marginBottom !== "") dock.style.marginBottom = "";
        return;
      }
      if (card.parentElement !== host) return;
      var anchor = rowInHost ? goalRow : card;
      // 位置没变就绝不动节点——insertBefore 即使原地也会触发 DOM 移动并使内部焦点丢失
      if (dock.parentElement !== host || dock.nextElementSibling !== anchor) host.insertBefore(dock, anchor);
      // 宽度对齐输入卡；有 goal 时与 goal 行留出间隔
      var w = Math.round(card.getBoundingClientRect().width) + "px";
      if (dock.style.width !== w) dock.style.width = w;
      if (dock.style.margin !== "0 auto") dock.style.margin = "0 auto";
      if (dock.style.flex !== "0 0 auto") dock.style.flex = "0 0 auto";
      // goal 行自带 marginTop 14px（desktop-chrome 设定，flex 内边距不折叠）；
      // -6px 抵消后净间距 8px，与 goal↔输入框一致
      var gap = rowInHost ? "-6px" : "8px";
      if (dock.style.marginBottom !== gap) dock.style.marginBottom = gap;
    }

    function ensureStyle() {
      if (document.getElementById("dsh-task-checklist-style")) return;
      var st = document.createElement("style");
      st.id = "dsh-task-checklist-style";
      st.textContent = CSS;
      document.head.appendChild(st);
    }

    // ---------- 挂载与保持 ----------
    function mount() {
      ensureStyle();
      var dock = document.getElementById(DOCK_ID);
      if (dock === null) {
        var host = findHost();
        if (host === null) return;
        render(); // render 内部完成放置
        return;
      }
      // 已存在：校正位置与宽度（host 从输入卡重算——dock 可能正处在 goal 行内）
      place(dock, findHost());
      fillSummary(dock);
    }

    var timer = null;
    function apply() {
      var obs = new MutationObserver(function () {
        if (timer !== null) clearTimeout(timer);
        // 铁律 2b：300ms 防抖
        timer = setTimeout(mount, 300);
      });
      obs.observe(document.body, { childList: true, subtree: true });
      // 自动收缩：点击清单外部且不在编辑态时收起（编辑中不收，避免丢草稿）
      document.addEventListener("click", function (e) {
        if (!open || editingId !== null) return;
        var dock = document.getElementById(DOCK_ID);
        if (dock === null || dock.contains(e.target)) return;
        open = false;
        updateOpen();
      }, true);
      mount();
    }

    module.exports.apply = apply;
    return module.exports;
  }
});
