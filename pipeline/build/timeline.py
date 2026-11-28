"""timeline.json: what the map can show year by year.

* series: per-province values by year, from data/stats/series/*.csv (long format: province_std, level 63|34, year,
  value, unit, source_url) plus the population series (NSO average population 2010–2025). Missing years stay missing.
* storms: every tropical cyclone that touched Vietnam since 1980 with the land hexes it passed (for a per-year typhoon
  lens), from the typhoon interim.
* events: dated milestones (the 2025 province merger, UNESCO inscriptions).
Money series are converted to USD at each year's World Bank official rate (data/stats/wb_fx.json).
"""
from __future__ import annotations

import csv
import json
from collections import defaultdict

from ..admin import NEW, fold, old_units
from ..fetch import ROOT
from ..store import load_interim, write_web
from .common import World

STATS = ROOT / "data" / "stats"
FIRST_YEAR = 2010   # the 63-province frame holds from 2008 (Hà Tây into Hà Nội); the series start in 2010
NAME_FIX = {"Bà Rịa - Vũng Tàu": "Bà Rịa–Vũng Tàu"}
EVENTS = [
    {"date": "2025-07-01", "id": "merger_2025", "title": "34 provinces from 1 July 2025", "source": "Resolution 202/2025/QH15",
     "text": "Resolution 202/2025/QH15 merged Vietnam's 63 provinces and centrally-run cities into 34; district-level "
             "government was abolished. Statistics before mid-2025 are published for the 63 former provinces."},
]


# Definition breaks inside a series, from the footnotes of the cited tables (shown with the series).
LABOUR_BREAK = ("From 2021 NSO computes labour figures under ICLS19: people working only to produce goods for their own "
                "use in agriculture, forestry and fishery no longer count as employed (ICLS13 before 2021; Statistical "
                "Yearbook 2025, p.151 footnote). Years before 2021 and 2021 onward are not strictly comparable.")
BREAKS = {k: LABOUR_BREAK for k in ("labour_force", "employed_workers", "unemployment_rate", "underemployment_rate",
                                     "informal_employment_rate", "trained_labour_share", "labour_productivity")}
BREAKS["hdi"] = ("HDI from 2020 uses the World Bank's 2017 PPPs (Statistical Yearbook 2025, p.1485 footnote); 2018 and "
                 "2019 come from the 2022 yearbook, the first to print HDI by province.")
BREAKS["poverty_rate_multidimensional"] = (
    "Multidimensional poverty from 2016: 2016-2021 under the 2016-2020 standard (income and deprivation in basic social "
    "services; Statistical Yearbook 2018, p.853 footnote), from 2022 under the 2022-2025 standard (Statistical Yearbook "
    "2025, p.934 footnote), so the 2021-2022 step is a definition change. Before 2016 the yearbooks print income poverty: "
    "those rates (2010-2015) are a separate series, not drawn on this lens.")
BREAKS["poverty_rate_income"] = (
    "Income poverty, not multidimensional: households below the Government's poverty line for 2011-2015 (updated by "
    "CPI; Statistical Yearbook 2018, p.853 footnote), 2010-2015 only. Not comparable with the multidimensional rates "
    "from 2016.")
BREAKS["income_per_capita_monthly"] = ("From the Household Living Standards Survey: by province every two years until "
                                       "2018 (2010, 2012, 2014, 2016, 2018), every year from 2019.")
BREAKS["pci"] = ("Method break in 2025: PCI 2022 and 2024 are VCCI's published composite scores for the 63 former "
                 "provinces (2024: the top 30 only); 2025 covers the 34 new provinces with new sub-indices and weights, and "
                 "its composite is computed by the atlas from the 9 sub-indices and the weights VCCI published (PCI 2025 "
                 "report, Figure A1.1 p.138): VCCI does not publish a PCI 2025 composite score.")
BREAKS["population"] = ("Average population adjusted to the Population and Housing Census of 1 April 2019 "
                        "(Statistical Yearbook 2019 footnote); 2010-2018 are NSO's revised figures in PX-Web V02.03-07, "
                        "which differ from the estimates the 2010-2018 yearbooks printed (e.g. Hà Nội 2018: 7,914.5 "
                        "thousand against 7,520.7).")


