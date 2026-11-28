"""Series back to 2010 (series2010 stream): the 2010-2018 yearbooks, PX-Web's earlier years and the World Bank rates."""
import csv
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATS, DATA = ROOT / "data" / "stats", ROOT / "web" / "data"
sys.path.insert(0, str(ROOT / "pipeline" / "nso"))


def rows(name):
    with open(STATS / "series" / f"{name}.csv", encoding="utf-8") as f:
        return [r for r in csv.DictReader(f) if r["level"] == "63"]


class TestSeries2010(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.T = json.loads((DATA / "timeline.json").read_text())

    def test_tcvn3(self):
        from tcvn3 import line, page
        self.assertEqual(line("§µ N½ng 385,6"), "Đà Nẵng 385,6")
        self.assertEqual(line("Đà Nẵng 3,4"), "Đà Nẵng 3,4")   # Unicode lines stay
        self.assertEqual(page(["Hµ Néi 1,0", "Thanh Hãa 2,0"]), ["Hà Nội 1,0", "Thanh Hóa 2,0"])

    def test_years_start_2010(self):
        self.assertEqual(self.T["years"][0], 2010)
        self.assertEqual(self.T["merger"]["before"], "63")

    def test_old_years_cite_an_old_edition_or_px(self):
        for f in (STATS / "series").glob("*.csv"):
            for r in rows(f.stem):
                if int(r["year"]) < 2019 and "derived" not in r["unit"].lower():
                    self.assertRegex(r["source_url"], r"(Statistical Yearbook 20(1\d|2[0-4]), table p\.\d+|PX-Web V|Part I, table p\.\d+)", (f.stem, r["year"]))

    def test_biennial_survey_years_stay_biennial(self):
        for name in ("income_per_capita_monthly", "electricity_households"):
            self.assertFalse({int(r["year"]) for r in rows(name) if int(r["year"]) < 2019} & {2011, 2013, 2015, 2017}, name)

    def test_revised_series_not_spliced(self):
        # the 2021 yearbook revised livestock from 2015: the older editions' 2016-2017 must not appear
        for name in ("cattle", "pigs", "poultry", "buffalo"):
            self.assertFalse({r["year"] for r in rows(name)} & {"2016", "2017", "2014"}, name)

    def test_breaks_noted(self):
        s = self.T["series"]
        self.assertIn("2022-2025 standard", s["poverty_rate_multidimensional"]["note"])
        self.assertIn("Income poverty, not multidimensional", s["poverty_rate_income"]["note"])

    def test_poverty_split(self):
        # the poverty lens (and its fixed colour domain) holds the multidimensional years only; income poverty has no lens
        s = self.T["series"]
        ys = lambda d: {int(y) for lv in d.values() for v in lv.values() for y in v}
        self.assertEqual(min(ys(s["poverty_rate_multidimensional"]["lens_values"])), 2016)
        self.assertEqual(min(ys(s["poverty_rate_multidimensional"]["levels"])), 2016)
        self.assertEqual(ys(s["poverty_rate_income"]["levels"]), set(range(2010, 2016)))
        self.assertIsNone(s["poverty_rate_income"]["lens"])
        for r in rows("poverty_rate_income"):
            self.assertRegex(r["source_url"], r"Statistical Yearbook 201\d, table p\.\d+")
        self.assertIn("every two years", s["income_per_capita_monthly"]["note"])
        self.assertIn("2010-2018 are NSO's revised figures", s["population"]["note"])

    def test_usd_from_each_years_rate(self):
        fx = {int(k): v for k, v in self.T["fx"].items()}
        self.assertTrue(all(y in fx for y in range(2010, 2025)))
        inc = self.T["series"]["income_per_capita_monthly"]
        k = next(iter(inc["levels"]["63"]))
        v = inc["levels"]["63"][k]["2010"]
        self.assertAlmostEqual(inc["lens_values"]["63"][k]["2010"], v * 1000 * 12 / fx[2010], delta=0.01)

    def test_population_2010_from_px(self):
        pop = self.T["series"]["population"]["levels"]["63"]
        px = {r["province_std"]: float(r["value"]) for r in rows("population") if r["year"] == "2010"}
        self.assertEqual(len(px), 63)
        self.assertAlmostEqual(sum(v["2010"] for v in pop.values()), sum(px.values()) * 1000, delta=63)


if __name__ == "__main__":
    unittest.main()
