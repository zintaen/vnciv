"""Checks on the commune statistics in web/data/communes.json ("stats" and each unit's area_km2, population, density)."""
import json
import unittest
from pathlib import Path

P = Path(__file__).resolve().parent.parent / "web" / "data" / "communes.json"


@unittest.skipUnless(P.exists(), "communes.json not built")
class TestCommuneStats(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = json.loads(P.read_text())
        cls.s = cls.d["stats"]
        cls.c = cls.d["communes"]

    def test_meta(self):
        s = self.s
        self.assertEqual(s["source"], "sapnhap_bando_official")
        self.assertIn("sapnhap_bando_official", self.d["sources"])
        self.assertEqual(s["population_year"], 2025)
        for r in s["resolutions"]:
            self.assertTrue(r["id"].startswith("Nghị quyết"), r)
            self.assertTrue(r["link"].startswith("https://vanban.chinhphu.vn/"), r)
        self.assertTrue(all(0 <= x["res"] < len(s["resolutions"]) for x in self.c))
        for k in ("as_of", "basis", "rules", "reasons", "fields"):
            self.assertTrue(s[k], k)
        for k in ("area_km2", "population", "density", "null_reason", "a"):
            self.assertIn(k, s["fields"])

    def test_every_unit_has_values_or_a_reason(self):
        self.assertEqual(len(self.c), 3321)
        for x in self.c:
            for f in ("area_km2", "population", "density"):
                self.assertIn(f, x, x["n"])
            missing = any(x[f] is None for f in ("area_km2", "population", "density"))
            self.assertEqual(missing, "null_reason" in x, x["n"])
            if missing:
                self.assertIn(x["null_reason"], self.s["reasons"], x["n"])

    def test_values(self):
        for x in self.c:
            if x["area_km2"] is not None:
                self.assertGreater(x["area_km2"], 0)
                self.assertLessEqual(max(x["area_km2"], x["a"]) / min(x["area_km2"], x["a"]), 1.5, x["n"])
            if x["population"] is not None:
                self.assertIsInstance(x["population"], int)
                self.assertIsNotNone(x["area_km2"], x["n"])
                self.assertGreater(x["population"], 0)
            if x["density"] is not None:
                self.assertAlmostEqual(x["density"], x["population"] / x["area_km2"], delta=0.06)
            else:
                self.assertIsNone(x["population"], x["n"])
        # the two archipelago zones never get an area (outlines enclose reefs and lagoons)
        reef = [x for x in self.c if x["k"] == 2 and x["n"] in ("Trường Sa", "Hoàng Sa")]
        self.assertEqual([x["null_reason"] for x in reef], ["reef", "reef"])

    def test_counts(self):
        n = self.s["count"]
        self.assertEqual(n["units"], 3321)
        self.assertEqual(n["area_km2"], sum(x["area_km2"] is not None for x in self.c))
        self.assertEqual(n["population"], sum(x["population"] is not None for x in self.c))
        self.assertEqual(sum(n["by_reason"].values()), sum("null_reason" in x for x in self.c))
        # most units have figures (a drop means the source or the checks changed: look before relaxing)
        self.assertGreater(n["area_km2"], 3250)
        self.assertGreater(n["population"], 3250)

    def test_province_sums(self):
        """Against the map's own 'Dân số 2025' per province: where every unit has a population the sum is within 5%;
        elsewhere the shown populations' share agrees within 20% with the shown units' share of WorldPop and the sum
        is at most 5% over the total."""
        bp = self.s["by_province"]
        self.assertEqual(len(bp), 34)
        for abbr, v in bp.items():
            got = sum(x["population"] or 0 for x in self.c if x["p"] == abbr)
            self.assertEqual(got, v["population_sum"], abbr)
            self.assertLessEqual(got, 1.05 * v["province_population_2025"], abbr)
            self.assertLessEqual(abs(v["ratio_vs_share"] - 1), 0.20, abbr)
            if v["with_population"] == v["units"]:
                self.assertLessEqual(abs(v["ratio"] - 1), 0.05, abbr)
        full = sum(v["with_population"] == v["units"] for v in bp.values())
        self.assertGreaterEqual(full, 24, "provinces with every unit's population")


if __name__ == "__main__":
    unittest.main()
