"""Render the whole trailer in Chrome (WebCodecs H.264) and save it: uv run --with playwright python tools/render_trailer.py OUT.mp4"""
import base64
import sys
import time

from playwright.sync_api import sync_playwright

out = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True)
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto("http://127.0.0.1:8765/dev/trailer.html")
    pg.wait_for_function("typeof window.__trailer?.render === 'function' && !document.getElementById('btn-render').disabled", timeout=120000)
    t0 = time.time()
    pg.evaluate("window.__trailer.render({ sound: true }).then(() => window.__done = 'ok', (e) => window.__done = 'error: ' + e)")
    pg.wait_for_function("window.__done", timeout=1800000, polling=2000)
    done = pg.evaluate("window.__done")
    print("render:", done, f"{time.time() - t0:.0f}s", pg.evaluate("document.getElementById('status').textContent"))
    if done == "ok":
        data = pg.evaluate("""async () => { const buf = await window.__trailer.blob.arrayBuffer(); let s = ''; const u = new Uint8Array(buf);
          for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }""")
        open(out, "wb").write(base64.b64decode(data))
        print("saved", out)
    b.close()
print("\n".join(errs) or "no console errors")
