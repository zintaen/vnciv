"""python -m pipeline fetch | build [builder ...] | all | serve [port] | package"""
import sys

from . import fetch, sources


def cmd_fetch():
    for s in sources.SOURCES:
        print(s["id"])
        for url, name in s["files"]:
            try:
                fetch.download(s["id"], url, name)
            except Exception as e:  # keep going: report every failure at once
                print(f"  ✗ {name}: {e}")


def cmd_build(*_):
    from .build import main
    main()


def cmd_serve(port="8765"):
    import functools, http.server
    from .build import pack
    pack.ensure()  # the page loads lenses_index.json + lens/<id>.json (gitignored, made from lenses.json)
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(fetch.ROOT / "web"))
    print(f"http://127.0.0.1:{port}")
    class Server(http.server.ThreadingHTTPServer):
        request_queue_size = 128  # the page loads ~100 ES modules at once; the default backlog (5) drops some

    Server(("127.0.0.1", int(port)), h).serve_forever()


def cmd_package(*_):
    """vnciv.zip (web/ without the dev pages, ready to upload). The source lives on GitHub."""
    import zipfile
    root = fetch.ROOT
    site = root / "vnciv.zip"
    with zipfile.ZipFile(site, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted((root / "web").rglob("*")):
            rel = p.relative_to(root / "web")
            if p.is_dir() or rel.parts[0] == "dev" or p.name == ".DS_Store":
                continue
            z.write(p, "vnciv/" + str(rel))
    print(f"{site.name} {site.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    cmd, *args = sys.argv[1:] or ["all"]
    if cmd == "all":
        cmd_fetch(); cmd_build()
    else:
        globals()[f"cmd_{cmd}"](*args)
