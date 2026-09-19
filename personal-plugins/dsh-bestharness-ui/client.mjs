/* dsh-bestharness-ui v24 — 原生状态条增强（补丁式，原生源码零改动）：
 * [✳动画] 原生 Deep diving.../任务文字 [↓ tokens · tokens/s] 原生秒数。
 * 原生文字与秒数完全不动；动画与用量经 data-* 属性 + CSS 伪元素注入。
 * 另保留：历史徽标（hover）+ /clear。 */
window.__ModuleLoader__.load({
  id: "dsh-bestharness-ui",
  factory: function () {
"use strict";
  var P = "bhui";
  function injectStyles() {
    if (document.getElementById(P + "-style")) return;
    var st = document.createElement("style"); st.id = P + "-style";
    st.textContent = [
      '[data-turn-tail][data-bhui-tok]::after{content:attr(data-bhui-tok);display:inline-flex;align-items:center;margin-left:10px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);font-size:12px;line-height:28px;white-space:nowrap;opacity:0;transition:opacity 80ms;pointer-events:none;}',
      '[data-turn-tail][data-bhui-tok]:hover::after{opacity:1}',
      '@keyframes ' + P + 'Glyph{0%,9%{content:"·"}10%,19%{content:"✢"}20%,29%{content:"✳"}30%,39%{content:"✶"}40%,49%{content:"✻"}50%,59%{content:"✽"}60%,69%{content:"✻"}70%,79%{content:"✶"}80%,89%{content:"✳"}90%,100%{content:"✢"}}',
      '[data-bhui-live]::before{content:"·";display:inline-flex;align-items:center;justify-content:center;width:1.2em;height:1em;vertical-align:middle;overflow:hidden;margin-right:6px;color:var(--dsw-alias-brand-primary,#e2954d);animation:' + P + 'Glyph 1.44s steps(1,end) infinite;}',
      '[data-bhui-live]::after{content:"  ↓ " attr(data-bhui-tok) " tokens · " attr(data-bhui-tps);display:inline-block;margin-left:8px;white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:500;color:var(--dsw-alias-label-secondary,#e6e9ef);}',
      '@media (prefers-reduced-motion:reduce){[data-bhui-live]::before{animation:none;content:"●"}}'
    ].join("\n");
    document.head.appendChild(st);
  }
  function fmtTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return String(Math.round(n));
  }
  var badgeTurns = Object.create(null);
  var currentSessionId = null;
  function collectChatViewTails() {
    var cv = document.querySelector('[class*="chatView"]') || document.querySelector("main") || document.body;
    var all = cv.querySelectorAll("div[data-turn-tail]");
    if (all.length === 0) all = document.querySelectorAll("div[data-turn-tail]");
    return Array.from(all);
  }
  function resolveChatSession(j) {
    var tails = collectChatViewTails();
    if (tails.length === 0) return null;
    var sample = parseInt(tails[tails.length - 1].getAttribute("data-turn-tail"), 10);
    if (!Number.isFinite(sample)) return null;
    var best = null, bestAt = 0;
    for (var sid in j.sessions) {
      if (!Object.prototype.hasOwnProperty.call(j.sessions, sid)) continue;
      var t = j.sessions[sid].turns;
      if (t && Object.prototype.hasOwnProperty.call(t, String(sample))) {
        var at = j.sessions[sid].lastUsageAt || 0;
        if (at >= bestAt) { best = sid; bestAt = at; }
      }
    }
    return best;
  }
  function pickSession(j) {
    if (currentSessionId && j.sessions[currentSessionId]) return { sid: currentSessionId, data: j.sessions[currentSessionId] };
    var sid = resolveChatSession(j);
    return sid ? { sid: sid, data: j.sessions[sid] } : null;
  }
  function refreshBadges(j) {
    var pick = pickSession(j);
    if (pick && pick.data.turns) badgeTurns = pick.data.turns;
    paintBadges();
  }
  function paintBadges() {
    var tails = collectChatViewTails();
    for (var i = 0; i < tails.length; i++) {
      var el = tails[i];
      if (el.nodeType !== 1) continue;
      var n = parseInt(el.getAttribute("data-turn-tail"), 10);
      if (!Number.isFinite(n)) continue;
      var ent = badgeTurns[String(n)];
      var want = ent ? ("\u2193 " + fmtTokens(ent.tok !== undefined ? ent.tok : ent) + (ent.steps ? " \u00b7 " + ent.steps + "\u6b65" : "")) : null;
      var cur = el.getAttribute("data-bhui-tok");
      if (cur !== want) {
        if (want === null) el.removeAttribute("data-bhui-tok");
        else el.setAttribute("data-bhui-tok", want);
      }
    }
  }
  // ---- 原生状态条增强：前面动画 + 后面 tokens·速度（原生文字/秒数不动）----
  var spin = { sid: null, target: 0, displayed: 0, lastSampleAt: 0, tps: 0, lastGrowthAt: 0, smoothTps: 0 };
  function findTurnStatus(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll('[role="status"][aria-live="polite"]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].className && String(nodes[i].className).indexOf("turnStatus") >= 0) return nodes[i];
    }
    var byClass = scope.querySelectorAll('[class*="turnStatus"]');
    return byClass.length > 0 ? byClass[byClass.length - 1] : null;
  }
  function setAttr(el, k, v) { if (el.getAttribute(k) !== v) el.setAttribute(k, v); }
  function updateSpinner(j) {
    var el = findTurnStatus(document);
    if (el === null) { spin.sid = null; return; }
    var pick = pickSession(j);
    var active = pick !== null && (pick.data.openTools > 0 || (j.now - pick.data.lastUsageAt) < 8000);
    if (!active) {
      if (el.hasAttribute("data-bhui-live")) el.removeAttribute("data-bhui-live");
      spin.sid = null;
      return;
    }
    var t = pick.data;
    var now = Date.now();
    var rt = t.turnOutputTokens || 0; // 纯输出（Claude ↓tokens 口径），速度同源
    if (spin.sid !== pick.sid) {
      spin.sid = pick.sid; spin.target = rt; spin.displayed = rt; spin.tps = 0; spin.smoothTps = 0;
      spin.lastSampleAt = 0; spin.lastGrowthAt = now;
    } else if (rt < spin.target) {
      spin.target = rt; spin.displayed = Math.min(spin.displayed, rt); spin.tps = 0; spin.smoothTps = 0;
      spin.lastSampleAt = 0; spin.lastGrowthAt = now;
    } else if (rt > spin.target) {
      var jump = rt - spin.target;
      if (spin.lastSampleAt === 0) { spin.displayed = rt; spin.tps = 0; } // 首次采样只锚不定速
      else {
        // 全量口径下每步跳变常 >2000（input 占大头）——大跳只直锚显示值，
        // 速度照算（jump/间隔 就是真实消耗速率）
        spin.tps = Math.round(jump / Math.max(0.001, (now - spin.lastSampleAt) / 1000));
        if (jump > 2000) spin.displayed = rt;
      }
      spin.lastSampleAt = now; spin.lastGrowthAt = now; spin.target = rt;
    }
    // 速度永远有值且只渐变：目标值 = 流式新鲜时瞬时速率，否则本轮平均速率
    // （turnOutput ÷ turn 耗时）；显示值经指数平滑（0.7 旧 + 0.3 新），
    // 瞬时↔平均切换时数字平滑过渡，不闪跳
    var elapsedS = Math.max(1, (now - (t.turnStartedAt || spin.anchorAt)) / 1000);
    var avgTps = Math.round(rt / elapsedS);
    var instFresh = spin.tps > 2 && (now - spin.lastGrowthAt) <= 8000;
    var targetTps = instFresh ? spin.tps : avgTps;
    spin.smoothTps = spin.smoothTps > 0
      ? Math.round(spin.smoothTps * 0.7 + targetTps * 0.3)
      : targetTps;
    el.setAttribute("data-bhui-live", "1");
    setAttr(el, "data-bhui-tok", fmtTokens(spin.displayed));
    setAttr(el, "data-bhui-tps", spin.smoothTps + " tokens/s");
  }
  // ---- tokens 平滑追赶（Claude SpinnerAnimationRow 三档逻辑，50ms 步进）----
  var rafId = 0;
  function chaseStep() {
    var gap = spin.target - spin.displayed;
    if (gap > 0) {
      var inc = gap < 70 ? 3 : (gap < 200 ? Math.max(8, Math.ceil(gap * 0.15)) : 50);
      spin.displayed = Math.min(spin.displayed + inc, spin.target);
      var el = findTurnStatus(document);
      if (el !== null && el.hasAttribute("data-bhui-live")) {
        setAttr(el, "data-bhui-tok", fmtTokens(spin.displayed));
      }
    } else if (gap < 0) {
      spin.displayed = spin.target;
    }
    rafId = requestAnimationFrame(chaseStep);
  }
  function onKeydown(ev) {
    if (ev.key !== "Enter" || ev.metaKey || ev.ctrlKey || ev.altKey || ev.isComposing) return;
    var el = ev.target;
    if (!el || el.tagName !== "TEXTAREA") return;
    if ((el.value || "").trim() !== "/clear") return;
    ev.preventDefault(); ev.stopPropagation();
    el.value = "";
    var btns = document.querySelectorAll('[aria-label*="\u65b0\u5efa"]');
    for (var i = 0; i < btns.length; i++) {
      var r = btns[i].getBoundingClientRect();
      if (r.width > 0) { btns[i].click(); break; }
    }
  }
  function apply(ctx) {
    injectStyles();
    try {
      var sessionsList = ctx && ctx.sessions && ctx.sessions.list;
      if (sessionsList && typeof sessionsList.subscribe === "function") {
        var syncSession = function () {
          try { var st = sessionsList.getSnapshot(); currentSessionId = (st && st.current) || null; } catch (e) {}
        };
        sessionsList.subscribe(syncSession); syncSession();
      }
    } catch (e) {}
    document.addEventListener("keydown", onKeydown, true);
    setInterval(function () {
      fetch("/api/bh-ui/live", { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && j.ok) { refreshBadges(j); updateSpinner(j); } })
        .catch(function () {});
    }, 1000);
    setTimeout(paintBadges, 200);
    try {
      if (!window.matchMedia || !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        rafId = requestAnimationFrame(chaseStep);
      }
    } catch (e) {}
    new MutationObserver(function () { try { paintBadges(); } catch (e) {} })
      .observe(document.body, { childList: true, subtree: true });
  }
  var module = { exports: {} };
  module.exports.apply = apply;
  module.exports.inject = ["sessions"];
  return module.exports;
  },
});
