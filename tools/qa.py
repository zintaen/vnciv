"""Load every view of the app and report console errors, failed requests and broken text.

uv run --with playwright python tools/qa.py [SHOT_DIR]
Views: home, every lens, every advisor, every province panel, every city panel and City View, every yield report,
help, every Almanac page, the Map menu toggles, search, share, and a phone-sized home view.
"""
import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

import os
BASE = os.environ.get("QA_BASE", "http://127.0.0.1:8765/")
LANG = os.environ.get("QA_LANG", "vi")  # vi: also fail on any English string missing from the dictionaries
DATA = Path(__file__).resolve().parent.parent / "web" / "data"
shots = Path(sys.argv[1]) if len(sys.argv) > 1 else None
BAD = re.compile(r"\bundefined\b|\bNaN\b|\[object |Infinity")

cities = json.loads((DATA / "cities.json").read_text())
states = json.loads((DATA / "world.json").read_text())["states"]
lenses = [l["id"] for l in json.loads((DATA / "lenses.json").read_text())["lenses"]]
ADVISORS = ["council", "energy", "economy", "people", "prosperity", "knowledge", "land", "military", "commerce", "culture", "explorer"]

views = [("home", "")]
views += [(f"lens {l}", f"#lens={l}") for l in lenses]
views += [(f"advisor {a}", f"#advisor={a}") for a in ADVISORS]
views += [(f"province {s['abbr']}", f"#state={s['abbr']}") for s in states]
views += [(f"city {c['id']}", f"#city={c['id']}") for c in cities]
views += [(f"cityview {c['id']}", f"#city={c['id']}&view=city") for c in cities]

problems = []
seen_missing = set()
seen_eng = set()
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True)

    def page(w=1440, h=900):
        pg = b.new_page(viewport={"width": w, "height": h})
        pg._errs = []
        pg.on("pageerror", lambda e: pg._errs.append(f"pageerror {e}"))
        pg.on("console", lambda m: pg._errs.append(f"console {m.text}") if m.type == "error" else None)
        # a request the next navigation aborts (a lazy file still loading) is the harness moving on, not a page error
        pg.on("requestfailed", lambda r: "ERR_ABORTED" in (r.failure or "") or pg._errs.append(f"requestfailed {r.url} {r.failure}"))
        pg.on("response", lambda r: pg._errs.append(f"HTTP {r.status} {r.url}") if r.status >= 400 else None)
        return pg

    def check(pg, label):
        txt = pg.evaluate("(() => { const b = document.body.cloneNode(true); b.querySelectorAll('[translate=no]').forEach((e) => e.remove()); document.documentElement.appendChild(b); b.style.display = 'block'; const s = b.innerText; b.remove(); return s; })()")
        hits = sorted(set(m.group(0) for m in BAD.finditer(txt)))
        if LANG == "vi":
            miss = pg.evaluate("window.__i18nMissing ? [...window.__i18nMissing] : []")
            new = [m for m in miss if m not in seen_missing]
            seen_missing.update(new)
            hits += [f"untranslated: {m[:70]}" for m in new]
            # English that never went through t(): common function words in the visible text
            eng = sorted(set(re.findall(r"(?:\b(?:the|and|of|with|from|per|former province|not published)\b[^.\n]{0,30})", txt)))
            eng = [e for e in eng if e not in seen_eng]
            seen_eng.update(eng)
            hits += [f"english: {e}" for e in eng[:8]]
        if pg._errs or hits:
            problems.append((label, pg._errs[:5], hits))
        pg._errs.clear()

    pg = page()
    for label, h in views:
        pg.goto("about:blank")
        pg.goto(BASE + "?lang=" + LANG + h)
        pg.wait_for_timeout(1800 if "cityview" in label or "advisor" in label else 1200)
        check(pg, label)
        if shots and label in ("home", "advisor military", "advisor commerce", "cityview 34", "province KHO"):
            pg.screenshot(path=str(shots / f"qa_{label.replace(' ', '_')}.png"))
    # top-bar reports, help, Almanac pages, map toggles, search, share
    pg.goto("about:blank")
    pg.goto(BASE + "?lang=" + LANG)
    pg.wait_for_timeout(2500)
    for key in pg.eval_on_selector_all("[data-report]", "els => els.map(e => e.dataset.report)"):
        pg.click(f'[data-report="{key}"]')
        pg.wait_for_timeout(500)
        check(pg, f"report {key}")
        pg.keyboard.press("Escape")
    pg.click("#btn-help")
    pg.wait_for_timeout(300)
    check(pg, "help")
    pg.keyboard.press("Escape")
    pg.click("#btn-pedia")
    for name in pg.eval_on_selector_all("#pedia-nav button", "els => els.map(e => e.dataset.page)"):
        pg.click(f'#pedia-nav button[data-page="{name}"]')
        pg.wait_for_timeout(200)
        check(pg, f"almanac {name}")
    pg.keyboard.press("Escape")
    toggles = pg.evaluate("window.__app.ui.mapToggles().map(t => t.id)")
    for t in toggles:
        for on in (True, False, True):
            pg.evaluate(f"window.__app.ui.setMapToggle('{t}', {str(on).lower()})")
            pg.wait_for_timeout(300)
        check(pg, f"toggle {t}")
    pg.fill("#search-input", "da nang")
    pg.wait_for_timeout(300)
    found = pg.evaluate("document.getElementById('search-results').innerText")
    if "Đà Nẵng" not in found:
        problems.append(("search 'da nang'", [], [found[:80]]))
    pg.keyboard.press("Escape")
    pg.click("#btn-more")  # Share lives in the top-bar "More" menu
    pg.click("#btn-share")
    pg.wait_for_timeout(500)
    check(pg, "share")
    if shots:
        pg.screenshot(path=str(shots / "qa_all_layers.png"))
    pg.close()
    m = page(390, 844)
    m.goto(BASE + "?lang=" + LANG)
    m.wait_for_timeout(2500)
    check(m, "phone home")
    m.goto("about:blank")
    m.goto(BASE + "?lang=" + LANG + "#city=SG&view=city")
    m.wait_for_timeout(2500)
    check(m, "phone cityview SG")
    if shots:
        m.screenshot(path=str(shots / "qa_phone.png"))
    b.close()

n = len(views) + 1
print(f"{n}+ views checked; toggles: {toggles}")
for label, errs, hits in problems:
    print("PROBLEM", label, errs, hits)
print("ALL CLEAN" if not problems else f"{len(problems)} views with problems")
