"""disasters.json: typhoon history from IBTrACS (the hazards file; Vietnam has no open disaster-declaration register)."""
from __future__ import annotations

from collections import Counter, defaultdict

from ..store import load_interim, write_web
from .common import World

STRONG_KT = 64  # typhoon strength (Beaufort 12, cấp 12+)


def build():
    W = World()
    s = load_interim("_storms")
    storms = s["storms"]
    remote = set(W.raw["islands"])  # far-offshore islands: not counted for provinces or the nation
    storms = {k: {**v, "cells": [c for c in v["cells"] if c not in remote]} for k, v in storms.items()}
    storms = {k: v for k, v in storms.items() if v["cells"]}
    since, radius = s["since"], s["radius_km"]
    by_county = defaultdict(lambda: {"total": 0, "strong": 0, "last": None})
    by_state = defaultdict(lambda: {"total": 0, "strong": 0})
    years = Counter()
    for sid, st in storms.items():
        strong = st["max_kt"] >= STRONG_KT
        years[st["season"]] += 1
        for k in {W.county[c] for c in st["cells"] if W.county[c] >= 0}:
            b = by_county[W.counties[k]]
            b["total"] += 1
            b["strong"] += strong
            b["last"] = max(b["last"] or "", st["first"])
        for a in {W.states[W.owner[c]] for c in st["cells"]}:
            by_state[a]["total"] += 1
            by_state[a]["strong"] += strong
    rows = [[g, by_county[g]["total"], by_county[g]["strong"], by_county[g]["last"]] for g in W.counties]
    ranked = sorted(storms.values(), key=lambda st: (-st["max_kt"], -len(st["cells"])))
    recent = sorted(storms.values(), key=lambda st: st["first"], reverse=True)[:12]
    brief = lambda st: {"name": st["name"].title() if st["name"] != "NOT_NAMED" else "Unnamed", "season": st["season"],
                        "date": st["first"], "max_kt": st["max_kt"], "strong": st["max_kt"] >= STRONG_KT,
                        "hexes": len(st["cells"]),
                        "provinces": sorted({W.states[W.owner[c]] for c in st["cells"]})}
    first, last = min(years), max(years)
    write_web("disasters.json", {
        "version": 2, "sources": ["ibtracs"], "vintage": f"IBTrACS v04r01 Western Pacific, {first}–{last}",
        "typhoons": {
            "since": since, "radius_km": radius, "min_kt": s["min_kt"], "strong_kt": STRONG_KT,
            "rule": f"Tropical cyclones of at least tropical-storm strength ({s['min_kt']} kt) whose best track passed "
                    f"within {radius} km of a mainland or coastal-island hex of Vietnam (the Hoàng Sa and Trường Sa "
                    f"hexes are left out of these counts), {since}–{last}. 'Strong' = typhoon strength "
                    f"({STRONG_KT} kt or more, Beaufort 12+) at some point near Vietnam's coast or inland.",
            "counties": {"columns": ["geoid", "total", "strong", "last_date"], "rows": rows},
            "states": {a: by_state[a] for a in W.states if a in by_state},
            "national": {"storms": len(storms), "strong": sum(st["max_kt"] >= STRONG_KT for st in storms.values()),
                         "by_year": [{"year": y, "storms": years.get(y, 0)} for y in range(since, last + 1)],
                         "strongest": [brief(st) for st in ranked[:10]], "recent": [brief(st) for st in recent]},
        }})
