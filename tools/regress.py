"""Browser regression suite: re-checks bugs fixed in earlier audit rounds (hash links, Back/Forward, docks, Esc order,
focus return, the timeline, share captions, idle frames, ...). Each check is a short Playwright journey that ends in
one JS assertion; any page error or console error/warning also fails it.

    uv run --with playwright python tools/regress.py             # every check, against http://127.0.0.1:8765/
    uv run --with playwright python tools/regress.py back esc    # only checks whose name contains "back" or "esc"
    REGRESS_BASE=http://127.0.0.1:8766/ uv run --with playwright python tools/regress.py

If nothing answers at REGRESS_BASE, the suite serves web/ itself on a free local port. Needs Playwright's Chromium
(`uv run --with playwright playwright install chromium` once). Takes a few minutes; exits 1 if any check fails.
Not run in CI (CI has no browser).

A check is a dict: name, url (query + hash after the base), vp (w, h), optional phone / reduced / slow (paths served
`delay` s late by a local slow server, default 1.5) / init (a script run before the page's own) /
ready (the load condition, default READY), steps, and expect (a JS expression that must be truthy at the end). Steps:
("wait", ms) ("js", expr) ("key", key) ("click", selector) ("focus", selector) ("until", expr) ("settle",) ("goto", url) ("reload",)
("save", name, expr) (expect reads it as S.name) ("fast",) (stop slowing) ("resize", w, h) ("mouse", x, y)
("download", selector) (file name in window.__dl).
"""
import http.server
import os
import sys
import threading
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

WEB = Path(__file__).resolve().parent.parent / "web"
BASE = os.environ.get("REGRESS_BASE", "http://127.0.0.1:8765/")
READY = "!!(window.__app && __app.timeline && __app.advisors && !document.getElementById('loading'))"
SETTLED = "!__app.cam.moving && !__app.cam.flight"
CAM = "[__app.cam.x|0, __app.cam.y|0, +__app.cam.scale.toFixed(4)].join()"

# Counts animation frames and lets a check skip the clock ahead, so the one-minute idle pause (app/motion.js IDLE_MS)
# is tested without waiting a minute: window.__rafN counts frames, __skip(ms) moves performance.now() forward.
CLOCK = ("(()=>{const r=requestAnimationFrame.bind(window);window.__rafN=0;window.requestAnimationFrame=cb=>r(t=>{__rafN++;cb(t)});"
         "const pn=performance.now.bind(performance);let off=0;performance.now=()=>pn()+off;window.__skip=ms=>{off+=ms}})()")
FRAMES = "(ms) => new Promise((ok) => { const a = __rafN; setTimeout(() => ok(__rafN - a), ms); })"


def idle(name, url):
    """Battery: once settled and a minute without input, no frames are drawn; input wakes the map again."""
    return dict(name=name, url=url, init=CLOCK, steps=[
        ("mouse", 700, 450), ("mouse", 705, 452), ("wait", 2000),
        ("js", f"({FRAMES})(2000).then((n) => window.__A = n)"), ("wait", 2100),
        ("js", "__skip(61000)"), ("wait", 1500),
        ("js", f"({FRAMES})(3000).then((n) => window.__I = n)"), ("wait", 3100),
        ("mouse", 600, 400), ("mouse", 610, 405), ("wait", 300),
        ("js", f"({FRAMES})(2000).then((n) => window.__W = n)"), ("wait", 2100)],
        expect="window.__I <= 1 && window.__A >= 20 && window.__W >= 20 || (console.log('frames', __A, __I, __W), false)")


AT = "'#at=3119,7510,5.05'"
# Map toggles: ON('id') → is that switch on; the default set Anh chose (the "Sống động / Lively" preset).
ON = "((id) => __app.ui.mapToggles().find((x) => x.id === id)?.on)"
DEFAULT_ON = (f"['roads','rail','hubs','rivers','wonders','places','ambient','trees','homes','seasons','boats','tet','military','traffic',"
              f"'hexlife','daynight'].map({ON})")
DEFAULT_OFF = (f"['resources','trade','communes','relics','worship','hospitals','universities','markets','beaches','reserves','metro','bridges',"
               f"'peaks','passes','lakes','gates','parks','crafts','battles','festivals','sealevel','growth','split','weather','atmos-sound',"
               f"'seasoncal','communes-density'].map({ON})")
