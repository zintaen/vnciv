"""trade.json: domestic air routes (OpenFlights route database, June 2014) as the map's trade routes.

Vietnam publishes no freight flows between provinces, so the trade layer shows the busiest domestic air links: each
airport pair served by scheduled flights in OpenFlights, weighted by the number of airlines flying it.
"""
from __future__ import annotations

import csv
import math

from ..fetch import RAW
from ..geo import UNIT
from ..store import load_interim, write_web
from .common import World

TOP = 30
RULE = (f"The {TOP} domestic air routes flown by the most airlines in the OpenFlights route database (June 2014, its "
        "last update), both directions together; ties are broken by the two airports' 2025 passengers (ACV). Each "
        "route links the cities whose former provinces hold the two airports.")
PATH_NOTE = ("Drawn as an arc between the two cities: OpenFlights lists which airports are linked, not how many "
             "passengers fly each route, and routes opened since 2014 are missing.")


def build():
    W = World()
    infra = load_interim("_infrastructure")
    airports = {a["id"]: a for a in infra["airports"]}
    import json
    cities = {c["id"]: c for c in json.loads((RAW.parent.parent / "web" / "data" / "cities.json").read_text())}
    airlines = {}
    with open(RAW / "openflights_routes" / "routes.dat", newline="", encoding="utf-8") as f:
        for row in csv.reader(f):
            a, b, al, stops = row[2], row[4], row[0], row[7]
            if a in airports and b in airports and a != b and stops == "0":
                airlines.setdefault(tuple(sorted((a, b))), set()).add(al)
    pax = lambda k: (airports[k[0]]["enplanements"] or 0) + (airports[k[1]]["enplanements"] or 0)
    pairs = sorted(airlines, key=lambda k: (-len(airlines[k]), -pax(k)))
    routes, used = [], set()
    for a, b in pairs:
        ca, cb = airports[a]["cbsa"], airports[b]["cbsa"]
        if not ca or not cb or ca == cb:
            continue
        A, B = cities[ca], cities[cb]
        dist = math.dist(W.center(A["cell"]), W.center(B["cell"])) / UNIT
        routes.append({"a": ca, "b": cb, "rank": len(routes) + 1, "airlines": len(airlines[(a, b)]),
                       "airline_codes": sorted(airlines[(a, b)]), "airports": [a, b], "value_musd": None,
                       "tons_k": None, "modes": {"air": 1.0}, "top_mode": "air", "dist_km": round(dist),
                       "path": [A["cell"], B["cell"]]})
        used |= {ca, cb}
        if len(routes) == TOP:
            break
    zones = []
    for cid in sorted(used):
        c = cities[cid]
        zones.append({"id": cid, "name": c["full"], "short": c["name"], "kind": "city", "states": c["states"],
                      "cities": [cid], "airports": sorted(k for k, a in airports.items() if a["cbsa"] == cid),
                      "anchor": {"cell": c["cell"], "x": c["x"], "y": c["y"], "city": cid},
                      "partners": sorted(([r["b"] if r["a"] == cid else r["a"], r["airlines"]] for r in routes
                                          if cid in (r["a"], r["b"])), key=lambda p: -p[1])[:5]})
    write_web("trade.json", {"version": 1, "vintage": "OpenFlights routes, June 2014", "year": 2014,
                             "sources": ["openflights_routes", "ourairports", "wikipedia_airports"],
                             "kind": "air", "rule": RULE, "path_note": PATH_NOTE,
                             "units": {"airlines": "airlines flying the route"},
                             "modes": [{"id": "air", "name": "Air"}], "zones": zones, "routes": routes})
    print(f"    {len(routes)} air routes between {len(zones)} cities; top: "
          f"{[(cities[r['a']]['name'], cities[r['b']]['name'], r['airlines']) for r in routes[:3]]}")
