// dsh-git-commit — client 半边：goal 行的提交 chip（±N 未提交数）+ Codex 风格提交弹窗。
// 弹窗：提交信息（留空自动生成）、包含未暂存的更改（+N -M 徽章）、提交/提交并推送/推送。
// 仓库定位：当前选中会话的 cwd（fiber 取 sessionId 精确解析，与 git-graph 的
// byId[sessionId].cwd 同源语义；标题前缀匹配与最近会话仅作兜底——跨工作区
// 同前缀标题会错配）。
//
// ⚠️ REWRITE RULE: 本文件是 ModuleLoader 脚本契约，不是裸 ESM。
// factory 必须 `return module.exports`，且 module.exports 必须带 .apply。
window.__ModuleLoader__.load({
  id: "dsh-git-commit",
  factory: function () {
    var module = { exports: {} };

    var P = "dshGc";
    var CHIP_ID = "dsh-git-commit-chip";
    var PANEL_ID = "dsh-git-commit-panel";

    var CSS = [
      "#" + CHIP_ID + "{display:inline-flex;align-items:center;gap:4px;min-height:28px;padding:0 8px;line-height:20px;border:0;border-radius:16px;background:transparent;cursor:pointer;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary, inherit);flex:0 0 auto;transition:background-color .12s,color .12s}",
      "#" + CHIP_ID + ":hover{background:var(--dsw-alias-interactive-bg-hover, transparent)}",
      "#" + CHIP_ID + ":active{background:var(--dsw-alias-interactive-bg-active, transparent)}",
      "#" + CHIP_ID + ".dirty{color:var(--dsw-alias-brand-primary, #4c8dff)}",
      "." + P + "Num{font-weight:600}",
      "." + P + "Clean{opacity:.7}",
      "#" + PANEL_ID + "{position:fixed;z-index:60;width:380px;box-sizing:border-box;display:none;flex-direction:column;gap:10px;padding:14px;border:1px solid var(--dsw-alias-border-l2, rgba(168,200,232,0.18));border-radius:12px;background:var(--dsw-alias-bg-layer-2, #16233f);box-shadow:0 12px 32px rgba(0,0,0,.35);font:inherit}",
      "#" + PANEL_ID + "[data-open='1']{display:flex}",
      "." + P + "Head{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--dsw-alias-label-secondary, #a5b3da)}",
      "." + P + "Branch{font-weight:600;color:var(--dsw-alias-label-primary, inherit)}",
      "." + P + "HeadLabel{font-size:12.5px;color:var(--dsw-alias-label-secondary, #a5b3da);flex:0 0 auto}",
      "." + P + "BranchSel{font:inherit;font-size:12.5px;font-weight:600;max-width:150px;padding:2px 6px;border:1px solid var(--dsw-alias-border-l2, rgba(168,200,232,0.18));border-radius:6px;background:var(--dsw-alias-bg-module-platform, rgba(28,52,100,0.64));color:var(--dsw-alias-label-primary, inherit);cursor:pointer;outline:none}",
      "." + P + "Ab{font-size:11px;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-module-platform, rgba(127,150,190,0.15))}",
      "." + P + "Close{margin-left:auto;background:none;border:0;color:var(--dsw-alias-label-tertiary, #8896bd);font:inherit;font-size:14px;cursor:pointer;padding:0 4px}",
      "." + P + "Msg{box-sizing:border-box;width:100%;min-height:64px;max-height:160px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l2, rgba(168,200,232,0.18));border-radius:8px;background:var(--dsw-alias-bg-module-platform, rgba(28,52,100,0.64));color:var(--dsw-alias-label-primary, inherit);font:inherit;font-size:13px;line-height:1.55;resize:vertical;outline:none}",
      "." + P + "Msg:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, #4c8dff);outline-offset:-1px}",
      "." + P + "Opt{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--dsw-alias-label-primary, inherit);cursor:pointer;user-select:none}",
      "." + P + "Opt input{accent-color:var(--dsw-alias-brand-primary, #4c8dff);cursor:pointer}",
      "." + P + "Badge{font-size:11.5px;font-weight:600}",
      "." + P + "Add{color:#4ade80}",
      "." + P + "Del{color:#f87171}",
      "." + P + "Btns{display:flex;gap:8px}",
      "." + P + "Btn{flex:1;padding:6px 10px;border-radius:8px;font:inherit;font-size:12.5px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2, rgba(168,200,232,0.18));background:none;color:var(--dsw-alias-label-primary, inherit);white-space:nowrap}",
      "." + P + "Btn:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed, rgba(168,200,232,0.4))}",
      "." + P + "Btn:disabled{opacity:.45;cursor:default}",
      "." + P + "Primary{background:var(--dsw-alias-label-primary, #d8e5f5);color:var(--dsw-alias-bg-layer-3, #1c3464);border-color:transparent;font-weight:600}",
      "." + P + "Result{font-size:12px;line-height:1.5;min-height:16px;color:var(--dsw-alias-label-tertiary, #8896bd);word-break:break-all}",
      "." + P + "Err{color:var(--dsw-alias-label-error, #ef4444)}",
      "." + P + "Ok{color:#4ade80}"
    ].join("");

    // ---------- 状态 ----------
    var cwd = null;
    var cwdTitle = null;   // 解析 cwd 时的选中会话标题——变了就必须重解析，
                           // 否则切会话后提交面板还挂着上一个仓库的分支
    // ... existing states ...
    var status = null;      // {branch, ahead, behind, staged, unstaged, untracked, dirty}
    var panelOpen = false;
    var busy = false;
    var includeUnstaged = true;

    function ensureStyle() {
      if (document.getElementById("dsh-git-commit-style")) return;
      var st = document.createElement("style");
      st.id = "dsh-git-commit-style";
      st.textContent = CSS;
      document.head.appendChild(st);
    }

    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }

    // ---------- 仓库定位：选中会话的 cwd ----------
    function selectedTitle() {
      var sel = document.querySelector('[role="treeitem"][aria-selected="true"], [role="treeitem"][data-selected]');
      if (sel === null) return null;
      var spans = sel.querySelectorAll("span, div");
      var best = "";
      for (var i = 0; i < spans.length; i++) {
        var t = (spans[i].textContent || "").trim();
        if (t.length > best.length && t.length < 60) best = t;
      }
      return best || null;
    }

    // 选中会话行的 React fiber 携带视图模型 { id, title, ... }——id 即 sessionId。
    // 按它精确解析 cwd；标题前缀匹配只作兜底（跨工作区同前缀标题会张冠李戴，
    // 见 git-graph 的 byId[sessionId].cwd 同源语义）。
    function selectedSessionId() {
      var sel = document.querySelector('[role="treeitem"][aria-selected="true"], [role="treeitem"][data-selected]');
      if (sel === null) return null;
      var fk = null;
      for (var k in sel) if (k.indexOf("__reactFiber") === 0) { fk = k; break; }
      if (fk === null) return null;
      var f = sel[fk];
      for (var i = 0; i < 6 && f; i++) {
        var p = f.memoizedProps;
        if (p && typeof p === "object" && p.node && p.node.id && p.currentId !== undefined) return String(p.node.id);
        f = f.return;
      }
      return null;
    }

    function resolveCwd(force) {
      var title = selectedTitle();
      // 选中会话变了就必须重解析——否则切会话后提交面板还挂着上一个仓库的
      // 分支，与分支 chip（跟随活跃会话）不一致
      if (cwd !== null && !force && title === cwdTitle) return Promise.resolve(cwd);
      cwdTitle = title;
      return fetch("/api/session.list", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "client-request", rpcId: "gc-cwd", method: "session.list", payload: {} })
      }).then(function (r) { return r.json(); }).then(function (msg) {
        var items = (msg.result && msg.result.value && msg.result.value.items) || [];
        if (items.length === 0) return null;
        var sid = selectedSessionId();
        var pick = null;
        if (sid !== null) {
          for (var i = 0; i < items.length; i++) if (String(items[i].sessionId || "") === sid) { pick = items[i]; break; }
        }
        var title = selectedTitle();
        if (pick === null && title !== null) {
          for (var i = 0; i < items.length; i++) {
            var t = String(((items[i].projections || {}).values || {}).title || "");
            if (t && title.indexOf(t.slice(0, 12)) >= 0) { pick = items[i]; break; }
          }
        }
        if (pick === null) {
          pick = items[0];
          for (var j = 0; j < items.length; j++) if ((items[j].updatedAt || 0) > (pick.updatedAt || 0) && !items[j].blank) pick = items[j];
        }
        cwd = pick && pick.cwd ? pick.cwd : null;
        return cwd;
      }).catch(function () { return null; });
    }

    function fetchStatus() {
      return resolveCwd().then(function (dir) {
        if (dir === null) return null;
        return fetch("/api/dsh-git-commit/status?cwd=" + encodeURIComponent(dir))
          .then(function (r) { return r.json(); }).then(function (b) {
            status = b && b.ok ? b.status : null;
            return status;
          });
      }).catch(function () { status = null; return null; });
    }

    // ---------- chip ----------
    function buildChip() {
      var chip = el("div");
      chip.id = CHIP_ID;
      chip.title = "提交 / 推送";
      chip.setAttribute("role", "button");
      chip.setAttribute("aria-label", "提交与推送");
      var label = el("span", null, "⎇ 提交");
      label.id = CHIP_ID + "-label";
      var num = el("span", P + "Num", "");
      num.id = CHIP_ID + "-num";
      chip.appendChild(label); chip.appendChild(num);
      chip.addEventListener("click", function (e) {
        e.stopPropagation();
        togglePanel();
      });
      return chip;
    }

    function updateChip() {
      var chip = document.getElementById(CHIP_ID);
      if (chip === null) return;
      var num = document.getElementById(CHIP_ID + "-num");
      if (status === null) {
        chip.classList.remove("dirty");
        if (num !== null) { num.textContent = ""; num.className = P + "Num " + P + "Clean"; }
        return;
      }
      var total = status.staged.n + status.unstaged.n + status.untracked;
      chip.classList.toggle("dirty", status.dirty || status.ahead > 0);
      if (num !== null) {
        num.textContent = status.dirty ? "±" + total : (status.ahead > 0 ? "↑" + status.ahead : "✓");
        num.className = P + "Num";
      }
    }

    // patch(subagent-guard): 子代理页面不显示提交按钮（子代理不提交）。
    // 检测：会话层级导航存在多个 crumb（父/子层级，用“/”分隔）→ 子代理页面。
    function isSubagentPage() {
      // 子代理页面：会话层级导航存在多于 1 个 crumb（父/子层级，用“/”分隔）。
      // 普通页面只有当前会话 1 个 crumb，无分隔符。
      var nav = document.querySelector('nav[aria-label="会话层级"]');
      if (nav === null) return false;
      return nav.querySelectorAll('[class*="crumbSep"]').length > 0;
    }
    function placeChip() {
      // chip 只需存在（挂在 body）；定位由 dsh-desktop-chrome 统一负责：
      // position:fixed 钉在分支 chip 左边、与 tab 栏水平对齐。
      // 子代理页面不显示提交按钮（子代理不提交）。
      var existing = document.getElementById(CHIP_ID);
      if (isSubagentPage()) {
        if (existing !== null) existing.remove();
        return;
      }
      if (existing === null) {
        document.body.appendChild(buildChip());
      }
    }

    // ---------- 弹窗 ----------
    function buildPanel() {
      var p = el("div");
      p.id = PANEL_ID;
      p.setAttribute("data-open", "0");

      var head = el("div", P + "Head");
      var branchLabel = el("span", P + "HeadLabel", "提交到:");
      var branch = el("select", P + "BranchSel");
      branch.id = PANEL_ID + "-branch";
      branch.title = "提交到该分支";
      var ab = el("span", P + "Ab", "");
      ab.id = PANEL_ID + "-ab";
      var close = el("button", P + "Close", "×");
      close.type = "button";
      close.setAttribute("aria-label", "关闭");
      close.addEventListener("click", function () { togglePanel(false); });
      head.appendChild(branchLabel); head.appendChild(branch); head.appendChild(ab); head.appendChild(close);

      var msg = el("textarea", P + "Msg");
      msg.id = PANEL_ID + "-msg";
      msg.placeholder = "提交信息（留空将自动生成）…";
      msg.spellcheck = false;

      var opt = el("label", P + "Opt");
      var cb = el("input");
      cb.type = "checkbox";
      cb.id = PANEL_ID + "-cb";
      cb.checked = includeUnstaged;
      cb.addEventListener("change", function () { includeUnstaged = cb.checked; });
      var optText = el("span", null, "包含未暂存的更改");
      var badge = el("span", P + "Badge", "");
      badge.id = PANEL_ID + "-badge";
      opt.appendChild(cb); opt.appendChild(optText); opt.appendChild(badge);

      var btns = el("div", P + "Btns");
      function mkBtn(text, cls, action) {
        var b = el("button", P + "Btn" + (cls ? " " + cls : ""), text);
        b.type = "button";
        b.addEventListener("click", function () { action(); });
        return b;
      }
      var bCommit = mkBtn("提交", "", function () { run("commit"); });
      var bBoth = mkBtn("提交并推送", P + "Primary", function () { run("commit-push"); });
      var bPush = mkBtn("推送", "", function () { run("push"); });
      btns.appendChild(bCommit); btns.appendChild(bBoth); btns.appendChild(bPush);

      var result = el("div", P + "Result", "");
      result.id = PANEL_ID + "-result";

      p.appendChild(head); p.appendChild(msg); p.appendChild(opt); p.appendChild(btns); p.appendChild(result);
      document.body.appendChild(p);

      // 点击外部关闭
      document.addEventListener("click", function (e) {
        if (!panelOpen) return;
        var panel = document.getElementById(PANEL_ID);
        var chip = document.getElementById(CHIP_ID);
        if (panel === null) return;
        if (panel.contains(e.target) || (chip !== null && chip.contains(e.target))) return;
        togglePanel(false);
      }, true);
      return p;
    }

    function updatePanel() {
      var p = document.getElementById(PANEL_ID);
      if (p === null) return;
      var branch = document.getElementById(PANEL_ID + "-branch");
      var ab = document.getElementById(PANEL_ID + "-ab");
      var badge = document.getElementById(PANEL_ID + "-badge");
      if (status === null) {
        if (branch !== null) branch.textContent = cwd === null ? "未找到 git 仓库" : "非 git 仓库";
        if (ab !== null) ab.textContent = "";
        if (badge !== null) badge.textContent = "";
        return;
      }
      if (branch !== null) {
        var want = status.branch || "";
        var has = false;
        for (var bi = 0; bi < branch.options.length; bi++) if (branch.options[bi].value === want) { has = true; break; }
        if (!has && want !== "") branch.insertBefore(new Option(want, want), branch.firstChild);
        if (branch.value !== want) branch.value = want;
      }
      if (ab !== null) {
        var parts = [];
        if (status.ahead > 0) parts.push("↑" + status.ahead + " 待推送");
        if (status.behind > 0) parts.push("↓" + status.behind + " 落后");
        ab.textContent = parts.join(" · ");
      }
      if (badge !== null) {
        badge.textContent = "";
        var add = el("span", P + "Add", "+" + (status.unstaged.add + status.staged.add));
        var del = el("span", P + "Del", " -" + (status.unstaged.del + status.staged.del));
        badge.appendChild(add); badge.appendChild(del);
      }
    }

    function positionPanel() {
      var p = document.getElementById(PANEL_ID);
      var chip = document.getElementById(CHIP_ID);
      if (p === null || chip === null) return;
      var r = chip.getBoundingClientRect();
      var w = 380;
      var left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
      // patch(panel-below): the commit panel MUST open downward from the chip.
      // The old default opened upward (top - height - 8), which clipped against
      // the tab bar above; only an overflow past the viewport bottom falls back up.
      var top = r.bottom + 8;
      if (top + p.offsetHeight > window.innerHeight - 8) top = r.top - p.offsetHeight - 8;
      if (top < 8) top = 8;
      p.style.left = left + "px";
      p.style.top = top + "px";
    }

    function togglePanel(force) {
      var target = force === undefined ? !panelOpen : force;
      if (target === panelOpen) return;
      panelOpen = target;
      var p = document.getElementById(PANEL_ID);
      if (p === null && panelOpen) p = buildPanel();
      if (p === null) return;
      p.setAttribute("data-open", panelOpen ? "1" : "0");
      if (panelOpen) {
        fetchStatus().then(function () { updateChip(); updatePanel(); positionPanel(); });
        resolveCwd().then(function (dir) {
          if (dir === null) return;
          fetch("/api/dsh-git-commit/branches?cwd=" + encodeURIComponent(dir))
            .then(function (r) { return r.json(); }).then(function (b) {
              if (!b.ok) return;
              var sel = document.getElementById(PANEL_ID + "-branch");
              if (sel === null) return;
              var keep = sel.value || b.current;
              sel.textContent = "";
              b.branches.forEach(function (nm) { sel.appendChild(new Option(nm, nm)); });
              sel.value = keep && b.branches.indexOf(keep) >= 0 ? keep : b.current;
            }).catch(function () {});
        });
        var msg = document.getElementById(PANEL_ID + "-msg");
        if (msg !== null) setTimeout(function () { msg.focus(); }, 0);
      }
    }

    function setResult(text, ok) {
      var r = document.getElementById(PANEL_ID + "-result");
      if (r === null) return;
      r.textContent = text;
      r.className = P + "Result " + (ok === true ? P + "Ok" : ok === false ? P + "Err" : "");
    }

    function setBusy(b) {
      busy = b;
      var p = document.getElementById(PANEL_ID);
      if (p === null) return;
      var btns = p.querySelectorAll("." + P + "Btn");
      for (var i = 0; i < btns.length; i++) btns[i].disabled = b;
    }

    function run(action) {
      if (busy) return;
      resolveCwd(true).then(function (dir) {
        if (dir === null) { setResult("未找到当前会话的仓库目录", false); return; }
        setBusy(true);
        setResult("执行中…");
        var steps = [];
        if (action === "commit" || action === "commit-push") {
          var msgEl = document.getElementById(PANEL_ID + "-msg");
          steps.push(fetch("/api/dsh-git-commit/commit", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ cwd: dir, message: msgEl ? msgEl.value : "", includeUnstaged: includeUnstaged, targetBranch: (document.getElementById(PANEL_ID + "-branch") || {}).value || "" })
          }).then(function (r) { return r.json(); }).then(function (b) {
            if (!b.ok) throw new Error(b.error || "commit failed");
            return (b.switched || "") + "已提交 " + b.commit + "（" + b.message.slice(0, 40) + "）";
          }));
        }
        if (action === "push" || action === "commit-push") {
          steps.push(fetch("/api/dsh-git-commit/push", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ cwd: dir })
          }).then(function (r) { return r.json(); }).then(function (b) {
            if (!b.ok) throw new Error(b.error || "push failed");
            return "已推送";
          }));
        }
        return Promise.all(steps).then(function (msgs) {
          setResult(msgs.join(" · "), true);
          if (msgEl) msgEl.value = "";
          return fetchStatus();
        }).then(function () { updateChip(); updatePanel(); positionPanel(); });
      }).catch(function (e) {
        setResult(String(e && e.message ? e.message : e), false);
        return fetchStatus();
      }).then(function () { setBusy(false); });
    }

    // ---------- 挂载与刷新 ----------
    var timer = null;
    function mount() {
      ensureStyle();
      placeChip();
      updateChip();
    }

    function apply() {
      var obs = new MutationObserver(function () {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(mount, 300);
      });
      obs.observe(document.body, { childList: true, subtree: true });
      mount();
      // 每 12s 刷新状态（chip 徽章）；弹窗开着也顺带更新
      setInterval(function () {
        fetchStatus().then(function () { updateChip(); if (panelOpen) { updatePanel(); positionPanel(); } });
      }, 12000);
      fetchStatus().then(updateChip);
    }

    module.exports.apply = apply;
    return module.exports;
  }
});
