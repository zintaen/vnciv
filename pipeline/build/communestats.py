"""Natural area, population and density of each commune-level unit (communestats stream), attached to communes.json
by ext_communes.build().

The figures are those of the official merger map (sapnhap.bando.com.vn): natural area and population 2025 of each
unit, as its data service returned them on 28 November 2026 (source `sapnhap_bando_official`), with the province
totals of the map's own table. Every value passes the checks in RULES first; a value that fails is null with the
reason's code."""
from __future__ import annotations

import json
import math
import re
from collections import defaultdict

from ..admin import fold
from ..fetch import RAW

SRC = RAW / "sapnhap_bando_official"
AS_OF = "2026-11-28"   # retrieved; the figures are the population of 2025 as the source labels them
COPY_OWN, COPY_NEXT = 0.05, 0.10   # a repeated record belongs to the one unit whose outline is within 5% (none other within 10%)
AREA_TOL = 1.5                     # stated vs outline area: at most 1.5× apart either way
WP_MIN = 0.3                       # stated population under 0.3× the WorldPop 2025 estimate within the outline: rejected
REEF_ZONES = {"Trường Sa", "Hoàng Sa"}
SUM_TOL = 0.20                     # per province: shown sum / province total within 20% of the shown units' WorldPop share

REASONS = {
    "copy": "The source gives this unit exactly the same area and population as another unit; the figures fit the "
            "other unit's outline, so none are shown here.",
    "no_area": "The source gives no area (0) for this unit.",
    "reef": "Archipelago special zone: its outline takes in reefs and lagoons, so the stated area cannot be checked "
            "against it.",
    "area_mismatch": "The stated area is more than 1.5 times off the unit's outline (for most Cà Mau units, the area "
                     "of one pre-merger commune: the source's Cà Mau communes add up to 76% of its province total), so "
                     "the record does not describe this unit; its population is withheld too.",
    "pending": "The source shows no population for this unit.",
    "province_total": "The stated population equals a whole province's population in the same source.",
    "implausible": f"The stated population is under {WP_MIN} times the WorldPop 2025 estimate for the unit's outline "
                   "(apparently a digit dropped); it is not corrected.",
}

RULES = {
    "stats": "Natural area (km²) and population 2025 (people) are the figures shown for each unit on the official "
             "merger map of administrative units (sapnhap.bando.com.vn, Vietnam Natural Resources, Environment and "
             "Cartography Publishing House, Ministry of Agriculture and Environment), retrieved 28 November 2026; the "
             "map labels its population 'Dân số 2025'. The 34 resolutions of 16 June 2025 themselves list no figures. "
             "Units that became wards in 2026 (Resolutions 237 and 388/NQ-UBTVQH16) kept their area and population.",
    "match": "Each record is matched to a unit by its official code; the source still has an old code for two "
             "units (listed in matched_by_name), matched by province and name instead.",
    "copy": f"When several units carry exactly the same area and population, the figures are kept only for the unit "
            f"whose outline area is within {COPY_OWN:.0%} of the stated area, if no other is within {COPY_NEXT:.0%}.",
    "area": f"area_km2 is the stated area, shown only if it is within {AREA_TOL}× of the outline area (field a, "
            "computed from the boundary); otherwise area and population are null with a reason.",
    "population": f"population is null when missing, equal to a province total, or under {WP_MIN}× the WorldPop 2025 "
                  "estimate summed over the unit's outline (WorldPop is used only for this check, never as a value; "
                  "the build lists any unit between 0.2× and 0.42×, and there is none). Values above the estimate "
                  "are kept: WorldPop misses most people on small islands.",
    "density": "density = population / area_km2 (people per km²), only when both are shown.",
    "sums": "Per province: ratio = the populations shown / the province's 'Dân số 2025' in the map's own province "
            "table; worldpop_share = the units shown's share of the province's WorldPop people. The build stops "
            f"unless ratio / worldpop_share is within {SUM_TOL:.0%} of 1. source_sum_ratio compares the sum over all "
            "units in the source (checked or not) with the province total.",
}


def _key(name):
    from .ext_communes import name_key
    return name_key(name)


