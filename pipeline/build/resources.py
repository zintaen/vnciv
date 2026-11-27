"""resources.json: power plants mapped in OpenStreetMap (capacities filled from WRI's GPPD where OSM has none)."""
from __future__ import annotations

import csv
import json
import math
import re
from collections import defaultdict

from ..fetch import RAW
from ..admin import fold
from ..names import accent
from .common import World
from ..store import save_interim, write_web

SRC = "osm_power"
PLANT_MIN = {"hydro": 100, "coal_plant": 300, "gas_plant": 300, "oil_plant": 100}
CLUSTER_MIN = {"solar": 40, "wind": 30}
FILL_KM = 3  # a GPPD plant of the same fuel this close to an OSM plant without a capacity tag lends it its capacity
FUEL = {"hydro": "hydro", "coal": "coal_plant", "gas": "gas_plant", "oil": "oil_plant", "diesel": "oil_plant",
        "solar": "solar", "wind": "wind"}
GPPD_FUEL = {"Hydro": "hydro", "Coal": "coal_plant", "Gas": "gas_plant", "Oil": "oil_plant", "Solar": "solar", "Wind": "wind"}
# plants tagged without plant:source: the fuel from the name
NAME_FUEL = [(r"thủy điện|thuỷ điện|hydro", "hydro"), (r"điện gió|phong điện|wind", "wind"),
             (r"mặt trời|quang điện|solar", "solar"), (r"nhiệt điện than|coal", "coal_plant")]
NOTE = ("Power plants mapped in OpenStreetMap (as fetched in 2026), with each plant's tagged capacity; where OSM has "
        "none, the capacity of the same-fuel plant within 3 km in WRI's Global Power Plant Database (2021). Coverage "
        "depends on mappers: plants without a capacity in either source are left out, and rooftop solar is not mapped "
        "as plants.")


def _t(id, name, emoji, color, description, icon=None):
    return {"id": id, "name": name, "category": "energy", "emoji": emoji, "icon": icon or f"r-{id}", "color": color,
            "unit": "MW", "description": f"{description} {NOTE}", "source": SRC}


TYPES = [
    _t("hydro", "Hydroelectric dam", "💧", "#3fa7d6", f"Hydro power plants of at least {PLANT_MIN['hydro']} MW; value is the plant's capacity."),
    _t("coal_plant", "Coal power plant", "🏭", "#5a5a5a", f"Coal-fired power plants of at least {PLANT_MIN['coal_plant']} MW; value is the plant's capacity."),
    _t("gas_plant", "Gas power plant", "⚡", "#f08a24", f"Gas-fired power plants (including LNG) of at least {PLANT_MIN['gas_plant']} MW; value is the plant's capacity."),
    _t("oil_plant", "Oil power plant", "🛢️", "#3a2f2a", f"Oil-fired power plants of at least {PLANT_MIN['oil_plant']} MW.", icon="r-oil"),
    _t("wind", "Wind farms", "🌬️", "#9fd8cb", f"Wind farms summed per hex, shown where a hex totals at least {CLUSTER_MIN['wind']} MW. "
       "Near-shore farms snap to the nearest coastal hex. OpenStreetMap has many of Vietnam's wind farms without a capacity, "
       "so this layer shows well under the country's installed wind power."),
    _t("solar", "Solar farms", "☀️", "#ffc93c", f"Solar farms summed per hex, shown where a hex totals at least {CLUSTER_MIN['solar']} MW "
       "(many of the farms built in 2019–2020 are just under 50 MW)."),
]


def parse_mw(v):
    """'50 MW', '49.5 MWp', '1,2 GW', '50000 kW' → MW; None if not a quantity."""
    m = re.fullmatch(r"\s*(\d+(?:[.,]\d+)?)\s*([kKmMgG]?)\s*[wW][pP]?\s*", v or "")
    if not m:
        return None
    return float(m.group(1).replace(",", ".")) * {"k": 1e-3, "m": 1, "g": 1e3, "": 1e-6}[m.group(2).lower()]


