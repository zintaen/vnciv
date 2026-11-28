"""Checks on geo.json and geo_rivers.json (stream geo): shapes, positions, thresholds, rules and sources."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "data"
KINDS = ("peaks", "passes", "lakes", "dams", "gates", "parks", "crafts", "battles", "festivals")


def load(name):
    p = DATA / f"{name}.json"
    return json.loads(p.read_text()) if p.exists() else None


class TestGeo(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.geo, cls.rivers, cls.world = load("geo"), load("geo_rivers"), load("world")
        if cls.geo is None or cls.rivers is None:
            raise unittest.SkipTest("geo.json / geo_rivers.json not built")
        from pipeline.sources import BY_ID
        cls.sources = BY_ID

    def test_points(self):
        d, W, H = self.geo, self.world["width"], self.world["height"]
        self.assertEqual(d["states"], [s["abbr"] for s in self.world["states"]])
        for k in KINDS:
            self.assertIn(k, d["rules"])
            self.assertEqual(d["counts"][k], len(d[k]))
            for s in d["sources"][k]:
                self.assertIn(s, self.sources, f"{k}: source {s} not registered")
            for r in d[k]:
                self.assertTrue(0 <= r["x"] <= W and 0 <= r["y"] <= H, r)
                self.assertTrue(0 <= r["p"] < len(d["states"]), r)
                self.assertTrue(r["n"], r)
        self.assertTrue(all(r["ele"] >= 1500 or r.get("wd") for r in d["peaks"]))
        self.assertTrue(all(r["km2"] >= 1 for r in d["lakes"]))
        self.assertTrue(all(r["ha"] >= 20 for r in d["parks"]))
        self.assertTrue(all(r["sl"] >= 4 for r in d["battles"]))
        self.assertTrue(all(1 <= r["month"] <= 12 and 1 <= r["day"] <= 30 and r["cal"] == "lunar" for r in d["festivals"]))
        self.assertTrue(all(r.get("cls") in (None, "intl", "main", "minor") for r in d["gates"]))

    def test_known_places(self):
        d = self.geo
        top = d["peaks"][0]
        self.assertIn("Phan Xi", top["n"])
        self.assertTrue(3100 <= top["ele"] <= 3160, top)
        self.assertTrue(any("Điện Biên Phủ" in r["n"] for r in d["battles"]))
        self.assertTrue(any("Hải Vân" in r["n"] for r in d["passes"]))

    def test_rivers(self):
        names = {s["name"] for s in self.world["rivers"]}
        rows = self.rivers["rivers"]
        self.assertGreater(len(rows), 30)
        self.assertEqual(len({r["name"] for r in rows}), len(rows), "one row per river name")
        for r in rows:
            self.assertIn(r["name"], names, "every river is drawn in world.json under its name")
            self.assertTrue(r["label"][0].isupper())
        hong = next(r for r in rows if r["name"] == "Sông Hồng")
        self.assertEqual(hong["en"], "Red River")
        self.assertIn("rivers", self.rivers["rules"])

    def test_size(self):
        import gzip
        for n in ("geo", "geo_rivers"):
            self.assertLess(len(gzip.compress((DATA / f"{n}.json").read_bytes())), 300_000, n)


if __name__ == "__main__":
    unittest.main()
