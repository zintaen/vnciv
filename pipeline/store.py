import json
from pathlib import Path

from .fetch import ROOT

INTERIM = ROOT / "data" / "interim"
WEB = ROOT / "web" / "data"


def save_interim(name, obj):
    INTERIM.mkdir(parents=True, exist_ok=True)
    (INTERIM / f"{name}.json").write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))


def load_interim(name):
    return json.loads((INTERIM / f"{name}.json").read_text())


def write_web(name, obj):
    WEB.mkdir(parents=True, exist_ok=True)
    tmp = WEB / f".{name}.tmp"
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False))
    tmp.replace(WEB / name)
    print(f"    wrote web/data/{name} ({(WEB / name).stat().st_size // 1024} kB)")


def load_web(name):
    p = WEB / name
    return json.loads(p.read_text()) if p.exists() else None
