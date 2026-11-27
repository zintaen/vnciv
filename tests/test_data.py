"""Checks on the built web/data files: shapes, cell ranges, totals and cross-file ids (run after a build)."""
import json
import unittest
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "web" / "data"


def load(name):
    return json.loads((DATA / f"{name}.json").read_text())


class TestData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world, cls.cities, cls.states, cls.nation = load("world"), load("cities"), load("states"), load("nation")
        cls.n = cls.world["grid"]["cols"] * cls.world["grid"]["rows"]

    def land(self, c):
        return 0 <= c < self.n and self.world["owner"][c] >= 0

    def test_world_arrays(self):
        for k in ("owner", "county", "elev", "water", "relief", "cover"):
            self.assertEqual(len(self.world[k]), self.n, k)
        self.assertEqual(len(self.world["states"]), 34)
        self.assertEqual(len(self.world["counties"]), 63)
        owned = {o for o in self.world["owner"] if o >= 0}
        self.assertEqual(owned, set(range(34)), "every province owns hexes")
        self.assertTrue(all(self.land(c) for c in self.world["remote"]))

    def test_cities(self):
        self.assertEqual(len(self.cities), 63)
        self.assertEqual(len({c["cell"] for c in self.cities}), 63, "banner cells are unique")
        abbrs = {s["abbr"] for s in self.world["states"]}
        for c in self.cities:
            self.assertTrue(self.land(c["cell"]), c["name"])
            self.assertIn(c["cell"], c["footprint"])
            self.assertTrue(set(c["states"]) <= abbrs)
            self.assertGreater(c["gdp"], 0)
        self.assertEqual(sum(c["capital"] for c in self.cities), 1)
        pops = [c["population"] for c in self.cities]
        self.assertEqual(pops, sorted(pops, reverse=True))

    def test_totals_add_up(self):
        nat = self.nation["nation"]
        for k in ("population", "gdp", "employed"):
            self.assertAlmostEqual(sum(s[k] for s in self.states), nat[k], delta=nat[k] * 1e-6, msg=k)
            self.assertAlmostEqual(sum(c[k] for c in self.cities), nat[k], delta=nat[k] * 1e-6, msg=k)
        self.assertTrue(95e6 < nat["population"] < 110e6)

    def test_lenses(self):
        lenses = load("lenses")["lenses"]
        for l in lenses:
            self.assertEqual(len(l["values"]), self.n, l["id"])
            self.assertEqual(len(l["ramp"]), 6, l["id"])
            for i, v in enumerate(l["values"]):
                if v is not None:
                    self.assertGreaterEqual(self.world["owner"][i], 0, l["id"])

    def test_sites_on_land(self):
        infra, wonders, res = load("infrastructure"), load("wonders"), load("resources")
        ids = {c["id"] for c in self.cities}
        for it in infra["ports"] + infra["airports"] + wonders["wonders"] + res["items"]:
            self.assertTrue(self.land(it["cell"]), it.get("name"))
            self.assertIn(it["cbsa"], ids)
        for a, b, *_ in infra["roads"] + infra["rail"]:
            self.assertLess(a, b)

    def test_military_and_trade(self):
        mil, trade = load("military"), load("trade")
        ids = {c["id"] for c in self.cities}
        for it in mil["installations"]:
            self.assertTrue(self.land(it["cell"]), it["name"])
            self.assertIn(it["tier"], ("major", "base", "site"))
        for r in mil["ranges"]:
            self.assertTrue(r["cells"], r["name"])
        self.assertTrue(set(mil["cities"]) <= ids)
        zones = {z["id"] for z in trade["zones"]}
        for r in trade["routes"]:
            self.assertIn(r["a"], zones)
            self.assertIn(r["b"], zones)
            self.assertGreater(r["airlines"], 0)

    def test_city_keyed_files(self):
        ids = {c["id"] for c in self.cities}
        self.assertEqual(set(load("districts")["cities"]), ids)
        self.assertEqual(set(load("citizens")["cities"]), ids)
        counties = load("counties")
        self.assertEqual(len(counties["rows"]), 63)
        self.assertEqual([f["key"] for f in counties["fields"]], counties["columns"])


if __name__ == "__main__":
    unittest.main()
