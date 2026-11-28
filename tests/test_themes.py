"""Invariants of the themes stream's lenses (pipeline/build/ext_themes.py) in web/data/lenses.json."""
import csv
import json
import re
import unittest
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web" / "data"
load = lambda n: json.loads((WEB / f"{n}.json").read_text(encoding="utf-8"))

# id: (group, value range, province lens?)
LENSES = {
    "life_expectancy": ("people", (60, 85), True),
    "ageing_index": ("people", (5, 200), True),
    "crude_birth_rate": ("people", (5, 35), True),
    "total_fertility_rate": ("people", (1, 4), True),
    "net_migration_rate": ("people", (-80, 80), True),
    "fishery_production": ("economy", (0, 5e6), True),
    "tourism_travel_turnover": ("economy", (0, 1e10), True),
    "disaster_deaths": ("hazards", (0, 5000), True),
    "elevation": ("land", (0, 3200), False),
    "slope": ("land", (0, 45), False),
    "pm25": ("environment", (1, 100), False),
}
ALLOWED_MISSING = {"tourism_travel_turnover": 0.03, "slope": 0.01, "pm25": 0.01}  # Bắc Kạn blank; coastal/island hexes


class TestThemes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        L = load("lenses")
        cls.groups = {g["id"] for g in L["groups"]}
        cls.ids = [l["id"] for l in L["lenses"]]
        cls.by = {l["id"]: l for l in L["lenses"] if l["id"] in LENSES}
        cls.w = load("world")
        cls.land = [i for i, o in enumerate(cls.w["owner"]) if o >= 0]
        cls.sources = {s["id"] for s in load("sources")}

    def test_present_once(self):
        self.assertEqual(set(self.by), set(LENSES))
        self.assertEqual(len(self.ids), len(set(self.ids)), "duplicate lens ids")

    def test_shape(self):
        n = len(self.w["owner"])
        for lid, l in self.by.items():
            grp, _, prov = LENSES[lid]
            self.assertEqual(l["group"], grp)
            self.assertIn(grp, self.groups)
            self.assertEqual(len(l["values"]), n, lid)
            self.assertEqual(len(l["ramp"]), 6)
            self.assertTrue(all(re.fullmatch(r"#[0-9a-f]{6}", c) for c in l["ramp"]), lid)
            self.assertLess(l["domain"][0], l["domain"][1], lid)
            self.assertIn(l["source"], self.sources, lid)
            self.assertTrue(l["unit"] and l["description"] and l["note"], lid)
            if prov:
                self.assertTrue(l.get("year"), lid)
            if l["scale"] == "log":
                self.assertGreater(l["domain"][0], 0, lid)
            # no values on water or foreign hexes
            self.assertTrue(all(v is None for i, v in enumerate(l["values"]) if self.w["owner"][i] < 0), lid)

    def test_ranges_and_coverage(self):
        for lid, l in self.by.items():
            lo, hi = LENSES[lid][1]
            vals = [l["values"][i] for i in self.land]
            have = [v for v in vals if v is not None]
            self.assertTrue(all(lo <= v <= hi for v in have), (lid, min(have), max(have)))
            missing = 1 - len(have) / len(vals)
            self.assertLessEqual(missing, ALLOWED_MISSING.get(lid, 0), (lid, missing))

    def test_one_value_per_former_province(self):
        for lid, l in self.by.items():
            if not LENSES[lid][2]:
                continue
            seen = defaultdict(set)
            for i in self.land:
                seen[self.w["county"][i]].add(l["values"][i])
            self.assertTrue(all(len(s) == 1 for s in seen.values()), lid)
            self.assertGreaterEqual(len(seen), 63, lid)

    def test_matches_csv(self):
        """A hex's value is its former province's published figure."""
        from pipeline.nso.names import std
        iso_std = {c["geoid"]: std(c["name"]) for c in self.w["counties"]}
        for lid, path in (("life_expectancy", "2025/life_expectancy.csv"), ("ageing_index", "midcensus2024/ageing_index.csv"),
                          ("total_fertility_rate", "2025/total_fertility_rate.csv")):
            src = {r["province_std"]: float(r["value"]) for r in csv.DictReader(open(ROOT / "data/stats" / path, encoding="utf-8"))}
            for i in self.land[::97]:
                p = iso_std[self.w["counties"][self.w["county"][i]]["geoid"]]
                self.assertEqual(self.by[lid]["values"][i], src[p], (lid, p))

    def test_ageing_csv(self):
        rows = list(csv.DictReader(open(ROOT / "data/stats/midcensus2024/ageing_index.csv", encoding="utf-8")))
        self.assertEqual(len({r["province_std"] for r in rows}), 63)
        self.assertEqual(max(rows, key=lambda r: float(r["value"]))["province_std"], "Bến Tre")  # 100.1, Table 5

    def test_parser(self):
        from pipeline.build.ext_themes import parse_rows
        self.assertEqual(parse_rows("Hà Giang 102,9 97,0 104,1 62,3 33,3 61,6 5,0 24,9\nTrung du 1,0 2,0"),
                         [("Hà Giang", [102.9, 97.0, 104.1, 62.3, 33.3, 61.6, 5.0, 24.9])])

    def test_translated(self):
        vi = json.loads((ROOT / "tools/i18n/vi-data-themes.json").read_text(encoding="utf-8"))
        for l in self.by.values():
            for k in ("name", "unit", "description", "note"):
                self.assertTrue(vi.get(l[k]), (l["id"], k))


if __name__ == "__main__":
    unittest.main()
