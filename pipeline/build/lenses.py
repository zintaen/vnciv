"""lenses.json (per-hex values) and counties.json (the 63 former provinces as the table level).

Hex-level lenses come from gridded data (WorldPop, WorldCover, IBTrACS); province lenses spread each former
province's NSO figure over its hexes, weighting the hex's 7 sample points (centre + 6) by province.
"""
from __future__ import annotations

import csv
import json
import math
from collections import defaultdict

import numpy as np

from ..admin import old_units
from ..fetch import RAW, ROOT
from ..geo import HEX_KM, UNIT
from ..store import load_interim, save_interim, write_web
from .common import World

RAMPS = json.loads((ROOT / "pipeline" / "ramps.json").read_text())  # the usaciv lens ramps
HEX_AREA_KM2 = 3 * math.sqrt(3) / 2 * HEX_KM ** 2
STORM_RADIUS_KM = 100
STORM_SINCE = 1980
STORM_MIN_KT = 34
NSO = "nso_yearbook"
GROUPS = [{"id": "people", "name": "People"}, {"id": "prosperity", "name": "Prosperity"},
          {"id": "knowledge", "name": "Knowledge"}, {"id": "life", "name": "Work & life"},
          {"id": "hazards", "name": "Hazards"}, {"id": "land", "name": "Land"}]

# id, group, name, icon, emoji, unit, format, scale, higher_is, source, ramp, stat key (province lenses), description, note
PROVINCE_LENSES = [
    ("urban", "people", "Urban share", "l-developed", "🏙️", "share of residents living in urban areas", "pct", "linear", "neutral", NSO, "developed", "urban",
     "Urban population ÷ average population, 2024 (NSO). Urban follows Vietnam's administrative definition (wards and towns).", None),
    ("growth", "people", "Growth", "l-people", "📈", "population change 2019–2024", "pct", "linear", "neutral", NSO, "age", "growth",
     "Average population 2024 ÷ 2019 − 1, by former province (NSO PX-Web V02.03-07).", None),
    ("income", "prosperity", "Income", "l-income", "💵", "income per person per year, $", "usd", "linear", "good", NSO, "income", "income",
     "Average monthly income per person (Vietnam Household Living Standards Survey, 2024) × 12, converted at the World Bank 2024 rate.",
     "Income per person, not per household."),
    ("gdp_pc", "prosperity", "GRDP per person", "l-home", "💰", "GRDP per person, $", "usd", "log", "good", NSO, "home", "gdp_pc",
     "Gross regional domestic product per person, 2024, current prices (NSO), converted at the World Bank 2024 rate.",
     "Counted where output is made: oil, mining and industrial provinces score high even where incomes are modest."),
    ("poverty", "prosperity", "Poverty", "l-poverty", "🥣", "households in multidimensional poverty", "pct", "linear", "bad", NSO, "poverty", "poverty",
     "Share of households poor by Vietnam's multidimensional poverty standard for 2022–2025 (income plus access to "
     "jobs, health, education, housing, water and sanitation, information), 2024 (NSO).", None),
    ("gini", "prosperity", "Inequality", "l-amenities", "⚖️", "Gini index of income", "float", "linear", "bad", NSO, "commute", "gini",
     "Gini coefficient of per-person income, 2024 (NSO, VHLSS). 0 = everyone earns the same.", None),
    ("fdi", "prosperity", "Foreign investment", "l-income", "🏗️", "FDI registered in 2024 per resident, $", "usd", "log", "neutral", NSO, "broadband", "fdi_pc",
     "Newly registered plus added foreign direct investment capital in 2024 ÷ population (NSO). Provinces with no "
     "registration in 2024 are 0.", "Registered capital, not money disbursed; one large project can dominate a province's year."),
    ("trained", "knowledge", "Trained workers", "l-degrees", "🎓", "workers 15+ with vocational or higher training", "pct", "linear", "good", NSO, "bachelors", "trained",
     "Share of the labour force aged 15+ holding a vocational certificate, college or university degree, 2024 (NSO Labour Force Survey).", None),
    ("literacy", "knowledge", "Literacy", "l-degrees", "📖", "people 15+ who can read and write", "pct", "linear", "good", NSO, "broadband", "literacy",
     "Literacy rate of people aged 15 and over, 2024 (NSO).", None),
    ("hdi", "knowledge", "Human development", "l-amenities", "🌱", "HDI (0–1)", "float", "linear", "good", NSO, "bachelors", "hdi",
     "Human Development Index by province, 2024 (NSO): health, education and income combined, 0–1.", None),
    ("unemployment", "life", "Unemployment", "l-poverty", "📉", "unemployed share of the working-age labour force", "pct", "linear", "bad", NSO, "uninsured", "unemployment",
     "Unemployment rate of the labour force in working age, 2024 (NSO Labour Force Survey).", "Low everywhere: informal work absorbs most people who lose a job."),
    ("productivity", "life", "Productivity", "l-income", "⚙️", "GRDP per worker, $", "usd", "log", "good", NSO, "income", "productivity",
     "Labour productivity: GRDP ÷ employed workers, 2024 (NSO), converted at the World Bank 2024 rate.", None),
    ("pci", "life", "Business climate", "l-amenities", "🤝", "PCI score (0–100)", "float", "linear", "good", "pci", "homeownership", "pci",
     "Provincial Competitiveness Index 2022 (VCCI/USAID), the last year scored for all 63 provinces: a survey of "
     "private firms on transparency, costs, land access and governance.", None),
]


