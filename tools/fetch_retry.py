"""Fetch one source with exponential backoff (for the overloaded Overpass API): python -m tools.fetch_retry ID [FILE ...]

Mirrors are tried only for queries without an area filter: their area index can be stale or partial, which silently
drops features (a mirror returned 63 of Vietnam's 179 port features)."""
import sys
import time

from pipeline import fetch, sources

MAIN = "https://overpass-api.de/api/"
MIRRORS = ("https://overpass.private.coffee/api/", "https://maps.mail.ru/osm/tools/overpass/api/")

s = sources.BY_ID[sys.argv[1]]
only = set(sys.argv[2:])
for url, name in s["files"]:
    if only and name not in only:
        continue
    bases = (MAIN,) if "area" in url else (MAIN, *MIRRORS)
    wait = 20
    for attempt in range(10):
        ok = False
        for base in bases:
            try:
                path = fetch.download(s["id"], url.replace(MAIN, base), name, force=True)
                if path.read_bytes()[:1] == b"{":
                    print("ok", name, base, path.stat().st_size, flush=True)
                    ok = True
                    break
            except Exception as e:
                print("fail", name, base, e, flush=True)
        if ok:
            break
        time.sleep(wait)
        wait = min(wait * 2, 240)
    else:
        sys.exit(1)
