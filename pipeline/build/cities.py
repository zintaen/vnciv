"""cities.json, states.json and nation.json.

Cities are the seats of the 63 former provinces; each city stands for its whole former province (the unit NSO
publishes statistics for), as a US metro stands for its counties. States are the 34 provinces of 2025, summed from
their former provinces. The nation is the sum of all 63.
"""
from __future__ import annotations

import json
import math
import zipfile
from collections import Counter

from ..admin import CAPITAL_ISO, fold, new_units, old_units
from ..fetch import RAW, ROOT
from ..store import load_interim, save_interim, write_web
from .common import World, site_cell

YEAR = 2025
GROWTH_YEARS = [2019, 2025]
VINTAGE = "NSO Statistical Yearbook 2025 (2025 preliminary; some indicators 2024 or earlier, see each record's years)"
JOBS_YEAR = "Sơ bộ 2025"  # PX-Web V02.42 column (national employment by industry, 2025 preliminary)
PARTIAL = {"tourism"}  # summed over the former provinces that publish it (Bắc Kạn's 2025 travel turnover is blank)
YIELDS = [
    {"key": "food", "icon": "y-food", "emoji": "🌾", "label": "Food", "color": "#7fbf3f", "unit": "tonnes", "stat": "paddy",
     "industries": ["agriculture"],
     "description": "Paddy rice harvested in 2025, in tonnes (NSO Statistical Yearbook 2025, preliminary). Rice is "
                    "the food yield because it is Vietnam's staple and the one crop counted in every province."},
    {"key": "production", "icon": "y-production", "emoji": "⚙️", "label": "Production", "color": "#d9823b", "unit": "workers",
     "stat": "employed", "industries": ["manufacturing", "construction", "mining"],
     "description": "Employed workers aged 15 and over in 2025, counted where they live (NSO Labour Force Survey via the "
                    "Statistical Yearbook 2025, preliminary). NSO does not publish workers by industry for each province."},
    {"key": "gold", "icon": "y-gold", "emoji": "💰", "label": "Gold", "color": "#f2c94c", "unit": "usd", "stat": "gdp",
     "industries": [],
     "description": "Gross regional domestic product (GRDP) in 2025 at current prices (NSO estimate), converted at the "
                    "World Bank official rate for 2024 (the 2025 rate is not yet published). NSO publishes GRDP per "
                    "person; the total is per person × average population 2025."},
    {"key": "science", "icon": "y-science", "emoji": "🔬", "label": "Science", "color": "#4fa3e0", "unit": "students",
     "stat": "students", "industries": ["professional", "information"],
     "description": "University students enrolled in the province's universities, 2023 (NSO Statistical Yearbook 2024; "
                    "the 2025 yearbook publishes no university figures by province). Provinces without a university count zero."},
    {"key": "culture", "icon": "y-culture", "emoji": "🎭", "label": "Culture", "color": "#b07ce0", "unit": "usd",
     "stat": "tourism", "industries": ["arts", "accommodation"],
     "description": "Turnover of travel agencies and tour operators in 2025 (preliminary), in US dollars (NSO). It is "
                    "the one tourism figure NSO publishes by province (Bắc Kạn's 2025 figure is blank); visitor counts "
                    "are not published by province."},
]
# national employment by industry (NSO V02.42, 2025 preliminary): PX-Web row index → key
INDUSTRY_ROWS = {"agriculture": [1], "mining": [2], "manufacturing": [3], "utilities": [4, 5], "construction": [6],
                 "retail": [7], "transportation": [8], "accommodation": [9], "information": [10], "finance": [11],
                 "real_estate": [12], "professional": [13], "admin": [14], "public_admin": [15], "education": [16],
                 "health": [17], "arts": [18], "other": [19, 20, 21]}
INDUSTRIES = {"agriculture": "Agriculture, forestry & fishing", "mining": "Mining & quarrying",
              "manufacturing": "Manufacturing", "utilities": "Electricity, gas, water & waste", "construction": "Construction",
              "retail": "Wholesale & retail trade, vehicle repair", "transportation": "Transport & storage",
              "accommodation": "Accommodation & food services", "information": "Information & communication",
              "finance": "Finance, banking & insurance", "real_estate": "Real estate",
              "professional": "Professional, scientific & technical", "admin": "Administrative & support services",
              "public_admin": "Party, state administration & defence", "education": "Education & training",
              "health": "Health & social work", "arts": "Arts, entertainment & recreation",
              "other": "Other services, households & international bodies"}