def fx_by_year():
    d = json.loads((STATS / "wb_fx.json").read_text())
    return {int(r["date"]): r["value"] for r in d[1] if r["value"]}


MONEY = {"income_per_capita_monthly", "grdp_per_capita", "labour_productivity", "tourism_travel_turnover"}   # VND: need that year's rate


# series file → (lens id, converter(value, year) → lens units); converters use fx(year) for VND money.
def _lens_map(fx):
    usd = lambda vnd, y: vnd / fx(y)   # callers skip years fx() returns None for
    return {
        "income_per_capita_monthly": ("income", lambda v, y: usd(v * 1000 * 12, y)),
        "grdp_per_capita": ("gdp_pc", lambda v, y: usd(v * 1e6, y)),
        "labour_productivity": ("productivity", lambda v, y: usd(v * 1e6, y)),
        "poverty_rate_multidimensional": ("poverty", lambda v, y: v / 100),
        "gini": ("gini", lambda v, y: v),
        "unemployment_rate": ("unemployment", lambda v, y: v / 100),
        "internet_users": ("internet", lambda v, y: v / 100),
        "hygienic_water_share": ("clean_water", lambda v, y: v / 100),
        "trained_labour_share": ("trained", lambda v, y: v / 100),
        "it_skills_share": ("it_skills", lambda v, y: v / 100),
        "hdi": ("hdi", lambda v, y: v),
        "pci": ("pci", lambda v, y: v),
        # phase D themes (ext_themes.py): same units as the lens
        "life_expectancy": ("life_expectancy", lambda v, y: v),
        "crude_birth_rate": ("crude_birth_rate", lambda v, y: v),
        "total_fertility_rate": ("total_fertility_rate", lambda v, y: v),
        "net_migration_rate": ("net_migration_rate", lambda v, y: v),
        "fishery_production": ("fishery_production", lambda v, y: v),
        "tourism_travel_turnover": ("tourism_travel_turnover", lambda v, y: usd(v * 1e9, y)),
    }


def read_series(fx):
    """{indicator: {"unit": str, "source": str, "lens": id|None, "levels": {"63"|"34": {key: {year: value}}}}}
    Values are as published; `lens_values` holds the same series converted to its lens's units (USD at each year's
    World Bank rate, % → fraction)."""
    out = {}
    d = STATS / "series"
    if not d.exists():
        return out
    olds = {u["name"]: u["iso"] for u in old_units()}
    news = {name: abbr for name, (abbr, _) in NEW.items()}
    news.update({fold(n): a for n, a in list(news.items())})
    lens_of = _lens_map(fx)
    # NSO series, plus PCI (VCCI, not an NSO series: kept apart from data/stats/series/)
    for stem, f in [(f.stem, f) for f in sorted(d.glob("*.csv"))] + [("pci", STATS / "pci_series.csv")]:
        rows = list(csv.DictReader(open(f, encoding="utf-8")))
        if not rows:
            continue
        lens, conv = lens_of.get(stem, (None, None))
        s = out.setdefault(stem, {"unit": rows[0].get("unit", ""), "source": rows[0].get("source_url", ""),
                                    "lens": lens, "levels": {}, "lens_values": {} if lens else None, "status": {},
                                    "status_levels": {}, "note": BREAKS.get(stem)})
        for r in rows:
            lvl = r["level"]
            name = NAME_FIX.get(r["province_std"], r["province_std"])
            key = olds.get(name) if lvl == "63" else news.get(name) or news.get(fold(name))
            year = str(r["year"])[:4]
            if not key or r["value"] in ("", None) or not year.isdigit():
                continue
            v = float(r["value"])
            s["levels"].setdefault(lvl, {}).setdefault(key, {})[year] = v
            if conv and (stem not in MONEY or fx(int(year)) is not None):
                s["lens_values"].setdefault(lvl, {}).setdefault(key, {})[year] = round(conv(v, int(year)), 6)
            if r.get("status"):
                s["status_levels"].setdefault(lvl, {})[year] = r["status"]
    # "status" (what the timeline shows) is the status of the level it draws: the lens's own level when it has the
    # year, else the other one (HDI 2024 is preliminary for the 63 former provinces, final for the 34)
    levels = {l["id"]: str(l.get("level") or "63")
              for l in json.loads((ROOT / "web" / "data" / "lenses.json").read_text())["lenses"]}
    for s in out.values():
        pref = levels.get(s["lens"], "63")
        order = [pref, "34" if pref == "63" else "63"]
        sl = s["status_levels"]
        s["status"] = {y: next(sl[l][y] for l in order if y in sl.get(l, {})) for y in sorted({y for v in sl.values() for y in v})}
    return out


