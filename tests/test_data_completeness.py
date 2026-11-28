"""Completeness of the NSO province statistics: every indicator x level (63 former / 34 provinces) x year 2019-2026.

`matrix()` counts the provinces each data/stats/series/<indicator>.csv has per level and year. Every cell short of a
full set (63 or 34) must be explained by KNOWN_GAPS (what NSO does not publish, and why); a KNOWN_GAPS entry that no
longer matches a gap fails too, so the list stays true. `python3 tests/test_data_completeness.py` writes the matrix to
data/stats/completeness.csv.
"""
import csv
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATS, DATA = ROOT / "data" / "stats", ROOT / "web" / "data"
YEARS = range(2019, 2027)
FULL = {"63": 63, "34": 34}
ALL = "*"
ENTERPRISE_63 = ("active_enterprises", "new_enterprises", "cooperatives", "enterprise_employees", "enterprise_monthly_wage",
                 "enterprise_net_turnover", "enterprise_profit", "enterprises_with_results", "household_businesses",
                 "household_business_workers", "housing_floor_area_built", "enterprises_per_1000")
ONLY_34 = ("markets", "supermarkets", "shopping_centres", "health_insurance_coverage", "social_insurance_coverage",
           "unemployment_insurance_coverage", "orange_production", "tea_production", "shrimp_aquaculture")
TIC = ("internet_users", "internet_households", "mobile_phone_users", "social_network_users", "it_skills_share")

# (indicators or ALL, level or ALL, years, fewest provinces allowed (0 = none), reason)
KNOWN_GAPS = [
    (ALL, ALL, [2026], 0, "Annual province values for 2026 appear in the 2026 yearbook (mid-2027); the newest 2026 "
     "figures are the 34-province period estimates in data/stats/p34_2026 (GRDP growth 9M2026, industrial jobs 1/10/2026)."),
    (ALL, "34", [2019], 0, "NSO back-casts the 34 provinces only from 2020 (the 2025 yearbook appendix starts at 2020)."),
    (ENTERPRISE_63, "63", [2025], 0, "The 2025 yearbook's 63-province enterprise, cooperative, household-business and "
     "housing tables stop at 2024 (31/12/2024), and PX-Web too; 2025 is published for the 34 provinces only."),
    (("cooperatives", "enterprise_employees", "enterprise_monthly_wage", "enterprise_net_turnover", "enterprise_profit",
      "enterprises_with_results", "household_businesses", "household_business_workers", "housing_floor_area_built"),
     "34", [2025], 0, "The appendix tables for these stop at 2024."),
    (("enterprises_per_1000",), "63", [2019, 2020], 0, "PX-Web V05.05 is inconsistent for 2017-2020 (Bắc Ninh and "
     "Quảng Ninh differ from V05.04 enterprises / V02.03 population), so those years are not used."),
    (("hdi", "fdi_projects", "fdi_registered_capital", "literacy_rate_15plus"), "63", [2025], 0,
     "Since 2025 NSO publishes HDI and FDI only for the 34 provinces; literacy has no 2025 by-province table."),
    (("divorces",), ALL, [2019, 2020, 2021, 2022, 2023], 0, "PX-Web V02.31 counts about 26-32 thousand divorces a year "
     "nationally for 2019-2023 and 182 thousand for 2024 (as the 2025 yearbook): a scope change, so the earlier years "
     "are not combined; the yearbooks have no other by-province divorce table."),
    (("divorces",), "63", [2025], 0, "2025 divorces are published for the 34 provinces only."),
    (("electricity_households",), ALL, [2019, 2021, 2023, 2025], 0, "From the Household Living Standards Survey "
     "module asked every two years (2016-2024, even years)."),
    (("fdi_projects", "fdi_registered_capital"), "34", [2020, 2021, 2022, 2023, 2024], 0,
     "The appendix FDI table is for 2025 only."),
    (("fdi_projects", "fdi_registered_capital"), ALL, list(range(2019, 2026)), 1, "Provinces with no project licensed "
     "that year have no row (none licensed); a blank project count with capital means supplementary capital only."),
    (("income_per_capita_monthly",), "34", [2020, 2021, 2022, 2023, 2024], 0,
     "The appendix income table is for 2025 only."),
    (("income_quintile_ratio",), ALL, [2019, 2020, 2021, 2022, 2023, 2024], 0, "The top/bottom quintile ratio by "
     "province is printed only in the 2025 yearbook (2025); older editions print quintile incomes, not the ratio."),
    (("industrial_production_index",), "34", [2020, 2021, 2022, 2023, 2024], 0,
     "The appendix index of industrial production is for 2025 only."),
    (TIC, ALL, [2019, 2020, 2021, 2022, 2023], 0, "NSO's ICT-use indicators by province start in 2024."),
    (("literacy_rate_15plus",), "34", list(range(2019, 2026)), 0, "No literacy table for the 34 provinces."),
    (ONLY_34, "63", list(range(2019, 2026)), 0, "Published only for the 34 provinces (2025 yearbook appendix)."),
    (("orange_production", "tea_production"), "34", list(range(2020, 2026)), 9,
     "The appendix lists the main producing provinces only."),
    (("shrimp_aquaculture",), "34", list(range(2020, 2026)), 28, "Provinces without shrimp farming have no row."),
    (("shopping_centres",), "34", list(range(2020, 2026)), 32, "Provinces without a shopping centre have no row."),
    (("farms",), "63", [2019], 0, "The farm criteria changed in 2020 (Circular 27/2011/TT-BNNPTNT up to 2019, "
     "Circular 02/2020/TT-BNNPTNT from 2020; Statistical Yearbook 2023, p.582 footnote), so 2019 is not combined."),
    (("farms",), "63", list(range(2020, 2026)), 61, "Two former provinces have no farm row (no farms)."),
    (("farms",), "34", list(range(2020, 2026)), 33, "One province has no farm row (no farms)."),
    (("sugarcane_production",), "63", list(range(2019, 2025)), 61, "Two former provinces grow no sugarcane (no row)."),
    (("sugarcane_production",), "63", [2025], 59, "Also Bến Tre and Hưng Yên: their 2025 rows have blank cells "
     "that the text extraction cannot place (0.0-0.3 thousand t in 2022-2024)."),
    (("tourism_travel_turnover",), "63", list(range(2019, 2026)), 60, "Blank cells in the yearbook: Điện Biên 2019, "
     "Hòa Bình 2022-2025, Bắc Kạn 2025."),
]
# Newest period of each 2026 estimate (NSO monthly reports): the October 2026 report (published November 2026) is
# the latest as of 28 November 2026; provincial GRDP is quarterly (Q3 / 9 months in the September report).
LATEST_2026 = {"grdp_growth_9M2026.csv": "9M2026 (est.)", "industrial_employment_index_Oct2026.csv": "2026-10-01 (est.)"}
# series years whose table prints no national row ("CẢ NƯỚC")
NO_NATIONAL = {("grdp_growth", 2019), ("grdp_per_capita", 2019), ("housing_floor_area_built", 2019),
               ("in_migration_rate", 2019), ("out_migration_rate", 2019), ("tourism_travel_turnover", 2019),
               ("income_quintile_ratio", 2025)} | {("net_migration_rate", y) for y in range(2019, 2026)}


