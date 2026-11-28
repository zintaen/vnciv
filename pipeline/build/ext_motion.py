"""Data for the motion streams (Phase 2 and 3 animations), all lazy-loaded:

* storm_tracks.json: the IBTrACS track of every storm on the timeline (same order as timeline.json storms).
* merger.json: the 23 merged provinces of 2025, their former provinces and centroids, in Resolution 202's order.
* motion_routes.json: rail lines chained from the main-line links, illustrative sea lanes from the ports, air arcs.
* night_lights.json: a per-hex brightness derived from WorldPop population density (not satellite night lights).
"""
from __future__ import annotations

import csv
import heapq
import json
import math
import re
from collections import defaultdict, deque

from ..admin import NEW, OLD, fold
from ..fetch import RAW
from ..store import load_interim, load_web, write_web
from .common import World
from .lenses import wind_kt

OPEN_SEA_HEXES = 5  # a water hex at least this many hexes (about 43 km) from any land is open sea
LAND_STEP = 4  # a sea lane's cost of crossing a land hex (an inland port reaches the coast the short way)
MIN_BRANCH_LINKS = 4  # rail spurs shorter than this (about 35 km) after their junction are left out
ARC_BEND = 0.15  # air arc: the Bézier control point sits this share of the route length to the left of a → b


def _pt(x, y):
    return [round(x, 1), round(y, 1)]


def storm_tracks(W, width, height):
    """[storm] in timeline.json's storms order, each with its track points inside the map window."""
    storms = load_interim("_storms")["storms"]
    order = sorted(storms.items(), key=lambda kv: kv[1]["first"])  # the same (stable) sort as timeline.py
    want = set(storms)
    rows, jma = defaultdict(list), set()
    with open(RAW / "ibtracs" / "ibtracs.WP.list.v04r01.csv", newline="") as f:
        r = csv.reader(f)
        head = next(r)
        next(r)
        ix = {k: head.index(k) for k in ("SID", "LAT", "LON", "TOKYO_WIND", "WMO_WIND", "USA_WIND", "ISO_TIME")}
        for row in r:
            sid = row[ix["SID"]]
            if sid not in want:
                continue
            w = wind_kt(row, ix)
            if w[0] is not None:
                jma.add(sid)
            rows[sid].append((row[ix["ISO_TIME"]], float(row[ix["LON"]]), float(row[ix["LAT"]]), w))
    inside = lambda p: 0 <= p[0] <= width and 0 <= p[1] <= height
    out = []
    for sid, s in order:
        k = 0 if sid in jma else 1
        pts = []
        for t, lon, lat, w in sorted(rows[sid]):
            x, y = W.proj(lon, lat)
            pts.append([t.replace(" ", "T")[:16] + "Z", *_pt(x, y), w[k]])
        # inside points, plus the neighbour just outside on each side so the line reaches the map edge
        keep = [i for i, p in enumerate(pts) if inside(p[1:3])]
        sel = sorted({j for i in keep for j in (i - 1, i, i + 1) if 0 <= j < len(pts)})
        out.append({"id": sid, "name": s["name"].title() if s["name"] != "NOT_NAMED" else None,
                    "season": s["season"], "date": s["first"], "max_kt": s["max_kt"],
                    "agency": "JMA" if k == 0 else "JTWC", "points": [pts[j] for j in sel]})
    return out


def centroid(W, cells):
    xs = [W.center(i) for i in cells]
    cx, cy = sum(p[0] for p in xs) / len(xs), sum(p[1] for p in xs) / len(xs)
    anchor = min(cells, key=lambda i: math.dist(W.center(i), (cx, cy)))
    return _pt(cx, cy), anchor


