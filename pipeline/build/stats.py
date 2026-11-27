"""Province statistics (NSO Statistical Yearbook 2024, NSO PX-Web, VCCI PCI) → interim "_stats".

The tidy CSVs in data/stats/ were parsed from the downloaded publications by pipeline/nso/*.py (see
data/stats/SOURCES.md). Values are converted to people, 0..1 fractions and US dollars (World Bank official rate).
"""
from __future__ import annotations

import csv
import json

from ..admin import old_units
from ..fetch import ROOT
from ..store import save_interim

STATS = ROOT / "data" / "stats"
FX_YEAR = "2024"
NAME_FIX = {"Bà Rịa - Vũng Tàu": "Bà Rịa–Vũng Tàu"}


def fx():
    d = json.loads((STATS / "wb_fx.json").read_text())
    return next(r["value"] for r in d[1] if r["date"] == FX_YEAR)


def read(name):
    out = {}
    for r in csv.DictReader(open(STATS / f"{name}.csv", encoding="utf-8")):
        if r["value"] in ("", None):
            continue
        out[NAME_FIX.get(r["province_std"], r["province_std"])] = float(r["value"])
    return out


def build():
    rate = fx()
    usd = lambda vnd: vnd / rate
    # indicator: (csv, converter)
    spec = {
        "population": ("population_2024", lambda v: round(v * 1000)),
        "urban_population": ("urban_population", lambda v: round(v * 1000)),
        "area_km2": ("area_km2", float),
        "labour_force": ("labour_force", lambda v: round(v * 1000)),
        "employed": ("employed_workers", lambda v: round(v * 1000)),
        "unemployment": ("unemployment_rate", lambda v: round(v / 100, 4)),
        "trained": ("trained_labour_share", lambda v: round(v / 100, 4)),
        "literacy": ("literacy_rate_15plus", lambda v: round(v / 100, 4)),
        "productivity": ("labour_productivity", lambda v: round(usd(v * 1e6))),
        "income": ("income_per_capita_monthly", lambda v: round(usd(v * 1000 * 12))),
        "income_worker": ("income_per_employee_monthly", lambda v: round(usd(v * 1000 * 12))),
        "hdi": ("hdi", float),
        "gini": ("gini", float),
        "poverty": ("poverty_rate_multidimensional", lambda v: round(v / 100, 4)),
        "fdi": ("fdi_registered_capital_2024", lambda v: v * 1e6),
        "fdi_projects": ("fdi_projects_2024", int),
        "paddy": ("paddy_production", lambda v: round(v * 1000)),
        "retail": ("retail_sales", lambda v: usd(v * 1e9)),
        "tourism": ("tourism_travel_turnover", lambda v: usd(v * 1e9)),
        "students": ("university_students", int),
        "lecturers": ("university_lecturers", int),
        "gdp": ("grdp_total_derived", lambda v: usd(v * 1e9)),
        "gdp_pc": ("grdp_per_capita", lambda v: round(usd(v * 1e6))),
        "pci": ("pci_score_2022", float),
        "pci_2024": ("pci_score_2024", float),
    }
    units = old_units()
    rows = {u["iso"]: {"name": u["name"]} for u in units}
    by_name = {u["name"]: u["iso"] for u in units}
    for key, (f, conv) in spec.items():
        vals = read(f)
        for name, v in vals.items():
            rows[by_name[name]][key] = conv(v)
    # provinces absent from a table: FDI (none in 2024) and universities (none) are real zeros, the rest unknown
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
        r["pop_series"] = dict(sorted(series.get(iso, {}).items())) or None
    # extra PX-Web tables (2024): informal employment, life expectancy, migration
    from ..nso.names import std
    national = {}
    for table, keys in (("V02.51", {None: "informal"}), ("V02.25", {None: "life_exp"}),
                        ("V02.21-23", {0: "in_migration", 1: "out_migration", 2: "net_migration"})):
        d = json.loads((STATS / "px" / f"{table}.json").read_text())
        var = d["meta"]["variables"]
        prov = var[0]["valueTexts"]
        years = var[-1]["valueTexts"]
        y = str(years.index("2024"))
        for row in d["data"]["data"]:
            key = row["key"]
            if key[-1] != y or row["values"][0] in ("", "..", "-"):
                continue
            k = keys[None] if None in keys else keys[int(key[1])]
            v = float(row["values"][0])
            if prov[int(key[0])] == "CẢ NƯỚC":  # NSO's own national figure
                national[k] = round(v / 100, 4) if k == "informal" else v
                continue
            name = std(prov[int(key[0])])
            if not name:
                continue
            rows[by_name[NAME_FIX.get(name, name)]][k] = round(v / 100, 4) if k == "informal" else v
    for r in rows.values():
        for k in ("informal", "life_exp", "in_migration", "out_migration", "net_migration"):
            r.setdefault(k, None)
    bad = [(iso, k) for iso, r in rows.items() for k in ("population", "gdp", "employed", "area_km2") if r[k] is None]
    assert not bad, f"core statistics missing: {bad}"
    print(f"    {len(rows)} former provinces; USD at {rate:,.2f} VND (World Bank, {FX_YEAR}); "
          f"national GRDP ≈ ${sum(r['gdp'] for r in rows.values()) / 1e9:,.0f} bn")
    save_interim("_stats", {"fx": rate, "fx_year": FX_YEAR, "year": 2024, "rows": rows, "national": national})
