"""Society stream: ethnic groups (2019 census) and crops (NSO yearbook 2025) as lenses, plus web/data/ethnic.json.

Lenses are appended to web/data/lenses.json (earlier copies of this builder's own lenses are replaced; no other lens
is touched). Every hex takes the value of its former province (world.json `county`).
"""
from __future__ import annotations

import csv
import json

from ..admin import NEW, old_units
from ..fetch import ROOT
from ..nso.names import std
from ..store import WEB, write_web
from .common import World

STATS = ROOT / "data" / "stats"
CENSUS_CSV = STATS / "census2019" / "ethnic_by_province.csv"
NOT_ETHNIC = ("Người nước ngoài", "Không xác định")  # foreigners, ethnicity not stated
KINH = "Kinh"
# Largest group: colour per category (all six that are largest somewhere; the builder fails if another one appears)
LARGEST = [("Kinh", "#d8c27a"), ("Tày", "#4f9d69"), ("Thái", "#3f7fbf"), ("Mường", "#c0584f"), ("Nùng", "#8c6bb1"),
           ("Mông", "#e08a2e")]
RULES = {
    "minority_share": "Ethnic-minority residents (the 53 groups other than Kinh) ÷ all residents counted on census day "
                      "(foreigners and residents with no stated ethnicity count in the total only).",
    "largest": "The ethnic group with the most residents in the former province on 1 April 2019.",
    "hexes": "Each hex shows the figure of the former province it belongs to (world.json county).",
    "provinces": "The 34 provinces of 2025 are sums of their former provinces.",
}
SOCIETY_IDS = {"ethnic_largest", "ethnic_minority"}
YB = "https://www.nso.gov.vn/wp-content/uploads/2026/07/NG-TOAN-QUOC-2025-1.pdf"
# id, csv, name, emoji, ramp, factor (csv unit → tonnes), partial (an "of which" table), table
CROPS = [
    ("crop_rice", "paddy_production", "Rice", "🌾", "farmland", 1000, False, "P198"),
    ("crop_maize", "maize_production", "Maize", "🌽", "homeownership", 1000, False, "P210"),
    ("crop_cassava", "cassava_production", "Cassava", "🥔", "income", 1000, True, "P214"),
    ("crop_sugarcane", "sugarcane_production", "Sugarcane", "🎋", "home", 1000, False, "P216"),
    ("crop_tea", "tea_production", "Tea", "🍵", "forest", 1000, True, "P222"),
    ("crop_orange", "orange_production", "Orange", "🍊", "uninsured", 1000, True, "P223"),
]
CROP_IDS = {c[0] for c in CROPS}
GROUP = {"id": "agriculture", "name": "Agriculture"}


def census():
    """{province_std or 'nation': {group: persons}}, groups in the census table's order."""
    out = {}
    for r in csv.DictReader(open(CENSUS_CSV, encoding="utf-8")):
        out.setdefault(r["province_std"], {})[r["group"]] = int(r["population"])
    return out


def read_csv(name):
    out = {}
    for r in csv.DictReader(open(STATS / "2025" / f"{name}.csv", encoding="utf-8")):
        if r["value"] not in ("", None):
            out[r["province_std"]] = float(r["value"])
    return out


def area():
    return {r["province_std"]: float(r["value"]) for r in csv.DictReader(open(STATS / "2024" / "area_km2.csv", encoding="utf-8"))}


def summary(pop):
    total = sum(pop.values())
    minority = sum(v for g, v in pop.items() if g != KINH and g not in NOT_ETHNIC)
    largest = max((g for g in pop if g not in NOT_ETHNIC), key=lambda g: pop[g])
    return {"total": total, "minority_share": round(minority / total, 4), "kinh_share": round(pop[KINH] / total, 4),
            "largest": largest}


def ramps():
    return json.loads((ROOT / "pipeline" / "ramps.json").read_text())