def resolution_order():
    """[new province name] in the order Wikipedia tiếng Việt lists Resolution 202/2025/QH15's mergers."""
    text = json.loads((RAW / "wikipedia_history" / "vi_hanhchinh.json").read_text())["query"]["pages"][0]["extract"]
    text = text[text.index("202/2025/QH15"):]
    key = lambda s: re.sub(r"^(tinh|thanh pho|tp\.) ", "", fold(s).strip(" ."))
    by_key = {key(n): n for n in NEW}
    out = []
    for m in re.finditer(r"^Sáp nhập .+ vào (.+?)\.?$", text, re.M):
        n = by_key.get(key(m.group(1)))
        if n and n not in out:
            out.append(n)
    return out


def merger(W):
    remote = set(W.raw["islands"])  # Hoàng Sa, Trường Sa: left out so the centroids stay on the mainland
    iso_of = {name: iso for iso, name, _ in OLD.values()}
    by_county, by_state = defaultdict(list), defaultdict(list)
    for i, o in enumerate(W.owner):
        if o >= 0 and i not in remote:
            by_state[W.states[o]].append(i)
            if W.county[i] >= 0:
                by_county[W.counties[W.county[i]]].append(i)
    order = resolution_order()
    merged = [n for n, (_, olds) in NEW.items() if len(olds) > 1]
    rest = sorted((n for n in merged if n not in order), key=lambda n: NEW[n][0])
    out = []
    for n in [n for n in order if n in merged] + rest:
        abbr, olds = NEW[n]
        c, a = centroid(W, by_state[abbr])
        members = []
        for o in olds:
            mc, ma = centroid(W, by_county[iso_of[o]])
            members.append({"iso": iso_of[o], "name": o, "centroid": mc, "anchor": ma, "keeps_name": fold(o) == fold(n)})
        out.append({"abbr": abbr, "name": n, "centroid": c, "anchor": a, "members": members,
                    "order": len(out) + 1, "order_from": "resolution" if n in order else "code"})
    return out, len(order) == len(merged)


def rail_lines(W, infra, cities):
    """Ordered polylines through the tier-0 (main line) links: Hà Nội → the southern end first, then each other end."""
    g = defaultdict(set)
    for a, b, t in infra["rail"]:
        if t == 0:
            g[a].add(b)
            g[b].add(a)
    seat = lambda x, y: min(cities, key=lambda c: math.dist((c["x"], c["y"]), (x, y)))
    hn = next(c for c in cities if c["id"] == "HN")
    hub = min(g, key=lambda i: math.dist(W.center(i), (hn["x"], hn["y"])))
    prev = {hub: None}
    q = deque([hub])
    while q:
        i = q.popleft()
        for j in sorted(g[i]):
            if j not in prev:
                prev[j] = i
                q.append(j)

    def path(end):
        p = []
        while end is not None:
            p.append(end)
            end = prev[end]
        return p[::-1]

    ends = [i for i in g if len(g[i]) == 1 and i in prev]
    south = max(ends, key=lambda i: W.center(i)[1])
    rest = sorted((i for i in ends if i != south), key=lambda i: -len(path(i)))
    used, lines = set(), []
    for k, end in enumerate([south] + rest):
        p = path(end)
        start = max((n for n, c in enumerate(p) if c in used), default=0)
        p = p[start:]
        if k and len(p) - 1 < MIN_BRANCH_LINKS:
            continue
        used.update(p)
        pts = [_pt(*W.center(i)) for i in p]
        a, b = seat(*pts[0]), seat(*pts[-1])
        lines.append({"id": "north_south" if k == 0 else f"branch_{len(lines)}", "kind": "main" if k == 0 else "branch",
                      "from": a["name"], "to": b["name"], "from_city": a["id"], "to_city": b["id"],
                      "cells": p, "pts": pts, "km": round(len(p) * W.grid.radius * math.sqrt(3) * 0.2)})
    return lines