def build():
    W = World()
    st = load_interim("_stats")["rows"]
    rates = fx_by_year()
    fx_used = {}

    def fx(year):  # that year's World Bank rate, else the latest earlier one (recorded in fx_used); None before the
        # first published rate (a later year's rate would misstate it), so that year gets no USD lens value
        if year < min(rates):
            return None
        y = max(k for k in rates if k <= year)
        fx_used[str(year)] = y
        return rates[y]

    series = read_series(fx)
    # population (63 former provinces, people), the same series the cities use (PX average population 2019–2025)
    pop = {iso: dict(sorted((r.get("pop_series") or {}).items())) for iso, r in st.items()}
    # 2010-2018 from the same PX-Web table (data/stats/series/population.csv, thousand persons), years the cities' series lacks
    for iso, ys in (series.get("population", {}).get("levels", {}).get("63") or {}).items():
        for y, v in ys.items():
            if iso in pop and y not in pop[iso]:
                pop[iso][y] = round(v * 1000)
    pop = {iso: dict(sorted(v.items())) for iso, v in pop.items()}
    series["population"] = {"unit": "people", "source": "NSO PX-Web V02.03-07", "lens": None, "note": BREAKS["population"],
                            "levels": {"63": pop}, "lens_values": None, "status": {}}
    years = sorted({int(y) for s in series.values() for lv in s["levels"].values() for v in lv.values() for y in v
                    if int(y) >= FIRST_YEAR})

    storms = load_interim("_storms")["storms"]
    storm_list = [{"name": s["name"].title() if s["name"] != "NOT_NAMED" else None, "season": s["season"],
                   "date": s["first"], "max_kt": s["max_kt"], "cells": sorted(s["cells"])}
                  for s in sorted(storms.values(), key=lambda s: s["first"])]
    wonders = json.loads((ROOT / "web" / "data" / "wonders.json").read_text())["wonders"]
    events = list(EVENTS) + [
        {"date": w["metrics"].get("inscribed_date") or str(w["metrics"]["inscribed"]), "id": f"unesco_{w['id']}", "title": "UNESCO World Heritage",
         "text": w["name"], "wonder": w["id"], "source": "wikidata" if w["metrics"].get("inscribed_date") else None}
        for w in wonders if w["rule"] == "world_heritage" and w["metrics"].get("inscribed")]
    events.sort(key=lambda e: e["date"])
    last_year = max(years + [s["season"] for s in storm_list])
    dis = json.loads((ROOT / "web" / "data" / "disasters.json").read_text())["typhoons"]
    write_web("timeline.json", {
        "version": 1, "sources": ["nso_yearbook", "ibtracs", "wikidata"],
        "provisional_seasons": dis.get("provisional_seasons", []),  # IBTrACS provisional tracks (TRACK_TYPE), may change
        "years": list(range(min(years or [FIRST_YEAR]), last_year + 1)),
        "fx": {str(k): round(v, 2) for k, v in rates.items()},
        "fx_used": fx_used,  # year → the year whose rate converted it (a missing rate uses the latest earlier one)
        "merger": {"date": "2025-07-01", "before": "63", "after": "34"},
        "series": series, "storms": storm_list, "events": events,
        "note": "Values are shown only for years the source publishes; a missing year stays empty (no interpolation).",
    })
    print(f"    {len(series)} series ({', '.join(sorted(series))}), {len(storm_list)} storms, {len(events)} events, "
          f"years {years[:1]}–{last_year}")
