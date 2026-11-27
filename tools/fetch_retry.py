"""Fetch one source with exponential backoff (for the overloaded Overpass API): python tools/fetch_retry.py ID"""
import sys
import time

from pipeline import fetch, sources

s = sources.BY_ID[sys.argv[1]]
for url, name in s["files"]:
    wait = 20
    for attempt in range(8):
        for base in ("https://overpass-api.de/api/", "https://overpass.private.coffee/api/"):
            try:
                path = fetch.download(s["id"], url.replace("https://overpass-api.de/api/", base), name, force=True)
                if path.read_bytes()[:1] == b"{":
                    print("ok", base, path.stat().st_size)
                    sys.exit(0)
            except Exception as e:
                print("fail", base, e, flush=True)
        time.sleep(wait)
        wait = min(wait * 2, 240)
sys.exit(1)
