"""Restore Vietnamese diacritics to place-like names that sources publish unaccented ("Duyen Hai 1" → "Duyên Hải 1").

The longest leading run of at least two words that matches a GeoNames name (folded: no diacritics, đ → d) is replaced
by its accented spelling; the rest of the name (numbers, "I", "BOT", …) is kept. Names already accented are unchanged.
"""
from __future__ import annotations

import zipfile
from collections import defaultdict
from functools import lru_cache

from .admin import fold
from .fetch import RAW


@lru_cache(maxsize=1)
def _spellings():
    best = defaultdict(lambda: (-1, None))
    with zipfile.ZipFile(RAW / "geonames" / "VN.zip") as z:
        for ln in z.read("VN.txt").decode("utf-8").splitlines():
            f = ln.split("\t")
            pop = int(f[14] or 0)
            if f[6] not in ("P", "A") or pop <= 0:
                continue  # trust populated places and administrative areas with a recorded population only
            for name in [f[1]] + f[3].split(","):
                name = name.strip().replace("Ð", "Đ")
                if not name or name == fold(name) or not name[0].isupper():
                    continue  # only accented, capitalised spellings
                words = name.split()
                if len(words) < 2 or len(words) > 4:
                    continue
                key = fold(name)
                if pop > best[key][0]:
                    best[key] = (pop, name)
    out = {k: v[1] for k, v in best.items()}
    from .admin import OLD, NEW
    for _, name, seat in OLD.values():  # the project's own verified spellings win
        for n in (name, seat):
            if n and len(n.split()) >= 2:
                out[fold(n)] = n
    for n in NEW:
        if len(n.split()) >= 2:
            out[fold(n)] = n
    return out


def accent(name: str) -> str:
    if not name or name != fold(name).title() and any(ord(c) > 127 for c in name):
        return name
    words = name.split()
    sp = _spellings()
    for n in range(min(4, len(words)), 1, -1):
        hit = sp.get(fold(" ".join(words[:n])))
        if hit:
            return " ".join([hit] + words[n:])
    return name


if __name__ == "__main__":
    for s in ["Duyen Hai 1", "Vung Ang I", "Mong Duong 2", "Hiep Phuoc", "Ca Mau 1", "Son La", "Duong Dong", "Phu My 1",
              "Cat Lai", "Nghe Tinh", "Ninh Binh", "Pha Lai 2", "AES Mong Duong"]:
        print(f"{s!r:22} → {accent(s)!r}")
