"""Screenshot the app and report console errors: uv run --with playwright python tools/shot.py URL OUT.png [w h] [js]"""
import sys
from playwright.sync_api import sync_playwright

url, out = sys.argv[1], sys.argv[2]
w, h = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (1440, 900)
js = sys.argv[5] if len(sys.argv) > 5 else None
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": w, "height": h})
    errs = []
    pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
    pg.goto(url)
    pg.wait_for_timeout(3500)
    if js:
        print("js:", pg.evaluate(js))
        pg.wait_for_timeout(2500)
    pg.screenshot(path=out)
    b.close()
print("\n".join(errs) or "no console errors")