def seat_positions(W, olds):
    """{iso: (lon, lat)} of each former seat: GeoNames populated places matched by name inside the former province."""
    with zipfile.ZipFile(RAW / "geonames" / "VN.zip") as z:
        lines = z.read("VN.txt").decode("utf-8").splitlines()
    places = []
    for ln in lines:
        f = ln.split("\t")
        if f[6] != "P":
            continue
        names = {fold(f[1].replace("Ð", "Đ")), fold(f[2])} | {fold(a.replace("Ð", "Đ")) for a in f[3].split(",") if a}
        for pre in ("thanh pho ", "tp. ", "thi xa "):
            names |= {n[len(pre):] for n in names if n.startswith(pre)}
        places.append((names, float(f[5]), float(f[4]), int(f[14] or 0), f[7]))
    out = {}
    for k, u in enumerate(olds):
        want = {fold(u["seat"]), fold(u["seat"]).replace("tp. ", ""), fold(u["seat"]).replace("–", "-")}
        if u["iso"] == "SG":
            want |= {"ho chi minh city", "thanh pho ho chi minh"}
        if u["iso"] == "HN":
            want |= {"hanoi"}
        best = None
        for names, lon, lat, pop, code in places:
            if not (names & want):
                continue
            cell = W.grid.cell_at(*W.proj(lon, lat))
            if cell < 0 or W.county[cell] != k:
                # allow a seat in a neighbouring hex of its province (coastal seats)
                c2 = site_cell(W, *W.proj(lon, lat), rings=1, county=k)
                if c2 is None:
                    continue
            score = (code in ("PPLC", "PPLA"), code.startswith("PPLA"), pop)
            if best is None or score > best[0]:
                best = (score, lon, lat)
        assert best, f"no GeoNames seat for {u['seat']} ({u['name']})"
        out[u["iso"]] = (best[1], best[2])
    return out


def rank(items, key, val):
    """{id: rank} 1 = highest; equal values share a rank (1, 2, 2, 4); None where val is None."""
    ok = [c for c in items if val(c) is not None]
    vals = sorted((val(c) for c in ok), reverse=True)
    first = {}
    for k, v in enumerate(vals):
        first.setdefault(v, k + 1)
    return {c[key]: first[val(c)] for c in ok}


def econ(rows, pop_years):
    """The shared economic shape for a sum of former provinces."""
    s = lambda k: (sum(r[k] or 0 for r in rows) if k in PARTIAL and any(r[k] is not None for r in rows) else
                   sum(r[k] for r in rows) if all(r[k] is not None for r in rows) else None)
    pop = s("population")
    w_mean = lambda k, w="population": (sum(r[k] * r[w] for r in rows) / sum(r[w] for r in rows)
                                        if all(r[k] is not None for r in rows) else None)
    y0, y1 = (str(y) for y in pop_years)
    series = [r["pop_series"] for r in rows]
    if all(sr and sr.get(y0) and sr.get(y1) for sr in series):
        growth = round(sum(sr[y1] for sr in series) / sum(sr[y0] for sr in series) - 1, 4)
        years = sorted(set.intersection(*(set(sr) for sr in series)))
        pop_series = {y: sum(sr[y] for sr in series) for y in years}
    else:
        growth, pop_series = None, None
    lf = s("labour_force")
    out = {
        "population": pop, "employed": s("employed"),
        "yields": {y["key"]: (round(v) if (v := s(y["stat"])) is not None else None) for y in YIELDS},
        "jobs": None,
        "median_income": round(w_mean("income")) if w_mean("income") else None,
        "median_rent": None, "home_value": None, "rent_burden": None,
        "unemployment": round(sum(r["unemployment"] * r["labour_force"] for r in rows) / lf, 4) if lf else None,
        "gdp": round(s("gdp")), "gdp_year": YEAR, "gdp_by_industry": None, "gdp_undisclosed": None, "gdp_estimated": None,
        "growth": growth, "growth_years": GROWTH_YEARS if growth is not None else None, "pop_series": pop_series,
        # Vietnam-specific panel figures (the year of each is in "years")
        "area_km2": round(s("area_km2"), 1), "density": round(pop / s("area_km2"), 1),
        "urban": round(s("urban_population") / pop, 4),
        "labour_force": lf, "trained": rnd(w_mean("trained", "labour_force"), 4),
        "literacy": rnd(w_mean("literacy"), 4), "hdi": rnd(w_mean("hdi"), 3), "poverty": rnd(w_mean("poverty"), 4),
        "gini": rnd(w_mean("gini"), 3), "income_worker": rnd(w_mean("income_worker", "employed"), 0),
        "productivity": round(s("gdp") / s("employed")) if s("employed") else None,
        "fdi": s("fdi"), "fdi_projects": s("fdi_projects"), "retail": rnd(s("retail"), 0), "paddy": s("paddy"),
        "tourism": rnd(s("tourism"), 0), "students": s("students"), "lecturers": s("lecturers"),
        "pci": rnd(w_mean("pci"), 2) if len(rows) == 1 else None, "pci_2024": rows[0]["pci_2024"] if len(rows) == 1 else None,
        "grdp_growth": rnd(w_mean("grdp_growth", "gdp"), 4) if len(rows) == 1 else None,
        "internet": rnd(w_mean("internet"), 4), "computer": rnd(w_mean("computer"), 4),
        "clean_water": rnd(w_mean("clean_water"), 4), "housing": rnd(w_mean("housing"), 4),
        "it_skills": rnd(w_mean("it_skills"), 4), "enterprises_pk": rnd(w_mean("enterprises_pk"), 2),
    }
    return out


