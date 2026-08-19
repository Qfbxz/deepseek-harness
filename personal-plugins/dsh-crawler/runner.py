#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dsh-crawler Python runner.
Reads one JSON command on stdin, writes one JSON result on stdout.
Engines: http (stdlib, zero-dep) / crawl4ai (smart markdown) / browser (patchright anti-detect).
Modes:  fetch | batch | site | unlock
Runs under ~/.dsh/venvs/scrape/bin/python (crawl4ai + patchright installed there).
"""
import asyncio, base64, json, os, re, signal, sys, time, urllib.request, urllib.error
from pathlib import Path

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
CHALLENGE = re.compile(r"just a moment|verifying you are human|performing security verification|security verification|attention required", re.I)

def out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()
    sys.exit(0)

def die(msg, **extra):
    out(dict(ok=False, error=str(msg)[:500], **extra))

# ---------------- http engine (stdlib) ----------------
TAG_RE = re.compile(r"<(script|style|noscript|template)[^>]*>.*?</\1>", re.S | re.I)

def http_fetch(url, cfg):
    req = urllib.request.Request(url, headers=dict({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"}, **(cfg.get("headers") or {})))
    with urllib.request.urlopen(req, timeout=cfg.get("timeoutMs", 30000) / 1000) as r:
        raw = r.read()
        charset = r.headers.get_content_charset() or "utf-8"
        html = raw.decode(charset, "replace")
        return {"url": r.geturl(), "status": r.status, "html": html}

def strip_html(html):
    txt = TAG_RE.sub(" ", html)
    txt = re.sub(r"<[^>]+>", " ", txt)
    return re.sub(r"\s+", " ", re.sub(r"(?i)<(br|/p|/div|/li|/h[1-6])[^>]*>", "\n", txt)).strip()

def meta_of(html):
    m = {}
    for name in ("title", "description", "keywords", "author"):
        mm = re.search(r'<meta[^>]+name=["\']' + name + r'["\'][^>]+content=["\']([^"\']*)', html, re.I)
        if mm: m[name] = mm.group(1)
    t = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
    if t: m["title"] = re.sub(r"\s+", " ", t.group(1)).strip()
    og = re.search(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']*)', html, re.I)
    if og: m["og:title"] = og.group(1)
    return m

def links_of(html, base):
    urls = []
    for href in re.findall(r'<a[^>]+href=["\']([^"\'#]+)', html, re.I):
        if href.startswith("http"): urls.append(href)
        elif href.startswith("/"): urls.append(base.rstrip("/") + href)
    seen, uniq = set(), []
    for u in urls:
        if u not in seen: seen.add(u); uniq.append(u)
    return uniq

# ---------------- CF auto-click responder ----------------
async def try_click(page):
    """One human-like click on the Turnstile checkbox inside the challenge iframe."""
    import random
    for sel in ('iframe[src*="challenges.cloudflare.com"]', 'iframe[title*="Widget"]', 'iframe[title*="widget"]'):
        fr = await page.query_selector(sel)
        if not fr: continue
        box = await fr.bounding_box()
        if not box: continue
        x, y = box["x"] + 30.0, box["y"] + box["height"] / 2.0
        await page.mouse.move(x - random.uniform(60, 140), y - random.uniform(30, 70), steps=random.randint(6, 12))
        await page.wait_for_timeout(random.randint(250, 600))
        await page.mouse.move(x + random.uniform(-2, 2), y + random.uniform(-2, 2), steps=random.randint(10, 20))
        await page.wait_for_timeout(random.randint(150, 400))
        await page.mouse.down(); await page.wait_for_timeout(random.randint(70, 130)); await page.mouse.up()
        return True
    return False

async def auto_clear(page, cfg, budget_ms=None):
    """Click the challenge checkbox until the page clears or the budget runs out."""
    t0 = time.time()
    budget = float(budget_ms if budget_ms is not None else (cfg.get("autoClickBudgetMs") or 120000))
    max_tries = int(cfg.get("autoClickMaxTries") or 14)
    tries = 0
    while (time.time() - t0) * 1000 < budget and tries < max_tries:
        title = await page.title()
        if not CHALLENGE.search(title or ""):
            return True
        if await try_click(page):
            tries += 1
        await page.wait_for_timeout(3000)
    title = await page.title()
    return not CHALLENGE.search(title or "")

# ---------------- browser engine (patchright) ----------------
async def browser_pages(p, items, cfg):
    """items: [{url, ...per-item opts}] -> [{...result}]; persistent profile + anti-detect."""
    from patchright.async_api import async_playwright
    profile = os.path.expanduser(cfg.get("profileDir") or "~/.dsh/crawler-profiles/default")
    Path(profile).mkdir(parents=True, exist_ok=True)
    results = []
    async with async_playwright() as pw:
        ctx = await pw.chromium.launch_persistent_context(
            profile, headless=cfg.get("headless", True), locale="en-US",
            viewport={"width": 1320, "height": 880})
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        for it in items:
            url = it["url"]
            rec = {"url": url}
            try:
                if ((it.get("extract") or {}).get("docs") or (it.get("extract") or {}).get("pdf")) and DOC_RE.search(url):
                    try:
                        ar = await ctx.request.get(url, timeout=45000)
                        body = await ar.body()
                        saved = save_doc(cfg, url, body)
                        if saved:
                            results.append({"url": url, "title": Path(saved).name, "docSaved": saved}); continue
                    except Exception:
                        pass
                resp = await page.goto(url, timeout=it.get("timeoutMs", cfg.get("timeoutMs", 30000)))
                await wait_ready(page, it)
                challenged = CHALLENGE.search(await page.title() or "")
                if challenged and it.get("autoClick", cfg.get("autoClick", True)):
                    cleared = await auto_clear(page, cfg)
                    rec["autoCleared"] = cleared
                    challenged = (not cleared) and bool(CHALLENGE.search(await page.title() or ""))
                rec["challenged"] = bool(challenged)
                rec["status"] = resp.status if resp else None
                if challenged and not it.get("allowChallenge"):
                    rec["error"] = "cloudflare-challenge (auto-click exhausted; retry, run crawler_unlock, or engine=http)"
                else:
                    rec.update(await page_extract(page, it))
            except Exception as e:
                rec["error"] = (type(e).__name__ + ": " + str(e))[:300]
            results.append(rec)
            if it.get("_delay"): await page.wait_for_timeout(it["_delay"])
        await ctx.close()
    return results

async def wait_ready(page, it):
    if it.get("waitMs"): await page.wait_for_timeout(int(it["waitMs"]))
    if it.get("waitForSelector"):
        try: await page.wait_for_selector(it["waitForSelector"], timeout=10000)
        except Exception: pass
    for _ in range(int(it.get("scroll") or 0)):
        await page.mouse.wheel(0, 1600); await page.wait_for_timeout(700)

async def page_extract(page, it):
    rec = {}
    html = await page.content()
    rec["title"] = await page.title()
    if it.get("mode") in (None, "text", "markdown"):
        rec["text"] = (await page.evaluate("document.body.innerText"))[: int(it.get("maxChars") or 50000)]
    if it.get("mode") == "html": rec["html"] = html[: int(it.get("maxChars") or 200000)]
    if it.get("mode") == "links" or it.get("_wantLinks"):
        rec["links"] = await page.evaluate("Array.from(new Set(Array.from(document.links).map(a=>a.href).filter(h=>h.startsWith('http'))))")
    if it.get("meta"):
        rec["meta"] = await page.evaluate("Object.fromEntries(Array.from(document.querySelectorAll('meta[name],meta[property]')).map(m=>[m.name||m.getAttribute('property'),m.content]))")
    want = it.get("extract") or {}
    if want.get("images") or it.get("extractImages"):
        rec["images"] = await page.evaluate("Array.from(document.images).slice(0,60).map(i=>({src:i.currentSrc||i.src, alt:i.alt||''}))")
    if want.get("tables"):
        rec["tables"] = await page.evaluate("Array.from(document.querySelectorAll('table')).slice(0,20).map(tb=>Array.from(tb.rows).slice(0,60).map(tr=>Array.from(tr.cells).map(c=>c.innerText.trim())))")
    sels = it.get("selectors") or {}
    if sels:
        rec["fields"] = await page.evaluate("(s)=>Object.fromEntries(Object.entries(s).map(([k,v])=>{const el=document.querySelector(v);return [k, el? el.innerText.trim() : null]}))", sels)
    if it.get("extractJs"):
        try: rec["extract"] = await page.evaluate(it["extractJs"])
        except Exception as e: rec["extractError"] = str(e)[:200]
    if it.get("screenshot"):
        path = os.path.expanduser(it["screenshot"])
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        await page.screenshot(path=path, full_page=bool(it.get("fullPage")))
        rec["screenshotPath"] = path
    return rec

# ---------------- storage helpers ----------------
def store_dir(cfg):
    d = os.path.expanduser(cfg.get("outdir") or "~/.dsh/crawler-out")
    Path(d).mkdir(parents=True, exist_ok=True)
    return d

def resolve_out_file(cfg, given, default_name):
    if given:
        p = os.path.expanduser(given)
        if not os.path.isabs(p):
            p = os.path.join(store_dir(cfg), given)
    else:
        p = os.path.join(store_dir(cfg), default_name)
    Path(p).parent.mkdir(parents=True, exist_ok=True)
    return p

def content_of(rec):
    for k in ("markdown", "text", "html"):
        if rec.get(k):
            return k, rec[k]
    return None, None

def slug(url):
    m = re.match(r"https?://([^/]+)(.*)", url or "")
    host = m.group(1).replace(".", "_") if m else "site"
    rest = re.sub(r"[^A-Za-z0-9._-]+", "_", (m.group(2) if m else (url or "")))[:80].strip("_")
    return (host + ("_" + rest if rest else "")).strip("_") or "page"

def save_binary(cfg, data, name, sub="assets"):
    d = os.path.join(store_dir(cfg), sub)
    Path(d).mkdir(parents=True, exist_ok=True)
    p = os.path.join(d, name)
    Path(p).write_bytes(data)
    return p

DOC_RE = re.compile(r"\.(pdf|epub|mobi|azw3?|docx?|xlsx?|pptx?|csv|txt|rtf|md|markdown|json|yaml|yml|zip)(\?|$)", re.I)

def save_doc(cfg, url, data):
    if not data or len(data) > 120 * 1024 * 1024:
        return None
    m = DOC_RE.search(url)
    ext = (m.group(1).lower() if m else "bin")
    magic = {"pdf": b"%PDF", "zip": b"PK", "epub": b"PK", "docx": b"PK", "xlsx": b"PK", "pptx": b"PK", "mobi": b"BOOKMOBI", "azw": b"TPZ", "azw3": b"TPZ"}.get(ext)
    if magic and not data[:len(magic)] == magic:
        return None
    base = slug(url)
    if base.lower().endswith("." + ext):
        base = base[: -(len(ext) + 1)]
    return save_binary(cfg, data, base + "." + ext, sub="assets")

def save_page_file(cfg, rec, sub="pages"):
    k, v = content_of(rec)
    if not v:
        return None
    ext = {"markdown": "md", "text": "txt", "html": "html"}.get(k, "txt")
    d = os.path.join(store_dir(cfg), sub)
    Path(d).mkdir(parents=True, exist_ok=True)
    p = os.path.join(d, slug(rec.get("url")) + "." + ext)
    Path(p).write_text(v, encoding="utf-8")
    return p

# ---------------- crawl4ai engine ----------------
async def c4ai_pages(items, cfg):
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
    bc = BrowserConfig(headless=cfg.get("headless", True), verbose=False)
    rc = CrawlerRunConfig(cache_mode=CacheMode.BYPASS)
    results = []
    async with AsyncWebCrawler(config=bc) as c:
        for it in items:
            r = await c.arun(url=it["url"], config=rc)
            md = r.markdown.raw_markdown if r.markdown else ""
            rec = {"url": it["url"], "ok": bool(r.success), "title": (md.splitlines()[0].lstrip("# ").strip() if md else ""), "markdown": md[: int(it.get("maxChars") or 60000)]}
            if not r.success: rec["error"] = str(r.error_message)[:200]
            results.append(rec)
    return results

# ---------------- unlock (human-in-the-loop) ----------------
async def unlock(cfg):
    from patchright.async_api import async_playwright
    import subprocess
    profile = os.path.expanduser(cfg.get("profileDir") or "~/.dsh/crawler-profiles/default")
    Path(profile).mkdir(parents=True, exist_ok=True)
    url = cfg.get("url") or "https://onepetro.org/"
    async with async_playwright() as pw:
        ctx = await pw.chromium.launch_persistent_context(profile, headless=False, locale="en-US")
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await page.goto(url, timeout=60000)
        wait_s = int(cfg.get("waitMs") or 300000)
        t0, beeped = time.time(), False
        auto_done, auto_ok = False, None
        while True:
            title = await page.title()
            if not CHALLENGE.search(title or ""):
                if auto_ok is not None:
                    try: subprocess.run(["osascript", "-e", "beep 2"], timeout=5)
                    except Exception: pass
                try: subprocess.run(["osascript", "-e", "beep 2"], timeout=5)
                except Exception: pass
                res = {"ok": True, "url": page.url, "title": title, "profile": profile}
                if auto_ok is not None: res["autoCleared"] = auto_ok
                if cfg.get("loginHint"):
                    res["loginHint"] = cfg["loginHint"]
                    input(">>> Finish login in the browser window, then press Enter here to save... ")
                    res["title"] = await page.title()
                await ctx.close()
                return res
            if not auto_done and cfg.get("autoClick", True):
                auto_ok = await auto_clear(page, cfg)
                auto_done = True
                if auto_ok:
                    continue
            if time.time() - t0 > 8 and not beeped:
                beeped = True
                try: subprocess.run(["osascript", "-e", "beep 3"], timeout=5)
                except Exception: pass
                print(">>> Human action needed: click the Cloudflare checkbox in the browser window <<<", flush=True)
            if time.time() - t0 > wait_s:
                await ctx.close(); return {"ok": False, "error": "unlock-timeout"}
            await page.wait_for_timeout(2000)

# ---------------- site crawl (BFS) ----------------
async def site_crawl(cmd, cfg, skip=None, emit=None):
    start = cmd["url"]
    max_pages = int(cmd.get("maxPages") or 20)
    max_depth = int(cmd.get("maxDepth") or 2)
    same_origin = cmd.get("sameOrigin", True)
    inc = [re.compile(p) for p in (cmd.get("include") or [])]
    exc = [re.compile(p) for p in (cmd.get("exclude") or [])]
    origin = re.match(r"https?://[^/]+", start).group(0)
    queue, seen, items = [(start, 0)], {start}, []
    while queue and len(items) < max_pages:
        url, depth = queue.pop(0)
        if skip and url in skip: continue
        if any(p.search(url) for p in exc): continue
        if inc and not any(p.search(url) for p in inc):
            if url != start: continue
        items.append({"url": url, "mode": cmd.get("contentMode") or "text", "_wantLinks": True, "_delay": cfg.get("minDelayMs", 1200), **{k: cmd.get(k) for k in ("selectors", "extractJs", "meta") if cmd.get(k)}})
        res = (await run_engine(cmd, cfg, [items[-1]]))[0]
        items[-1]["result"] = res
        if emit: emit(res)
        if depth < max_depth:
            for u in res.get("links") or []:
                u = u.split("#")[0]
                if u in seen or (same_origin and not u.startswith(origin)): continue
                if any(p.search(u) for p in exc): continue
                if u.endswith((".pdf", ".zip", ".jpg", ".png", ".gif")): continue
                seen.add(u); queue.append((u, depth + 1))
    return items

# ---------------- dispatch ----------------
async def run_engine(cmd, cfg, items):
    engine = (cmd.get("engine") or cfg.get("engine") or "auto")
    if engine == "http":
        res = []
        for it in items:
            try:
                doc_flag = (it.get("extract") or {}).get("docs") or (it.get("extract") or {}).get("pdf")
                if doc_flag and DOC_RE.search(it["url"]):
                    try:
                        rq = urllib.request.Request(it["url"], headers={"User-Agent": UA})
                        with urllib.request.urlopen(rq, timeout=cfg.get("timeoutMs", 30000) / 1000) as pr:
                            data = pr.read(120 * 1024 * 1024)
                        saved = save_doc(cfg, it["url"], data)
                        if saved:
                            res.append({"url": it["url"], "title": Path(saved).name, "docSaved": saved}); continue
                    except Exception:
                        pass
                f = http_fetch(it["url"], cfg)
                r = {"url": f["url"], "status": f["status"], "title": meta_of(f["html"]).get("title")}
                mode = it.get("mode") or "text"
                if mode in ("text", "markdown"): r["text"] = strip_html(f["html"])[: int(it.get("maxChars") or 50000)]
                elif mode == "html": r["html"] = f["html"][: int(it.get("maxChars") or 200000)]
                if mode == "links" or it.get("_wantLinks"): r["links"] = links_of(f["html"], f["url"])
                want = it.get("extract") or {}
                if it.get("meta") or want.get("meta"): r["meta"] = meta_of(f["html"])
                if want.get("images") or it.get("extractImages"):
                    imgs = []
                    for m in re.finditer(r'<img[^>]+src=["\']([^"\']{8,300})["\']', f["html"]):
                        s = m.group(1)
                        if s.startswith("//"): s = "https:" + s
                        elif s.startswith("/"): s = re.match(r"https?://[^/]+", f["url"]).group(0) + s
                        if not s.startswith("data:"): imgs.append({"src": s[:300], "alt": ""})
                    r["images"] = imgs[:60]
                if want.get("tables"):
                    r["tables"] = []
                    for tm in list(re.finditer(r"<table[\s\S]{0,30000}?</table>", f["html"], re.I))[:20]:
                        rows = []
                        for rm in list(re.finditer(r"<tr[\s\S]*?</tr>", tm.group(0), re.I))[:60]:
                            cells = [re.sub(r"<[^>]+>|\s+", " ", c).strip() for c in re.findall(r"<t[hd][\s\S]*?</t[hd]>", rm.group(0), re.I)]
                            if cells: rows.append(cells)
                        if rows: r["tables"].append(rows)
                res.append(r)
            except Exception as e:
                res.append({"url": it["url"], "error": str(e)[:300]})
        return res
    if engine == "crawl4ai":
        try: return await c4ai_pages(items, cfg)
        except ImportError: return await browser_pages_pw(None, items, cfg)
    # browser / auto
    return await browser_pages_pw(None, items, cfg)

async def browser_pages_pw(_p, items, cfg):
    return await browser_pages(None, items, cfg)

async def main():
    cmd = json.loads(sys.stdin.read() or "{}")
    cfg = cmd.get("config") or {}
    if not cfg.get("enabled", True):
        out({"ok": False, "error": "crawler disabled in config (crawler_config set enabled=true)"})
    mode = cmd.get("mode", "fetch")
    if mode == "unlock":
        out(dict(ok=True, result=await unlock({**cfg, **{k: cmd[k] for k in ("url", "loginHint", "profileDir", "waitMs") if cmd.get(k) is not None}})))
    if mode == "site":
        outf = resolve_out_file(cfg, cmd.get("outFile"), slug(cmd["url"]) + "-site.jsonl")
        done = set()
        if cmd.get("resume", True) and os.path.exists(outf):
            for line in Path(outf).read_text().splitlines():
                try:
                    rec = json.loads(line)
                    if not rec.get("error"): done.add(rec.get("url"))
                except Exception: pass
        save_mode = cmd.get("saveMode") or "jsonl"
        def emit(rec):
            if save_mode in ("files", "both"):
                fp = save_page_file(cfg, rec)
                if fp: rec["file"] = fp
            if save_mode in ("jsonl", "both"):
                with open(outf, "a") as f: f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        items = await site_crawl(cmd, cfg, skip=done, emit=emit)
        okn = sum(1 for it in items if not (it.get("result") or {}).get("error"))
        body = {"ok": True, "fetched": len(items), "okPages": okn,
                "outFile": outf if save_mode in ("jsonl", "both") else None, "saveMode": save_mode,
                "pages": [{"url": it["url"], "title": (it.get("result") or {}).get("title"),
                           "error": (it.get("result") or {}).get("error"),
                           "file": (it.get("result") or {}).get("file")} for it in items]}
        if cmd.get("returnPages"):
            body["pagesFull"] = items
        out(body)
    if mode == "fetch":
        ex = cmd.get("extractOptions") or {}
        per = {"mode": cmd.get("contentMode"), "extract": ex, **{k: cmd[k] for k in ("selectors", "extractJs", "meta", "waitMs", "waitForSelector", "scroll", "screenshot", "fullPage", "maxChars", "allowChallenge") if cmd.get(k) is not None}}
        items = [{"url": cmd["url"], **per}]
        res = (await run_engine(cmd, cfg, items))[0]
        if cmd.get("saveTo") and not res.get("error"):
            given = cmd["saveTo"]
            if given is True or given in ("auto", "1"):
                res["savedTo"] = save_page_file(cfg, res)
            else:
                p = resolve_out_file(cfg, str(given), slug(res.get("url")) + ".txt")
                k, v = content_of(res)
                Path(p).write_text(v or "", encoding="utf-8")
                res["savedTo"] = p
        out({"ok": not res.get("error"), "result": res})
    if mode == "batch":
        urls = cmd.get("urls") or []
        if cmd.get("urlsFile"):
            p = os.path.expanduser(cmd["urlsFile"])
            urls += [l.strip() for l in Path(p).read_text().splitlines() if l.strip() and not l.startswith("#")]
        outf = resolve_out_file(cfg, cmd.get("outFile"), "batch.jsonl")
        done = set()
        if cmd.get("resume", True) and os.path.exists(outf):
            for line in Path(outf).read_text().splitlines():
                try:
                    rec = json.loads(line)
                    if not rec.get("error"): done.add(rec.get("url"))
                except Exception: pass
        todo = [u for u in urls if u not in done]
        limit = int(cmd.get("limit") or len(todo)); todo = todo[:limit]
        conc = max(1, int(cmd.get("concurrency") or 1)); delay = int(cmd.get("minDelayMs") or cfg.get("minDelayMs", 1500))
        ok = fail = 0
        per = {"mode": cmd.get("contentMode"), **{k: cmd[k] for k in ("selectors", "extractJs", "meta", "maxChars") if cmd.get(k) is not None}}
        save_mode = cmd.get("saveMode") or "jsonl"
        for i in range(0, len(todo), conc):
            chunk = [{"url": u, **per, "_delay": delay} for u in todo[i:i + conc]]
            for res in await run_engine(cmd, cfg, chunk):
                if save_mode in ("files", "both") and not res.get("error"):
                    fp = save_page_file(cfg, res)
                    if fp: res["file"] = fp
                if save_mode in ("jsonl", "both"):
                    with open(outf, "a") as f: f.write(json.dumps(res, ensure_ascii=False) + "\n")
                if res.get("error"): fail += 1
                else: ok += 1
            print(f"[batch {min(i + conc, len(todo))}/{len(todo)}] ok={ok} fail={fail}", file=sys.stderr, flush=True)
        out({"ok": True, "total": len(urls), "fetched": len(todo), "okCount": ok, "failCount": fail, "outFile": outf})

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except SystemExit:
        raise
    except Exception as e:
        die(e)
