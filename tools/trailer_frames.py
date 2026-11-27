"""Preview trailer frames: uv run --with playwright python tools/trailer_frames.py OUTDIR frame ..."""
import sys
from playwright.sync_api import sync_playwright

out, frames = sys.argv[1], [int(f) for f in sys.argv[2:]]
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto("http://127.0.0.1:8765/dev/trailer.html")
    pg.wait_for_timeout(3000)
    for f in frames:
        pg.evaluate(f"(() => {{ const s = document.getElementById('scrub'); s.value = {f}; s.dispatchEvent(new Event('input')); }})()")
        pg.wait_for_timeout(2500)
        pg.locator("canvas").first.screenshot(path=f"{out}/tf{f}.png")
    b.close()
print("\n".join(errs) or "no errors")
