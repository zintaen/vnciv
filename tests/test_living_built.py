"""Checks on web/data/living_built.json (GHSL built-up surface per hex, observed epochs 1975–2020)."""
import gzip
import json
import unittest
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "web" / "data"


@unittest.skipUnless((DATA / "living_built.json").exists(), "living_built not built")
class TestLivingBuilt(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = json.loads((DATA / "living_built.json").read_text())
        cls.owner = json.loads((DATA / "world.json").read_text())["owner"]

    def test_epochs_observed_only(self):
        self.assertEqual(self.d["epochs"], list(range(1975, 2021, 5)))

    def test_aligned_and_valid(self):
        d, ne = self.d, len(self.d["epochs"])
        self.assertEqual(len(d["cells"]), len(d["first"]))
        self.assertEqual(len(d["cells"]), len(d["share"]))
        self.assertEqual(d["cells"], sorted(set(d["cells"])))
        for c, f, s in zip(d["cells"], d["first"], d["share"]):
            self.assertGreaterEqual(self.owner[c], 0)
            self.assertTrue(-1 <= f < ne)
            self.assertEqual(len(s), ne)
            self.assertTrue(all(isinstance(v, int) and 0 <= v <= 100 for v in s))
            self.assertGreaterEqual(s[-1], 2)
            if f >= 0:  # first epoch at/over the threshold (whole-percent rounding may land on either side)
                self.assertGreaterEqual(s[f], d["threshold"] * 100 - 1)

    def test_hanoi_built_by_2020(self):
        hn = next(c for c in json.loads((DATA / "cities.json").read_text()) if c["id"] == "HN")
        i = self.d["cells"].index(hn["cell"])
        self.assertGreaterEqual(self.d["first"][i], 0)

    def test_size(self):
        self.assertLess(len(gzip.compress((DATA / "living_built.json").read_bytes())), 100_000)


if __name__ == "__main__":
    unittest.main()