def ramp(name):
    return RAMPS[name]


def pctl(vals, lo=2, hi=98):
    v = sorted(x for x in vals if x is not None)
    if not v:
        return [0, 1]
    a, b = v[int(len(v) * lo / 100)], v[min(len(v) - 1, int(len(v) * hi / 100))]
    return [a, b] if b > a else [v[0], v[-1] or 1]


def round_for(fmt, x):
    if x is None:
        return None
    return round(x, 4) if fmt in ("pct",) else round(x, 3) if fmt == "float" else round(x)


def worldpop(W):
    """People per hex from WorldPop 2025 (1 km pixels)."""
    import rasterio
    pop = np.zeros(len(W.owner))
    with rasterio.open(RAW / "worldpop" / "vnm_pop_2025_CN_1km_R2025A_UA_v1.tif") as src:
        a = src.read(1)
        nd = src.nodata
        rows, cols = np.nonzero((a > 0) & (a != nd) if nd is not None else a > 0)
        xs, ys = rasterio.transform.xy(src.transform, rows, cols)
        for lon, lat, v in zip(xs, ys, a[rows, cols]):
            c = W.grid.cell_at(*W.proj(lon, lat))
            if c >= 0:
                pop[c] += float(v)
    return pop


def typhoons(W):
    """Distinct tropical cyclones (≥ 34 kt) passing within STORM_RADIUS_KM of each land hex centre since STORM_SINCE."""
    land = [i for i in range(len(W.owner)) if W.owner[i] >= 0]
    centers = np.array([W.center(i) for i in land])
    remote_set = set(W.raw["islands"])
    rem = np.array([i in remote_set for i in land])  # Hoàng Sa, Trường Sa: hexes counted, but not for wind or date
    tracks = defaultdict(list)
    names = {}
    with open(RAW / "ibtracs" / "ibtracs.WP.list.v04r01.csv", newline="") as f:
        r = csv.reader(f)
        head = next(r)
        next(r)
        ix = {k: head.index(k) for k in ("SID", "SEASON", "NAME", "LAT", "LON", "WMO_WIND", "USA_WIND", "ISO_TIME")}
        for row in r:
            if int(row[ix["SEASON"]]) < STORM_SINCE:
                continue
            lat, lon = float(row[ix["LAT"]]), float(row[ix["LON"]])
            if not (3 < lat < 27 and 98 < lon < 122):
                continue
            wind = row[ix["WMO_WIND"]].strip() or row[ix["USA_WIND"]].strip()
            kt = float(wind) if wind else 0
            tracks[row[ix["SID"]]].append((lon, lat, kt, row[ix["ISO_TIME"]]))
            names[row[ix["SID"]]] = (row[ix["NAME"]], int(row[ix["SEASON"]]))
    count = np.zeros(len(land), int)
    rad = STORM_RADIUS_KM * UNIT
    per_storm = {}
    for sid, pts in tracks.items():
        hit = np.zeros(len(land), bool)
        maxkt, first = 0, None
        for (lo0, la0, k0, t0), (lo1, la1, k1, _) in zip(pts, pts[1:]):
            if max(k0, k1) < STORM_MIN_KT:
                continue
            p0, p1 = np.array(W.proj(lo0, la0)), np.array(W.proj(lo1, la1))
            n = max(1, int(np.linalg.norm(p1 - p0) / (rad / 3)))
            for t in np.linspace(0, 1, n + 1):
                q = p0 + (p1 - p0) * t
                d2 = ((centers - q) ** 2).sum(1)
                near = d2 <= rad * rad
                if near.any():
                    hit |= near
                    if (near & ~rem).any():
                        maxkt = max(maxkt, k0, k1)
                        first = first or t0
        if hit.any():
            count += hit
            per_storm[sid] = {"name": names[sid][0], "season": names[sid][1], "max_kt": maxkt,
                              "first": (first or pts[0][3])[:10], "cells": [land[k] for k in np.nonzero(hit)[0]]}
    vals = [None] * len(W.owner)
    for k, i in enumerate(land):
        vals[i] = int(count[k])
    return vals, per_storm


