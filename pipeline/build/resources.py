"""resources.json: power plants (WRI Global Power Plant Database) as strategy-game resources."""
from __future__ import annotations

import csv
from collections import defaultdict

from ..fetch import RAW
from .common import World, site_cell
from ..store import save_interim, write_web

SRC = "gppd"
PLANT_MIN = {"hydro": 100, "coal_plant": 300, "gas_plant": 300, "oil_plant": 100}
CLUSTER_MIN = {"solar": 50, "wind": 30}
FUEL = {"Hydro": "hydro", "Coal": "coal_plant", "Gas": "gas_plant", "Oil": "oil_plant", "Solar": "solar", "Wind": "wind"}
NOTE = ("Data as of 2021 (WRI Global Power Plant Database v1.3.0): the solar and wind boom of 2019–2021 is only "
        "partly in it, and plants built since are missing.")


def _t(id, name, emoji, color, description, icon=None):
    return {"id": id, "name": name, "category": "energy", "emoji": emoji, "icon": icon or f"r-{id}", "color": color,
            "unit": "MW", "description": f"{description} {NOTE}", "source": SRC}


TYPES = [
    _t("hydro", "Hydroelectric dam", "💧", "#3fa7d6", f"Hydro plants of at least {PLANT_MIN['hydro']} MW; value is the plant's capacity."),
    _t("coal_plant", "Coal power plant", "🏭", "#5a5a5a", f"Coal plants of at least {PLANT_MIN['coal_plant']} MW; value is the plant's capacity."),
    _t("gas_plant", "Gas power plant", "⚡", "#f08a24", f"Gas plants of at least {PLANT_MIN['gas_plant']} MW; value is the plant's capacity."),
    _t("oil_plant", "Oil power plant", "🛢️", "#3a2f2a", f"Oil-fired plants of at least {PLANT_MIN['oil_plant']} MW.", icon="r-oil"),
    _t("wind", "Wind farms", "🌬️", "#9fd8cb", f"Wind capacity summed per hex, shown where a hex totals at least {CLUSTER_MIN['wind']} MW. Near-shore farms snap to the nearest coastal hex."),
    _t("solar", "Solar farms", "☀️", "#ffc93c", f"Utility-scale solar summed per hex, shown where a hex totals at least {CLUSTER_MIN['solar']} MW."),
]


def build():
    W = World()
    rows = [r for r in csv.DictReader(open(RAW / SRC / "global_power_plant_database.csv", encoding="utf-8"))
            if r["country"] == "VNM"]
    items = []
    clusters = defaultdict(lambda: {"mw": 0.0, "names": [], "x": 0, "y": 0})
    for r in rows:
        t = FUEL.get(r["primary_fuel"])
        if not t:
            continue
        mw = float(r["capacity_mw"])
        lon, lat = float(r["longitude"]), float(r["latitude"])
        x, y = W.proj(lon, lat)
        cell, k = W.place(lon, lat, rings=3 if t == "wind" else 1)
        if cell is None:
            continue
        if t in CLUSTER_MIN:
            c = clusters[(t, cell)]
            c["mw"] += mw
            c["names"].append(r["name"])
            c["x"], c["y"], c["k"] = x, y, k
            continue
        if mw < PLANT_MIN[t]:
            continue
        year = int(r["commissioning_year"][:4]) if r["commissioning_year"] else None
        items.append({"type": t, "name": r["name"], "x": round(x, 1), "y": round(y, 1), "cell": cell,
                      "value": round(mw), "detail": r["owner"].strip() or None, "since": year, "_k": k})
    for (t, cell), c in clusters.items():
        if c["mw"] >= CLUSTER_MIN[t]:
            names = c["names"]
            items.append({"type": t, "name": names[0] if len(names) == 1 else f"{names[0]} + {len(names) - 1} more",
                          "x": round(c["x"], 1), "y": round(c["y"], 1), "cell": cell, "value": round(c["mw"]),
                          "detail": None, "farms": len(names), "_k": c["k"]})
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
    print("    " + ", ".join(f"{t} {national[t]['count']}" for t in national))
    out = {"types": types, "items": items,
           "summary": {"note": "Totals of the mapped sites only (each type's threshold applies), not total generating capacity. " + NOTE,
                       "national": national, "states": dict(states)}}
    write_web("resources.json", out)
    save_interim("_resources", out)
