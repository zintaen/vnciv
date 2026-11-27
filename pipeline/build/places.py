"""places.json: place names drawn on the map — the Hoàng Sa and Trường Sa archipelagos and the slogan between them,
their islands, notable coastal islands, and towns that are not one of the 63 city banners."""
from __future__ import annotations

import json
import math
import zipfile

from ..admin import fold, old_units
from ..fetch import RAW
from ..geo import UNIT
from ..store import write_web
from .common import World
from .world import archipelago_islands

TOWN_MIN_POP = 100_000
TOWN_CLEAR_KM = 15  # a town this close to a city banner's seat is left to the banner
# Well-known islands (display name, GeoNames name to look up, feature codes in order of preference, hint lat)
COASTAL = [
    ("Đảo Phú Quốc", "phu quoc", ("ADM2", "PPLA2"), 10.25), ("Côn Đảo", "con son", ("ISLS",), 8.68),
    ("Đảo Cát Bà", "dao cat ba", ("ISL",), 20.8), ("Đảo Lý Sơn", "ly son", ("PPLA2",), 15.37),
    ("Đảo Phú Quý", "dao phu quy", ("ISL",), 10.53), ("Quần đảo Cô Tô", "quan dao co to", ("ISLS",), 21.07),
    ("Đảo Bạch Long Vĩ", "dao bach long vi", ("ISL",), 20.13), ("Đảo Thổ Chu", "dao tho chu", ("ISL",), 9.31),
    ("Cù Lao Chàm", "cu lao cham", ("ISL",), 15.95), ("Quần đảo Nam Du", "quan dao nam du", ("ISLS",), 9.7),
    ("Hòn Khoai", "hon khoai", ("ISL",), 8.43), ("Đảo Cái Bầu", "dao cai bau", ("ISL",), 21.17),
    ("Hòn Tre", "hon tre", ("ISL",), 12.21), ("Cù Lao Xanh", "cu lao xanh", ("ISL",), 13.62),
]
# Well-known small towns (tourism, history) shown even under the population threshold: (name, hint lat)
TOURIST = [("Sa Pa", 22.34), ("Hội An", 15.88), ("Mũi Né", 10.93), ("Mộc Châu", 20.85), ("Đồng Văn", 23.28),
           ("Tam Đảo", 21.46), ("Sầm Sơn", 19.74), ("Cửa Lò", 18.81), ("Đồ Sơn", 20.71), ("Bà Nà", 15.99),
           ("Mai Châu", 20.66), ("Điện Biên Phủ", 21.39)]
SLOGAN = {"text": "Hoàng Sa, Trường Sa là của Việt Nam", "en": "Hoàng Sa and Trường Sa belong to Vietnam"}
RULES = {
    "archipelagos": "Hoàng Sa (Paracel Islands) belongs to Đà Nẵng and Trường Sa (Spratly Islands) to Khánh Hòa. Their "
                    "islands and reefs are placed at their Wikidata coordinates, looked up by Vietnamese name; each holds "
                    "at least the hex at its centre.",
    "islands": "Hand-picked well-known coastal islands, at their GeoNames coordinates.",
    "towns": f"GeoNames towns of {TOWN_MIN_POP:,} people or more that are not one of the 63 city banners (more than "
             f"{TOWN_CLEAR_KM} km from a former provincial seat), plus hand-picked tourist and historic towns.",
}


BAD_SPELLING = ("ưc", "ưt", "ưp", "ưch", "ưnh")  # letter runs that can't occur in Vietnamese (GeoNames typos)


def ok_name(name):
    """A plain Vietnamese town name: accented, not a district unit, no English words, no impossible spelling."""
    if not any(ord(ch) > 127 for ch in name):
        return False  # unaccented spelling ("Sa Dec"): GeoNames has no Vietnamese form
    if name.split()[0] in ("Huyện", "Quận", "Phường", "Xã", "Khu"):
        return False
    if any(w.isascii() and w.lower() in ("mines", "town", "city", "district") for w in name.split()):
        return False
    low = name.lower()
    return not any(b in low.replace("ức", "").replace("ứt", "") for b in BAD_SPELLING)


def geonames():
    with zipfile.ZipFile(RAW / "geonames" / "VN.zip") as z:
        rows = [ln.split("\t") for ln in z.read("VN.txt").decode("utf-8").splitlines()]
    return rows


def clean(name):
    for pre in ("Thành Phố ", "Thành phố ", "Thị Xã ", "Thị xã ", "Thị Trấn ", "Thị trấn "):
        if name.startswith(pre):
            return name[len(pre):]
    return name


