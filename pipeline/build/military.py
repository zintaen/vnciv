"""military.json: Vietnam People's Army sites mapped in OpenStreetMap, as forts and restricted ground.

Vietnam publishes no list of installations, personnel or defence spending by province, so this file holds only what
OpenStreetMap mappers have drawn: military land with outlines (area) and, often, names. Branches are read from
tags and names. Personnel and spending fields are null (never invented).
"""
from __future__ import annotations

import json
import math
import re
from collections import Counter, defaultdict

from ..admin import fold
from ..fetch import RAW
from ..geo import UNIT
from ..store import write_web
from .common import World

MAJOR_KM2, BASE_KM2, UNNAMED_MIN_KM2, RANGE_MIN_KM2 = 10.0, 1.0, 1.0, 5.0
SKIP = {"trench", "bunker", "checkpoint", "office", "danger_area", "obstacle_course"}
COMPONENTS = [{"id": "army", "name": "Ground forces", "codes": []}, {"id": "navy", "name": "Navy", "codes": []},
              {"id": "air_force", "name": "Air Defence – Air Force", "codes": []},
              {"id": "other", "name": "Border guard, coast guard & other", "codes": []}]
RULES = {
    "installations": "Every OpenStreetMap feature in Vietnam tagged as military land (landuse=military or a military=* "
                     "tag), except trenches, bunkers, checkpoints and offices; unnamed ones only from "
                     f"{UNNAMED_MIN_KM2:g} km². Several features in one hex and branch are folded into the largest.",
    "tier": f"major: outline of {MAJOR_KM2:g} km² or more; base: {BASE_KM2:g} km² or more; site: smaller or no outline. "
            "By area only: no headcount is published.",
    "components": "Branch from the tags and names: naval bases, 'Hải quân', 'Quân cảng', 'Hải đoàn' → Navy; "
                  "airfields, 'Sân bay', 'Không quân', 'Phòng không', 'Tên lửa', 'Ra đa' → Air Defence – Air Force; "
                  "'Biên phòng', 'Cảnh sát biển' → Border guard & other; the rest → Ground forces.",
    "ranges": f"Outlines of {RANGE_MIN_KM2:g} km² or more (firing ranges, training areas, large bases) are drawn as "
              "restricted ground on the hexes whose centre they cover.",
    "encampment": f"A city gets an Encampment when its former province holds a major installation ({MAJOR_KM2:g} km²+), "
                  "a naval base or a military airfield: a fortress with two or more of them, else a garrison.",
    "names": "Names as mapped in OpenStreetMap (Vietnamese).",
}
RULE = RULES["encampment"]
CAVEATS = ("OpenStreetMap is a volunteer map: coverage is uneven, many military areas are unmapped or unnamed, and some "
           "names are generic ('Doanh trại'). Vietnam publishes no installation list, troop numbers or defence "
           "spending by province, so troop, spending and veteran figures are left empty: never estimated.")


def component(tags):
    n = fold(tags.get("name", ""))
    m = tags.get("military", "")
    if m == "naval_base" or re.search(r"hai quan|quan cang|hai doan|vung \d+ hai", n):
        return "navy"
    if m == "airfield" or re.search(r"san bay|khong quan|phong khong|ten lua|ra da", n):
        return "air_force"
    if re.search(r"bien phong|canh sat bien|kiem ngu", n):
        return "other"
    return "army"


def outline(el):
    if el["type"] == "way":
        return [el.get("geometry") or []]
    return [m.get("geometry") or [] for m in el.get("members", []) if m.get("role") == "outer"]


def area_km2(rings):
    tot = 0.0
    for g in rings:
        if len(g) < 3:
            continue
        lat0 = sum(p["lat"] for p in g) / len(g)
        k = 111.32 * math.cos(math.radians(lat0))
        pts = [(p["lon"] * k, p["lat"] * 110.57) for p in g]
        tot += abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(pts, pts[1:] + pts[:1]))) / 2
    return tot


def covered_cells(W, rings):
    """Hexes whose centre lies inside the outline."""
    from ..geo import Shape
    shape = Shape([[W.proj(p["lon"], p["lat"]) for p in g] for g in rings if len(g) >= 3])
    x0, y0, x1, y1 = shape.bbox
    out = []
    for i in range(W.grid.size):
        cx, cy = W.center(i)
        if x0 <= cx <= x1 and y0 <= cy <= y1 and W.owner[i] >= 0 and shape.contains(cx, cy):
            out.append(i)
    return out