def plant_type(tags):
    src = tags.get("plant:source") or tags.get("generator:source") or tags.get("source:power")
    if src:
        return FUEL.get(src.split(";")[0].strip())
    name = (tags.get("name") or "").lower()
    return next((t for pat, t in NAME_FUEL if re.search(pat, name)), None)


def plant_name(tags):
    n = tags.get("name:vi") or tags.get("name") or tags.get("name:en")
    if n and n.isascii():
        n = accent(n)
    return n


def km(a, b):
    return math.hypot((a[0] - b[0]) * 111.32 * math.cos(math.radians(a[1])), (a[1] - b[1]) * 110.57)


def osm_plants():
    """[{type, name, lonlat, mw, operator, since, filled}] from OSM, capacities filled from GPPD by location."""
    out = []
    for e in json.loads((RAW / SRC / "power_plants.json").read_text())["elements"]:
        tags = e.get("tags", {})
        if any(tags.get(k) for k in ("disused", "abandoned", "construction", "construction:power", "planned:power",
                                     "proposed:power")):
            continue  # only plants in service
        t = plant_type(tags)
        c = e.get("center") or e
        if not t or "lat" not in c:
            continue
        since = re.match(r"\d{4}", tags.get("start_date", ""))
        out.append({"type": t, "name": plant_name(tags), "lonlat": (c["lon"], c["lat"]),
                    "mw": parse_mw(tags.get("plant:output:electricity")), "operator": tags.get("operator"),
                    "since": int(since.group()) if since else None, "filled": False})
    gppd = [r for r in csv.DictReader(open(RAW / "gppd" / "global_power_plant_database.csv", encoding="utf-8"))
            if r["country"] == "VNM" and r["primary_fuel"] in GPPD_FUEL]
    # each GPPD plant pairs once with the nearest OSM plant of its fuel whose name shares a word with it (or that has no
    # name), greedy by distance; it lends its capacity (and name) only when that OSM plant has none, so a plant OSM
    # already has never lends to a neighbour
    pairs = sorted((km(p["lonlat"], (float(r["longitude"]), float(r["latitude"]))), i, j)
                   for i, p in enumerate(out) for j, r in enumerate(gppd)
                   if GPPD_FUEL[r["primary_fuel"]] == p["type"] and same_name(p["name"], r["name"]))
    used_p, used_g = set(), set()
    for d, i, j in pairs:
        if d > FILL_KM:
            break
        if i in used_p or j in used_g:
            continue
        used_p.add(i)
        used_g.add(j)
        p, r = out[i], gppd[j]
        if p["mw"] is None:
            p["mw"], p["filled"] = float(r["capacity_mw"]), True
        p["name"] = p["name"] or accent(r["name"])
        p["since"] = p["since"] or (int(r["commissioning_year"][:4]) if r["commissioning_year"] else None)
    return dedupe(out)


CORE = re.compile(r"\b(nha (may|may)|dap|thuy dien|nhiet dien|dien gio|dien mat troi|phong dien|cong ty|"
                  r"hydro(power|electric)?|power (plant|station)|dam|wind ?farm|solar)\b")


def core(name):
    return " ".join(CORE.sub(" ", fold(name or "").lower().replace("-", " ")).split())


def same_name(a, b):
    """Unnamed, or the core names share a word that is not a number."""
    if not a:
        return True
    return bool({w for w in core(a).split() if not w.isdigit()} & {w for w in core(b).split() if not w.isdigit()})


