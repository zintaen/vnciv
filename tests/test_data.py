"""Checks on the built web/data files: shapes, cell ranges, totals and cross-file ids (run after a build)."""
import csv
import json
import unittest
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "web" / "data"
STATS = Path(__file__).resolve().parent.parent / "data" / "stats"
ONLY_34 = ("hdi", "fdi", "enterprises_pk", "doctors_pk", "forest_cover", "road_deaths", "pupils_per_teacher",
           "growth_9m2026", "industry_jobs_2026")


def load(name):
    return json.loads((DATA / f"{name}.json").read_text())


class TestData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world, cls.cities, cls.states, cls.nation = load("world"), load("cities"), load("states"), load("nation")
        cls.n = cls.world["grid"]["cols"] * cls.world["grid"]["rows"]

    def land(self, c):
        return 0 <= c < self.n and self.world["owner"][c] >= 0

    def test_world_arrays(self):
        for k in ("owner", "county", "elev", "water", "relief", "cover"):
            self.assertEqual(len(self.world[k]), self.n, k)
        self.assertEqual(len(self.world["states"]), 34)
        self.assertEqual(len(self.world["counties"]), 63)
        owned = {o for o in self.world["owner"] if o >= 0}
        self.assertEqual(owned, set(range(34)), "every province owns hexes")
        self.assertTrue(all(self.land(c) for c in self.world["remote"]))

    def test_cities(self):
        self.assertEqual(len(self.cities), 63)
        self.assertEqual(len({c["cell"] for c in self.cities}), 63, "banner cells are unique")
        abbrs = {s["abbr"] for s in self.world["states"]}
        for c in self.cities:
            self.assertTrue(self.land(c["cell"]), c["name"])
            self.assertIn(c["cell"], c["footprint"])
            self.assertTrue(set(c["states"]) <= abbrs)
            self.assertGreater(c["gdp"], 0)
        self.assertEqual(sum(c["capital"] for c in self.cities), 1)
        pops = [c["population"] for c in self.cities]
        self.assertEqual(pops, sorted(pops, reverse=True))

    def test_totals_add_up(self):
        nat = self.nation["nation"]
        for k in ("population", "gdp", "employed"):
            self.assertAlmostEqual(sum(s[k] for s in self.states), nat[k], delta=nat[k] * 1e-6, msg=k)
            self.assertAlmostEqual(sum(c[k] for c in self.cities), nat[k], delta=nat[k] * 1e-6, msg=k)
        self.assertTrue(95e6 < nat["population"] < 110e6)

    def test_lenses(self):
        lenses = load("lenses")["lenses"]
        for l in lenses:
            self.assertEqual(len(l["values"]), self.n, l["id"])
            self.assertEqual(len(l["ramp"]), 6, l["id"])
            for i, v in enumerate(l["values"]):
                if v is not None:
                    self.assertGreaterEqual(self.world["owner"][i], 0, l["id"])

    def test_sites_on_land(self):
        infra, wonders, res = load("infrastructure"), load("wonders"), load("resources")
        ids = {c["id"] for c in self.cities}
        for it in infra["ports"] + infra["airports"] + wonders["wonders"] + res["items"]:
            self.assertTrue(self.land(it["cell"]), it.get("name"))
            self.assertIn(it["cbsa"], ids)
        for a, b, *_ in infra["roads"] + infra["rail"]:
            self.assertLess(a, b)
            self.assertIn(b, self.neighbours(a), "a road or rail link joins neighbouring hexes")

    def neighbours(self, c):
        """Pointy-top odd-r neighbours (pipeline/hexgrid.py ⇄ web/js/hex.js)."""
        cols = self.world["grid"]["cols"]
        col, row = c % cols, c // cols
        d = [(1, 0), (-1, 0), (0, -1), (1, -1), (0, 1), (1, 1)] if row & 1 else \
            [(1, 0), (-1, 0), (-1, -1), (0, -1), (-1, 1), (0, 1)]
        return {(row + dr) * cols + col + dc for dc, dr in d}

    def test_roads_ports_parks(self):
        infra, wonders = load("infrastructure"), load("wonders")
        for a, b, cls, name in infra["roads"]:
            self.assertIn(cls, (0, 1))
            self.assertTrue(name is None or isinstance(name, str))
        self.assertGreater(sum(r[2] == 0 for r in infra["roads"]), 200, "expressway links")
        classes = {c["id"] for c in infra["port_classes"]}
        for p in infra["ports"]:
            self.assertIn(p["class"], classes, p["name"])
        seaports = {p["seaport"] for p in infra["ports"]}
        self.assertGreaterEqual(len(seaports), 25, "most of the 34 listed seaports are placed")
        self.assertEqual(sum(p["class"] == "special" for p in infra["ports"] if p["main"]), 2)
        parks = [w for w in wonders["wonders"] if w["rule"] == "national_park"]
        self.assertGreaterEqual(len(parks), 34)
        self.assertTrue({"Vườn quốc gia Cúc Phương", "Vườn quốc gia Vũ Quang"} <= {w["name"] for w in parks})

    def test_power_plants(self):
        res = load("resources")
        ids = {t["id"] for t in res["types"]}
        for it in res["items"]:
            self.assertIn(it["type"], ids)
            self.assertGreater(it["value"], 0, it["name"])
            self.assertTrue(it["name"], "every plant is named")

    def test_military_and_trade(self):
        mil, trade = load("military"), load("trade")
        ids = {c["id"] for c in self.cities}
        for it in mil["installations"]:
            self.assertTrue(self.land(it["cell"]), it["name"])
            self.assertIn(it["tier"], ("major", "base", "site"))
        for r in mil["ranges"]:
            self.assertTrue(r["cells"], r["name"])
        self.assertTrue(set(mil["cities"]) <= ids)
        zones = {z["id"] for z in trade["zones"]}
        for r in trade["routes"]:
            self.assertIn(r["a"], zones)
            self.assertIn(r["b"], zones)
            self.assertGreater(r["airlines"], 0)

    def test_typhoons_and_land_exclude_remote_islands(self):
        ty = load("disasters")["typhoons"]
        # province keys follow the map's province order (deterministic output)
        order = [s["abbr"] for s in self.world["states"]]
        self.assertEqual(list(ty["states"]), [a for a in order if a in ty["states"]])
        self.assertLessEqual(ty["national"]["strong"], ty["national"]["storms"])
        # land shares are over hexes with land cover only: a province's forest share can't be dragged down by
        # the cover-less Hoàng Sa / Trường Sa hexes (Đà Nẵng's mainland is about 70% forest)
        dn = next(s for s in self.states if s["abbr"] == "DNA")
        self.assertGreater(dn["land"]["forest"], 0.7)
        lens = next(l for l in load("lenses")["lenses"] if l["id"] == "disasters")
        remote = set(self.world["remote"])
        self.assertEqual(lens["domain"][1], max(v for i, v in enumerate(lens["values"]) if v is not None and i not in remote))

    def test_no_generated_english_names(self):
        for it in load("military")["installations"]:
            self.assertNotEqual(it["name"], "Military area")
        for it in load("resources")["items"]:
            self.assertNotIn(" more", it["name"])

    def test_years(self):
        nat = self.nation["nation"]
        self.assertEqual(nat["growth_years"], [2019, 2025])
        self.assertEqual(self.nation["year"], 2025)
        for rec in self.cities + self.states:
            self.assertEqual(rec["gdp_year"], 2025)
            self.assertEqual(rec["growth_years"], [2019, 2025])
            self.assertEqual(rec["years"]["population"], "2025")
        # the former provinces keep their last published HDI/FDI (2024); provinces and the nation have 2025
        self.assertTrue(all(c["years"]["hdi"] == "2024" and c["years"]["fdi"] == "2024" for c in self.cities))
        self.assertTrue(all(s["years"]["hdi"] == "2025" and s["years"]["fdi"] == "2025" for s in self.states))
        self.assertEqual(nat["years"]["hdi"][:4], "2025")
        self.assertEqual(nat["cities_basis"]["year"], "2024")
        self.assertIn("2024", self.nation["currency"]["note"])
        lenses = load("lenses")
        groups = {g["id"] for g in lenses["groups"]}
        for l in lenses["lenses"]:
            self.assertIn(l["group"], groups, l["id"])
            if l["source"] in ("nso_yearbook", "nso_monthly_2026", "pci"):
                self.assertTrue(l.get("year"), l["id"])
                self.assertIn(l["year"][:4], l["description"].replace("–", " ") + l["year"], l["id"])

    def test_lens_ids_kept(self):
        ids = {l["id"] for l in load("lenses")["lenses"]}
        old = {"density", "urban", "growth", "income", "gdp_pc", "poverty", "gini", "fdi", "trained", "literacy", "hdi",
               "unemployment", "productivity", "pci", "disasters", "forest", "farmland", "developed", "wetland"}
        self.assertLessEqual(old, ids)

    def test_34_province_indicators(self):
        for s in self.states:
            for k in ONLY_34:
                self.assertIsNotNone(s[k], (s["abbr"], k))
        self.assertTrue(0.6 < min(s["hdi"] for s in self.states) < max(s["hdi"] for s in self.states) < 0.9)
        # a 34-province lens gives every hex of a province the province's value
        world_abbr = [s["abbr"] for s in self.world["states"]]
        by_abbr = {s["abbr"]: s for s in self.states}
        lens = next(l for l in load("lenses")["lenses"] if l["id"] == "growth_2026")
        self.assertEqual(lens["level"], "34")
        for i, v in enumerate(lens["values"]):
            if self.world["owner"][i] >= 0:
                self.assertAlmostEqual(v, by_abbr[world_abbr[self.world["owner"][i]]]["growth_9m2026"], places=4)

    def test_gia_lai_khanh_hoa_rice_not_swapped(self):
        # the yearbook appendix swaps the Gia Lai and Khánh Hòa rice rows; provinces are summed from former provinces
        city = {c["id"]: c for c in self.cities}
        st = {s["abbr"]: s for s in self.states}
        self.assertEqual(st["GLA"]["paddy"], city["30"]["paddy"] + city["31"]["paddy"])  # Gia Lai + Bình Định
        self.assertEqual(st["KHO"]["paddy"], city["34"]["paddy"] + city["36"]["paddy"])  # Khánh Hòa + Ninh Thuận
        self.assertGreater(st["GLA"]["paddy"], st["KHO"]["paddy"])
        rd = lambda f: {r["province_std"]: float(r["value"]) for r in csv.DictReader((STATS / f).read_text(encoding="utf-8").splitlines())}
        p63, p34 = rd("2025/paddy_production.csv"), rd("p34/paddy_production.csv")
        self.assertAlmostEqual(p34["Gia Lai"], p63["Gia Lai"] + p63["Bình Định"], places=1)
        self.assertAlmostEqual(p34["Khánh Hòa"], p63["Khánh Hòa"] + p63["Ninh Thuận"], places=1)

    def test_series_files(self):
        rows = list(csv.DictReader((STATS / "series" / "paddy_production.csv").read_text(encoding="utf-8").splitlines()))
        gla = {r["year"]: float(r["value"]) for r in rows if r["level"] == "34" and r["province_std"] == "Gia Lai"}
        old = {(r["province_std"], r["year"]): float(r["value"]) for r in rows if r["level"] == "63"}
        for y, v in gla.items():
            self.assertAlmostEqual(v, old[("Gia Lai", y)] + old[("Bình Định", y)], places=1)
        for f in (STATS / "series").glob("*.csv"):
            keys = set()
            for r in csv.DictReader(f.read_text(encoding="utf-8").splitlines()):
                k = (r["province_std"], r["level"], r["year"])
                self.assertNotIn(k, keys, f.name)
                keys.add(k)

    def test_city_keyed_files(self):
        ids = {c["id"] for c in self.cities}
        self.assertEqual(set(load("districts")["cities"]), ids)
        self.assertEqual(set(load("citizens")["cities"]), ids)
        counties = load("counties")
        self.assertEqual(len(counties["rows"]), 63)
        self.assertEqual([f["key"] for f in counties["fields"]], counties["columns"])


if __name__ == "__main__":
    unittest.main()
