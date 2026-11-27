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

from ..admin import NEW, old_units
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
MONTHLY = "nso_monthly_2026"
GROUPS = [{"id": "people", "name": "People"}, {"id": "economy", "name": "Economy"},
          {"id": "living", "name": "Quality of life"}, {"id": "education", "name": "Education"},
          {"id": "hazards", "name": "Hazards"}, {"id": "land", "name": "Land"}]

# Lenses from the 63 former provinces: each hex averages its 7 sample points' former-province values.
# id, group, name, icon, emoji, unit, format, scale, higher_is, source, ramp, stat key, year, description, note
PROVINCE_LENSES = [
    ("urban", "people", "Urban share", "l-developed", "🏙️", "share of residents living in urban areas", "pct", "linear", "neutral", NSO, "developed", "urban", "2025",
     "Urban population ÷ average population, 2025 (NSO, preliminary). Urban follows Vietnam's administrative definition (wards and towns).", None),
    ("growth", "people", "Growth", "l-people", "📈", "population change 2019–2025", "pct", "linear", "neutral", NSO, "age", "growth", "2019–2025",
     "Average population 2025 ÷ 2019 − 1, by former province (NSO PX-Web V02.03-07 for 2019, Statistical Yearbook 2025 for 2025, preliminary).", None),
    ("gdp_pc", "economy", "GRDP per person", "l-home", "💰", "GRDP per person, $", "usd", "log", "good", NSO, "home", "gdp_pc", "2025",
     "Gross regional domestic product per person, 2025, current prices (NSO estimate), converted at the World Bank 2024 rate (the 2025 rate is not yet published).",
     "Counted where output is made: oil, mining and industrial provinces score high even where incomes are modest."),
    ("productivity", "economy", "Productivity", "l-income", "⚙️", "GRDP per worker, $", "usd", "log", "good", NSO, "income", "productivity", "2025",
     "Labour productivity: GRDP ÷ employed workers, 2025 (NSO, preliminary), converted at the World Bank 2024 rate.", None),
    ("pci", "economy", "Business climate", "l-amenities", "🤝", "PCI score (0–100)", "float", "linear", "good", "pci", "homeownership", "pci", "2022",
     "Provincial Competitiveness Index 2022 (VCCI/USAID), the last year scored for all 63 provinces: a survey of "
     "private firms on transparency, costs, land access and governance.",
     "PCI 2025 covers the 34 new provinces but publishes only sub-indices and rank groups, no composite score."),
    ("income", "living", "Income", "l-income", "💵", "income per person per year, $", "usd", "linear", "good", NSO, "income", "income", "2025",
     "Average monthly income per person (Vietnam Household Living Standards Survey, 2025) × 12, converted at the World Bank 2024 rate.",
     "Income per person, not per household."),
    ("poverty", "living", "Poverty", "l-poverty", "🥣", "households in multidimensional poverty", "pct", "linear", "bad", NSO, "poverty", "poverty", "2025",
     "Share of households poor by Vietnam's multidimensional poverty standard for 2022–2025 (income plus access to "
     "jobs, health, education, housing, water and sanitation, information), 2025 (NSO, preliminary).", None),
    ("gini", "living", "Inequality", "l-amenities", "⚖️", "Gini index of income", "float", "linear", "bad", NSO, "commute", "gini", "2025",
     "Gini coefficient of per-person income, 2025 (NSO, VHLSS, preliminary). 0 = everyone earns the same.", None),
    ("unemployment", "living", "Unemployment", "l-poverty", "📉", "unemployed share of the working-age labour force", "pct", "linear", "bad", NSO, "uninsured", "unemployment", "2025",
     "Unemployment rate of the labour force in working age, 2025 (NSO Labour Force Survey, preliminary).", "Low everywhere: informal work absorbs most people who lose a job."),
    ("internet", "living", "Internet users", "l-broadband", "🌐", "people using the internet", "pct", "linear", "good", NSO, "broadband", "internet", "2025",
     "Share of people who used the internet, 2025 (NSO, preliminary).", None),
    ("clean_water", "living", "Clean water", "l-commute", "🚰", "population using a hygienic water source", "pct", "linear", "good", NSO, "commute", "clean_water", "2025",
     "Share of the population whose main drinking water comes from a hygienic source, 2025 (NSO, preliminary).",
     "Above 95% almost everywhere; the colours separate the few provinces that lag."),
    ("housing", "living", "Permanent housing", "l-homeownership", "🏠", "households living in a permanent house", "pct", "linear", "good", NSO, "homeownership", "housing", "2024",
     "Share of households whose house is permanent (kiên cố), 2024 (NSO; the 2025 yearbook's latest housing survey). "
     "The rest live in semi-permanent, less-permanent or simple houses.",
     "Mekong Delta provinces score low: houses on stilts and of light materials are common there."),
    ("trained", "education", "Trained workers", "l-degrees", "🎓", "workers 15+ with vocational or higher training", "pct", "linear", "good", NSO, "bachelors", "trained", "2025",
     "Share of the labour force aged 15+ holding a vocational certificate, college or university degree, 2025 (NSO Labour Force Survey, preliminary).", None),
    ("literacy", "education", "Literacy", "l-degrees", "📖", "people 15+ who can read and write", "pct", "linear", "good", NSO, "broadband", "literacy", "2024",
     "Literacy rate of people aged 15 and over, 2024 (NSO; the latest published by province).", None),
    ("it_skills", "education", "IT skills", "l-broadband", "💻", "people with information-technology skills", "pct", "linear", "good", NSO, "bachelors", "it_skills", "2025",
     "Share of people with at least one information-technology skill (copying files, sending e-mail, using a "
     "spreadsheet…), 2025 (NSO, preliminary).", None),
]
# Lenses NSO publishes only for the 34 provinces of 2025: every hex of a province shows the province's value.
STATE_LENSES = [
    ("fdi", "economy", "Foreign investment", "l-income", "🏗️", "FDI registered in 2025 per resident, $", "usd", "log", "neutral", NSO, "broadband", "fdi_pc", "2025",
     "Newly registered plus added foreign direct investment capital in 2025 ÷ average population 2025, by the 34 "
     "provinces (NSO). Provinces with no registration in 2025 are 0.",
     "Registered capital, not money disbursed; one large project can dominate a province's year."),
    ("enterprises", "economy", "Enterprises", "l-amenities", "🏢", "active enterprises per 1,000 residents", "float", "log", "good", NSO, "income", "enterprises_pk", "2025-12-31",
     "Active enterprises per 1,000 residents at 31 December 2025, by the 34 provinces (NSO).", None),
    ("growth_2026", "economy", "Growth, 9 months 2026 (est.)", "l-income", "🚀", "GRDP growth vs the first 9 months of 2025", "pct", "linear", "good", MONTHLY, "home", "growth_9m2026", "9M2026",
     "Estimated GRDP growth of January–September 2026 over the same period of 2025, at constant 2020 prices, by the "
     "34 provinces (NSO socio-economic report for September 2026, published October 2026).",
     "An estimate; NSO revises it with the full-year figures."),
    ("industry_jobs_2026", "economy", "Factory jobs 2026 (est.)", "l-income", "🏭", "industrial-enterprise jobs vs a year earlier", "pct", "linear", "good", MONTHLY, "age", "industry_jobs_2026", "2026-10-01",
     "Change in the number of workers in industrial enterprises at 1 October 2026 compared with 1 October 2025, "
     "by the 34 provinces (NSO socio-economic report for October 2026, estimate).", None),
    ("hdi", "living", "Human development", "l-amenities", "🌱", "HDI (0–1)", "float", "linear", "good", NSO, "bachelors", "hdi", "2025",
     "Human Development Index by the 34 provinces, 2025 (NSO, preliminary): health, education and income combined, 0–1.",
     "NSO publishes HDI only for the 34 provinces from 2025; the former provinces' tables keep their 2024 values."),
    ("doctors", "living", "Doctors", "l-uninsured", "🩺", "doctors per 10,000 people (State sector)", "float", "linear", "good", NSO, "amenities", "doctors_pk", "2025",
     "Doctors working in State-sector health facilities in 2025 per 10,000 residents (average population 2025), by "
     "the 34 provinces (NSO).", "Private-sector doctors are not counted; central hospitals lift Hà Nội, Huế and TP. Hồ Chí Minh."),
    ("road_deaths", "living", "Road deaths", "l-poverty", "🚦", "road traffic deaths per 100,000 people", "float", "linear", "bad", NSO, "poverty", "road_deaths", "2025",
     "People killed in road traffic accidents in 2025 per 100,000 residents, by the 34 provinces (NSO).", None),
    ("pupils_per_teacher", "education", "Pupils per teacher", "l-degrees", "🏫", "pupils per teacher (general education)", "float", "linear", "bad", NSO, "commute", "pupils_per_teacher", "2025-09-30",
     "General-education pupils (primary to upper secondary) per teacher at 30 September 2025, by the 34 provinces (NSO).", None),
    ("forest_cover", "land", "Forest cover (official)", "l-forest", "🌲", "forest cover", "pct", "linear", "neutral", NSO, "forest", "forest_cover", "2025-12-31",
     "Official forest cover rate at 31 December 2025 (natural and planted forest ÷ area), by the 34 provinces (NSO, "
     "from the forestry sector's monitoring). The Forest lens next to it measures tree cover from satellite imagery.", None),
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


def wind_kt(row, ix):
    """Max sustained wind (kt): JMA's 10-minute wind (TOKYO_WIND is filled at the 3-hourly rows too, WMO_WIND only
    6-hourly); JTWC's 1-minute wind only for a storm JMA did not estimate. Mixing them row by row lets the higher
    1-minute wind set a storm's maximum (Yagi 2024: 128 kt instead of JMA's 105)."""
    for k in ("TOKYO_WIND", "WMO_WIND", "USA_WIND"):
        if row[ix[k]].strip():
            return float(row[ix[k]])
    return 0


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
        ix = {k: head.index(k) for k in ("SID", "SEASON", "NAME", "LAT", "LON", "TOKYO_WIND", "WMO_WIND", "USA_WIND", "ISO_TIME")}
        for row in r:
            if int(row[ix["SEASON"]]) < STORM_SINCE:
                continue
            lat, lon = float(row[ix["LAT"]]), float(row[ix["LON"]])
            if not (3 < lat < 27 and 98 < lon < 122):
                continue
            kt = wind_kt(row, ix)
            tracks[row[ix["SID"]]].append((lon, lat, kt, row[ix["ISO_TIME"]]))
            names[row[ix["SID"]]] = (row[ix["NAME"]], int(row[ix["SEASON"]]))
    count = np.zeros(len(land), int)
    rad = STORM_RADIUS_KM * UNIT
    per_storm = {}
    for sid, pts in tracks.items():
        hit = np.zeros(len(land), bool)
        maxkt, first, county_first = 0, None, {}
        for (lo0, la0, k0, t0), (lo1, la1, k1, _) in zip(pts, pts[1:]):
            if max(k0, k1) < STORM_MIN_KT:
                continue
            p0, p1 = np.array(W.proj(lo0, la0)), np.array(W.proj(lo1, la1))
            v = p1 - p0
            # exact distance from each hex centre to the segment (sampling it missed close passes between fixes)
            t = np.clip((centers - p0) @ v / (v @ v), 0, 1) if v @ v > 0 else np.zeros(len(centers))
            near = ((centers - (p0 + t[:, None] * v)) ** 2).sum(1) <= rad * rad
            if near.any():
                for k in np.nonzero(near & ~hit)[0]:
                    if W.county[land[k]] >= 0 and not rem[k]:  # date it first came near each former province (mainland)
                        county_first.setdefault(int(W.county[land[k]]), t0[:10])
                hit |= near
                if (near & ~rem).any():
                    maxkt = max(maxkt, k0, k1)
                    first = first or t0
        if hit.any():
            count += hit
            per_storm[sid] = {"name": names[sid][0], "season": names[sid][1], "max_kt": maxkt,
                              "first": (first or pts[0][3])[:10], "cells": [land[k] for k in np.nonzero(hit)[0]],
                              "county_first": {str(k): d for k, d in county_first.items()}}
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
        r["growth"] = s["2025"] / s["2019"] - 1 if s.get("2025") and s.get("2019") else None
    states = load_interim("_stats")["states"]
    state_pop = defaultdict(int)
    for u in olds:
        state_pop[NEW[u["new"]][0]] += st[u["iso"]]["population"]
    for abbr, r in states.items():
        r["fdi_pc"] = r["fdi"] / state_pop[abbr]
    owner_abbr = [a for a in W.states]  # world.json state order: owner index → abbr
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
    for level, table in (("63", PROVINCE_LENSES), ("34", STATE_LENSES)):
        for (lid, group, name, icon, emoji, unit, fmt, scale, hi, src, rmp, key, year, desc, note) in table:
            vals = [None] * ncell
            for i in land:
                if level == "34":
                    vals[i] = round_for(fmt, states[owner_abbr[W.owner[i]]][key])
                    continue
                smp = [k for k in W.samples[i] if k >= 0]
                xs = [st[iso[k]][key] for k in smp if st[iso[k]][key] is not None]
                vals[i] = round_for(fmt, sum(xs) / len(xs)) if xs else None
            lens = {"id": lid, "group": group, "name": name, "icon": icon, "emoji": emoji, "unit": unit, "format": fmt,
                    "scale": scale, "domain": pctl([v for v in vals if v is not None and (scale != "log" or v > 0)]),
                    "ramp": ramp(rmp), "higher_is": hi, "source": src, "year": year, "level": level,
                    "description": desc, "values": vals}
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
                                  f"JMA 10-minute winds; JTWC where JMA has none) whose IBTrACS best track passed within {STORM_RADIUS_KM} km of the "
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
    order = {g["id"]: k for k, g in enumerate(GROUPS)}
    lenses.sort(key=lambda l: order[l["group"]])  # stable: keeps each group's own order
    write_web("lenses.json", {"vintage": "NSO Statistical Yearbook 2025 (some lenses 2024 or earlier; each lens states its year); "
                                         "NSO monthly report Oct 2026; NSO 2019 census; VCCI PCI 2022; WorldPop 2025; ESA WorldCover 2021; "
                                         "IBTrACS; CHELSA V2.1 (1981–2010); Hansen Global Forest Change 2001–2025; ETOPO1; "
                                         "OpenStreetMap",
                              "groups": GROUPS, "lenses": lenses})

    # --- counties.json: the 63 former provinces ---
    cells_of = W.county_cells()
    storm_by_k = {}
    for k, cells in cells_of.items():
        xs = [storm_vals[i] for i in cells if storm_vals[i] is not None and i not in remote]
        storm_by_k[k] = round(sum(xs) / len(xs)) if xs else None
    # A field from another year than the 2025 main one says so in its label, "Literacy (2024)", as the Explorer
    # labels the same field of the cities and provinces.
    yrs = load_interim("_stats")["years"]
    yl = lambda label, key: f"{label} ({yrs[key]})"
    assert yrs["area_km2"].endswith("-12-31"), yrs["area_km2"]
    F = lambda key, label, fmt, unit, hi, src, desc, lens=None: {"key": key, "label": label, "format": fmt, "unit": unit,
                                                                  "higher_is": hi, "source": src, "description": desc, "lens": lens}
    fields = [F("geoid", "Code", "text", "", "neutral", NSO, "ISO 3166-2:VN code of the former province."),
              F("name", "Former province", "text", "", "neutral", NSO, "Province or centrally-run city before 1 July 2025."),
              F("state", "Province (2025)", "text", "", "neutral", NSO, "The 2025 province it is part of."),
              F("population", "Population", "int", "people", "neutral", NSO, "Average population, 2025 (preliminary)."),
              F("land_km2", f"Area (31 Dec {yrs['area_km2'][:4]})", "km2", "km²", "neutral", NSO, "Natural area at 31 December 2023 (NSO Statistical Yearbook 2024)."),
              F("density", "Density", "int", "people / km²", "neutral", NSO, "Population 2025 ÷ area.", "density"),
              F("income", "Income", "usd", "$ per person per year", "good", NSO, "Average income per person, 2025.", "income"),
              F("gdp_pc", "GRDP per person", "usd", "$", "good", NSO, "GRDP per person, 2025 (estimate).", "gdp_pc"),
              F("grdp_growth", "GRDP growth 2025", "pct", "vs 2024", "good", NSO, "GRDP growth 2025 over 2024 at constant prices (estimate)."),
              F("poverty", "Poverty", "pct", "households", "bad", NSO, "Multidimensional poverty rate, 2025 (preliminary).", "poverty"),
              F("urban", "Urban", "pct", "residents", "neutral", NSO, "Urban share of the population, 2025.", "urban"),
              F("growth", "Growth", "pct", "2019–2025", "neutral", NSO, "Population change 2019–2025.", "growth"),
              F("trained", "Trained workers", "pct", "labour force", "good", NSO, "Trained share of the labour force, 2025.", "trained"),
              F("literacy", yl("Literacy", "literacy"), "pct", "15+", "good", NSO, "Literacy rate 15+, 2024.", "literacy"),
              F("it_skills", "IT skills", "pct", "people", "good", NSO, "People with information-technology skills, 2025.", "it_skills"),
              F("hdi", yl("HDI", "hdi"), "float", "0–1", "good", NSO, "Human Development Index, 2024 (the last year NSO published it for the 63 former provinces; the HDI lens shows 2025 by the 34 provinces)."),
              F("gini", "Gini", "float", "0–1", "bad", NSO, "Gini index of income, 2025.", "gini"),
              F("unemployment", "Unemployment", "pct", "labour force", "bad", NSO, "Unemployment rate, 2025.", "unemployment"),
              F("internet", "Internet users", "pct", "people", "good", NSO, "People using the internet, 2025.", "internet"),
              F("clean_water", "Clean water", "pct", "population", "good", NSO, "Population using a hygienic water source, 2025.", "clean_water"),
              F("housing", yl("Permanent housing", "housing"), "pct", "households", "good", NSO, "Households in a permanent house, 2024.", "housing"),
              F("productivity", "Productivity", "usd", "$ per worker", "good", NSO, "GRDP per worker, 2025.", "productivity"),
              F("fdi", yl("FDI", "fdi"), "usd", "$", "neutral", NSO, "Foreign direct investment registered in 2024 (the last year published for the 63 former provinces; the FDI lens shows 2025 by the 34 provinces)."),
              F("students", yl("University students", "students"), "int", "students", "neutral", NSO, "University students, 2023."),
              F("paddy", "Paddy rice", "int", "tonnes", "neutral", NSO, "Paddy production, 2025 (preliminary)."),
              F("pci", yl("PCI", "pci"), "float", "0–100", "good", "pci", "Provincial Competitiveness Index 2022.", "pci"),
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
                     round(r["population"] / r["area_km2"], 1), r["income"], r["gdp_pc"], r["grdp_growth"], r["poverty"],
                     round(r["urban"], 4), round(r["growth"], 4) if r["growth"] is not None else None, r["trained"],
                     r["literacy"], r["it_skills"], r["hdi"], r["gini"], r["unemployment"], r["internet"],
                     r["clean_water"], r["housing"], r["productivity"], r["fdi"], r["students"],
                     r["paddy"], r["pci"], u["iso"], cities[u["iso"]]["cell"], share("forest"), share("crop"),
                     share("developed"), storm_by_k.get(k)])
    write_web("counties.json", {"vintage": "NSO Statistical Yearbook 2025 (2025 preliminary; HDI, FDI and literacy 2024, students 2023; each field states its year)", "fields": fields,
                                "columns": [f["key"] for f in fields], "rows": rows})
    top = sorted(storms.values(), key=lambda s: -len(s["cells"]))
    save_interim("_storms", {"storms": storms, "radius_km": STORM_RADIUS_KM, "since": STORM_SINCE, "min_kt": STORM_MIN_KT})
    print(f"    {len(lenses)} lenses; {len(storms)} storms touched Vietnam since {STORM_SINCE}; "
          f"widest: {[(s['name'], s['season'], len(s['cells'])) for s in top[:3]]}")
