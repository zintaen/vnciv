"""infrastructure.json: expressways, national roads and railways snapped to hex links; seaports and airports."""
from __future__ import annotations

import csv
import json
import re
from collections import defaultdict

from ..fetch import RAW
from ..geo import geojson_lines
from ..store import save_interim, write_web
from .common import World, site_cell, wkt_point
from .hexlinks import links_of, sample_cells

ROAD_CLASSES = [{"id": "interstate", "name": "Expressway"}, {"id": "major", "name": "National road"}]
RAIL_TIERS = [{"id": "main", "name": "Main line"}, {"id": "secondary", "name": "Branch line"}]
HUBS = {"L": "Major hub (10M+ passengers)", "M": "Medium hub (2–10M)", "S": "Small hub (0.5–2M)", "N": "Local airport"}
RAIL_MAIN = 6
# Nội Bài lies in Sóc Sơn district, Hà Nội; geoBoundaries' generalised border puts its point in Vĩnh Phúc
AIRPORT_PROVINCE = {"HAN": "HN"}
RULES = {
    "roads": "Natural Earth 1:10m roads in Vietnam, sampled along their length and snapped to hex-centre links. Class 0: "
             "every road Natural Earth marks as an expressway (cao tốc). Class 1: other roads it types as major highway "
             "or road, or unclassified roads at scale rank 5 or less (the main national roads), where no expressway "
             "already joins the same two hexes. Natural Earth is generalised and lags new expressways.",
    "rail": f"Natural Earth 1:10m railroads, snapped to hex-centre links; tier 0 (main line) is scale rank {RAIL_MAIN} or "
            "less, which includes the North–South (Thống Nhất) railway. Lines in neighbouring countries are dropped.",
    "ports": "Ports and port terminals in Wikidata with coordinates (instances of port). Vietnam's port throughput "
             "statistics (Vinamarine) are not published as open data, so ports are not ranked by tonnage.",
    "airports": "Every Vietnamese airport with scheduled service and an IATA code (OurAirports), with yearly passengers "
                "from Airports Corporation of Vietnam figures compiled on Wikipedia. Hub class by passengers: major 10M+, "
                "medium 2–10M, small 0.5–2M, local under 0.5M.",
}


def build_roads(W, ne):
    cls_of = {}
    for f in ne:
        p = f["properties"]
        sr = p.get("scalerank") or 99
        if p.get("expressway") == 1:
            cls = 0
        elif p.get("type") in ("Major Highway", "Road") or (p.get("type") == "Unknown" and sr <= 5):
            cls = 1
        else:
            continue
        for line in geojson_lines(f["geometry"]):
            if not any(101.5 < x < 110 and 8 < y < 23.6 for x, y in line):
                continue
            for run in sample_cells(W.grid, [W.proj(x, y) for x, y in line]):
                for a, b in links_of(W.grid, run):
                    if W.owner[a] == -2 or W.owner[b] == -2 or (W.owner[a] < 0 and W.owner[b] < 0):
                        continue
                    cls_of[(a, b)] = min(cls, cls_of.get((a, b), 9))
    return [[a, b, c, None] for (a, b), c in sorted(cls_of.items())]


def build_rail(W, ne):
    tier_of = {}
    for f in ne:
        sr = f["properties"].get("scalerank") or 99
        tier = 0 if sr <= RAIL_MAIN else 1
        for line in geojson_lines(f["geometry"]):
            if not any(101.5 < x < 110 and 8 < y < 23.6 for x, y in line):
                continue
            keep = lambda x, y: W.grid.cell_at(x, y) >= 0 and W.owner[W.grid.cell_at(x, y)] != -2
            for run in sample_cells(W.grid, [W.proj(x, y) for x, y in line], keep):
                for a, b in links_of(W.grid, run):
                    if W.owner[a] == -2 or W.owner[b] == -2 or (W.owner[a] < 0 and W.owner[b] < 0):
                        continue
                    tier_of[(a, b)] = min(tier, tier_of.get((a, b), 9))
    return [[a, b, t] for (a, b), t in sorted(tier_of.items())]


def place(W, lon, lat, rings=2):
    x, y = W.proj(lon, lat)
    cell, k = W.place(lon, lat, rings)
    if cell is None:
        return None
    iso = W.counties[k]
    return {"x": round(x, 1), "y": round(y, 1), "cell": cell, "county": iso, "cbsa": iso,
            "state": W.states[W.old_new[k]]}


