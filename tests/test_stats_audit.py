"""Province statistics re-derived from data/stats CSVs and Resolution 202/2025/QH15 (run after a build)."""
import csv
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA, STATS = ROOT / "web" / "data", ROOT / "data" / "stats"

# Resolution 202/2025/QH15, Article 1: the 23 merged provinces (the other 11 are unchanged)
RES_202 = {
    "Tuyên Quang": {"Tuyên Quang", "Hà Giang"}, "Lào Cai": {"Lào Cai", "Yên Bái"},
    "Thái Nguyên": {"Thái Nguyên", "Bắc Kạn"}, "Phú Thọ": {"Phú Thọ", "Vĩnh Phúc", "Hòa Bình"},
    "Bắc Ninh": {"Bắc Ninh", "Bắc Giang"}, "Hưng Yên": {"Hưng Yên", "Thái Bình"},
    "Hải Phòng": {"Hải Phòng", "Hải Dương"}, "Ninh Bình": {"Ninh Bình", "Hà Nam", "Nam Định"},
    "Quảng Trị": {"Quảng Trị", "Quảng Bình"}, "Đà Nẵng": {"Đà Nẵng", "Quảng Nam"},
    "Quảng Ngãi": {"Quảng Ngãi", "Kon Tum"}, "Gia Lai": {"Gia Lai", "Bình Định"},
    "Khánh Hòa": {"Khánh Hòa", "Ninh Thuận"}, "Lâm Đồng": {"Lâm Đồng", "Đắk Nông", "Bình Thuận"},
    "Đắk Lắk": {"Đắk Lắk", "Phú Yên"}, "TP. Hồ Chí Minh": {"TP. Hồ Chí Minh", "Bình Dương", "Bà Rịa–Vũng Tàu"},
    "Đồng Nai": {"Đồng Nai", "Bình Phước"}, "Tây Ninh": {"Tây Ninh", "Long An"},
    "Cần Thơ": {"Cần Thơ", "Sóc Trăng", "Hậu Giang"}, "Vĩnh Long": {"Vĩnh Long", "Bến Tre", "Trà Vinh"},
    "Đồng Tháp": {"Đồng Tháp", "Tiền Giang"}, "Cà Mau": {"Cà Mau", "Bạc Liêu"}, "An Giang": {"An Giang", "Kiên Giang"},
    "Huế": {"Thừa Thiên Huế"},  # renamed, not merged
}
UNCHANGED = {"Hà Nội", "Huế", "Lai Châu", "Điện Biên", "Sơn La", "Lạng Sơn", "Quảng Ninh", "Thanh Hóa", "Nghệ An",
             "Hà Tĩnh", "Cao Bằng"}


def load(name):
    return json.loads((DATA / f"{name}.json").read_text())


def rd(name):
    return {r["province_std"]: float(r["value"]) for r in csv.DictReader(open(STATS / f"{name}.csv", encoding="utf-8"))
            if r["value"]}


class TestStats(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.states = {s["name"]: s for s in load("states")}
        cls.cities = {c["province_old"]: c for c in load("cities")}

    def test_resolution_202_members(self):
        self.assertEqual(set(self.states), set(RES_202) | UNCHANGED)
        for name, s in self.states.items():
            self.assertEqual(set(s["former"]), RES_202.get(name, {name}), name)

    def test_states_match_nso_34_province_tables(self):
        # summed from the former provinces, the counts equal NSO's own 34-province appendix (within rounding)
        for key, f in (("population", "population_2025"), ("employed", "employed_workers"), ("paddy", "paddy_production")):
            p34 = rd(f"p34/{f}")
            for name, s in self.states.items():
                self.assertAlmostEqual(s[key], p34[name] * 1000, delta=max(300, p34[name] * 1000 * 1e-4), msg=(name, key))

    def test_state_area_is_official(self):
        # NSO's 34-province area (31/12/2024), not the sum of the former provinces' 2023 areas (Vĩnh Long +9%)
        area = rd("p34/area_km2")
        for name, s in self.states.items():
            self.assertAlmostEqual(s["area_km2"], area[name], places=1, msg=name)
            self.assertAlmostEqual(s["density"], s["population"] / s["area_km2"], delta=0.06, msg=name)
            self.assertEqual(s["years"]["area_km2"], "2024-12-31")
        nat = load("nation")["nation"]
        self.assertAlmostEqual(nat["area_km2"], sum(area.values()), delta=0.1)

    def test_money_at_world_bank_rate(self):
        fx = load("nation")["currency"]["fx"]
        gpc, inc = rd("2025/grdp_per_capita"), rd("2025/income_per_capita_monthly")
        for name in ("Bình Định", "Ninh Thuận", "Đắk Nông", "Bình Dương", "Hà Nam", "Điện Biên"):
            c = self.cities[name]
            self.assertAlmostEqual(c["gdp"] / c["population"], gpc[name] * 1e6 / fx, delta=1, msg=name)
            self.assertAlmostEqual(c["median_income"], inc[name] * 12000 / fx, delta=1, msg=name)

    def test_timeline_money_uses_each_years_rate(self):
        t = load("timeline")
        fx = {int(k): v for k, v in t["fx"].items()}
        s = t["series"]["grdp_per_capita"]
        for iso, by_year in s["levels"]["63"].items():
            for y, v in by_year.items():
                used = t["fx_used"][y]
                self.assertEqual(used, max(k for k in fx if k <= int(y)))
                self.assertAlmostEqual(s["lens_values"]["63"][iso][y], v * 1e6 / fx[used], delta=0.05, msg=(iso, y))


    def test_storm_wind_is_jma_not_mixed(self):
        from pipeline.build.lenses import wind_kt
        ix = {"TOKYO_WIND": 0, "WMO_WIND": 1, "USA_WIND": 2}
        self.assertEqual(wind_kt(["105", " ", "128"], ix), (105, 128))  # Yagi 2024-09-06 03:00, a 3-hourly row
        self.assertEqual(wind_kt([" ", "95", "110"], ix), (95, 110))
        self.assertEqual(wind_kt([" ", " ", "40"], ix), (None, 40))
        self.assertEqual(wind_kt([" ", " ", " "], ix), (None, None))

    def test_storm_max_wind_never_jtwc_for_a_jma_storm(self):
        """A storm JMA estimated takes its maximum from JMA's winds only: a JTWC-only row (before JMA starts or
        after it stops, e.g. Warren 1981: JMA 35 kt, JTWC 45 kt) must not raise it."""
        import csv
        from pipeline.fetch import RAW
        jma_max = {}
        with open(RAW / "ibtracs" / "ibtracs.WP.list.v04r01.csv", newline="") as f:
            r = csv.reader(f)
            head = next(r)
            next(r)
            ix = {k: head.index(k) for k in ("SID", "TOKYO_WIND", "WMO_WIND")}
            for row in r:
                for k in ("TOKYO_WIND", "WMO_WIND"):
                    if row[ix[k]].strip():
                        jma_max[row[ix["SID"]]] = max(jma_max.get(row[ix["SID"]], 0), float(row[ix[k]]))
        storms = json.loads((ROOT / "data" / "interim" / "_storms.json").read_text())["storms"]
        jma_storms = [sid for sid in storms if sid in jma_max]
        self.assertGreater(len(jma_storms), 200)
        over = [(sid, storms[sid]["name"], storms[sid]["max_kt"], jma_max[sid]) for sid in jma_storms
                if storms[sid]["max_kt"] > jma_max[sid]]
        self.assertEqual(over, [])

if __name__ == "__main__":
    unittest.main()
