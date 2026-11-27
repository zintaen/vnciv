"""timeline.json: what the map can show year by year.

* series: per-province values by year, from data/stats/series/*.csv (long format: province_std, level 63|34, year,
  value, unit, source_url) plus the population series (NSO average population 2019–2025). Missing years stay missing.
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
FIRST_YEAR = 2019
NAME_FIX = {"Bà Rịa - Vũng Tàu": "Bà Rịa–Vũng Tàu"}
EVENTS = [
    {"date": "2025-07-01", "id": "merger_2025", "title": "34 provinces from 1 July 2025",
     "text": "Resolution 202/2025/QH15 merged Vietnam's 63 provinces and centrally-run cities into 34; district-level "
             "government was abolished. Statistics before mid-2025 are published for the 63 former provinces."},
]


def fx_by_year():
    d = json.loads((STATS / "wb_fx.json").read_text())
    return {int(r["date"]): r["value"] for r in d[1] if r["value"]}


# series file → (lens id, converter(value, year) → lens units); converters use fx(year) for VND money.
def _lens_map(fx):
    usd = lambda vnd, y: vnd / fx(y)
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
    for f in sorted(d.glob("*.csv")):
        rows = list(csv.DictReader(open(f, encoding="utf-8")))
        if not rows:
            continue
        lens, conv = lens_of.get(f.stem, (None, None))
        s = out.setdefault(f.stem, {"unit": rows[0].get("unit", ""), "source": rows[0].get("source_url", ""),
                                    "lens": lens, "levels": {}, "lens_values": {} if lens else None, "status": {}})
        for r in rows:
            lvl = r["level"]
            name = NAME_FIX.get(r["province_std"], r["province_std"])
            key = olds.get(name) if lvl == "63" else news.get(name) or news.get(fold(name))
            year = str(r["year"])[:4]
            if not key or r["value"] in ("", None) or not year.isdigit():
                continue
            v = float(r["value"])
            s["levels"].setdefault(lvl, {}).setdefault(key, {})[year] = v
            if conv:
                s["lens_values"].setdefault(lvl, {}).setdefault(key, {})[year] = round(conv(v, int(year)), 6)
            if r.get("status"):
                s["status"][year] = r["status"]
    return out


def build():
    W = World()
    st = load_interim("_stats")["rows"]
    rates = fx_by_year()
    fx_used = {}

    def fx(year):  # that year's World Bank rate, else the latest earlier one (recorded in fx_used)
        y = max((k for k in rates if k <= year), default=min(rates))
        fx_used[str(year)] = y
        return rates[y]

    series = read_series(fx)
    # population (63 former provinces, people), the same series the cities use (PX average population 2019–2025)
    pop = {iso: dict(sorted((r.get("pop_series") or {}).items())) for iso, r in st.items()}
    series["population"] = {"unit": "people", "source": "NSO PX-Web V02.03-07", "lens": None,
                            "levels": {"63": pop}, "lens_values": None, "status": {}}
    years = sorted({int(y) for s in series.values() for lv in s["levels"].values() for v in lv.values() for y in v
                    if int(y) >= FIRST_YEAR})

    storms = load_interim("_storms")["storms"]
    storm_list = [{"name": s["name"].title() if s["name"] != "NOT_NAMED" else None, "season": s["season"],
                   "date": s["first"], "max_kt": s["max_kt"], "cells": sorted(s["cells"])}
                  for s in sorted(storms.values(), key=lambda s: s["first"])]
    wonders = json.loads((ROOT / "web" / "data" / "wonders.json").read_text())["wonders"]
    events = list(EVENTS) + [
        {"date": f"{w['metrics']['inscribed']}-07-01", "id": f"unesco_{w['id']}", "title": "UNESCO World Heritage",
         "text": w["name"], "wonder": w["id"]}
        for w in wonders if w["rule"] == "world_heritage" and w["metrics"].get("inscribed")]
    events.sort(key=lambda e: e["date"])
    last_year = max(years + [s["season"] for s in storm_list])
    write_web("timeline.json", {
        "version": 1, "sources": ["nso_yearbook", "ibtracs", "wikidata"],
        "years": list(range(min(years or [FIRST_YEAR]), last_year + 1)),
        "fx": {str(k): round(v, 2) for k, v in rates.items()},
        "fx_used": fx_used,  # year → the year whose rate converted it (a missing rate uses the latest earlier one)
        "merger": {"date": "2025-07-01", "before": "63", "after": "34"},
        "series": series, "storms": storm_list, "events": events,
        "note": "Values are shown only for years the source publishes; a missing year stays empty (no interpolation).",
    })
    print(f"    {len(series)} series ({', '.join(sorted(series))}), {len(storm_list)} storms, {len(events)} events, "
          f"years {years[:1]}–{last_year}")