# The presets of "Show on the map" (app/api.js PRESETS, docs/DATA_CONTRACTS.md): the switches each one turns on, apart
# from military and Effects, which a preset never touches.
LIVELY = ["roads", "rail", "hubs", "rivers", "wonders", "places", "traffic", "ambient", "hexlife", "trees", "homes", "seasons", "boats", "tet", "daynight"]
PRESETS = {"clean": ["roads", "rail", "rivers", "places"], "lively": LIVELY,
           "everything": LIVELY + ["peaks", "passes", "lakes", "gates", "parks", "crafts", "festivals", "battles", "relics", "worship", "hospitals",
                                   "universities", "markets", "beaches", "reserves", "metro", "bridges", "communes"]}
ONSET = "__app.ui.mapToggles().filter((x) => x.on && x.id !== 'motion' && x.id !== 'military').map((x) => x.id).sort().join()"
PRESET_STATE = (f"[{ONSET}, __app.ui.mapPreset(), [...document.querySelectorAll('.ml-preset[aria-pressed=true]')].map((b) => b.dataset.preset).join(),"
                f" {ON}('military'), history.length - window.__h0]")


def preset_steps():
    steps = [("settle",), ("click", "#btn-lenses"), ("wait", 300)]
    for k in ("clean", "everything", "lively"):
        steps += [("js", "window.__h0 = history.length"), ("click", f".ml-preset[data-preset='{k}']"), ("wait", 600), ("js", "__app.hash.flush()"),
                  ("save", k, PRESET_STATE)]
    return steps + [("click", ".ml-row[data-toggle='peaks']"), ("wait", 300),
                    ("save", "custom", "[__app.ui.mapPreset(), !document.querySelector('.ml-custom').hidden, document.querySelectorAll('.ml-preset[aria-pressed=true]').length]")]


