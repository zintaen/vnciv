"""Province statistics (NSO Statistical Yearbook 2025 and 2024, NSO PX-Web, NSO monthly reports 2026, VCCI PCI) → "_stats".

The tidy CSVs in data/stats/ were parsed from the downloaded publications by pipeline/nso/*.py (see
data/stats/SOURCES.md): 2025/ = yearbook 2025 Part I (63 former provinces), p34/ = its appendix (34 provinces of 2025),
p34_2026/ = 2026 monthly reports (34 provinces), 2024/ = yearbook 2024 (63). Values are converted to people, 0..1
fractions and US dollars (World Bank official rate).

* `rows`: the 63 former provinces (cities). Each indicator is the newest NSO publishes for the 63; `YEARS` says which.
* `states`: the 34 provinces, for indicators NSO publishes only at that level (HDI 2025, FDI 2025, enterprises, doctors,
  forest cover, road deaths, pupils per teacher, 2026 growth) and the 34-province official value of ratio indicators
  (shares, rates, averages that cannot be summed from the former provinces). `STATE_YEARS` says which year.
* `national`: NSO's own national figures (data/stats/national.csv), in the same units as the rows.
"""
from __future__ import annotations

import csv
import json

from ..admin import NEW, old_units
from ..fetch import ROOT
from ..store import save_interim

STATS = ROOT / "data" / "stats"
FX_YEAR = "2025"   # wanted; falls back to the newest year the World Bank has published (see fx())
NAME_FIX = {"Bà Rịa - Vũng Tàu": "Bà Rịa–Vũng Tàu"}
pct = lambda v: round(v / 100, 4)
idx = lambda v: round(v / 100 - 1, 4)   # NSO index (previous period = 100) → growth fraction

# Year of each 63-province field (the label shown with it); "2025" values are preliminary or estimated.
YEARS = {"population": "2025", "urban": "2025", "area_km2": "2023-12-31", "labour_force": "2025", "employed": "2025",
         "unemployment": "2025", "trained": "2025", "informal": "2025", "productivity": "2025", "income": "2025",
         "income_worker": "2025", "gini": "2025", "poverty": "2025", "gdp": "2025", "gdp_pc": "2025",
         "grdp_growth": "2025", "paddy": "2025", "retail": "2025", "tourism": "2025", "life_exp": "2025",
         "migration": "2025", "literacy": "2024", "hdi": "2024", "fdi": "2024", "fdi_projects": "2024",
         "students": "2023", "lecturers": "2023", "pci": "2022", "pci_2024": "2024", "internet": "2025",
         "computer": "2025", "clean_water": "2025", "housing": "2024", "it_skills": "2025", "enterprises_pk": "2024"}
STATE_YEARS = {**YEARS, "area_km2": "2024-12-31", "hdi": "2025", "fdi": "2025", "fdi_projects": "2025", "enterprises_pk": "2025-12-31",
               "doctors": "2025", "doctors_pk": "2025", "forest_cover": "2025-12-31", "road_deaths": "2025",
               "pupils_per_teacher": "2025-09-30", "growth_9m2026": "9M2026", "industry_jobs_2026": "2026-10-01",
               "pci_2025": "2025"}


def fx():
    """(rate, year): the World Bank official rate for FX_YEAR, or the newest published year before it."""
    d = json.loads((STATS / "wb_fx.json").read_text())
    have = sorted((r["date"], r["value"]) for r in d[1] if r["value"] and r["date"] <= FX_YEAR)
    return have[-1][1], have[-1][0]


def read(name):
    out = {}
    for r in csv.DictReader(open(STATS / f"{name}.csv", encoding="utf-8")):
        if r["value"] in ("", None):
            continue
        out[NAME_FIX.get(r["province_std"], r["province_std"])] = float(r["value"])
    return out


