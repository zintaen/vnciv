"""The same quantity shown in two places agrees: data files with each other, and the counts that README.md and the
data files' own descriptions state. Reads only web/data and README.md, so it runs in a fresh clone."""
import json
import re
import unittest
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "web" / "data"
J = lambda name: json.loads((D / name).read_text(encoding="utf-8"))  # noqa: E731
README = (ROOT / "README.md").read_text(encoding="utf-8")


def num(pattern, text):
    m = re.search(pattern, text)
    assert m, f"claim not found: {pattern!r}"
    return int(m.group(1).replace(",", "").replace(".", ""))


class TestConsistency(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.nation, cls.states, cls.cities = J("nation.json"), J("states.json"), J("cities.json")
        cls.sources = {s["id"]: s for s in J("sources.json")}

    def test_national_totals_are_sums(self):
        n = self.nation["nation"]
        for k in ("population", "employed", "labour_force"):
            self.assertEqual(n[k], sum(s[k] for s in self.states), k)
            self.assertEqual(n[k], sum(c[k] for c in self.cities), k)
        self.assertAlmostEqual(n["area_km2"], sum(s["area_km2"] for s in self.states), delta=0.5)
        for y in self.nation["yields"]:
            k = y.get("key") or y.get("id")
            tot = sum(s["yields"][k] or 0 for s in self.states)
            self.assertAlmostEqual(n["yields"][k], tot, delta=max(5, abs(tot) * 1e-9), msg=k)
            self.assertAlmostEqual(tot, sum(c["yields"][k] or 0 for c in self.cities), delta=max(5, abs(tot) * 1e-9))
        # the top bar's GDP is NSO's national figure; the provinces' sum is kept beside it
        self.assertAlmostEqual(n["gdp_provinces"], sum(s["gdp"] for s in self.states), delta=5)

    def test_counts_stated_in_readme(self):
        self.assertEqual(num(r"the (\d+) provinces of 2025", README), len(self.states))
        self.assertEqual(num(r"The \*\*(\d+) former provinces\*\*", README), len(self.cities))
        self.assertEqual(num(r"(\d+) lenses", README), len(J("lenses.json")["lenses"]))
        self.assertEqual(num(r"The (\d+) domestic air routes", README), len(J("trade.json")["routes"]))
        self.assertEqual(num(r"The (\d+) seaports", README), len(self.seaports()))
        ty = J("disasters.json")["typhoons"]
        self.assertEqual(num(r"within (\d+) km since", README), ty["radius_km"])
        self.assertEqual(num(r"within \d+ km since (\d{4})", README), ty["since"])
        self.assertEqual(num(r"([\d,]+) communes, wards and special zones", README), J("communes.json")["count"])
        self.assertEqual(num(r"(\d+) special national relics", README), J("relics.json")["listed"])

    def seaports(self):
        inf = J("infrastructure.json")
        sp = {p["seaport"]: p["class"] for p in inf["ports"]}
        sp.update({u["seaport"]: u["class"] for u in inf["seaports_unplaced"]})
        return sp

    def test_seaports(self):
        sp = self.seaports()
        desc = self.sources["qd804"]["description"]
        self.assertEqual(num(r"Vietnam's (\d+) seaports", desc), len(sp))
        c = Counter(sp.values())
        self.assertEqual((num(r"(\d+) special", desc), num(r"(\d+) class I,", desc), num(r"(\d+) class II,", desc),
                          num(r"(\d+) class III", desc)), (c["special"], c["I"], c["II"], c["III"]))
        self.assertEqual(num(r"The (\d+) seaports", J("infrastructure.json")["rules"]["ports"]), len(sp))

    def test_storm_counts(self):
        ty = J("disasters.json")["typhoons"]
        nat = ty["national"]
        self.assertEqual(nat["storms"], sum(y["storms"] for y in nat["by_year"]))
        self.assertGreaterEqual(nat["storms"], max(s["total"] for s in ty["states"].values()))
        # the timeline counts a year's storms the way the typhoon lens does: those touching a non-remote hex
        remote = set(J("world.json")["remote"])
        tl = Counter(s["season"] for s in J("timeline.json")["storms"] if any(c not in remote for c in s["cells"]))
        self.assertEqual(dict(tl), {y["year"]: y["storms"] for y in nat["by_year"] if y["storms"]})

    def test_power_plants(self):
        r = J("resources.json")
        for t, v in r["summary"]["national"].items():
            items = [i for i in r["items"] if i["type"] == t]
            self.assertEqual(v["count"], len(items), t)
            self.assertEqual(v["value"], sum(i["value"] for i in items), t)
            self.assertEqual(v["count"], sum(s["energy"]["sites"][t] for s in self.states if s["energy"]), t)
            self.assertEqual(v["value"], sum(s["energy"]["by_type"][t] for s in self.states if s["energy"]), t)
            self.assertEqual(v["value"], sum(st.get(t, {}).get("value", 0) for st in r["summary"]["states"].values()))
        for s in self.states:
            if s["energy"]:
                self.assertNotIn("data as of 2021", s["energy"]["note"])  # the plants are OSM 2026

    def test_communes(self):
        m = J("communes.json")
        o = m["official_2025"]
        self.assertEqual(m["count"], len(m["communes"]))
        self.assertEqual(m["count"], sum(p["total"] for p in m["by_province"].values()))
        self.assertEqual(o["total"], o["communes"] + o["wards"] + o["special"])
        self.assertEqual(o["total"], sum(p["official_2025"]["total"] for p in m["by_province"].values()))
        self.assertEqual(num(r"The number of units, ([\d,]+)", m["count_note"]), m["count"])
        vtc = self.sources["vtc_communes_2025"]["description"]
        self.assertEqual((num(r"\(([\d,]+) =", vtc), num(r"= ([\d,]+) communes", vtc), num(r"\+ ([\d,]+) wards", vtc),
                          num(r"\+ ([\d,]+) special", vtc)), (o["total"], o["communes"], o["wards"], o["special"]))
        self.assertEqual(num(r"and ([\d,]+) communes, wards", self.sources["vn_wards_gis"]["description"]), m["count"])
        self.assertEqual(Counter(c["k"] for c in m["communes"]).total(), m["count"])

    def test_relics(self):
        r = J("relics.json")
        self.assertEqual(r["listed"], len(r["relics"]) + len(r["unplaced"]))

    def test_islands_and_wonders(self):
        p = J("places.json")
        owner = {a["name"]: a["owner"] for a in p["archipelagos"]}
        self.assertEqual(owner, {"Quần đảo Hoàng Sa": "Đà Nẵng", "Quần đảo Trường Sa": "Khánh Hòa"})
        self.assertIn("Hoàng Sa under Đà Nẵng, Trường Sa under Khánh Hòa", " ".join(README.split()))
        w = J("wonders.json")
        kinds = Counter(x["rule"] for x in w["wonders"])
        self.assertEqual(w["national"]["world_heritage"], kinds["world_heritage"])
        self.assertEqual(w["national"]["r1_universities"], kinds["research_university"])
        uni = next(r["text"] for r in w["rules"] if "universit" in r["text"])
        self.assertEqual(num(r"\((\d+) national", uni) + num(r"(\d+) regional in", uni), kinds["research_university"])

    def test_ethnic_claims(self):
        e = J("ethnic.json")
        lenses = {lens["id"]: lens for lens in J("lenses.json")["lenses"]}
        kinh = sum(1 for v in e["former"].values() if v["largest"] == "Kinh")
        self.assertEqual(num(r"largest group in (\d+) of the", lenses["ethnic_largest"]["description"]), kinh)
        share = re.search(r"Nationally ([\d.]+)%", lenses["ethnic_minority"]["note"]).group(1)
        self.assertEqual(share, f"{e['nation']['minority_share'] * 100:.1f}")

    def test_exchange_rate_note(self):
        fx = json.loads((ROOT / "data" / "stats" / "wb_fx.json").read_text())[1]
        rate = next(r["value"] for r in fx if r["date"] == "2024")
        self.assertEqual(num(r"2024: ([\d,]+) VND", self.nation["currency"]["note"]), round(rate))


if __name__ == "__main__":
    unittest.main()