def build():
    W = World()
    st = load_interim("_stats")["rows"]
    olds = old_units()
    iso = [u["iso"] for u in olds]
    ncell = len(W.owner)
    land = [i for i in range(ncell) if W.owner[i] >= 0]
    for r in st.values():
        s = r["pop_series"] or {}
        r["growth"] = s["2024"] / s["2019"] - 1 if s.get("2024") and s.get("2019") else None
        r["fdi_pc"] = r["fdi"] / r["population"] if r["population"] else None
    lenses = []

    # --- hex-level: population density (WorldPop) ---
    pop = worldpop(W)
    dens = [round(pop[i] / HEX_AREA_KM2, 1) if W.owner[i] >= 0 else None for i in range(ncell)]
    lenses.append({"id": "density", "group": "people", "name": "Population", "icon": "l-people", "emoji": "👥",
                   "unit": "people / km²", "format": "int", "scale": "log", "domain": pctl([d for d in dens if d]),
                   "ramp": ramp("density"), "higher_is": "neutral", "source": "worldpop",
                   "description": "WorldPop 2025 estimated residents in the hex (1 km pixels, constrained to built-up "
                                  f"areas, adjusted to UN totals) ÷ the hex's {HEX_AREA_KM2:.0f} km².", "values": dens})

    # --- province lenses ---
    for (lid, group, name, icon, emoji, unit, fmt, scale, hi, src, rmp, key, desc, note) in PROVINCE_LENSES:
        vals = [None] * ncell
        for i in land:
            smp = [k for k in W.samples[i] if k >= 0]
            xs = [st[iso[k]][key] for k in smp if st[iso[k]][key] is not None]
            vals[i] = round_for(fmt, sum(xs) / len(xs)) if xs else None
        lens = {"id": lid, "group": group, "name": name, "icon": icon, "emoji": emoji, "unit": unit, "format": fmt,
                "scale": scale, "domain": pctl([v for v in vals if v is not None and (scale != "log" or v > 0)]),
                "ramp": ramp(rmp), "higher_is": hi, "source": src, "description": desc, "values": vals}
        if note:
            lens["note"] = note
        lenses.append(lens)

    # --- hazards: typhoons ---
    storm_vals, storms = typhoons(W)
    remote = set(W.raw["islands"])  # Hoàng Sa, Trường Sa: shown on their hexes, left out of province figures
    lenses.append({"id": "disasters", "group": "hazards", "name": "Typhoons", "icon": "l-disasters", "emoji": "🌀",
                   "unit": f"storms since {STORM_SINCE}", "format": "int", "scale": "linear",
                   "domain": [0, max(v for i, v in enumerate(storm_vals) if v is not None and i not in remote)],
                   "ramp": ramp("disasters"),
                   "higher_is": "bad", "source": "ibtracs",
                   "description": f"Distinct tropical cyclones of at least tropical-storm strength ({STORM_MIN_KT} kt, "
                                  f"WMO or JTWC winds) whose IBTrACS best track passed within {STORM_RADIUS_KM} km of the "
                                  f"hex centre, {STORM_SINCE} to today.",
                   "note": "Counts storm passages, not damage: floods and landslides from storms that pass further away are not counted.",
                   "values": storm_vals})

    # --- land lenses (WorldCover shares) ---
    for lid, name, icon, emoji, keys, rmp in (("forest", "Forest", "l-forest", "🌳", ["forest"], "forest"),
                                              ("farmland", "Farmland", "l-farmland", "🌾", ["crop"], "farmland"),
                                              ("developed", "Built-up", "l-developed", "🏙️", ["developed"], "developed"),
                                              ("wetland", "Wetland & mangrove", "l-forest", "🦩", ["wetland"], "commute")):
        vals = [round(sum(W.pct[k][i] for k in keys) / 100, 2) if W.owner[i] >= 0 and W.raw["cover"][i] > 0 else None
                for i in range(ncell)]
        lenses.append({"id": lid, "group": "land", "name": name, "icon": icon, "emoji": emoji, "unit": "share of land",
                       "format": "pct", "scale": "linear", "domain": [0, pctl([v for v in vals if v is not None])[1]],
                       "ramp": ramp(rmp), "higher_is": "neutral", "source": "worldcover",
                       "description": f"Share of the hex's land that ESA WorldCover 2021 classes as {name.lower()}.",
                       "values": vals})
    write_web("lenses.json", {"vintage": "NSO Statistical Yearbook 2024; WorldPop 2025; ESA WorldCover 2021; IBTrACS",
                              "groups": GROUPS, "lenses": lenses})

    # --- counties.json: the 63 former provinces ---
    cells_of = W.county_cells()
    storm_by_k = {}
    for k, cells in cells_of.items():
        xs = [storm_vals[i] for i in cells if storm_vals[i] is not None and i not in remote]
        storm_by_k[k] = round(sum(xs) / len(xs)) if xs else None
    F = lambda key, label, fmt, unit, hi, src, desc, lens=None: {"key": key, "label": label, "format": fmt, "unit": unit,
                                                                  "higher_is": hi, "source": src, "description": desc, "lens": lens}
    fields = [F("geoid", "Code", "text", "", "neutral", NSO, "ISO 3166-2:VN code of the former province."),
              F("name", "Former province", "text", "", "neutral", NSO, "Province or centrally-run city before 1 July 2025."),
              F("state", "Province (2025)", "text", "", "neutral", NSO, "The 2025 province it is part of."),
              F("population", "Population", "int", "people", "neutral", NSO, "Average population, 2024."),
              F("land_km2", "Area", "km2", "km²", "neutral", NSO, "Natural area, 2023 (NSO)."),
              F("density", "Density", "int", "people / km²", "neutral", NSO, "Population ÷ area.", "density"),
              F("income", "Income", "usd", "$ per person per year", "good", NSO, "Average income per person, 2024.", "income"),
              F("gdp_pc", "GRDP per person", "usd", "$", "good", NSO, "GRDP per person, 2024.", "gdp_pc"),
              F("poverty", "Poverty", "pct", "households", "bad", NSO, "Multidimensional poverty rate, 2024.", "poverty"),
              F("urban", "Urban", "pct", "residents", "neutral", NSO, "Urban share of the population, 2024.", "urban"),
              F("growth", "Growth", "pct", "2019–2024", "neutral", NSO, "Population change 2019–2024.", "growth"),
              F("trained", "Trained workers", "pct", "labour force", "good", NSO, "Trained share of the labour force, 2024.", "trained"),
              F("literacy", "Literacy", "pct", "15+", "good", NSO, "Literacy rate 15+, 2024.", "literacy"),
              F("hdi", "HDI", "float", "0–1", "good", NSO, "Human Development Index, 2024.", "hdi"),
              F("gini", "Gini", "float", "0–1", "bad", NSO, "Gini index of income, 2024.", "gini"),
              F("unemployment", "Unemployment", "pct", "labour force", "bad", NSO, "Unemployment rate, 2024.", "unemployment"),
              F("productivity", "Productivity", "usd", "$ per worker", "good", NSO, "GRDP per worker, 2024.", "productivity"),
              F("fdi", "FDI 2024", "usd", "$", "neutral", NSO, "Foreign direct investment registered in 2024."),
              F("students", "University students", "int", "students", "neutral", NSO, "University students, 2023."),
              F("paddy", "Paddy rice", "int", "tonnes", "neutral", NSO, "Paddy production, 2024."),
              F("pci", "PCI 2022", "float", "0–100", "good", "pci", "Provincial Competitiveness Index 2022.", "pci"),
              F("cbsa", "City", "text", "", "neutral", NSO, "The map city standing for this former province."),
              F("cell", "Hex", "int", "", "neutral", NSO, "A representative hex (the city's banner hex)."),
              F("forest", "Forest", "pct", "of land", "neutral", "worldcover", "WorldCover forest share.", "forest"),
              F("crop", "Farmland", "pct", "of land", "neutral", "worldcover", "WorldCover cropland share.", "farmland"),
              F("developed", "Built-up", "pct", "of land", "neutral", "worldcover", "WorldCover built-up share.", "developed"),
              F("disasters", "Typhoons", "int", f"storms since {STORM_SINCE}", "bad", "ibtracs",
                f"Typhoons within {STORM_RADIUS_KM} km (mean over the province's mainland hexes).", "disasters")]
    cities = {c["id"]: c for c in json.loads((ROOT / "web" / "data" / "cities.json").read_text())}
    rows = []
    for k, u in enumerate(olds):
        r = st[u["iso"]]
        cells = [i for i in cells_of.get(k, []) if W.raw["cover"][i] > 0 and i not in remote]
        share = lambda key: round(sum(W.pct[key][i] for i in cells) / len(cells) / 100, 3) if cells else None
        rows.append([u["iso"], u["name"], W.states[W.old_new[k]], r["population"], r["area_km2"],
                     round(r["population"] / r["area_km2"], 1), r["income"], r["gdp_pc"], r["poverty"],
                     round(r["urban"], 4), round(r["growth"], 4) if r["growth"] is not None else None, r["trained"],
                     r["literacy"], r["hdi"], r["gini"], r["unemployment"], r["productivity"], r["fdi"], r["students"],
                     r["paddy"], r["pci"], u["iso"], cities[u["iso"]]["cell"], share("forest"), share("crop"),
                     share("developed"), storm_by_k.get(k)])
    write_web("counties.json", {"vintage": "NSO Statistical Yearbook 2024", "fields": fields,
                                "columns": [f["key"] for f in fields], "rows": rows})
    top = sorted(storms.values(), key=lambda s: -len(s["cells"]))
    save_interim("_storms", {"storms": storms, "radius_km": STORM_RADIUS_KM, "since": STORM_SINCE, "min_kt": STORM_MIN_KT})
    print(f"    {len(lenses)} lenses; {len(storms)} storms touched Vietnam since {STORM_SINCE}; "
          f"widest: {[(s['name'], s['season'], len(s['cells'])) for s in top[:3]]}")