PRESET_EXPECT = " && ".join(
    f"S.{k}[0]==={','.join(sorted(v))!r} && S.{k}[1]==='{k}' && S.{k}[2]==='{k}' && S.{k}[3]===false && S.{k}[4]<=1" for k, v in PRESETS.items()
) + " && S.custom.join()===',true,0' || (console.log(JSON.stringify(S)), false)"
CHECKS = [
    # --- battery ---
    idle("idle: home stops drawing after a minute and wakes on input", ""),
    # traffic (planes, ships, trains) is what animates over a lens (on by default)
    idle("idle: a lens stops drawing after a minute and wakes on input", "#lens=density&layers=traffic"),
    idle("idle: an advisor stops drawing after a minute and wakes on input", "#advisor=land"),
    # --- map layers in the link ---
    dict(name="empty layers= means the defaults, layers=none turns every layer off", url="#layers=",
         steps=[("settle",), ("save", "empty", f"[{ON}('roads'), location.hash.includes('layers'), __app.state.showResources]"),
                ("goto", "#layers=none"), ("settle",)],
         expect=f"S.empty[0]===true && S.empty[1]===false && S.empty[2]===false && {ON}('roads')===false && location.hash.includes('layers=none')"),
    dict(name="each preset sets exactly its documented set, leaves military alone, one history entry; a switch after it is Custom",
         url="#layers=roads,rail", steps=preset_steps(), expect=PRESET_EXPECT),
    dict(name="collapsed groups: header aria, remembered, and the filter opens a matching collapsed group", url="?lang=en",
         steps=[("settle",), ("click", "#btn-lenses"), ("wait", 300),
                ("save", "a", "[...document.querySelectorAll('.ml-sec')].filter((b) => b.getAttribute('aria-expanded') === 'false').map((b) => b.dataset.group).join()"),
                ("save", "ctl", "[...document.querySelectorAll('.ml-sec')].every((b) => document.getElementById(b.getAttribute('aria-controls'))?.hidden === (b.getAttribute('aria-expanded') === 'false'))"),
                ("click", ".ml-sec[data-group='culture']"), ("click", ".ml-sec[data-group='transport']"), ("key", "Escape"), ("reload",), ("settle",),
                ("click", "#btn-lenses"), ("wait", 300),
                ("save", "b", "['culture','transport'].map((g) => document.querySelector(`.ml-sec[data-group=${g}]`).getAttribute('aria-expanded')).join()"),
                ("js", "(() => { const f = document.querySelector('.bp-filter'); f.value = 'battle'; f.dispatchEvent(new Event('input', {bubbles: true})); })()"),
                ("wait", 300)],
         expect="S.a==='energy,nature,culture,history,economy,weather,places,military,Environment' && S.ctl && S.b==='true,false' "
                "&& document.querySelector('.ml-sec[data-group=history]').getAttribute('aria-expanded')==='true' "
                "&& !!document.querySelector('.ml-row[data-toggle=battles]').getClientRects().length || (console.log(JSON.stringify(S)), false)"),
    dict(name="default layers are the Lively set; a shared layers= link overrides them and round-trips",
         steps=[("settle",), ("save", "def", f"[{DEFAULT_ON}, {DEFAULT_OFF}, location.hash.includes('layers')]"),
                ("goto", "#layers=resources,traffic,daynight"), ("settle",),
                ("save", "link", f"[{ON}('resources'), __app.state.showResources, {ON}('traffic'), {ON}('daynight'), {ON}('roads')]"),
                ("js", "__app.ui.setMapToggle('rail', true)"), ("wait", 600), ("js", "__app.hash.flush()")],
         expect="S.def[0].every(Boolean) && !S.def[1].some(Boolean) && !S.def[2] && S.link.join()==='true,true,true,true,false' "
                "&& new URLSearchParams(location.hash.slice(1)).get('layers').split(',').sort().join()==='daynight,rail,resources,traffic' "
                "|| (console.log(JSON.stringify(S)), false)"),
    # --- at= links ---
    dict(name="back from an advisor restores the at= link and its camera", url=AT.strip("'"),
         steps=[("settle",), ("js", f"window.__c0={CAM}"), ("click", "#btn-more"), ("click", "#btn-advisors"), ("wait", 2500), ("js", "history.back()"), ("wait", 3000), ("settle",)],
         expect=f"(__app.hash.flush(), location.hash==={AT}) && __app.mode==null && {CAM}===window.__c0"),
    dict(name="esc from an advisor restores the at= link", url=AT.strip("'"),
         steps=[("settle",), ("click", "#btn-more"), ("click", "#btn-advisors"), ("wait", 2500), ("key", "Escape"), ("wait", 2500), ("settle",)],
         expect=f"(__app.hash.flush(), location.hash==={AT}) && __app.mode==null"),
    dict(name="a link's at= is kept by city view, an advisor and a province", url="#city=HN&view=city&at=3000,2500,1",
         steps=[("wait", 3000), ("settle",), ("save", "cv", "[__app.mode, (__app.hash.flush(), new URLSearchParams(location.hash.slice(1)).get('at'))]"),
                ("goto", "#advisor=economy&at=3000,2500,1"), ("wait", 3000), ("settle",),
                ("save", "adv", "(__app.hash.flush(), new URLSearchParams(location.hash.slice(1)).get('at'))"),
                ("goto", "#state=11&at=3000,2500,1"), ("wait", 2000), ("settle",)],
         expect="S.cv[0]==='city' && S.cv[1]==='3000,2500,1' && S.adv==='3000,2500,1' && (__app.hash.flush(), new URLSearchParams(location.hash.slice(1)).get('at'))==='3000,2500,1'"),
    dict(name="a lens picked inside an advisor survives a reload", url="#advisor=culture",
         steps=[("wait", 2500), ("js", "__app.setLens('poverty')"), ("wait", 1200), ("js", "__app.hash.flush()"), ("reload",), ("wait", 2500)],
         expect="__app.state.lens?.id==='poverty' && __app.advisors.current==='culture' && __app.mode==='advisor'"),
    # --- links and history ---
    dict(name="slow extensions: a deep link keeps view=city and year", url="#lens=density&city=SG&view=city&year=2019",
         slow=["/js/ext/timeline/index.js", "/js/ext/cityView/index.js"], steps=[("wait", 3000)],
         expect="location.hash.includes('view=city') && location.hash.includes('year=2019') && __app.mode==='city' && __app.timeline.year===2019"),
    dict(name="back/forward into an advisor restores the same link",
         steps=[("js", "__app.selectCity('SG')"), ("wait", 1500), ("js", "__app.advisors.open('economy')"), ("wait", 2500),
                ("js", "window.__h0=location.hash"), ("js", "history.back()"), ("wait", 1500), ("js", "history.forward()"), ("wait", 2500)],
         expect="__app.mode==='advisor' && location.hash===window.__h0"),
    dict(name="forest_loss link keeps its year", url="?lang=en#lens=forest_loss&year=2003",
         expect="__app.timeline.year===2003 && location.hash.includes('year=2003') && /Forest loss in 2003/.test(document.getElementById('lens-area').innerText)"),
    # --- docks and framing ---
    dict(name="advisor dock: timeline beside the dock, esc returns to the exact home camera",
         steps=[("settle",), ("js", f"window.__c0={CAM}"), ("js", "location.hash='#advisor=economy'"), ("wait", 2500),
                ("js", "window.__pill=document.getElementById('turn').getBoundingClientRect().left>=document.querySelector('.adv-dock').getBoundingClientRect().right"),
                ("key", "Escape"), ("wait", 1000), ("settle",)],
         expect=f"window.__pill && __app.mode==null && {CAM}===window.__c0"),
    # --- keyboard, Esc order, focus ---
    dict(name="timeline slider keys move the year (no snap back to now)", url="?lang=en",
         steps=[("focus", ".tl-range"), ("key", "ArrowLeft"), ("js", "window.__y1=__app.timeline.year"), ("key", "Home")],
         expect="window.__y1===+document.querySelector('.tl-range').max-1 && __app.timeline.year===+document.querySelector('.tl-range').min && document.querySelector('.tl-label').textContent===document.querySelector('.tl-range').min"),
    dict(name="coffee dialog blocks map keys; esc closes it before the panel and returns focus", url="#city=SG",
         steps=[("click", "#btn-coffee"), ("click", ".coffee-lead"), ("key", "l"), ("key", "?"), ("key", "Escape")],
         expect="document.querySelector('.coffee-modal').hidden && document.getElementById('help').hidden && !document.getElementById('city-panel').hidden && __app.state.lens==null && document.activeElement.id==='btn-coffee'"),
    dict(name="map panel: a layer switch keeps focus after space; esc returns focus to the Map button",
         steps=[("focus", "#btn-lenses"), ("key", "Enter"), ("js", "document.querySelector('#lens-picker .ml-row').focus()"), ("key", "ArrowDown"), ("key", "Space"),
                ("js", "window.__f=document.activeElement.classList.contains('ml-row')"), ("key", "Escape")],
         expect="window.__f===true && document.getElementById('lens-picker').hidden && document.activeElement.id==='btn-lenses'"),
    dict(name="esc order: history card first, then the city", url="#city=HN",
         steps=[("click", ".tl-hist-btn"), ("click", ".tl-hist-item >> nth=3"), ("key", "Escape"),
                ("js", "window.__a=document.querySelector('.tl-card').hidden && __app.state.selectedCity?.id==='HN'"), ("key", "Escape")],
         expect="window.__a && __app.state.selectedCity===null"),
    dict(name="city view esc keeps at= and returns focus to its button", url="#city=HN",
         steps=[("settle",), ("js", "window.__at=new URLSearchParams(location.hash.slice(1)).get('at')"), ("click", ".cv-open"),
                ("until", "__app.mode==='city'"), ("wait", 1200), ("key", "Escape"), ("wait", 1500)],
         expect="__app.mode===null && document.activeElement.classList.contains('cv-open') && __app.state.selectedCity?.id==='HN' && !location.hash.includes('view=city') && new URLSearchParams(location.hash.slice(1)).get('at')===window.__at"),
    dict(name="focus returns to each top-bar control after enter then esc", url="?lang=en",
         steps=[s for sel in ["#btn-help", "#btn-pedia", "#btn-coffee", "#btn-tour", "#btn-lenses"]
                for s in [("focus", sel), ("key", "Enter"), ("wait", 450), ("key", "Escape"), ("wait", 250),
                          ("js", f"if (!(document.activeElement===document.querySelector('{sel}') && __app.mode===null)) (window.__lost ||= []).push('{sel}')")]]
               # Share and Advisors sit in the "More ▾" menu: Enter on the item, then Esc, returns focus to the More button
               + [s for sel in ["#btn-share", "#btn-advisors"]
                  for s in [("focus", "#btn-more"), ("key", "Enter"), ("focus", sel), ("key", "Enter"), ("wait", 450), ("key", "Escape"), ("wait", 250),
                            ("js", f"if (!(document.activeElement.id==='btn-more' && __app.mode===null)) (window.__lost ||= []).push('{sel}')")]],
         expect="!window.__lost"),
    dict(name="timeline twin buttons: focus moves to prev when next reaches now", url="?lang=en",
         steps=[("click", ".tl-prev"), ("focus", ".tl-next"), ("key", "Enter")],
         expect="__app.timeline.year===null && document.activeElement.classList.contains('tl-prev')"),
    dict(name="play from 2025 stops at now without wrapping or extra history", url="#lens=income",
         steps=[("js", "__app.timeline.setYear(2025)"), ("wait", 400), ("click", ".tl-play"),
                ("until", "__app.timeline.year===null && document.querySelector('.tl-play').getAttribute('aria-pressed')==='false'"), ("wait", 2600)],
         expect="__app.timeline.year===null && location.hash==='#lens=income' && history.length<=5"),
    dict(name="play from now back to now leaves no entry that Back steps through unchanged", url="#lens=income",
         steps=[("wait", 800), ("save", "i", "navigation.currentEntry.index"), ("click", ".tl-play"), ("wait", 26000),  # 2010 → now: 17 years × 1.2 s + the merger replay
                ("until", "__app.timeline.year===null && document.querySelector('.tl-play').getAttribute('aria-pressed')==='false'"), ("wait", 1500)],
         expect="navigation.currentEntry.index===S.i && location.hash==='#lens=income' || (console.log('entry', navigation.currentEntry.index, S.i), false)"),
    dict(name="back walks lens, city, city view in order",
         steps=[s for js in ["__app.setLens('income')", "__app.selectCity('HN')", "__app.setMode('city',{id:'HN'})", "__app.setMode(null)"]
                for s in [("js", js), ("wait", 1200)]]
               + [s for _ in range(4) for s in [("js", "history.back()"), ("wait", 1200),
                  ("js", "(window.__seq ||= []).push(`${__app.mode}/${__app.state.selectedCity?.id??null}/${__app.state.lens?.id??null}`)")]],
         expect="window.__seq.join(' ')==='city/HN/income null/HN/income null/null/income null/null/null'"),
    dict(name="language switch keeps lens, city and year", url="?lang=vi#lens=income&city=SG&year=2021",
         steps=[("click", "#btn-lang"), ("wait", 1500), ("until", READY), ("wait", 1500)],
         expect="document.documentElement.lang==='en' && __app.state.lens?.id==='income' && __app.state.selectedCity?.id==='SG' && __app.timeline.year===2021 && !window.__i18nMissing?.size"),
    dict(name="rotating a phone refits the untouched camera like a fresh load", url="", vp=(390, 844), phone=True,
         steps=[("resize", 844, 390), ("save", "rot", "[__app.cam.scale, __app.cam.x, __app.cam.y, location.hash]"), ("goto", "")],
         expect="S.rot[3]==='' && [__app.cam.scale, __app.cam.x, __app.cam.y].every((v, i) => Math.abs(v - S.rot[i]) <= 1e-6 * Math.max(1, Math.abs(v)))"),
    dict(name="city view deep link frames the metro even when its extension loads late", url="#city=HN&view=city",
         slow=["/js/ext/cityView/index.js"], steps=[("wait", 2500), ("settle",), ("save", "slow", "[__app.mode, location.hash]"), ("fast",),
                                                    ("goto", "#city=HN&view=city"), ("wait", 1000), ("settle",)],
         expect="S.slow[0]==='city' && S.slow[1]===location.hash"),
    dict(name="advisor deep link frames the nation even when its extension loads late", url="#advisor=economy",
         slow=["/js/ext/advisors/index.js"], steps=[("wait", 2500), ("settle",), ("save", "slow", f"[__app.mode, {CAM}]"), ("fast",),
                                                   ("goto", "#advisor=economy"), ("wait", 1000), ("settle",)],
         expect=f"S.slow[0]==='advisor' && S.slow[1]==={CAM}"),
    # --- the lens-loading window (lenses_index.json still downloading) ---
    dict(name="while lenses load: almanac and report are clean, a pasted lens link waits and then applies",
         slow=["/data/lenses_index.json"], delay=8, ready="!!window.__app", steps=[
             ("save", "early", "__app.data.lenses.lenses.length"), ("click", "#btn-pedia"), ("click", '#pedia-nav button[data-page="Lenses"]'),
             ("save", "pedia", "/\\(\\)|undefined|NaN/.test(document.getElementById('pedia-body').innerText)"), ("key", "Escape"),
             ("click", '[data-report="population"]'), ("save", "report", "!!document.querySelector('#yield-report .yr-lens')"), ("key", "Escape"),
             ("js", "location.hash='#lens=poverty&city=26'"), ("wait", 1500), ("save", "hash", "location.hash.includes('lens=poverty')"),
             ("until", "__app.data.lenses.lenses.length>0"), ("wait", 1000)],
         expect="S.early===0 && !S.pedia && !S.report && S.hash && __app.state.lens?.id==='poverty' && __app.state.selectedCity?.id==='26' && !document.getElementById('legend').hidden"),
    # --- timeline marks ---
    dict(name="while a lens's values load: the link keeps the lens, then it applies; a lens picked meanwhile wins",
         url="#lens=poverty", slow=["/data/lens/poverty.json", "/data/lens/gini.json"], delay=4, ready="!!window.__app", steps=[
             ("wait", 500), ("save", "early", "[__app.state.lens?.id ?? null, location.hash.includes('lens=poverty')]"),
             ("until", "__app.state.lens?.id==='poverty'"), ("js", "__app.setLens('gini')"), ("js", "__app.setLens('density')"), ("wait", 5500)],
         expect="S.early[1] && __app.state.lens?.id==='density' && location.hash.includes('lens=density') && !document.getElementById('legend').hidden"),
    dict(name="storm year: advisors button stays clickable on a phone", url="#lens=disasters&year=2017", vp=(390, 844), phone=True,
         steps=[("click", "#btn-more"), ("click", "#btn-advisors"), ("wait", 1500)], expect="__app.mode==='advisor'"),
    dict(name="storm year: timeline mark stays clickable on desktop", url="#lens=disasters&year=2017",
         steps=[("click", ".tl-mark"), ("wait", 800)], expect="location.hash.includes('lens=disasters')"),
    # --- share ---
    dict(name="share image file name and saved caption", url="?lang=en#state=HCM&lens=density",
         steps=[("wait", 1500), ("click", "#btn-more"), ("click", "#btn-share"), ("download", "#share-pop [data-act=image]")],
         expect="window.__dl==='vietnam-density-tp-ho-chi-minh.png' && document.querySelector('.sp-status').textContent.includes(window.__dl)"),
    # --- panels ---
    dict(name="deep-linked province panel (phone) has the ethnic section", url="?lang=en#state=LCA", vp=(390, 844), phone=True,
         expect="!!document.querySelector('#city-panel .soc-ethnic') && /Kinh/.test(document.querySelector('#city-panel .soc-ethnic').innerText)"),
]