def build():
    W = World()
    olds = old_units()
    std_of = {u["iso"]: std(u["name"]) for u in olds}
    assert all(std_of.values()), [u["name"] for u in olds if not std(u["name"])]
    iso_of_k = list(W.counties)  # county index → iso
    land = [i for i in range(len(W.owner)) if W.owner[i] >= 0]

    # --- ethnic groups ---
    C = census()
    groups = list(C["nation"])
    assert len(groups) == 56 and set(std_of.values()) <= set(C)
    former, by_new = {}, {}
    for u in olds:
        pop = C[std_of[u["iso"]]]
        former[u["iso"]] = {"name": u["name"], "province": NEW[u["new"]][0], **summary(pop), "pop": [pop[g] for g in groups]}
        acc = by_new.setdefault(NEW[u["new"]][0], {g: 0 for g in groups})
        for g in groups:
            acc[g] += pop[g]
    provinces = {a: {"name": next(n for n, (ab, _) in NEW.items() if ab == a), **summary(p), "pop": [p[g] for g in groups]}
                 for a, p in sorted(by_new.items())}
    cats = [c for c, _ in LARGEST]
    extra = {f["largest"] for f in former.values()} - set(cats)
    assert not extra, f"largest group not in LARGEST: {extra}"
    write_web("ethnic.json", {
        "version": 1, "source": "nso_census2019", "date": "2019-04-01", "unit": "persons",
        "note": "Census of 1 April 2019, by the 63 provinces of the time; the 34 provinces of 2025 are their sums.",
        "rules": RULES, "groups": groups, "nation": {**summary(C["nation"]), "pop": [C["nation"][g] for g in groups]},
        "former": former, "provinces": provinces})

    def per_hex(fn):
        vals = [None] * len(W.owner)
        for i in land:
            k = W.county[i]
            if k >= 0:
                vals[i] = fn(iso_of_k[k])
        return vals

    R = ramps()
    src_line = "NSO, Completed results of the 2019 Population and Housing Census, Table 2"
    lenses = [
        {"id": "ethnic_largest", "group": "people", "name": "Largest ethnic group", "icon": "l-people", "emoji": "🧑‍🤝‍🧑",
         "unit": "ethnic group", "format": "category", "scale": "linear", "domain": [0, len(cats) - 1],
         "ramp": [c for _, c in LARGEST], "higher_is": "neutral", "source": "nso_census2019", "year": "2019",
         "categories": [{"name": c, "color": col} for c, col in LARGEST],
         "description": "The ethnic group with the most residents in each former province on census day, 1 April 2019. "
                        f"Kinh are the largest group in {sum(f['largest'] == KINH for f in former.values())} of the 63 former provinces.",
         "note": f"{src_line}. Each hex shows its former province; minorities living in parts of a province are not visible.",
         "values": per_hex(lambda iso: cats.index(former[iso]["largest"]))},
        {"id": "ethnic_minority", "group": "people", "name": "Ethnic minorities", "icon": "l-people", "emoji": "🧑‍🤝‍🧑",
         "unit": "share of residents", "format": "pct", "scale": "linear", "domain": [0, 1], "ramp": R["foreign_born"],
         "higher_is": "neutral", "source": "nso_census2019", "year": "2019",
         "description": "Share of residents belonging to one of the 53 ethnic minorities (all groups except Kinh), "
                        "census of 1 April 2019, by former province.",
         "note": f"{src_line}. Nationally {summary(C['nation'])['minority_share'] * 100:.1f}%.",
         "values": per_hex(lambda iso: former[iso]["minority_share"])},
    ]

    # --- crops: tonnes per km² of the former province ---
    A = area()
    for lid, name_csv, name, emoji, rmp, factor, partial, table in CROPS:
        v = read_csv(name_csv)
        dens = {iso: round(v[s] * factor / A[s], 2) if s in v else None for iso, s in std_of.items()}
        vals = per_hex(lambda iso: dens[iso])
        pos = sorted(x for x in vals if x)
        dom = [pos[int(len(pos) * 0.02)], pos[min(len(pos) - 1, int(len(pos) * 0.98))]]
        desc = (f"{name} production in 2025 (preliminary) per km² of the former province's area, tonnes "
                f"(NSO Statistical Yearbook 2025, table {table[1:]}).")
        listed = sum(1 for x in dens.values() if x is not None)
        note = (f"NSO lists only the {listed} main producing former provinces for this crop; the others show no data "
                "(small or no production, not published)." if partial else
                "A province total spread over the whole province: the fields themselves are not mapped.")
        lenses.append({"id": lid, "group": "agriculture", "name": name, "icon": "l-farmland", "emoji": emoji,
                       "unit": "t / km²", "format": "float", "scale": "log", "domain": dom, "ramp": R[rmp],
                       "higher_is": "neutral", "source": "nso_yearbook", "year": "2025", "level": "63",
                       "description": desc, "note": note, "values": vals})

    # --- append to lenses.json (replace only this builder's own lenses) ---
    path = WEB / "lenses.json"
    L = json.loads(path.read_text())
    mine = SOCIETY_IDS | CROP_IDS
    L["lenses"] = [l for l in L["lenses"] if l["id"] not in mine] + lenses
    if not any(g["id"] == GROUP["id"] for g in L["groups"]):
        L["groups"].append(GROUP)
    write_web("lenses.json", L)
    n_min = sum(1 for f in former.values() if f["largest"] != KINH)
    print(f"    ethnic: 63 former / {len(provinces)} provinces, {n_min} with a non-Kinh largest group; "
          f"{len(lenses)} lenses appended")

