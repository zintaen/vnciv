"""Audit round 2 (data, part A): districts baseline, communes vs the raw Vietnamese Provinces Database (run after a build)."""
import json
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

BUILT = unittest.skipUnless((ROOT / "data" / "raw").is_dir() and (ROOT / "data" / "interim").is_dir(),
                            "needs data/raw and data/interim: run `python -m pipeline all` first")
DATA, RAW = ROOT / "web" / "data", ROOT / "data" / "raw" / "vn_wards_gis"


class TestDistrictsBaseline(unittest.TestCase):
    @BUILT
    def test_unknown_figures_left_out_of_national_baseline(self):
        # Bắc Kạn's 2025 tourism cell is blank: the national per-resident baseline must skip its population
        st = json.loads((ROOT / "data" / "interim" / "_stats.json").read_text())["rows"]
        self.assertIsNone(st["53"]["tourism"])
        known = [r for r in st.values() if r["tourism"] is not None]
        want = sum(r["tourism"] for r in known) / sum(r["population"] for r in known)
        got = json.loads((DATA / "districts.json").read_text())["national"]["tourism"]
        self.assertAlmostEqual(got, want, delta=1e-3)


@BUILT
class TestCommunesVsRaw(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        meta = json.loads((RAW / "full_json_generated_data_vn_units.json").read_text())
        cls.info = {w["Code"]: (w, p["Name"]) for p in meta for w in p["Wards"]}
        cls.C = json.loads((DATA / "communes.json").read_text())

    def test_name_kind_province_match_raw(self):
        import sys
        sys.path.insert(0, str(ROOT))
        from pipeline.admin import NEW, fold
        name_of = {a: n for n, (a, _) in NEW.items()}
        f = lambda s: fold(s).replace("thanh pho ", "").replace("tp. ", "")
        self.assertEqual(len(self.C["communes"]), len(self.info))
        for c in self.C["communes"]:
            w, prov = self.info[c["id"]]
            self.assertEqual(c["n"], w["Name"], c["id"])
            self.assertEqual(self.C["kinds"][c["k"]], w["AdministrativeUnitShortName"], c["id"])
            self.assertEqual(f(name_of[c["p"]]), f(prov), c["id"])

    def test_area_rule_explains_differences(self):
        with zipfile.ZipFile(RAW / "vn_provinces_wards_geojson.zip") as z:
            src = {}
            for n in z.namelist():
                if "/wards/" in n and n.endswith(".geojson"):
                    p = json.loads(z.read(n))["features"][0]["properties"]
                    src[p["code"]] = p["areaKm2"]
        r = [c["a"] / src[c["id"]] for c in self.C["communes"] if src.get(c["id"])]
        self.assertGreater(sum(abs(x - 1) < 0.05 for x in r) / len(r), 0.9)
        self.assertIn("reefs and lagoons", self.C["rules"]["area"])


if __name__ == "__main__":
    unittest.main()