def sea_lanes(W, infra):
    """For each placed port: the cheapest hex path to the nearest open-sea hex (water hexes cost 1, land LAND_STEP)."""
    n = len(W.owner)
    water = lambda i: W.water[i] in (1, 2)
    dist = [0 if not water(i) else -1 for i in range(n)]  # hexes from the nearest land (any country)
    q = deque(i for i in range(n) if dist[i] == 0)
    while q:
        i = q.popleft()
        for j in W.grid.neighbours(i):
            if dist[j] < 0:
                dist[j] = dist[i] + 1
                q.append(j)
    lanes = []
    for p in infra["ports"]:
        best, prev, h = {p["cell"]: 0}, {p["cell"]: None}, [(0, p["cell"])]
        goal = None
        while h:
            c, i = heapq.heappop(h)
            if c > best[i]:
                continue
            if water(i) and dist[i] >= OPEN_SEA_HEXES:
                goal = i
                break
            for j in W.grid.neighbours(i):
                cj = c + (1 if water(j) else LAND_STEP)
                if cj < best.get(j, 1e18):
                    best[j], prev[j] = cj, i
                    heapq.heappush(h, (cj, j))
        if goal is None:
            continue
        cells = []
        while goal is not None:
            cells.append(goal)
            goal = prev[goal]
        cells = cells[::-1]
        pts = [_pt(p["x"], p["y"])] + [_pt(*W.center(i)) for i in cells[1:]]
        lanes.append({"port": p["id"], "name": p["name"], "seaport": p["seaport"], "class": p["class"],
                      "land_hexes": sum(1 for i in cells[1:] if not water(i)), "pts": pts})
    return lanes


def air_arcs(infra, trade, width, height):
    ap = {a["id"]: a for a in infra["airports"]}
    out = []
    for r in trade["routes"]:
        # the route's airport in each city; where a city has two of them (Kiên Giang), the busier one
        a, b = (max((ap[c] for c in r["airports"] if ap[c]["cbsa"] == city), key=lambda x: x["enplanements"] or 0)
                for city in (r["a"], r["b"]))
        (ax, ay), (bx, by) = (a["x"], a["y"]), (b["x"], b["y"])
        dx, dy = bx - ax, by - ay
        cx = min(max((ax + bx) / 2 + dy * ARC_BEND, 0), width)  # left of a → b (y is down)
        cy = min(max((ay + by) / 2 - dx * ARC_BEND, 0), height)
        out.append({"a": r["a"], "b": r["b"], "airport_a": a["id"], "airport_b": b["id"], "rank": r["rank"], "airlines": r["airlines"],
                    "dist_km": r["dist_km"], "p0": _pt(ax, ay), "c": _pt(cx, cy), "p1": _pt(bx, by)})
    return out


def night_lights(W, lenses, cities):
    dens = next(l for l in lenses["lenses"] if l["id"] == "density")
    lo = dens["domain"][0]
    hi = max(v for v in dens["values"] if v is not None)
    span = math.log(hi / lo)
    vals = [None if v is None else round(min(max(math.log(max(v, lo) / lo) / span, 0), 1), 2) for v in dens["values"]]
    seats = [{"id": c["id"], "name": c["name"], "x": c["x"], "y": c["y"], "population": c["population"],
              "capital": c["capital"]} for c in cities]
    return {"version": 1, "sources": ["worldpop", "nso_yearbook"],
            "rules": {"brightness": f"Not satellite night lights: derived from population. Each land hex's brightness is "
                                    f"the WorldPop 2025 population density lens on a log scale, from {lo:g} people / km² "
                                    f"(the lens's 2nd percentile; 0 below it) to {hi:g} (the densest hex; 1). Water and "
                                    f"foreign land are null.",
                      "seats": "The 63 former provincial seats (cities.json) with their former province's population."},
            "domain": [lo, hi], "values": vals, "seats": seats}


