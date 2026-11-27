"""wonders.json: UNESCO World Heritage sites, national parks, the national and regional universities, landmarks."""
from __future__ import annotations

import json
import re

from ..fetch import RAW
from ..sources import LANDMARKS
from ..store import save_interim, write_web
from .common import World, site_cell, wkt_point

# The two national universities and the three regional universities (Law on Higher Education 2012, art. 8)
UNIVERSITIES = [("Q1076729", "Đại học Quốc gia Hà Nội", "VNU Hà Nội"),
                ("Q943759", "Đại học Quốc gia Thành phố Hồ Chí Minh", "VNU TP.HCM"),
                ("Q1310048", "Đại học Huế", "Đại học Huế"),
                ("Q945839", "Đại học Đà Nẵng", "Đại học Đà Nẵng"),
                ("Q4116346", "Đại học Thái Nguyên", "Đại học Thái Nguyên")]
RULES = [
    {"id": "world_heritage", "kind": "landmark", "kinds": ["natural", "landmark"], "year": 2025,
     "text": "Every UNESCO World Heritage site in Vietnam (World Heritage list as of 2025), at its Wikidata coordinates; "
             "a serial site without its own coordinates (the Complex of Huế Monuments) is placed at the mean of its "
             "components. Ranked by year of inscription."},
    {"id": "national_park", "kind": "natural", "kinds": ["natural"], "year": 2025,
     "text": "Every national park (vườn quốc gia) that Wikidata lists with coordinates (a few parks are missing "
             "there), except those inside a World Heritage wonder (Cát Bà, part of Hạ Long Bay–Cát Bà since 2023). Ranked by area where Wikidata records it (largest first), then by name. Vietnam publishes no "
             "visitor counts per park, so parks are not ranked by visits."},
    {"id": "research_university", "kind": "university", "kinds": ["university"], "year": 2025,
     "text": "The two national universities and the three regional universities, the multi-campus university systems "
             "named in the Law on Higher Education; placed at their Wikidata coordinates when Wikidata has them."},
    {"id": "landmark", "kind": "landmark", "kinds": ["landmark"], "curated": True,
     "text": "Hand-picked by this project: famous monuments not already covered by the World Heritage list, placed at "
             "their Wikidata coordinates. Ranked alphabetically, not by importance."},
]
MAX_PARK_KM2 = 2500  # Vietnam's largest national parks are ~1,000-2,000 km²; larger values are entry errors
# UNESCO inscription years (whc.unesco.org), used when Wikidata lacks the qualifier
INSCRIBED = {"678": 1993, "672": 1994, "948": 1999, "949": 1999, "951": 2003, "1328": 2010, "1358": 2011, "1438": 2014,
             "1732": 2025}
# national parks inside a World Heritage site (Cát Bà joined Hạ Long Bay's site 672 in 2023)
PARK_IN_WH = {"Q1537215"}
NATURAL_WH = {"672", "951", "1438"}  # Hạ Long Bay–Cát Bà, Phong Nha–Kẻ Bàng, Tràng An (mixed)
SHORT = {"672": "Vịnh Hạ Long", "951": "Phong Nha–Kẻ Bàng", "1438": "Tràng An", "678": "Cố đô Huế", "948": "Phố cổ Hội An",
         "949": "Mỹ Sơn", "1328": "Hoàng thành Thăng Long", "1358": "Thành nhà Hồ", "1732": "Yên Tử"}


def bindings(name):
    return json.loads((RAW / "wikidata" / name).read_text())["results"]["bindings"]