def build():
    W = World()
    els = json.loads((RAW / "osm_military" / "military.json").read_text())["elements"]
    raw = []
    for el in els:
        tags = el.get("tags", {})
        if tags.get("military") in SKIP:
            continue
        rings = outline(el)
        pts = [p for g in rings for p in g]
        if not pts:
            continue
        a = area_km2(rings)
        name = tags.get("name") or tags.get("name:vi")
        if not name and a < UNNAMED_MIN_KM2:
            continue
        lon = sum(p["lon"] for p in pts) / len(pts)
        lat = sum(p["lat"] for p in pts) / len(pts)
        cell, k = W.place(lon, lat, rings=2)
        if cell is None or k < 0:
            continue
        x, y = W.proj(lon, lat)
        raw.append({"osm": f"{el['type'][0]}{el['id']}", "name": name or "Military area", "named": bool(name),
                    "kind": tags.get("military") or "landuse", "component": component(tags), "area": a,
                    "rings": rings, "x": x, "y": y, "cell": cell, "k": k})
    # fold several features in one hex and branch into the largest (named first)
    groups = defaultdict(list)
    for r in raw:
        groups[(r["cell"], r["component"])].append(r)
    inst = []
    for (cell, comp), rs in groups.items():
        rs.sort(key=lambda r: (not r["named"], -r["area"]))
        head = rs[0]
        area = sum(r["area"] for r in rs)
        tier = "major" if area >= MAJOR_KM2 else "base" if area >= BASE_KM2 else "site"
        iso = W.counties[head["k"]]
        item = {"id": f"osm-{head['osm']}", "name": head["name"], "component": comp, "joint": False, "status": "act",
                "tier": tier, "curated": False, "area_km2": round(area, 2) if area >= 0.01 else None,
                "kind": head["kind"], "x": round(head["x"], 1), "y": round(head["y"], 1), "cell": cell,
                "county": iso, "cbsa": iso, "state": W.states[W.old_new[head["k"]]],
                "state_filed": W.states[W.old_new[head["k"]]], "cells": None, "_rings": head["rings"]}
        if len(rs) > 1:
            item["parts"] = [r["name"] for r in rs[1:]][:8]
        inst.append(item)
    order = {"major": 0, "base": 1, "site": 2}
    inst.sort(key=lambda i: (order[i["tier"]], -(i["area_km2"] or 0)))
    ranges = []
    for it in inst:
        rings = it.pop("_rings")
        if (it["area_km2"] or 0) >= RANGE_MIN_KM2:
            cells = covered_cells(W, rings) or [it["cell"]]
            it["cells"] = cells
            hex_state = Counter(W.states[W.owner[c]] for c in cells).most_common(1)[0][0]
            ranges.append({"id": it["id"], "name": it["name"], "component": it["component"], "area_km2": it["area_km2"],
                           "cells": cells, "state": it["state"], "hex_state": hex_state, "installation": it["id"]})
    # encampments
    by_city = defaultdict(list)
    for it in inst:
        if it["tier"] == "major" or it["kind"] in ("naval_base", "airfield"):
            by_city[it["cbsa"]].append(it)
    cities = {}
    for cid, its in by_city.items():
        w = Counter(it["component"] for it in its)
        cities[cid] = {"tier": "fortress" if len(its) >= 2 else "garrison", "armed_forces": None, "share": None,
                       "naval": w["navy"] > max(w["army"], w["air_force"]),
                       "installations": [it["id"] for it in its][:8], "installation_count": len(its)}
    states = {s: {"personnel": None, "spending": None,
                  "installations": sum(1 for it in inst if it["state"] == s),
                  "area_km2": round(sum(it["area_km2"] or 0 for it in inst if it["state"] == s), 1)} for s in W.states}
    write_web("military.json", {
        "version": 1, "vintage": {"installations": "OpenStreetMap, as of the download date", "personnel": None,
                                  "spending": None, "acs": None},
        "sources": ["osm_military"], "rule": RULE, "rules": RULES, "flagships": [], "caveats": CAVEATS,
        "components": COMPONENTS, "installations": inst, "ranges": ranges, "states": states,
        "national": {"personnel": None, "spending": None, "veterans": None, "armed_forces_resident": None,
                     "installations": len(inst), "area_km2": round(sum(it["area_km2"] or 0 for it in inst), 1),
                     "by_component": dict(Counter(it["component"] for it in inst)),
                     "by_tier": dict(Counter(it["tier"] for it in inst))},
        "cities": cities})
    print(f"    {len(inst)} installations ({dict(Counter(i['tier'] for i in inst))}), {len(ranges)} ranges, "
          f"{len(cities)} encampment cities")
