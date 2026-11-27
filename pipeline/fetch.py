"""Cached downloads with a provenance manifest (data/raw/<source>/manifest.json)."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import shutil
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
UA = {"User-Agent": "vnciv-pipeline/0.1 (+static map project)"}


def download(source: str, url: str, name: str, force: bool = False) -> Path:
    d = RAW / source
    d.mkdir(parents=True, exist_ok=True)
    path = d / name
    man_path = d / "manifest.json"
    man = json.loads(man_path.read_text()) if man_path.exists() else {}
    if path.exists() and not force and name in man:
        return path
    print(f"  ↓ {url}")
    req = urllib.request.Request(url, headers=UA)
    tmp = path.with_suffix(path.suffix + ".part")
    with urllib.request.urlopen(req, timeout=600) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f)
    tmp.replace(path)
    data = path.read_bytes()
    man[name] = {"url": url, "retrieved": dt.date.today().isoformat(),
                 "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
    man_path.write_text(json.dumps(man, indent=1, ensure_ascii=False))
    return path


def manifest(source: str) -> dict:
    p = RAW / source / "manifest.json"
    return json.loads(p.read_text()) if p.exists() else {}