def build():
    W = World()
    wonders = []

    def add(id_, name, short, kind, rule, lon, lat, metrics, en=None, curated=False):
        x, y = W.proj(lon, lat)
        cell, k = W.place(lon, lat, rings=2)
        if cell is None:
            print(f"    ! {name}: no land hex")
            return
        wonders.append({"id": id_, "name": name, "short": short, "name_en": en, "kind": kind, "rule": rule, "rank": 0,
                        "metrics": metrics, "x": round(x, 1), "y": round(y, 1), "cell": cell, "cells": None,
                        "county": W.counties[k], "cbsa": W.counties[k], "state": W.states[W.old_new[k]],
                        "curated": curated})

    # World Heritage: main entries have a plain numeric ref; components "678-005" place a site without coordinates
    sites, parts = {}, {}
    for r in bindings("heritage.json"):
        ref = r["ref"]["value"]
        m = re.fullmatch(r"(\d+)(bis)?", ref)
        if m:
            s = sites.setdefault(m.group(1), {"name": r["sLabel"]["value"], "en": r.get("enLabel", {}).get("value"),
                                              "c": None, "year": None})
            if r.get("c"):
                s["c"] = wkt_point(r["c"]["value"])
            if r.get("year"):
                y = int(r["year"]["value"][:4])
                s["year"] = min(s["year"] or y, y)
        elif "-" in ref and r.get("c"):
            parts.setdefault(ref.split("-")[0], []).append(wkt_point(r["c"]["value"]))
    for ref, s in sites.items():
        c = s["c"] or (tuple(sum(v) / len(v) for v in zip(*parts[ref])) if ref in parts else None)
        if not c:
            continue
        add(f"wh-{ref}", s["name"], SHORT.get(ref, s["name"]), "natural" if ref in NATURAL_WH else "landmark",
            "world_heritage", *c, {"inscribed": s["year"] or INSCRIBED.get(ref), "whc_ref": ref}, en=s["en"])
    wh_names = {w["name"] for w in wonders}

    seen = set()
    for r in bindings("parks.json"):
        q = r["s"]["value"].rsplit("/", 1)[1]
        name = r["sLabel"]["value"]
        if q in seen or q in PARK_IN_WH or name in wh_names or re.fullmatch(r"Q\d+", name):
            continue
        seen.add(q)
        area = float(r["area"]["value"]) / 1e6 if r.get("area") else None
        if area and area > MAX_PARK_KM2:  # a unit slip in Wikidata (Bến En: hectares entered as km²)
            area = None
        short = name.replace("Vườn quốc gia ", "VQG ").replace("Khu bảo tồn thiên nhiên ", "KBT ")
        add(f"np-{q}", name, short, "natural", "national_park", *wkt_point(r["c"]["value"]),
            {"area_km2": round(area, 1) if area else None, "visits": None}, en=r.get("enLabel", {}).get("value"))

    unis = {r["s"]["value"].rsplit("/", 1)[1]: r for r in bindings("universities.json")}
    for q, name, short in UNIVERSITIES:
        r = unis.get(q)
        if not r:
            print(f"    ! {name}: no coordinates in Wikidata")
            continue
        inc = r.get("inception", {}).get("value")
        add(f"uni-{q}", name, short, "university", "research_university", *wkt_point(r["c"]["value"]),
            {"founded": int(inc[:4]) if inc else None}, en=r.get("enLabel", {}).get("value"))

    by_label = {}
    for r in bindings("landmarks.json"):
        by_label.setdefault(r["label"]["value"], r)
    for label in LANDMARKS:
        r = by_label.get(label)
        if r:
            add(f"lm-{r['s']['value'].rsplit('/', 1)[1]}", r["sLabel"]["value"], label, "landmark", "landmark",
                *wkt_point(r["c"]["value"]), {}, en=r.get("enLabel", {}).get("value"), curated=True)

    order = {r["id"]: k for k, r in enumerate(RULES)}
    key = {"world_heritage": lambda w: (w["metrics"]["inscribed"] or 9999, w["name"]),
           "national_park": lambda w: (-(w["metrics"]["area_km2"] or 0), w["name"]),
           "research_university": lambda w: [u[0] for u in UNIVERSITIES].index(w["id"][4:]),
           "landmark": lambda w: w["short"]}
    wonders.sort(key=lambda w: (order[w["rule"]], key[w["rule"]](w)))
    rank = {}
    for w in wonders:
        rank[w["rule"]] = rank.get(w["rule"], 0) + 1
        w["rank"] = rank[w["rule"]]
    print("    " + ", ".join(f"{k} {v}" for k, v in rank.items()))
    doc = {"version": 1, "vintage": {"heritage": "UNESCO World Heritage list via Wikidata, 2025", "parks": "Wikidata",
                                     "universities": "Wikidata", "landmarks": "Wikidata"},
           "sources": ["wikidata"], "rules": RULES,
           "national": {"world_heritage": rank.get("world_heritage", 0), "national_parks": rank.get("national_park", 0),
                        "park_visits": None, "r1_universities": rank.get("research_university", 0)},
           "wonders": wonders}
    write_web("wonders.json", doc)
    save_interim("_wonders", doc)
