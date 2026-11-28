"""Split web/data/lenses.json (the build artefact every lens builder appends to, ~14 MB) for the browser:
lenses_index.json (every lens without its per-hex values, ~35 kB) and lens/<id>.json (one lens's values, a list per
hex cell), which the page fetches only when something needs that lens. store.write_web runs this whenever
lenses.json is written, so the split files never fall behind it; CI runs it before the Pages upload."""
import json

from ..store import WEB, load_web


def pack(L=None, out=WEB):
    L = L if L is not None else load_web("lenses.json")
    d = out / "lens"
    d.mkdir(parents=True, exist_ok=True)
    dump = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    ids = set()
    for l in L["lenses"]:
        ids.add(l["id"])
        (d / f"{l['id']}.json").write_text(dump(l["values"]))
    for p in d.glob("*.json"):  # a lens that was removed
        if p.stem not in ids:
            p.unlink()
    index = {**L, "lenses": [{k: v for k, v in l.items() if k != "values"} for l in L["lenses"]]}
    (out / "lenses_index.json").write_text(dump(index))


def ensure():
    """Pack when lenses.json is newer than the split copy (a fresh clone, or lenses.json edited by hand)."""
    src, idx = WEB / "lenses.json", WEB / "lenses_index.json"
    if src.exists() and (not idx.exists() or idx.stat().st_mtime < src.stat().st_mtime):
        pack()


def build():
    pack()
    print(f"    wrote web/data/lenses_index.json and web/data/lens/*.json")
