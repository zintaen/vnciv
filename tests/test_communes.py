"""Checks on web/data/communes.json (the 3,321 communes, wards and special zones of 1 July 2025)."""
import gzip
import json
import unittest
from collections import Counter
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "web" / "data"
P = DATA / "communes.json"


@unittest.skipUnless(P.exists(), "communes.json not built")
class TestCommunes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = P.read_bytes()
        cls.d = json.loads(cls.raw)
        cls.world = json.loads((DATA / "world.json").read_text())

    def test_counts(self):
        c = self.d["communes"]
        self.assertEqual(len(c), 3321)
        self.assertEqual(len({x["id"] for x in c}), 3321, "unique codes")
        self.assertEqual(self.d["official_2025"]["total"], 3321)
        kinds = Counter(x["k"] for x in c)
        self.assertEqual(kinds[2], 13, "13 special zones")
        # The only known differences from the June 2025 list are later commune → ward upgrades (Đồng Nai, Bắc Ninh).
        for abbr, v in self.d["by_province"].items():
            off = v["official_2025"]
            self.assertIsNotNone(off, abbr)
            self.assertEqual(v["total"], off["total"], abbr)
            self.assertEqual(v["special"], off["special"], abbr)
            if abbr not in ("DNI", "BNI"):
                self.assertEqual((v["communes"], v["wards"]), (off["communes"], off["wards"]), abbr)

    def test_provinces(self):
        abbrs = {s["abbr"] for s in self.world["states"]}
        got = {x["p"] for x in self.d["communes"]}
        self.assertEqual(got, abbrs, "every commune in one of the 34 provinces, every province has communes")

    def test_inside_vietnam(self):
        g = self.world["grid"]
        R, cols, rows = g["radius"], g["cols"], g["rows"]
        w, h = 3 ** 0.5 * R, 1.5 * R
        owner = self.world["owner"]
        far = []
        for x in self.d["communes"]:
            # the label point is on a Vietnamese land hex or within 3 hexes of one (small islands, coastal wards)
            r0, c0 = round(x["y"] / h), round(x["x"] / w)
            near = any(owner[r * cols + c] >= 0 for r in range(r0 - 3, r0 + 4) for c in range(c0 - 3, c0 + 4)
                       if 0 <= r < rows and 0 <= c < cols)
            if not near:
                far.append(x["n"])
        # Offshore island units the hex map has no land hex near (the archipelagos' labels sit between their islands)
        self.assertLessEqual(set(far), {"Bạch Long Vĩ", "Cồn Cỏ", "Hoàng Sa", "Trường Sa", "Thổ Châu"}, far)
        W, H = self.world["width"], self.world["height"]
        # Trường Sa reaches south of the map window (~7.9°N at its south-west corner): its label point is off the map
        off = [x["n"] for x in self.d["communes"] if not (0 < x["x"] < W and 0 < x["y"] < H)]
        self.assertLessEqual(set(off), {"Trường Sa"}, off)
        self.assertTrue(all(0 < x["a"] < 10000 for x in self.d["communes"]))

    def test_topology(self):
        n = len(self.d["arcs"])
        used = Counter()
        for x in self.d["communes"]:
            self.assertTrue(x["r"], x["n"])
            for ring in x["r"]:
                for r in ring:
                    k = ~r if r < 0 else r
                    self.assertTrue(0 <= k < n)
                    used[k] += 1
        self.assertEqual(len(used), n, "no orphan arcs")
        self.assertGreater(sum(1 for v in used.values() if v == 2) / n, 0.7, "most borders are shared, drawn once")

    def test_size(self):
        self.assertLess(len(gzip.compress(self.raw)), 1_500_000)


if __name__ == "__main__":
    unittest.main()