def build():
    W = World()
    rows = geonames()
    pt = lambda lon, lat: [round(v, 1) for v in W.proj(lon, lat)]

    arch = archipelago_islands()
    groups = {}
    for a in arch:
        groups.setdefault(a["group"], []).append(a)
    archipelagos = []
    centers = {}
    for gid, name, owner in (("hoang_sa", "Quần đảo Hoàng Sa", "Đà Nẵng"), ("truong_sa", "Quần đảo Trường Sa", "Khánh Hòa")):
        g = groups.get(gid, [])
        lon = sum(a["lon"] for a in g) / len(g)
        lat = sum(a["lat"] for a in g) / len(g)
        centers[gid] = (lon, lat)
        archipelagos.append({"id": gid, "name": name, "owner": owner, "x": pt(lon, lat)[0], "y": pt(lon, lat)[1],
                             "islands": len(g)})
    (lo1, la1), (lo2, la2) = centers["hoang_sa"], centers["truong_sa"]
    mx, my = pt((lo1 + lo2) / 2 + 0.6, (la1 + la2) / 2)  # the open sea between the two groups
    slogan = {**SLOGAN, "x": mx, "y": my}

    islands = [{"name": a["name"], "en": a["en"], "group": a["group"], "x": pt(a["lon"], a["lat"])[0],
                "y": pt(a["lon"], a["lat"])[1]} for a in arch]
    for disp, key, codes, hint in COASTAL:
        cands = [r for r in rows if r[7] in codes and fold(r[1]).endswith(key)]
        if not cands:
            print(f"    ! no GeoNames entry for {disp}")
            continue
        r = min(cands, key=lambda r: (codes.index(r[7]), abs(float(r[4]) - hint)))
        x, y = pt(float(r[5]), float(r[4]))
        islands.append({"name": disp, "en": None, "group": "coastal", "x": x, "y": y})

    seats = [W.proj(*s) for s in seat_points(rows)]
    towns, seen = [], set()
    cand = sorted((r for r in rows if r[6] == "P" and r[7] in ("PPLA2", "PPL") and int(r[14] or 0) >= TOWN_MIN_POP),
                  key=lambda r: -int(r[14]))
    taken = {fold(c["name"]) for c in json.loads((RAW.parent.parent / "web" / "data" / "cities.json").read_text())}
    taken |= {fold(i["name"]).replace("dao ", "").replace("quan ", "") for i in islands}
    for r in cand:
        name = clean(r[1])
        if not ok_name(name) or fold(name) in seen or fold(name) in taken:
            continue
        x, y = W.proj(float(r[5]), float(r[4]))
        c = W.grid.cell_at(x, y)
        if c < 0 or W.owner[c] < 0 or any(math.dist((x, y), s) / UNIT < TOWN_CLEAR_KM for s in seats):
            continue
        seen.add(fold(name))
        towns.append({"name": name, "x": round(x, 1), "y": round(y, 1), "population": int(r[14]), "kind": "town"})
    for name, hint in TOURIST:
        if fold(name) in seen or fold(name) in taken:
            continue
        cands = [r for r in rows if r[6] == "P" and fold(clean(r[1])) == fold(name)]
        if not cands:
            print(f"    ! no GeoNames entry for {name}")
            continue
        r = min(cands, key=lambda r: (abs(float(r[4]) - hint), -int(r[14] or 0)))
        if abs(float(r[4]) - hint) > 0.3:
            print(f"    ! {name}: nearest GeoNames match too far ({r[4]})")
            continue
        x, y = W.proj(float(r[5]), float(r[4]))
        seen.add(fold(name))
        towns.append({"name": name, "x": round(x, 1), "y": round(y, 1), "population": int(r[14] or 0), "kind": "tourist"})
    write_web("places.json", {"version": 1, "sources": ["wikidata", "geonames"], "rules": RULES,
                              "archipelagos": archipelagos, "slogan": slogan, "islands": islands, "towns": towns})
    print(f"    {len(islands)} islands ({len(arch)} in Hoàng Sa/Trường Sa), {len(towns)} towns")


def seat_points(rows):
    """(lon, lat) of the 63 former provincial seats, as in cities.json."""
    cities = json.loads((RAW.parent.parent / "web" / "data" / "cities.json").read_text())
    W = World()
    return [W.proj.inverse(c["x"], c["y"]) for c in cities]
