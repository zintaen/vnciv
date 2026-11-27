"""Invariants of the society stream's files: ethnic.json, its lenses, the crop lenses and history.json."""
import csv
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web" / "data"
load = lambda n: json.loads((WEB / f"{n}.json").read_text(encoding="utf-8"))


class TestCensusParser(unittest.TestCase):
    def test_split9(self):
        from pipeline.nso.census2019 import split9
        self.assertEqual(split9("1 845 492 918 155 927 337 325 688 149 136 176 552 1 519 804 769 019 750 785".split()),
                         (1845492, 918155, 927337, 325688, 149136, 176552, 1519804, 769019, 750785))
        self.assertEqual(split9("1 649 881 768 458 217 241 1 191 664 527".split()),
                         (1649, 881, 768, 458, 217, 241, 1191, 664, 527))
        self.assertEqual(split9("14 10 4 9 9 - 5 1 4".split()), (14, 10, 4, 9, 9, 0, 5, 1, 4))
        with self.assertRaises(ValueError):
            split9("1 2 3".split())

    def test_csv_sums(self):
        rows = list(csv.DictReader(open(ROOT / "data/stats/census2019/ethnic_by_province.csv", encoding="utf-8")))
        nat = sum(int(r["population"]) for r in rows if r["province_std"] == "nation")
        prov = sum(int(r["population"]) for r in rows if r["province_std"] != "nation")
        self.assertEqual(nat, 96208984)  # the census's national total (Table 2, first row)
        self.assertEqual(prov, nat)


class TestEthnic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.e = load("ethnic")
        cls.world = load("world")

    def test_shape(self):
        e = self.e
        self.assertEqual(len(e["groups"]), 56)
        self.assertEqual(set(e["former"]), {c["geoid"] for c in self.world["counties"]})
        self.assertEqual(set(e["provinces"]), {s["abbr"] for s in self.world["states"]})
        for rows in (e["former"], e["provinces"]):
            for k, r in rows.items():
                self.assertEqual(sum(r["pop"]), r["total"], k)
                self.assertTrue(0 <= r["minority_share"] <= 1, k)
                self.assertIn(r["largest"], e["groups"], k)
        self.assertEqual(sum(r["total"] for r in e["former"].values()), e["nation"]["total"])
        self.assertEqual(sum(r["total"] for r in e["provinces"].values()), e["nation"]["total"])

    def test_lenses(self):
        L = {l["id"]: l for l in load("lenses")["lenses"]}
        groups = {g["id"] for g in load("lenses")["groups"]}
        self.assertIn("agriculture", groups)
        cat = L["ethnic_largest"]
        n = len(cat["categories"])
        self.assertEqual(len(cat["ramp"]), n)
        self.assertTrue(all(v is None or v in range(n) for v in cat["values"]))
        owner, county = self.world["owner"], self.world["county"]
        iso = [c["geoid"] for c in self.world["counties"]]
        names = [c["name"] for c in cat["categories"]]
        for i, v in enumerate(L["ethnic_minority"]["values"]):
            if v is not None:
                self.assertEqual(v, self.e["former"][iso[county[i]]]["minority_share"])
                self.assertEqual(names[cat["values"][i]], self.e["former"][iso[county[i]]]["largest"])
        for lid in ("crop_rice", "crop_maize", "crop_cassava", "crop_sugarcane", "crop_tea", "crop_orange"):
            l = L[lid]
            self.assertEqual(l["group"], "agriculture")
            self.assertTrue(any(v for v in l["values"]), lid)
            self.assertTrue(all(v is None or (v >= 0 and owner[i] >= 0) for i, v in enumerate(l["values"])), lid)


class TestHistory(unittest.TestCase):
    def test_events(self):
        p = WEB / "history.json"
        if not p.exists():
            self.skipTest("history.json not built")
        h = json.loads(p.read_text(encoding="utf-8"))
        w = load("world")
        years = [ev["year"] for ev in h["events"]]
        self.assertEqual(years, sorted(years))
        for ev in h["events"]:
            for k in ("id", "date", "year", "title", "text", "category", "cite"):
                self.assertTrue(ev.get(k) is not None, (ev.get("id"), k))
            self.assertTrue(ev["cite"].startswith("https://") and "wikipedia.org/wiki/" in ev["cite"], ev["id"])
            self.assertEqual(ev["year"], -int(ev["date"][1:5]) if ev["date"][0] == "-" else int(ev["date"][:4]), ev["id"])
            if ev.get("x") is not None:
                self.assertTrue(0 <= ev["x"] <= w["width"] and 0 <= ev["y"] <= w["height"], ev["id"])


if __name__ == "__main__":
    unittest.main()
