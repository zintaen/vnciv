"""Air routes from the Wikipedia airport articles (stream fresh2): air_routes.json, trade.json and the plane arcs."""
import datetime as dt
import json
import unittest
from pathlib import Path

from pipeline import airtables

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web" / "data"


def load(name):
    return json.loads((WEB / f"{name}.json").read_text())


class AirRoutes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r, cls.infra = load("air_routes"), load("infrastructure")
        cls.vn = {a["id"] for a in cls.infra["airports"]}

    def test_articles_recorded(self):
        self.assertEqual(set(self.r["articles"]), {f"{l}:{a}" for l in ("en", "vi") for a in self.vn})
        for k, a in self.r["articles"].items():
            self.assertIsInstance(a["revid"], int, k)
            self.assertRegex(a["timestamp"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
            self.assertTrue(a["url"].endswith(f"oldid={a['revid']}"))

    def check_airlines(self, als, ctx):
        self.assertGreater(len(als), 0, ctx)
        for x in als:
            self.assertIn(x["id"], self.r["airlines"], ctx)
            self.assertIn(x["service"], ("scheduled", "seasonal", "charter"))
            self.assertTrue(set(x["listed_in"]) <= set(self.r["articles"]), ctx)

    def test_domestic_listed_at_both_ends(self):
        self.assertGreater(len(self.r["domestic"]), 30)
        pairs = [(d["a"], d["b"]) for d in self.r["domestic"]]
        self.assertEqual(len(pairs), len(set(pairs)))
        for d in self.r["domestic"]:
            self.assertTrue(d["a"] < d["b"] and {d["a"], d["b"]} <= self.vn, d)
            self.check_airlines(d["airlines"], d)
            for x in d["airlines"]:
                self.assertEqual({k.split(":")[1] for k in x["listed_in"]}, {d["a"], d["b"]}, d)
        for d in self.r["one_sided"]:
            for x in d["airlines"]:
                self.assertEqual(len({k.split(":")[1] for k in x["listed_in"]}), 1, d)

    def test_international(self):
        fa = self.r["foreign_airports"]
        self.assertEqual(set(fa), {i["foreign"] for i in self.r["international"]})
        for i in self.r["international"]:
            self.assertIn(i["vn"], self.vn)
            self.assertNotEqual(fa[i["foreign"]]["country"], "VN")
            self.check_airlines(i["airlines"], i)
            self.assertTrue(all(k.split(":")[1] == i["vn"] for x in i["airlines"] for k in x["listed_in"]))

    def test_trade_from_routes(self):
        t, m = load("trade"), load("motion_routes")
        self.assertIn("wikipedia_air_routes", t["sources"])
        self.assertTrue(all(r["airlines"] >= 3 and len(r["airline_codes"]) == r["airlines"] for r in t["routes"]))
        self.assertEqual([r["rank"] for r in t["routes"]], list(range(1, len(t["routes"]) + 1)))
        self.assertEqual(len([a for a in m["air"] if not a.get("international")]), len(t["routes"]))
        I = t["international"]
        self.assertEqual(sum(a.get("international", False) for a in m["air"]), sum(r["drawn"] for r in I["routes"]))
        dom = {(d["a"], d["b"]) for d in self.r["domestic"]}
        for r in t["routes"]:
            self.assertTrue(any(p <= set(r["airports"]) for p in map(set, dom)), r)

    def test_international_in_trade(self):
        t, world = load("trade"), load("world")
        I, vn = t["international"], {a["id"]: a for a in self.infra["airports"]}
        self.assertEqual([r["rank"] for r in I["routes"]], list(range(1, len(I["routes"]) + 1)))
        self.assertEqual([r["airlines"] for r in I["routes"]], sorted((r["airlines"] for r in I["routes"]), reverse=True))
        listed = {(i["vn"], i["foreign"]) for i in self.r["international"]}
        for r in I["routes"]:
            self.assertIn((r["vn"], r["foreign"]), listed)
            self.assertEqual(r["city"], vn[r["vn"]]["cbsa"])
            self.assertEqual(len(r["airline_codes"]), r["airlines"])
            f = I["foreign"][r["foreign"]]
            self.assertNotEqual(f["country"], "VN")
            self.assertEqual(r["in_frame"], "x" in f)
            if r["in_frame"]:
                self.assertTrue(0 <= f["x"] <= world["width"] and 0 <= f["y"] <= world["height"])
            self.assertEqual(r["drawn"], r["in_frame"] and r["airlines"] >= I["min_airlines"])
            self.assertEqual(r["path"] is not None, r["in_frame"])
        self.assertGreater(sum(r["drawn"] for r in I["routes"]), 0)
        self.assertGreater(sum(not r["in_frame"] for r in I["routes"]), 0)

    def test_almanac(self):
        ids = {s["id"] for s in load("sources")}
        self.assertIn("wikipedia_air_routes", ids)
        self.assertNotIn("openflights_routes", ids)


class PCI2025(unittest.TestCase):
    """The PCI 2025 composite is computed by the atlas (VCCI does not publish it) and must reproduce every one of the
    34 rank groups VCCI publishes, by the cut-offs of the PCI 2025 report (Bảng 4.3 p.107)."""

    @classmethod
    def setUpClass(cls):
        import csv
        cls.rows = list(csv.DictReader(open(ROOT / "data" / "stats" / "p34" / "pci_2025.csv", encoding="utf-8")))

    def test_groups_reproduced(self):
        from pipeline.nso.pci2025 import WEIGHTS, composite, group
        self.assertEqual(len(self.rows), 34)
        self.assertAlmostEqual(sum(WEIGHTS), 1.0)
        for r in self.rows:
            subs = [float(r[f"sub{k}"]) for k in range(1, 10)]
            self.assertAlmostEqual(composite(subs), float(r["value"]), delta=0.01, msg=r["province_std"])
            self.assertEqual(group(float(r["value"])), r["group"], r["province_std"])
        import statistics
        v = [float(r["value"]) for r in self.rows]
        self.assertAlmostEqual(statistics.mean(v), 63.76, delta=0.01)  # the report's mean (Bảng 4.3)

    def test_lens_and_timeline(self):
        lens = next(l for l in load("lenses")["lenses"] if l["id"] == "pci")
        self.assertEqual((lens["level"], lens["year"], lens["source"]), ("34", "2025", "pci"))
        self.assertIn("computed by the atlas", lens["description"])
        self.assertIn("VCCI does not publish", lens["description"])
        self.assertIn("p.138", lens["description"])
        vi = (ROOT / "tools" / "i18n" / "vi-data-fresh2.json").read_text()
        self.assertIn("Điểm tổng do atlas tự tính từ 9 chỉ số thành phần và trọng số VCCI công bố; VCCI không công bố điểm tổng PCI 2025", vi)
        s = load("timeline")["series"]["pci"]
        self.assertEqual(sorted({y for d in s["levels"]["63"].values() for y in d}), ["2022", "2024"])
        self.assertEqual(len(s["levels"]["34"]), 34)
        self.assertIn("2025", s["note"])
        self.assertIn("computed", s["note"])


class SeaLevelDelta(unittest.TestCase):
    """Sea level: ETOPO1, with the Mekong delta's hexes from the Minderhoud et al. (2019) delta DEM (CC BY 4.0)."""

    def test_sources_and_rule(self):
        s = load("sealevel")
        self.assertEqual((s["source"], s["delta_source"]), ("etopo", "mekong_dem"))
        self.assertIn("ETOPO1", s["rule"])
        self.assertIn("Minderhoud", s["rule"])
        self.assertIn("0.8 m", s["note"])
        low = next(l for l in load("lenses")["lenses"] if l["id"] == "low_lying")
        self.assertEqual(low["source"], "etopo")
        self.assertIn("Minderhoud", low["note"])
        self.assertIn("mekong_dem", load("living")["sources"])
        src = {x["id"]: x for x in load("sources")}
        self.assertNotIn("etopo2022", src)
        self.assertEqual(src["mekong_dem"]["license"], "CC BY 4.0")
        self.assertEqual((src["nso_dvhc"]["vintage"], src["nq_wards_2026"]["vintage"]),
                         ("NSO register of 28 November 2026", "Resolutions 237 and 388/NQ-UBTVQH16 (2026)"))

    def test_delta_cells_in_the_delta(self):
        s, world = load("sealevel"), load("world")
        delta = {k for k, st in enumerate(world["states"]) if st["abbr"] in ("AGI", "DTH", "CTH", "VLO", "CMA", "HCM", "TNI")}
        self.assertGreater(len(s["delta_cells"]), 100)
        self.assertTrue(all(world["owner"][c] in delta for c in s["delta_cells"]))


class Parser(unittest.TestCase):
    def test_en_flags_and_notes(self):
        text = ("{{Airport-dest-list\n| {{nowrap|[[VietJet Air]]}} | [[Noi Bai International Airport|Hanoi]],<ref>x</ref> "
                "[[Incheon International Airport|Seoul–Incheon]] (begins 9 February 2027)<br>'''Seasonal charter:''' "
                "[[Koltsovo Airport|Yekaterinburg]]\n}}")
        (al, d), = airtables.en_rows(text)
        self.assertEqual(al, "VietJet Air")
        self.assertEqual([(x[0], x[2]) for x in d], [("Noi Bai International Airport", []),
                                                     ("Incheon International Airport", []),
                                                     ("Koltsovo Airport", ["charter", "seasonal"])])
        today = dt.date(2026, 11, 28)
        self.assertEqual(airtables.status(d[1][3], today), "future")
        self.assertEqual(airtables.status("begins 2026-11-1", today), "listed")
        self.assertEqual(airtables.status("Đã ngừng", today), "ended")

    def test_vi_table(self):
        text = ("== Các hãng hàng không và điểm đến ==\n{| class=\"wikitable\"\n! Hãng !! Điểm đến\n|-\n"
                "| [[Hãng hàng không Quốc gia Việt Nam|Vietnam Airlines]] || [[Sân bay quốc tế Nội Bài|Hà Nội]], "
                "'''Thuê chuyến''': [[Sân bay quốc tế Incheon|Seoul]]\n|}\n== Tham khảo ==\n")
        (al, d), = airtables.vi_rows(text)
        self.assertEqual(al, "Hãng hàng không Quốc gia Việt Nam")
        self.assertEqual([x[2] for x in d], [[], ["charter"]])


if __name__ == "__main__":
    unittest.main()
