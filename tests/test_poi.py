"""Checks on poi.json and relics.json (stream poi): shapes, positions on the map, provinces, rules and sources."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "data"


def load(name):
    p = DATA / f"{name}.json"
    return json.loads(p.read_text()) if p.exists() else None


class TestPoi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.poi, cls.relics, cls.world = load("poi"), load("relics"), load("world")
        if cls.poi is None or cls.relics is None:
            raise unittest.SkipTest("poi.json / relics.json not built")
        cls.W, cls.H = cls.world["width"], cls.world["height"]

    def check_rows(self, rows, cols, states):
        for r in rows:
            self.assertEqual(len(r), len(cols), r)
            self.assertTrue(0 <= r[0] <= self.W and 0 <= r[1] <= self.H, r)
            self.assertTrue(0 <= r[3] < len(states), r)

    def test_points(self):
        d = self.poi
        self.assertEqual(d["states"], [s["abbr"] for s in self.world["states"]])
        for kind, rows in d["points"].items():
            self.assertIn(kind, d["rules"])
            self.check_rows(rows, d["cols"][kind], d["states"])
            self.assertEqual(d["counts"][kind], len(rows))
        self.assertTrue(all(r[2] for r in d["points"]["beach"]), "beaches are named")
        self.assertTrue(all(r[4] >= 10 for r in d["points"]["protected"]))
        self.assertTrue(all(r[4] >= 500 and r[2] for r in d["points"]["bridge"]))
        self.assertTrue(all(0 <= r[4] < len(d["religions"]) for r in d["points"]["worship"]))
        self.assertGreater(len(d["points"]["hospital"]), 500)

    def test_no_national_parks_in_reserves(self):
        names = {r[2] for r in self.poi["points"]["protected"]}
        self.assertFalse([n for n in names if n.lower().startswith("vườn quốc gia")])

    def test_metro(self):
        lines = self.poi["metro"]
        self.assertTrue(lines)
        for l in lines:
            self.assertTrue(l["paths"] and all(len(p) >= 4 and len(p) % 2 == 0 for p in l["paths"]))
            self.assertTrue(l["colour"] is None or (l["colour"].startswith("#") and len(l["colour"]) == 7))
        self.assertTrue({l["state"] for l in lines} <= {"HN", "HCM"}, {l["state"] for l in lines})

    def test_relics(self):
        r = self.relics
        self.check_rows(r["relics"], r["cols"], r["states"])
        self.assertEqual(len(r["relics"]) + len(r["unplaced"]), r["listed"])
        self.assertGreaterEqual(r["listed"], 150)
        self.assertTrue(all(2009 <= x[4] <= 2030 and x[7] in ("list", "article", "wikidata", "osm") for x in r["relics"]))

    def test_sources_registered(self):
        from pipeline import sources
        for sid in set(self.poi["sources"]) | set(self.relics["sources"]):
            self.assertIn(sid, sources.BY_ID)

    def test_lens(self):
        L = load("lenses")
        lens = next((l for l in L["lenses"] if l["id"] == "osm_schools"), None)
        if lens is None:
            self.skipTest("lenses.json rebuilt without ext_poi")
        self.assertEqual(len(lens["values"]), len(self.world["owner"]))
        self.assertIn(lens["group"], {g["id"] for g in L["groups"]})
        self.assertEqual(len(lens["ramp"]), 6)
        for v, o in zip(lens["values"], self.world["owner"]):
            self.assertEqual(v is None, o < 0)


if __name__ == "__main__":
    unittest.main()
