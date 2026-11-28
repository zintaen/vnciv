"""Checks on web/data/borders_history.json (historical province boundaries, pipeline/build/ext_borders.py)."""
import gzip
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "data"
sys.path.insert(0, str(ROOT))
from pipeline.admin import new_units, old_units  # noqa: E402

# province-level units at each change, as Wikipedia's year-by-year list (Đơn vị hành chính cấp tỉnh, rev 75732571)
# gives them; 1991-08 is derived from the resolution (see the file's rules.counts)
OFFICIAL = {"1976": 38, "1977": 38, "1978": 39, "1979": 40, "1982": 40, "1989": 44, "1991-08": 49, "1991-12": 53,
            "1996": 61, "2003": 64, "2008": 63, "2024": 63, "2025": 34, "2026": 34}


def cells(frame):
    c = frame["cells"]
    return [v for k in range(0, len(c), 2) for v in [c[k]] * c[k + 1]]


@unittest.skipUnless((DATA / "borders_history.json").exists(), "borders_history.json not built")
class TestBorders(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.D = json.loads((DATA / "borders_history.json").read_text())
        cls.world = json.loads((DATA / "world.json").read_text())
        cls.land = [i for i, o in enumerate(cls.world["owner"]) if o >= 0]

    def test_counts(self):
        self.assertEqual([f["id"] for f in self.D["frames"]], list(OFFICIAL))
        for f in self.D["frames"]:
            v = cells(f)
            self.assertEqual(f["count"], OFFICIAL[f["id"]], f["id"])
            self.assertEqual(len(f["provinces"]), OFFICIAL[f["id"]], f["id"])
            self.assertEqual(len(set(v)), OFFICIAL[f["id"]], f"{f['id']}: every province has hexes")
            self.assertEqual(sum(f["kinds"].values()), f["count"])

    def test_every_land_hex(self):
        self.assertEqual(self.D["n_land"], len(self.land))
        for f in self.D["frames"]:
            v = cells(f)
            self.assertEqual(len(v), len(self.land), f["id"])
            self.assertTrue(all(0 <= x < len(f["provinces"]) for x in v), f["id"])

    def test_2025_is_the_34(self):
        owner = [self.world["owner"][i] for i in self.land]
        names = [u["name"] for u in new_units()]
        for fid in ("2025", "2026"):
            f = next(x for x in self.D["frames"] if x["id"] == fid)
            self.assertEqual(cells(f), owner, fid)
            self.assertEqual([p["name"] for p in f["provinces"]], names)

    def test_2008_is_the_63(self):
        olds = [u["name"] for u in old_units()]
        f = next(x for x in self.D["frames"] if x["id"] == "2008")
        names = [p["name"].replace(" – ", "–") for p in f["provinces"]]
        self.assertEqual([names[v] for v in cells(f)], [olds[self.world["county"][i]] for i in self.land])

    def test_cards_and_size(self):
        for f in self.D["frames"]:
            self.assertTrue(f["legal"] and f["changes"], f["id"])
            for c in f["legal"] + f["changes"]:
                self.assertTrue(c["url"].startswith("https://") and c["text"] and c["text_vi"], f["id"])
        self.assertLess(len(gzip.compress((DATA / "borders_history.json").read_bytes())), 1_500_000)


if __name__ == "__main__":
    unittest.main()
