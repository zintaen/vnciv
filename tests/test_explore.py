"""ext/explore: seasons.json invariants, the lunar → solar conversion, and the browser helpers (node self-test)."""
import json
import math
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web" / "data"


class SeasonsJson(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = json.loads((WEB / "seasons.json").read_text())
        cls.sources = {s["id"] for s in json.loads((WEB / "sources.json").read_text())}

    def test_sources_registered(self):
        for part, ids in self.d["sources"].items():
            self.assertTrue(ids, part)
            for sid in ids:
                self.assertIn(sid, self.sources, f"{part}: {sid} not in sources.json")
        for k in ("storms", "festivals", "sights", "rice", "flood"):
            self.assertTrue(self.d["rules"].get(k), k)

    def test_sights_months_quotes_places(self):
        s = self.d["sights"]
        self.assertGreaterEqual(len(s), 5)
        for x in s:
            self.assertTrue(x["months"] and all(isinstance(m, int) and 1 <= m <= 12 for m in x["months"]), x["id"])
            self.assertEqual(len(set(x["months"])), len(x["months"]), x["id"])
            self.assertTrue(x["quote"] and x["source"].startswith("https://vi.wikipedia.org/wiki/"), x["id"])
            # every month number in the entry is written in its quote ("tháng N")
            for m in x["months"]:
                if m not in (x["months"][0], x["months"][-1]):
                    continue  # middle months of a range ("từ tháng 4 đến tháng 6")
                self.assertIn(f"tháng {m}", x["quote"].lower(), (x["id"], m))
            self.assertTrue(8 <= x["lat"] <= 24 and 102 <= x["lon"] <= 110, x["id"])
            self.assertTrue(x["vi"] and x["en"] and x["place_vi"] and x["place_en"], x["id"])

    def test_sight_quotes_in_downloaded_articles(self):
        raw = ROOT / "data" / "raw" / "wikipedia_vi_seasons"
        if not raw.exists():
            self.skipTest("raw articles not downloaded")
        texts = [p.get("extract", "") for f in raw.glob("*.json") if f.name != "manifest.json"
                 for p in json.loads(f.read_text())["query"]["pages"].values()]
        for x in self.d["sights"]:
            self.assertTrue(any(x["quote"] in t for t in texts), x["id"])

    def test_storms(self):
        st = self.d["storms"]
        months = st["months"]
        self.assertEqual(sorted(months, key=int), [str(m) for m in range(1, 13)])
        self.assertEqual(sum(v["count"] for v in months.values()), st["total"])
        dis = json.loads((WEB / "disasters.json").read_text())["typhoons"]["national"]["storms"]
        self.assertEqual(st["total"], dis)  # the same storms as the typhoon counts
        for m, v in months.items():
            self.assertLessEqual(v["strong"], v["count"])
            self.assertAlmostEqual(v["per_year"], round(v["count"] / st["years"], 2))
        # the peak of the season is in autumn (Sep–Nov), as the data shows
        peak = max(months, key=lambda m: months[m]["count"])
        self.assertIn(int(peak), (9, 10, 11))

    def test_festival_dates(self):
        living = json.loads((WEB / "living.json").read_text())["tet"]["dates"]
        years = self.d["lunar_years"]
        self.assertTrue(self.d["festivals"])
        for f in self.d["festivals"]:
            self.assertTrue(1 <= f["month"] <= 12 and 1 <= f["day"] <= 30, f["n"])
            for y, d in f["solar"].items():
                self.assertIn(int(y), years)
                # on or after Tết of that lunar year, before the next Tết
                self.assertGreaterEqual(d, living[y], f["n"])
                if str(int(y) + 1) in living:
                    self.assertLess(d, living[str(int(y) + 1)], f["n"])
                if f["month"] == 1 and f["day"] == 1:
                    self.assertEqual(d, living[y])

    def test_lunar_conversion_matches_hko(self):
        from pipeline.build import ext_seasons as E
        try:
            codes = E.year_codes()
        except FileNotFoundError:
            self.skipTest("lunar tables not downloaded")
        import datetime as dt
        # mùng 1 of each month of 2026 vs the HKO month starts (both calendars agree in 2026)
        hko = E.hko_month_starts(2026)
        if not hko:
            self.skipTest("HKO tables not downloaded")
        for m, leap, start, n in E.lunar_months(2026, codes[2026]):
            if start.year == 2026:
                self.assertEqual(hko.get(start), m, start)
            self.assertIn(n, (29, 30))
        self.assertEqual(E.lunar_to_solar(2026, 1, 15, codes), dt.date(2026, 3, 3))  # Rằm tháng Giêng


class Licence(unittest.TestCase):
    """The same rule as web/js/ext/explore/geom.js isFreeLicense (checked in node below)."""

    def test_rule_text_lists_licences(self):
        src = (ROOT / "web" / "js" / "ext" / "explore" / "geom.js").read_text()
        for word in ("cc0", "public domain", "cc[- ]by(-sa)?", "(nc|nd)"):
            self.assertIn(word, src)


class Haversine(unittest.TestCase):
    def test_hanoi_hcmc(self):
        # the same formula as geom.js haversineKm: Hà Nội – TP.HCM ≈ 1,140 km ± 2 %
        R = 6371.0088
        lo1, la1, lo2, la2 = map(math.radians, (105.8542, 21.0285, 106.698, 10.7724))
        a = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
        d = 2 * R * math.asin(math.sqrt(a))
        self.assertLess(abs(d - 1140) / 1140, 0.02)


@unittest.skipUnless(shutil.which("node"), "node not installed")
class NodeSelfTest(unittest.TestCase):
    def test_geom(self):
        r = subprocess.run(["node", str(ROOT / "web/js/ext/explore/geom.test.mjs")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)


if __name__ == "__main__":
    unittest.main()
