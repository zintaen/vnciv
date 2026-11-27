"""Checks on the environment stream's files: lenses (ranges, coverage), forest_loss.json, sealevel.json, sizes."""
import gzip
import json
import unittest
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "web" / "data"


def load(name):
    p = DATA / f"{name}.json"
    return json.loads(p.read_text()) if p.exists() else None


@unittest.skipUnless((DATA / "sealevel.json").exists() and (DATA / "forest_loss.json").exists(), "env not built")
class TestEnv(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world = load("world")
        cls.n = cls.world["grid"]["cols"] * cls.world["grid"]["rows"]
        cls.land = [i for i, o in enumerate(cls.world["owner"]) if o >= 0]
        cls.lenses = {l["id"]: l for l in load("lenses")["lenses"]}
        cls.forest, cls.sea = load("forest_loss"), load("sealevel")

    def test_lenses(self):
        ranges = {"rainfall": (500, 6000, 0.97), "temperature": (0, 32, 0.97), "hot_month": (10, 42, 0.97),
                  "cold_month": (-8, 26, 0.97), "forest_loss": (0, 1, 0.5), "low_lying": (0, 1, 0.97)}
        self.assertIn("environment", {g["id"] for g in load("lenses")["groups"]})
        for lid, (lo, hi, cover) in ranges.items():
            l = self.lenses[lid]
            self.assertEqual(l["group"], "environment")
            self.assertEqual(len(l["values"]), self.n, lid)
            self.assertEqual(len(l["ramp"]), 6)
            self.assertTrue(all(c.startswith("#") for c in l["ramp"]))
            vals = [l["values"][i] for i in self.land]
            got = [v for v in vals if v is not None]
            self.assertGreaterEqual(len(got) / len(self.land), cover, f"{lid} coverage")
            self.assertTrue(all(lo <= v <= hi for v in got), f"{lid} out of range")
            water = [l["values"][i] for i, o in enumerate(self.world["owner"]) if o < 0]
            self.assertTrue(all(v is None for v in water), f"{lid} has values on water")
        t, r = self.lenses["temperature"]["values"], self.lenses["hot_month"]["values"]
        c = self.lenses["cold_month"]["values"]
        self.assertTrue(all(c[i] <= t[i] <= r[i] for i in self.land if None not in (c[i], t[i], r[i])))

    def test_forest_loss(self):
        f = self.forest
        k = len(f["cells"])
        self.assertEqual(f["years"], list(range(2001, 2026)))
        self.assertEqual(len(f["loss_ha"]), 25)
        self.assertTrue(all(len(y) == k for y in f["loss_ha"]))
        land = set(self.land)
        self.assertTrue(all(c in land for c in f["cells"]))
        for j in range(k):
            tot = sum(y[j] for y in f["loss_ha"])
            self.assertLessEqual(tot, f["forest2000_ha"][j] + 1)
            self.assertEqual(f["peak_year"][j] is None, tot == 0)
        self.assertEqual(len(f["provinces"]), 34)
        nat = f["national"]
        self.assertLessEqual(abs(sum(p["forest2000_ha"] for p in f["provinces"]) - nat["forest2000_ha"]), 34)  # rounding
        self.assertTrue(0 < sum(nat["loss_ha"]) < nat["forest2000_ha"])

    def test_sealevel(self):
        s = self.sea
        self.assertEqual(s["levels"], [0.5, 1, 2, 3])
        k = len(s["cells"])
        self.assertTrue(k > 0 and len(s["land_pct"]) == k and all(len(x) == k for x in s["share"]))
        land = set(self.land)
        remote = set(self.world["remote"])
        self.assertTrue(all(c in land and c not in remote for c in s["cells"]))
        for j in range(k):
            col = [x[j] for x in s["share"]]
            self.assertEqual(col, sorted(col), "share grows with the level")
            self.assertTrue(0 <= col[0] and col[-1] <= 100 and col[-1] > 0)
        self.assertIn("not a forecast", s["note"])

    def test_sizes(self):
        for name in ("forest_loss", "sealevel"):
            gz = len(gzip.compress((DATA / f"{name}.json").read_bytes()))
            self.assertLess(gz, 1_500_000, name)


if __name__ == "__main__":
    unittest.main()