def read(path):
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def matrix():
    """{(indicator, level, year): number of provinces with a value}."""
    out = {}
    for f in sorted((STATS / "series").glob("*.csv")):
        cells = {(f.stem, lv, y): 0 for lv in FULL for y in YEARS}
        for r in read(f):
            k = (f.stem, r["level"], int(r["year"]))
            if k in cells and r["value"] not in ("", None):
                cells[k] += 1
        out.update(cells)
    return out


def explain(ind, lv, y, n):
    for inds, lvl, years, least, why in KNOWN_GAPS:
        if (inds == ALL or ind in inds) and lvl in (ALL, lv) and y in years and n >= least:
            return why
    return None


def write_matrix(path=STATS / "completeness.csv"):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["indicator", "level", "year", "provinces", "of", "status", "reason"])
        for (ind, lv, y), n in sorted(matrix().items()):
            full = FULL[lv]
            w.writerow([ind, lv, y, n, full, "complete" if n == full else "gap", "" if n == full else explain(ind, lv, y, n) or "UNEXPLAINED"])


class TestCompleteness(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = matrix()

    def test_every_gap_is_known(self):
        bad = [(k, n) for k, n in self.m.items() if n < FULL[k[1]] and not explain(*k, n)]
        self.assertEqual(bad, [], "gaps NSO may publish (find the source or add a KNOWN_GAPS reason)")

    def test_no_stale_known_gap(self):
        used = set()
        for k, n in self.m.items():
            if n < FULL[k[1]]:
                for i, (inds, lvl, years, least, _) in enumerate(KNOWN_GAPS):
                    if (inds == ALL or k[0] in inds) and lvl in (ALL, k[1]) and k[2] in years and n >= least:
                        used.add(i); break
        self.assertEqual(sorted(set(range(len(KNOWN_GAPS))) - used), [], "KNOWN_GAPS entries that explain nothing")

    def test_no_province_twice_and_counts_bounded(self):
        for f in (STATS / "series").glob("*.csv"):
            keys = [(r["province_std"], r["level"], r["year"]) for r in read(f)]
            self.assertEqual(len(keys), len(set(keys)), f.stem)
        self.assertTrue(all(n <= FULL[k[1]] for k, n in self.m.items()))

    def test_every_row_cites_a_downloaded_source(self):
        for f in (STATS / "series").glob("*.csv"):
            for r in read(f):
                self.assertRegex(r["source_url"], r"^https://(www|pxweb)\.nso\.gov\.vn/.+(p\.\d+|PX-Web V[\d.-]+, )", f.stem)
                self.assertIn(r["status"], ("final", "prel", "est"), f.stem)

    def test_units_consistent_across_years(self):
        # one unit per series and level (a thousand-vs-million or %-vs-fraction mix would show as two units or a jump)
        for f in (STATS / "series").glob("*.csv"):
            units = {}
            for r in read(f):
                units.setdefault(r["level"], set()).add(r["unit"].split(" (DERIVED")[0])
            for lv, u in units.items():
                self.assertEqual(len(u), 1, (f.stem, lv, u))

    def test_no_unit_jump_between_years(self):
        # median year-on-year ratio per series: COVID-19 tourism (2020-2022) and the 2024 migration tables move a lot,
        # a unit slip (x1000) would move far more
        T = json.loads((DATA / "timeline.json").read_text())
        for k, s in T["series"].items():
            for lv, d in s["levels"].items():
                ys = sorted({y for v in d.values() for y in v})
                for a, b in zip(ys, ys[1:]):
                    r = sorted(v[b] / v[a] for v in d.values() if v.get(a) and v.get(b) is not None)
                    if r:
                        self.assertTrue(0.15 < r[len(r) // 2] < 7, (k, lv, a, b, r[len(r) // 2]))

    def test_timeline_covers_every_year_with_data(self):
        T = json.loads((DATA / "timeline.json").read_text())
        have = {int(y) for s in T["series"].values() for lv in s["levels"].values() for v in lv.values() for y in v}
        self.assertTrue({y for y in have if y >= 2019} <= set(T["years"]))
        for f in (STATS / "series").glob("*.csv"):
            self.assertIn(f.stem, T["series"])
        # USD lens values only where the World Bank has that year's (or, for 2025, the previous) rate
        first = min(int(y) for y in T["fx"])
        for k in ("income_per_capita_monthly", "grdp_per_capita", "labour_productivity"):
            lv = T["series"][k]["lens_values"]
            self.assertFalse(any(int(y) < first for d in lv.values() for v in d.values() for y in v), k)

    def test_labour_break_noted(self):
        T = json.loads((DATA / "timeline.json").read_text())
        for k in ("labour_force", "employed_workers", "unemployment_rate", "trained_labour_share", "informal_employment_rate"):
            self.assertIn("ICLS19", T["series"][k].get("note") or "", k)

    def test_nation_has_every_series_year(self):
        nat = json.loads((DATA / "nation.json").read_text())["series"]
        for (ind, lv, y), n in self.m.items():
            if n and y <= 2025 and (ind, y) not in NO_NATIONAL:
                self.assertIn(str(y), nat.get(ind, {}).get("values", {}), (ind, y))

    def test_latest_2026_period(self):
        for f, label in LATEST_2026.items():
            rows = list(read(STATS / "p34_2026" / f))
            self.assertEqual(len(rows), 34, f)
            self.assertEqual({r["year"] for r in rows}, {label}, f)
        years = json.loads((DATA / "states.json").read_text())[0]["years"]
        self.assertEqual((years["growth_9m2026"], years["industry_jobs_2026"]), ("9M2026", "2026-10-01"))

    def test_growth_years(self):
        nation = json.loads((DATA / "nation.json").read_text())["nation"]
        self.assertEqual(nation["growth_years"], [2019, 2025])
        self.assertEqual(sorted(nation["pop_series"])[0], "2019")

    def test_farms_definition_break_not_combined(self):
        # the 2019-2023 yearbooks count 2019 farms under Circular 27/2011 and 2020 on under Circular 02/2020 (p.582
        # footnote of the 2023 edition): 31,908 -> 23,680 farms; the 2019 column must not be spliced onto the series
        self.assertFalse([r for r in read(STATS / "series" / "farms.csv") if r["year"] == "2019"])
        nat = json.loads((DATA / "nation.json").read_text())["series"]["farms"]["values"]
        self.assertNotIn("2019", nat)
        self.assertNotIn("2019", {y for d in json.loads((DATA / "timeline.json").read_text())["series"]["farms"]["levels"].values()
                                  for v in d.values() for y in v})

    def test_derived_34_sums(self):
        # the 34-province rice/cereal rows are the sums of their former provinces (appendix rows are swapped)
        import sys
        sys.path.insert(0, str(ROOT / "pipeline")); sys.path.insert(0, str(ROOT / "pipeline" / "nso"))
        from admin import NEW
        from names import std
        new_of = {std(o.replace("–", " - ")): n for n, (_, olds) in NEW.items() for o in olds}
        for f in ("cereal_production", "paddy_area", "paddy_production"):
            rows = list(read(STATS / "series" / f"{f}.csv"))
            for y in {r["year"] for r in rows}:
                s = {}
                for r in rows:
                    if r["level"] == "63" and r["year"] == y:
                        s[new_of[r["province_std"]]] = s.get(new_of[r["province_std"]], 0) + float(r["value"])
                for r in rows:
                    if r["level"] == "34" and r["year"] == y:
                        self.assertAlmostEqual(float(r["value"]), s[r["province_std"]], delta=0.11, msg=(f, y, r["province_std"]))


if __name__ == "__main__":
    write_matrix()
    gaps = [r for r in read(STATS / "completeness.csv") if r["status"] == "gap"]
    print(f"wrote data/stats/completeness.csv: {len(gaps)} gap cells, {sum(r['reason'] == 'UNEXPLAINED' for r in gaps)} unexplained")