def rnd(v, d):
    return None if v is None else (round(v) if d == 0 else round(v, d))


def national_jobs():
    d = json.loads((ROOT / "data" / "stats" / "px" / "V02.42.json").read_text())
    years = d["meta"]["variables"][2]["values"]
    yi = years[d["meta"]["variables"][2]["valueTexts"].index(JOBS_YEAR)]
    vals = {}
    for row in d["data"]["data"]:
        ind, part, yr = row["key"]
        if part == "0" and yr == yi:
            vals[int(ind)] = float(row["values"][0]) * 1000
    return {k: round(sum(vals[i] for i in rows)) for k, rows in INDUSTRY_ROWS.items()}, round(vals[0])


def build():
    W = World()
    st = load_interim("_stats")
    rows = st["rows"]
    olds, news = old_units(), new_units()
    seats = seat_positions(W, olds)
    cells_of = W.county_cells()

    cities, used = [], set()
    for k, u in enumerate(olds):
        r = rows[u["iso"]]
        lon, lat = seats[u["iso"]]
        x, y = W.proj(lon, lat)
        cell = site_cell(W, x, y, rings=2, county=k)
        if cell in used:  # unique banner cell: the nearest free cell of the province
            free = [c for c in cells_of[k] if c not in used]
            cell = min(free, key=lambda c: math.dist(W.center(c), (x, y)))
        used.add(cell)
        new_abbr = next(n["abbr"] for n in news if n["name"] == u["new"])
        c = {"id": u["iso"], "name": u["seat"],
             "full": u["name"] if u["seat"] == u["name"] else f"{u['seat']} · {u['name']} (former province)",
             "province_old": u["name"], "province_new": u["new"],
             "states": [new_abbr], "metro": True, "capital": u["iso"] == CAPITAL_ISO,
             "x": round(x, 1), "y": round(y, 1), "cell": cell, **econ([r], GROWTH_YEARS),
             "counties": [u["iso"]], "footprint": sorted(set(cells_of.get(k, [])) | {cell}),
             "years": st["years"]}
        cities.append(c)
    cities.sort(key=lambda c: -c["population"])
    keys = {"population": lambda c: c["population"], "gdp": lambda c: c["gdp"],
            "gdp_per_capita": lambda c: c["gdp"] / c["population"], "growth": lambda c: c["growth"]}
    keys.update({y["key"]: (lambda c, k=y["key"]: c["yields"][k]) for y in YIELDS})
    ranks = {k: rank(cities, "id", f) for k, f in keys.items()}
    for c in cities:
        c["ranks"] = {k: ranks[k].get(c["id"]) for k in keys}
        c["peers"] = [p["id"] for p in sorted((p for p in cities if p is not c),
                                              key=lambda p: abs(math.log(p["population"] / c["population"])))[:5]]
    write_web("cities.json", cities)

    # --- states: the 34 provinces of 2025 ---
    res = load_interim("_resources") if (ROOT / "data" / "interim" / "_resources.json").exists() else None
    states = []
    remote = set(W.raw["islands"])  # far-offshore island hexes: no land-cover data, left out of land shares
    for k, n in enumerate(news):
        members = [rows[u["iso"]] for u in olds if u["new"] == n["name"]]
        cells = [i for i in range(len(W.owner)) if W.owner[i] == k and W.raw["cover"][i] > 0 and i not in remote]
        land = {key: round(sum(W.pct[key][i] for i in cells) / len(cells) / 100, 3) for key in W.pct} if cells else None
        energy = None
        if res:
            mw_types = [t["id"] for t in res["types"] if t["unit"] == "MW"]
            mine = [it for it in res["items"] if it["state"] == n["abbr"]]
            energy = {"unit": "MW", "total": sum(it["value"] or 0 for it in mine),
                      "by_type": {t: sum(it["value"] or 0 for it in mine if it["type"] == t) for t in mw_types},
                      "sites": {t: sum(1 for it in mine if it["type"] == t) for t in mw_types},
                      "note": "Only the mapped power plants (each type's threshold applies, data as of 2021), not the "
                              "province's total generating capacity."}
        states.append({"fips": f"{k + 1:02d}", "abbr": n["abbr"], "name": n["name"],
                       "former": [u["name"] for u in olds if u["new"] == n["name"]],
                       **econ(members, GROWTH_YEARS), "land": land, "energy": energy, "label": None})
        # indicators NSO publishes only for the 34 provinces, and its official 34-province ratios (see stats.py)
        states[-1].update({("median_income" if key == "income" else key): v for key, v in st["states"][n["abbr"]].items()
                           if key != "name"})
        states[-1]["density"] = round(states[-1]["population"] / states[-1]["area_km2"], 1)
        states[-1]["years"] = {k: v for k, v in st["state_years"].items() if v}
    yr = {y["key"]: rank(states, "abbr", lambda s, k=y["key"]: s["yields"][k]) for y in YIELDS}
    yr.update({k: rank(states, "abbr", f) for k, f in keys.items() if k in ("population", "gdp", "growth")})
    for s in states:
        s["ranks"] = {k: yr[k].get(s["abbr"]) for k in yr}
    write_web("states.json", states)

    jobs, employed_total = national_jobs()
    nation = econ(list(rows.values()), GROWTH_YEARS)
    nation["area_km2"] = round(sum(s["area_km2"] for s in states), 1)  # the 34 provinces' official 2024 area
    nation["density"] = round(nation["population"] / nation["area_km2"], 1)
    # the 63-province basis of the city figures that are newer for the provinces/nation (compare cities with this)
    nation["cities_basis"] = {"year": "2024", "hdi": None, "fdi": nation["fdi"], "fdi_projects": nation["fdi_projects"]}
    # NSO's own national figures, not averages of provinces (inequality between them counts)
    rate = st["fx"]
    conv = {"income": ("median_income", lambda v: round(v * 1000 * 12 / rate)),
            "income_worker": ("income_worker", lambda v: round(v * 1000 * 12 / rate)),
            "fdi": ("fdi", lambda v: v * 1e6), "fdi_projects": ("fdi_projects", int),
            "grdp_growth": ("grdp_growth", lambda v: round(v / 100 - 1, 4)),
            "gdp": ("gdp", lambda v: round(v * 1e9 / rate))}  # NSO's national GDP (bn VND); the province sum is kept
    nation["gdp_provinces"] = nation["gdp"]  # sum of the 63 former provinces' GRDP (per person × population)
    pcts = {"poverty", "informal", "trained", "unemployment", "internet", "it_skills", "clean_water", "housing", "forest_cover"}
    nat_years = {}
    for key, v in st["national"].items():
        if key == "_years":
            continue
        if key == "hdi_2024":
            nation["cities_basis"]["hdi"] = v
            continue
        out, f = conv.get(key, (key, (lambda x: round(x / 100, 4)) if key in pcts else (lambda x: x)))
        nation[out] = f(v)
        nat_years[out] = nat_years[key] = st["national"]["_years"][key]  # "income" too: the UI reads that key
    nation["doctors_pk"] = round(nation["doctors"] / nation["population"] * 1e4, 2)
    nation["years"] = {**{k: v for k, v in st["state_years"].items() if v}, **nat_years,
                       "growth_9m2026": None, "industry_jobs_2026": None}
    nation["jobs"] = jobs
    nation["employed_lfs"] = employed_total
    write_web("nation.json", {
        "vintage": VINTAGE, "year": YEAR, "gdp_vintage": "Vietnam: NSO's national GDP 2025 at current prices (estimate); provinces and cities: NSO GRDP per "
                       "person (2025 estimate) × average population 2025 (preliminary), which add up to "
                       f"{1 - nation['gdp_provinces'] / nation['gdp']:.1%} less",
        "currency": {"code": "USD", "fx": round(st["fx"], 2), "fx_year": st["fx_year"],
                     "note": f"VND converted at the World Bank official rate for {st['fx_year']}: {st['fx']:,.0f} VND per USD"
                             + ("." if st["fx_year"] == str(YEAR) else
                                f" (the World Bank has not yet published the {YEAR} rate, so {YEAR} figures use {st['fx_year']}'s).")},
        "nation": nation, "yields": [{k: v for k, v in y.items() if k != "stat"} for y in YIELDS],
        "industries": INDUSTRIES, "gdp_industries": {}, "jobs_source": "NSO PX-Web V02.42 (employed by industry, 2025 preliminary)",
        "years_note": "Each record's 'years' gives the year of its fields; cities (63 former provinces) carry 2024 HDI and "
                      "FDI, provinces and the nation 2025 (NSO publishes those only for the 34 provinces since 2025).",
    })
    print(f"    {len(cities)} cities, {len(states)} provinces; Vietnam {nation['population']:,} people, "
          f"GDP ${nation['gdp'] / 1e9:,.0f} bn, growth {nation['growth']:+.2%}")
    save_interim("_cities", {"ids": [c["id"] for c in cities]})