def airport_passengers():
    """{IATA: (passengers, year)} from the Wikipedia table: the newest year with a figure."""
    text = json.loads((RAW / "wikipedia_airports" / "busiest_airports.json").read_text())["parse"]["wikitext"]
    sec = text.split("===2020s===", 1)[1].split("|}", 1)[0]
    head = re.findall(r"data-sort-type=number\|(\d{4})", sec)
    out = {}
    for row in sec.split("|-")[1:]:
        cells = [c.strip() for c in row.strip().split("\n") if c.startswith("|")]
        cells = [re.sub(r"<ref[^>]*/>|<ref.*?</ref>|<ref[^>]*>.*", "", c[1:]).strip() for c in cells]
        if len(cells) < 6:
            continue
        iata = cells[4]
        vals = cells[6:6 + len(head)]
        for year, v in reversed(list(zip(head, vals))):
            if "unknown" in v.lower():  # data-sort-value="N" {{unknown}}: no figure for that year
                continue
            n = re.sub(r"[^\d]", "", v)
            if n:
                out[iata] = (int(n), int(year))
                break
    return out


def build():
    W = World()
    ne = RAW / "natural_earth"
    roads = build_roads(W, json.loads((ne / "ne_10m_roads.geojson").read_text())["features"])
    rail = build_rail(W, json.loads((ne / "ne_10m_railroads.geojson").read_text())["features"])
    print(f"    {len(roads)} road links, {len(rail)} rail links")

    seen, ports = set(), []
    for r in json.loads((RAW / "wikidata" / "ports.json").read_text())["results"]["bindings"]:
        if r["s"]["value"] in seen:
            continue
        seen.add(r["s"]["value"])
        name = r["sLabel"]["value"]
        if "Naval" in r.get("enLabel", {}).get("value", "") or re.fullmatch(r"Q\d+", name):
            continue
        lon, lat = wkt_point(r["c"]["value"])
        pl = place(W, lon, lat)
        if not pl:
            continue
        ports.append({"id": r["s"]["value"].rsplit("/", 1)[1], "name": name, "type": "coastal", "rank": None,
                      "tons": None, "domestic": None, "foreign": None, "imports": None, "exports": None, "year": None, **pl})
    # one port per hex: keep the first listed
    by_cell = {}
    for p in ports:
        by_cell.setdefault(p["cell"], p)
    ports = sorted(by_cell.values(), key=lambda p: p["name"])
    for k, p in enumerate(ports):
        p["rank"] = k + 1

    pax = airport_passengers()
    from ..admin import old_units
    SEAT = {u["iso"]: u["name"] for u in old_units()}  # where an airport is: its former province (OurAirports municipality strings are messy)
    airports = []
    for r in csv.DictReader(open(RAW / "ourairports" / "airports.csv", encoding="utf-8")):
        if r["iso_country"] != "VN" or r["scheduled_service"] != "yes" or not r["iata_code"]:
            continue
        pl = place(W, float(r["longitude_deg"]), float(r["latitude_deg"]))
        if not pl:
            continue
        if r["iata_code"] in AIRPORT_PROVINCE:  # generalised outlines put a border airport in the neighbour
            iso = AIRPORT_PROVINCE[r["iata_code"]]
            k = W.counties.index(iso)
            pl.update(county=iso, cbsa=iso, state=W.states[W.old_new[k]])
            if W.county[pl["cell"]] != k:
                pl["cell"] = site_cell(W, pl["x"], pl["y"], 2, county=k) or pl["cell"]
        n, year = pax.get(r["iata_code"], (None, None))
        hub = None if n is None else "L" if n >= 1e7 else "M" if n >= 2e6 else "S" if n >= 5e5 else "N"
        airports.append({"id": r["iata_code"], "name": r["name"], "city": SEAT[pl["cbsa"]], "hub": hub,
                         "enplanements": n, "enplanements_prev": None, "cargo_lbs": None, "year": year, **pl})
    airports.sort(key=lambda a: -(a["enplanements"] or 0))
    print(f"    {len(ports)} ports, {len(airports)} airports ({sum(a['enplanements'] is not None for a in airports)} with passengers)")
    doc = {"version": 1,
           "vintage": {"roads": "Natural Earth v5.1.2 (1:10m)", "rail": "Natural Earth v5.1.2 (1:10m)",
                       "ports": "Wikidata", "airports": f"ACV passengers {max((a['year'] or 0) for a in airports)}"},
           "sources": ["natural_earth", "wikidata", "ourairports", "wikipedia_airports"], "rules": RULES,
           "road_classes": ROAD_CLASSES, "rail_tiers": RAIL_TIERS, "hubs": HUBS, "roads": roads, "rail": rail,
           "ports": ports, "airports": airports}
    write_web("infrastructure.json", doc)
    save_interim("_infrastructure", doc)