def _prov(name, abbr_of_name):
    n = fold(name)
    for p in ("thu do ", "thanh pho ", "tinh "):
        n = n.replace(p, "")
    return abbr_of_name[n]


def worldpop_by_unit(units):
    """{code: WorldPop 2025 people within the unit's outline} (1 km pixels assigned by their centre)."""
    import numpy as np
    import rasterio
    from rasterio import features
    with rasterio.open(RAW / "worldpop" / "vnm_pop_2025_CN_1km_R2025A_UA_v1.tif") as src:
        a, nod, tr = src.read(1).astype("float64"), src.nodata, src.transform
    a[(a == nod) | (a < 0)] = 0
    lab = features.rasterize((({"type": "MultiPolygon", "coordinates": u["polys"]}, i + 1) for i, u in enumerate(units)),
                             out_shape=a.shape, transform=tr, fill=0, dtype="int32")
    wp = np.bincount(lab.ravel(), weights=a.ravel(), minlength=len(units) + 1)[1:]
    return {u["code"]: float(w) for u, w in zip(units, wp)}


def _num(s):
    """'3.359,84' → 3359.84 (the source's Vietnamese number format)."""
    return float(str(s).replace(".", "").replace(",", "."))


def read_source():
    """(rows: [{code, name, prov (province code), area, pop, res: (resolution, link)}], {province code: population
    2025 of the map's province table})."""
    rows = []
    for f in sorted(SRC.glob("co_bangbieu_*.txt")):
        prov, units = f.read_text(encoding="utf-8").split(".synt.", 1)
        pc = json.loads(prov)["ma"]
        for r in json.loads(units):
            assert re.fullmatch(r"\d{1,3}(\.\d{3})*", r["dansonguoi"]), r
            rows.append({"code": r["ma"], "name": r["ten"], "prov": pc, "area": _num(r["dientichkm2"]),
                         "pop": int(r["dansonguoi"].replace(".", "")), "res": (r["cancu"], r["link"])})
    import openpyxl
    ws = openpyxl.load_workbook(SRC / "bangbieu_vn_provinces.xlsx", read_only=True).active
    table = list(ws.iter_rows(values_only=True))
    head = next(i for i, r in enumerate(table) if r and "Dân số 2025 (người)" in r)
    ci, cp = table[head].index("Mã số ĐVHC (theo Quyết định 19/2025/QĐ-TTg)"), table[head].index("Dân số 2025 (người)")
    totals = {str(r[ci]): int(str(r[cp]).replace(".", "")) for r in table[head + 1:] if r and r[ci]}
    assert len(totals) == 34, len(totals)
    return rows, totals