def build():
    W = World()
    world = load_web("world.json")
    width, height = world["width"], world["height"]
    infra, trade, cities = load_web("infrastructure.json"), load_web("trade.json"), load_web("cities.json")

    tracks = storm_tracks(W, width, height)
    write_web("storm_tracks.json", {
        "version": 1, "sources": ["ibtracs"], "cols": ["time", "x", "y", "kt"],
        "rules": {"storms": "Every storm in timeline.json's storms, in the same order (index i here is index i there); "
                            "id is the IBTrACS storm id (SID).",
                  "points": "Every IBTrACS v04r01 best-track row of the storm (about 3-hourly; agency fixes at other "
                            "hours kept) whose position falls inside the map window, plus the row just before and just "
                            "after each stretch inside, so the line reaches the map edge. Positions are projected to "
                            "map units; times are UTC. Points are not simplified.",
                  "wind": "kt from one agency per storm, the rule of the Typhoons lens: JMA's 10-minute wind "
                          "(TOKYO_WIND, else WMO_WIND) if JMA estimated the storm anywhere on its track, else JTWC's "
                          "1-minute wind (USA_WIND). null where that agency gives no wind at that row."},
        "storms": tracks})

    merged, by_res = merger(W)
    write_web("merger.json", {
        "version": 1, "sources": ["wikipedia_history", "hdx_cod_ab_vnm"], "date": "2025-07-01",
        "rules": {"members": "The 23 provinces of 1 July 2025 formed by merging former provinces (Resolution "
                             "202/2025/QH15), with their former provinces (keeps_name: the one whose name the new "
                             "province keeps).",
                  "centroid": "Mean position of the province's land hexes on the map (Hoàng Sa and Trường Sa left out); "
                              "anchor is the province's hex nearest that centroid (a centroid can fall outside a "
                              "curved province).",
                  "order": "The order in which Wikipedia tiếng Việt (Phân cấp hành chính Việt Nam) lists the mergers of "
                           "Resolution 202/2025/QH15" + ("." if by_res else "; provinces it does not list follow by code.")},
        "provinces": merged})

    lines, lanes, arcs = rail_lines(W, infra, cities), sea_lanes(W, infra), air_arcs(infra, trade, width, height)
    write_web("motion_routes.json", {
        "version": 1, "sources": ["osm_rail", "osm_ports", "qd804", "etopo", "openflights_routes", "ourairports"],
        "rules": {
            "rail": "Ordered polylines through the main-line (tier 0) rail links of infrastructure.json (OpenStreetMap, "
                    "2026), as hex centres. The North–South line runs from the main-line hex nearest Hà Nội to the "
                    "southern end; each other end of the main-line network gives a branch from where it leaves the "
                    "lines already drawn, longest first; branches shorter than "
                    f"{MIN_BRANCH_LINKS} hex links are left out. from/to name the nearest former provincial seat. "
                    "Stations are not included: the downloaded OpenStreetMap data has no station nodes. Train "
                    "frequency in an animation is illustrative, not a timetable.",
            "sea": "Illustrative, not real shipping lanes: from each placed port of infrastructure.json, the shortest "
                   f"hex path to the nearest open-sea hex (water at least {OPEN_SEA_HEXES} hexes, about "
                   f"{OPEN_SEA_HEXES * 8.66:.0f} km, from any land), crossing land only where the port sits inland "
                   f"(a land hex costs {LAND_STEP} sea hexes; land_hexes counts them). Ship movement is illustrative.",
            "air": "The 30 domestic air routes of trade.json (OpenFlights route database, June 2014; not current "
                   "schedules), drawn as quadratic Bézier arcs p0 → c → p1 between the airports of the two cities (where a city "
                   "has two of the route's airports, the one with more passengers), the control point "
                   f"{ARC_BEND:.0%} of the route length to the left. Plane frequency is illustrative.",
        },
        "rail": lines, "sea": lanes, "air": arcs})

    write_web("night_lights.json", night_lights(W, load_web("lenses.json"), cities))
    print(f"    {len(tracks)} storms ({sum(len(s['points']) for s in tracks)} points), {len(merged)} merged provinces "
          f"(resolution order: {by_res}), {len(lines)} rail lines, {len(lanes)} sea lanes, {len(arcs)} air arcs")