def dedupe(plants):
    """A dam and its powerhouse are often both mapped as plants: of two same-fuel plants with the same core name within
    15 km, or the same capacity within 2 km, keep the one with a tagged capacity (else the larger)."""
    keep = []
    for p in sorted(plants, key=lambda p: (p["filled"], p["mw"] is None, -(p["mw"] or 0))):
        dup = any(q["type"] == p["type"] and (
            (core(p["name"]) and core(p["name"]) == core(q["name"]) and km(p["lonlat"], q["lonlat"]) < 15) or
            (p["mw"] and q["mw"] and abs(p["mw"] - q["mw"]) <= 0.02 * q["mw"] and km(p["lonlat"], q["lonlat"]) < 2))
            for q in keep)
        if not dup:
            keep.append(p)
    return keep


def build():
    W = World()
    plants = osm_plants()
    items = []
    clusters = defaultdict(list)  # (type, cell) → [(mw, plant, x, y, k)]
    for p in plants:
        t, mw = p["type"], p["mw"]
        if not mw:
            continue
        lon, lat = p["lonlat"]
        cell, k = W.place(lon, lat, rings=3 if t == "wind" else 1)
        if cell is None:
            continue
        x, y = W.proj(lon, lat)
        if t in CLUSTER_MIN:
            clusters[(t, cell)].append((mw, p, x, y, k))
            continue
        if mw < PLANT_MIN[t] or not p["name"]:
            continue
        items.append({"type": t, "name": p["name"], "x": round(x, 1), "y": round(y, 1), "cell": cell,
                      "value": round(mw), "detail": p["operator"], "since": p["since"], "_k": k,
                      **({"capacity_from": "gppd"} if p["filled"] else {})})
    for (t, cell), farms in clusters.items():
        total = sum(f[0] for f in farms)
        named = sorted((f for f in farms if f[1]["name"]), key=lambda f: -f[0])
        if total < CLUSTER_MIN[t] or not named:
            continue
        _, top, x, y, k = named[0]  # the marker sits on the hex's largest named farm
        items.append({"type": t, "name": top["name"], "x": round(x, 1), "y": round(y, 1), "cell": cell,
                      "value": round(total), "detail": None, "farms": len(farms), "_k": k,
                      **({"capacity_from": "gppd"} if any(f[1]["filled"] for f in farms) else {})})
    for it in items:
        k = it.pop("_k")
        it["state"] = W.states[W.old_new[k]]
        it["cbsa"] = W.counties[k]
    order = {t["id"]: k for k, t in enumerate(TYPES)}
    items.sort(key=lambda it: (order[it["type"]], -(it["value"] or 0)))
    present = {it["type"] for it in items}
    types = [t for t in TYPES if t["id"] in present]
    national = {t["id"]: {"count": 0, "value": 0, "unit": "MW"} for t in types}
    states = defaultdict(dict)
    for it in items:
        n = national[it["type"]]
        n["count"] += 1
        n["value"] += it["value"]
        s = states[it["state"]].setdefault(it["type"], {"count": 0, "value": 0, "unit": "MW"})
        s["count"] += 1
        s["value"] += it["value"]
    # every OSM plant with a capacity (before thresholds), for the comparison with official totals
    mapped = defaultdict(float)
    for p in plants:
        mapped[p["type"]] += p["mw"] or 0
    print("    " + ", ".join(f"{t} {national[t]['count']} ({national[t]['value']} MW)" for t in national))
    print("    all mapped plants with a capacity: " + ", ".join(f"{t} {round(v)} MW" for t, v in mapped.items()))
    out = {"types": types, "items": items,
           "summary": {"note": "Totals of the power plants shown on the map only (each type's threshold applies), not "
                               "Vietnam's total generating capacity. " + NOTE,
                       "national": national, "states": dict(states)}}
    write_web("resources.json", out)
    save_interim("_resources", out)


if __name__ == "__main__":
    assert parse_mw("50 MW") == 50 and parse_mw("49.5 MWp") == 49.5 and parse_mw("1,2 GW") == 1200
    assert parse_mw("50000 kW") == 50 and parse_mw("yes") is None and parse_mw("26,4 MW") == 26.4
