"""Checks on the province rasters of web/data/world.json (34 provinces from COD-AB 2025, 63 former ones nested inside)."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
W = json.loads((ROOT / "web" / "data" / "world.json").read_text())


@unittest.skipUnless("provinces" in W["tables"]["notes"], "world.json built before the COD-AB outlines")
class TestBoundaries(unittest.TestCase):
    def test_grid_unchanged(self):
        self.assertEqual((W["grid"]["cols"], W["grid"]["rows"], len(W["owner"])), (263, 234, 61542))

    def test_nesting(self):
        from pipeline.admin import NEW
        new_of = {o: n for n, (_, olds) in NEW.items() for o in olds}
        names = [s["name"] for s in W["states"]]
        for i, o in enumerate(W["owner"]):
            if o >= 0:
                self.assertEqual(new_of[W["counties"][W["county"][i]]["name"]], names[o], i)

    def test_spots(self):
        """GeoNames points (data/raw/geonames/VN.txt): Hồ Hoàn Kiếm 1580636, Móng Cái 1574507."""
        from pipeline.geo import MapProjection
        from pipeline.hexgrid import HexGrid
        it = json.loads((ROOT / "data" / "interim" / "_world.json").read_text())
        grid, proj = HexGrid(**it["grid"]), MapProjection(**it["projection"])
        abbr = [s["abbr"] for s in W["states"]]
        for lat, lon, want in ((21.02877, 105.85058, "HN"), (21.52471, 107.96619, "QNI")):
            self.assertEqual(abbr[W["owner"][grid.cell_at(*proj(lon, lat))]], want)

    def test_outline_check(self):
        c = json.loads((ROOT / "web" / "data" / "communes.json").read_text())["outline_check"]["vn_wards_gis"]
        iou = sorted(r["iou"] for r in c)
        self.assertGreater(iou[len(iou) // 2], 0.97, "median IoU with the official commune file's provinces")


if __name__ == "__main__":
    unittest.main()