def build():
    rate, fx_year = fx()
    usd = lambda vnd: vnd / rate
    # 63 former provinces — indicator: (csv, converter)
    spec = {
        "population": ("2025/population_2025", lambda v: round(v * 1000)),
        "urban_population": ("2025/urban_population", lambda v: round(v * 1000)),
        "area_km2": ("2024/area_km2", float),
        "labour_force": ("2025/labour_force", lambda v: round(v * 1000)),
        "employed": ("2025/employed_workers", lambda v: round(v * 1000)),
        "unemployment": ("2025/unemployment_rate", pct),
        "trained": ("2025/trained_labour_share", pct),
        "informal": ("2025/informal_employment_rate", pct),
        "productivity": ("2025/labour_productivity", lambda v: round(usd(v * 1e6))),
        "income": ("2025/income_per_capita_monthly", lambda v: round(usd(v * 1000 * 12))),
        "income_worker": ("2025/income_per_employee_monthly", lambda v: round(usd(v * 1000 * 12))),
        "gini": ("2025/gini", float),
        "poverty": ("2025/poverty_rate_multidimensional", pct),
        "gdp": ("2025/grdp_total_derived", lambda v: usd(v * 1e9)),
        "gdp_pc": ("2025/grdp_per_capita", lambda v: round(usd(v * 1e6))),
        "grdp_growth": ("2025/grdp_growth", idx),
        "paddy": ("2025/paddy_production", lambda v: round(v * 1000)),
        "retail": ("2025/retail_sales", lambda v: usd(v * 1e9)),
        "tourism": ("2025/tourism_travel_turnover", lambda v: usd(v * 1e9)),
        "life_exp": ("2025/life_expectancy", float),
        "in_migration": ("2025/in_migration_rate", float),
        "out_migration": ("2025/out_migration_rate", float),
        "net_migration": ("2025/net_migration_rate", float),
        "internet": ("2025/internet_users", pct),
        "computer": ("2025/computer_households", pct),
        "clean_water": ("2025/hygienic_water_share", pct),
        "housing": ("2025/permanent_housing_share", pct),
        "it_skills": ("2025/it_skills_share", pct),
        "enterprises_pk": ("2025/enterprises_per_1000", float),
        "literacy": ("2024/literacy_rate_15plus", pct),
        "hdi": ("2024/hdi", float),
        "fdi": ("2024/fdi_registered_capital_2024", lambda v: v * 1e6),
        "fdi_projects": ("2024/fdi_projects_2024", int),
        "students": ("2024/university_students", int),
        "lecturers": ("2024/university_lecturers", int),
        "pci": ("pci_score_2022", float),
        "pci_2024": ("pci_score_2024", float),
    }
    units = old_units()
    rows = {u["iso"]: {"name": u["name"]} for u in units}
    by_name = {u["name"]: u["iso"] for u in units}
    for key, (f, conv) in spec.items():
        for name, v in read(f).items():
            rows[by_name[name]][key] = conv(v)
    # provinces absent from a table: FDI (none licensed that year) and universities (none) are real zeros, the rest
    # unknown (e.g. Bắc Kạn's 2025 travel turnover is blank in the yearbook)
    for r in rows.values():
        for k in ("fdi", "fdi_projects", "students", "lecturers"):
            r.setdefault(k, 0)
        for k in spec:
            r.setdefault(k, None)
        r["urban"] = r["urban_population"] / r["population"] if r["population"] else None
    series = {}
    for r in csv.DictReader(open(STATS / "population_series.csv", encoding="utf-8")):
        if r.get("series") != "total":
            continue
        iso = by_name[NAME_FIX.get(r["province_std"], r["province_std"])]
        year = r["year"].replace("Sơ bộ ", "").replace(" (prel.)", "")[:4]
        series.setdefault(iso, {})[year] = round(float(r["value"]) * 1000)
    for iso, r in rows.items():
        s = dict(sorted(series.get(iso, {}).items()))
        if s:
            s["2025"] = r["population"]  # the yearbook 2025 figure (PX-Web's "Sơ bộ 2025" agrees within 50 people)
        r["pop_series"] = s or None

    # 34 provinces (2025) — indicator: (csv, converter, missing province = 0?)
    spec34 = {
        # NSO's official area of the 34 provinces (31/12/2024, Decision 456/QĐ-BNNMT); the former provinces' 2023
        # areas do not add up to it (Vĩnh Long +9%, Hưng Yên +5%)
        "area_km2": ("p34/area_km2", float, False),
        "hdi": ("p34/hdi", float, False),
        "fdi": ("p34/fdi_registered_capital_2025", lambda v: v * 1e6, True),
        "fdi_projects": ("p34/fdi_projects_2025", int, True),
        "enterprises_pk": ("p34/enterprises_per_1000", float, False),
        "doctors": ("p34/doctors_public", int, False),
        "forest_cover": ("p34/forest_cover", pct, False),
        "road_deaths": ("p34/road_deaths_per_100k", float, False),
        "pupils_per_teacher": ("p34/pupils_per_teacher", float, False),
        "pci_2025": ("p34/pci_2025", float, False),  # composite computed from VCCI's sub-indices and weights (pipeline/nso/pci2025.py)
        "growth_9m2026": ("p34_2026/grdp_growth_9M2026", idx, False),
        "industry_jobs_2026": ("p34_2026/industrial_employment_index_Oct2026", idx, False),
        # official 34-province values of ratio indicators (not sums of the former provinces)
        "grdp_growth": ("p34/grdp_growth", idx, False),
        "unemployment": ("p34/unemployment_rate", pct, False),
        "trained": ("p34/trained_labour_share", pct, False),
        "income": ("p34/income_per_capita_monthly", lambda v: round(usd(v * 1000 * 12)), False),
        "income_worker": ("p34/income_per_employee_monthly", lambda v: round(usd(v * 1000 * 12)), False),
        "gini": ("p34/gini", float, False),
        "poverty": ("p34/poverty_rate_multidimensional", pct, False),
        "internet": ("p34/internet_users", pct, False),
        "computer": ("p34/computer_households", pct, False),
        "clean_water": ("p34/hygienic_water_share", pct, False),
        "housing": ("p34/permanent_housing_share", pct, False),
        "it_skills": ("p34/it_skills_share", pct, False),
    }
    states = {abbr: {"name": name} for name, (abbr, _) in NEW.items()}
    abbr_of = {name: abbr for name, (abbr, _) in NEW.items()}
    pop34 = {abbr_of[n]: v * 1000 for n, v in read("p34/population_2025").items()}
    for key, (f, conv, zero) in spec34.items():
        vals = read(f)
        assert set(vals) <= set(abbr_of), (f, set(vals) - set(abbr_of))
        for name, (abbr, _) in NEW.items():
            states[abbr][key] = conv(vals[name]) if name in vals else (conv(0) if zero else None)
    for abbr, s in states.items():
        s["doctors_pk"] = round(s["doctors"] / pop34[abbr] * 1e4, 2) if s["doctors"] is not None else None

    national = {}
    for r in csv.DictReader(open(STATS / "national.csv", encoding="utf-8")):
        national[r["indicator"]] = float(r["value"])
        national.setdefault("_years", {})[r["indicator"]] = r["year"]
    bad = [(iso, k) for iso, r in rows.items() for k in ("population", "gdp", "employed", "area_km2") if r[k] is None]
    assert not bad, f"core statistics missing: {bad}"
    gaps = {k: [r["name"] for r in rows.values() if r[k] is None] for k in spec}
    gaps34 = {k: [s["name"] for s in states.values() if s[k] is None] for k in spec34}
    print(f"    {len(rows)} former provinces, {len(states)} provinces; USD at {rate:,.2f} VND (World Bank, {fx_year}); "
          f"national GRDP ≈ ${sum(r['gdp'] for r in rows.values()) / 1e9:,.0f} bn; "
          f"gaps {({k: v for k, v in gaps.items() if v})} {({k: v for k, v in gaps34.items() if v})}")
    save_interim("_stats", {"fx": rate, "fx_year": fx_year, "year": 2025, "rows": rows, "states": states,
                            "years": YEARS, "state_years": STATE_YEARS, "national": national})