def serve_if_needed():
    global BASE
    try:
        urllib.request.urlopen(BASE, timeout=2)
        return
    except OSError:
        pass
    BASE = slow_base()  # with nothing slowed it is a plain static server
    print("serving web/ at", BASE)


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 256  # the default 5 resets connections when the page asks for its ~100 modules at once
    daemon_threads = True


class SlowHandler(http.server.SimpleHTTPRequestHandler):
    """Serves web/, answering paths that end with one of SLOW's keys that many seconds late (in its own thread, so the
    page and the checks keep running meanwhile: a slow network for one file)."""
    SLOW = {}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(WEB), **kw)

    def log_message(self, *a):
        pass

    def do_GET(self):
        path = self.path.split("?")[0]
        delay = max((d for k, d in self.SLOW.items() if path.endswith(k)), default=0)
        if delay:
            time.sleep(delay)
        super().do_GET()


_slow_base = None


def slow_base():
    global _slow_base
    if not _slow_base:
        srv = Server(("127.0.0.1", 0), SlowHandler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        _slow_base = f"http://127.0.0.1:{srv.server_address[1]}/"
    return _slow_base


def run(browser, c):
    w, h = c.get("vp", (1440, 900))
    opts = dict(viewport={"width": w, "height": h}, bypass_csp=True)
    if c.get("phone"):
        opts.update(has_touch=True, is_mobile=True, device_scale_factor=3)
    if c.get("reduced"):
        opts["reduced_motion"] = "reduce"
    ctx = browser.new_context(**opts, accept_downloads=True)
    saved = {}
    try:
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
        pg.on("console", lambda m: errs.append(f"console {m.type}: {m.text}") if m.type in ("error", "warning") else None)
        base = BASE
        if c.get("slow"):
            SlowHandler.SLOW = {k: c.get("delay", 1.5) for k in c["slow"]}
            base = slow_base()
        if c.get("init"):
            pg.add_init_script(c["init"])

        def goto(u):
            pg.goto(base + u)
            pg.wait_for_function(c.get("ready", READY), timeout=60000)
            pg.wait_for_timeout(1500)

        goto(c.get("url", ""))
        for step in c.get("steps", []):
            kind, arg = step[0], (step[1] if len(step) > 1 else None)
            if kind == "wait":
                pg.wait_for_timeout(arg)
            elif kind == "js":
                pg.evaluate(arg)
            elif kind == "key":
                pg.keyboard.press(arg)
                pg.wait_for_timeout(250)
            elif kind == "click":
                pg.click(arg)
                pg.wait_for_timeout(250)
            elif kind == "focus":
                pg.focus(arg)
            elif kind == "until":
                pg.wait_for_function(arg, timeout=15000)
            elif kind == "settle":
                pg.wait_for_function(SETTLED, timeout=15000)
                pg.wait_for_timeout(900)
            elif kind == "goto":  # a real load, even when only the hash differs
                pg.goto("about:blank")
                goto(arg)
            elif kind == "save":  # ("save", name, expr): keep a value across reloads; expect sees it as S.name
                saved[arg] = pg.evaluate(step[2])
            elif kind == "fast":  # stop slowing the extension files (for a reference load)
                SlowHandler.SLOW = {}
            elif kind == "reload":
                pg.reload()
                pg.wait_for_function(READY, timeout=60000)
                pg.wait_for_timeout(1500)
            elif kind == "mouse":  # ("mouse", x, y): move the real pointer
                pg.mouse.move(arg, step[2])
                pg.wait_for_timeout(100)
            elif kind == "resize":
                pg.set_viewport_size({"width": arg, "height": step[2]})
                pg.wait_for_timeout(1500)
            elif kind == "download":  # click a selector that downloads a file; its name goes to window.__dl
                with pg.expect_download() as d:
                    pg.click(arg)
                pg.evaluate("(f) => { window.__dl = f; }", d.value.suggested_filename)
            else:
                raise ValueError(f"unknown step {kind}")
        ok = pg.evaluate(f"(S) => ({c['expect']})", saved)
        if not ok:
            return f"expect false: {c['expect'][:160]}" + (f"\n     saved: {saved}" if saved else "")
        if errs:
            return "console: " + " | ".join(errs[:3])
        return None
    finally:
        ctx.close()


def main():
    sys.path.insert(0, str(WEB.parent))
    from pipeline.build import pack
    pack.ensure()  # the page loads lenses_index.json + lens/<id>.json, made from lenses.json
    serve_if_needed()
    sel = [a.lower() for a in sys.argv[1:]]
    todo = [c for c in CHECKS if not sel or any(s in c["name"].lower() for s in sel)]
    fails = []
    t0 = time.time()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for c in todo:
            t = time.time()
            try:
                err = run(browser, c)
            except Exception as e:  # a timeout or a selector that no longer exists
                err = f"{type(e).__name__}: {str(e).splitlines()[0][:200]}"
            if err:
                fails.append(c["name"])
            print(f"{'FAIL' if err else 'PASS'} {c['name']} ({time.time() - t:.1f}s)" + (f"\n     {err}" if err else ""))
        browser.close()
    print(f"\n{len(todo) - len(fails)}/{len(todo)} passed in {time.time() - t0:.0f}s" + (f"; failed: {', '.join(fails)}" if fails else ""))
    sys.exit(1 if fails or not todo else 0)


if __name__ == "__main__":
    main()