def attach(communes, abbr_of_name, wp):
    """Adds area_km2, population, density, res (and null_reason when any is null) to each commune dict; returns the
    file-level 'stats' block (basis, rules, reasons, resolutions, counts, per-province sums)."""
    rows, totals = read_source()
    by_code = {c["id"]: c for c in communes}
    idx = {(c["p"], _key(c["n"])): c for c in communes}
    prov_abbr, recs, by_name = {}, {}, []
    for r in rows:  # province code → map abbr, from the units whose codes match
        if r["code"] in by_code:
            prov_abbr.setdefault(r["prov"], by_code[r["code"]]["p"])
    for r in rows:
        c = by_code.get(r["code"])
        if c is None:  # a code the source has not updated: match by province and name, and say so
            c = idx[(prov_abbr[r["prov"]], _key(re.sub(r"^(Xã|Phường|Đặc khu) ", "", r["name"])))]
            by_name.append({"source_code": r["code"], "id": c["id"], "name": r["name"]})
        assert c["id"] not in recs and c["p"] == prov_abbr[r["prov"]], r
        recs[c["id"]] = r
    assert len(recs) == len(communes) == len(rows), (len(recs), len(communes), len(rows))
    prov_total = {prov_abbr[k]: v for k, v in totals.items()}
    resolutions = sorted({r["res"] for r in rows})

    # repeated records: the same area and population on several units
    groups = defaultdict(list)
    for c in communes:
        r = recs[c["id"]]
        groups[(r["area"], r["pop"])].append(c)
    copies = set()
    for (area, _), cs in groups.items():
        if len(cs) < 2:
            continue
        off = sorted((abs(math.log(area / c["a"])) if area else 9, c["id"]) for c in cs)
        own = off[0][1] if off[0][0] < math.log1p(COPY_OWN) and off[1][0] > math.log1p(COPY_NEXT) else None
        copies |= {c["id"] for c in cs if c["id"] != own}

    totals_set = set(prov_total.values())
    near = []
    for c in communes:
        r = recs[c["id"]]
        area, pop, why = r["area"] or None, r["pop"] or None, None
        if c["id"] in copies:
            why = "copy"
        elif not area:
            why = "no_area"
        elif c["k"] == 2 and c["n"] in REEF_ZONES:
            why = "reef"
        elif abs(math.log(area / c["a"])) > math.log(AREA_TOL):
            why = "area_mismatch"
        if why:
            area = pop = None
        elif pop is None:
            why = "pending"
        elif pop in totals_set:
            why, pop = "province_total", None
        elif wp.get(c["id"], 0) > 0:
            ratio = pop / wp[c["id"]]
            if 0.2 < ratio < 0.42:
                near.append((c["n"], pop, round(ratio, 2)))
            if ratio < WP_MIN:
                why, pop = "implausible", None
        c["area_km2"] = area  # as the source states it
        c["population"] = pop
        c["density"] = round(pop / area, 1) if pop and area else None
        c["res"] = resolutions.index(r["res"])
        if why:
            c["null_reason"] = why
    print(f"    stats: matched by name (code not updated in the source): {by_name}; near the WorldPop cut: {near}")

    by_prov = {}
    for abbr in sorted(prov_total):
        cs = [c for c in communes if c["p"] == abbr]
        shown = [c["population"] for c in cs if c["population"] is not None]
        share = sum(wp[c["id"]] for c in cs if c["population"] is not None) / sum(wp[c["id"]] for c in cs)
        ratio = sum(shown) / prov_total[abbr]
        all_units = sum(recs[c["id"]]["pop"] for c in cs)
        by_prov[abbr] = {"units": len(cs), "with_area": sum(c["area_km2"] is not None for c in cs),
                         "with_population": len(shown), "population_sum": sum(shown),
                         "province_population_2025": prov_total[abbr], "ratio": round(ratio, 3),
                         "worldpop_share": round(share, 3), "ratio_vs_share": round(ratio / share, 3),
                         "source_sum_all_units": all_units, "source_sum_ratio": round(all_units / prov_total[abbr], 3)}
        assert abs(ratio / share - 1) <= SUM_TOL, (abbr, by_prov[abbr])
    n = len(communes)
    count = lambda f: sum(c[f] is not None for c in communes)
    reasons = defaultdict(int)
    for c in communes:
        if "null_reason" in c:
            reasons[c["null_reason"]] += 1
    return {
        "source": "sapnhap_bando_official", "check_sources": ["vn_wards_gis", "worldpop"], "as_of": AS_OF,
        "population_year": 2025,
        "basis": "Population 2025 and natural area as shown on the official merger map of administrative units "
                 "(sapnhap.bando.com.vn, Vietnam Natural Resources, Environment and Cartography Publishing House), "
                 "retrieved 28 November 2026; the province totals are the map's 'Dân số 2025 (người)' column.",
        "fields": {"area_km2": "natural area stated by the source, km² (null: see null_reason)",
                   "population": "population 2025 stated by the source, people (null: see null_reason)",
                   "density": "population / area_km2, people per km²",
                   "res": "index into resolutions: the resolution the source cites for the unit",
                   "null_reason": "code into reasons, present when any of the three is null",
                   "a": "outline area computed from the boundary, km² (a different basis; always present)"},
        "rules": RULES, "reasons": REASONS,
        "resolutions": [{"id": a, "link": b} for a, b in resolutions],
        "matched_by_name": by_name,
        "count": {"units": n, "area_km2": count("area_km2"), "population": count("population"),
                  "density": count("density"), "by_reason": dict(sorted(reasons.items()))},
        "by_province": by_prov,
    }
