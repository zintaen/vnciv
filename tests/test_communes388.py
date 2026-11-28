"""Checks on communes.json's current types (NSO register) and the 2026 commune → ward changes (237 and 388/NQ-UBTVQH16)."""
import json
import unittest
from collections import Counter
from pathlib import Path

from pipeline.build.ext_communes import name_key

P = Path(__file__).resolve().parent.parent / "web" / "data" / "communes.json"


class TestNameKey(unittest.TestCase):
    def test_tone_placement(self):
        self.assertEqual(name_key("Xã Hiệp Hoà"), name_key("xã  Hiệp Hòa "))
        self.assertEqual(name_key("Thuỵ Anh"), name_key("Thụy Anh"))
        self.assertNotEqual(name_key("Bố Hạ"), name_key("Bố Hà"))


@unittest.skipUnless(P.exists(), "communes.json not built")
class TestCommunes388(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = json.loads(P.read_text())
        cls.by_id = {c["id"]: c for c in cls.d["communes"]}

    def test_national_counts(self):
        kinds = Counter(c["k"] for c in self.d["communes"])
        self.assertEqual((kinds[0], kinds[1], kinds[2]), (2599, 709, 13))
        self.assertEqual(self.d["official_now"], {"communes": 2599, "wards": 709, "special": 13, "total": 3321})

    def test_province_counts(self):
        for abbr, v in self.d["by_province"].items():
            self.assertEqual(v["official_now"], {k: v[k] for k in ("communes", "wards", "special", "total")}, abbr)
        # as stated in the resolutions: Bắc Ninh 54 xã + 45 phường, Đồng Nai 62 xã + 33 phường
        bp = self.d["by_province"]
        self.assertEqual((bp["BNI"]["communes"], bp["BNI"]["wards"], bp["BNI"]["total"]), (54, 45, 99))
        self.assertEqual((bp["DNI"]["communes"], bp["DNI"]["wards"], bp["DNI"]["total"]), (62, 33, 95))

    def test_changes(self):
        ch = {c["id"]: c for c in self.d["changes"]}
        self.assertEqual(set(ch), {"237/NQ-UBTVQH16", "388/NQ-UBTVQH16"})
        self.assertEqual(len(ch["237/NQ-UBTVQH16"]["ids"]), 10)
        self.assertEqual(len(ch["388/NQ-UBTVQH16"]["ids"]), 12)
        self.assertEqual(ch["388/NQ-UBTVQH16"]["effective"], "2026-09-20")
        self.assertEqual(ch["237/NQ-UBTVQH16"]["effective"], "2026-04-30")
        for r in ch.values():
            for i in r["ids"]:
                self.assertEqual((self.by_id[i]["k"], self.by_id[i]["p"]), (r["kind_to"], r["province"]), i)
        # a sample of units named in the resolutions, now wards
        for code, name, prov in [("07294", "Bố Hạ", "BNI"), ("09496", "Lương Tài", "BNI"), ("09193", "Yên Phong", "BNI"),
                                 ("26248", "Trảng Bom", "DNI"), ("26368", "Long Thành", "DNI"), ("25270", "Lộc Ninh", "DNI")]:
            c = self.by_id[code]
            self.assertEqual((c["n"], c["k"], c["p"]), (name, 1, prov), code)
        self.assertEqual(self.d["as_of"], "2026-11-28")


if __name__ == "__main__":
    unittest.main()
