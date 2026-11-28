"""Round-2 data audit (lenses, timeline, nation): checks for the fixes (run after a build)."""
import csv
import re
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

BUILT = unittest.skipUnless((ROOT / "data" / "raw").is_dir() and (ROOT / "data" / "interim").is_dir(),
                            "needs data/raw and data/interim: run `python -m pipeline all` first")
DATA, STATS = ROOT / "web" / "data", ROOT / "data" / "stats"
load = lambda n: json.loads((DATA / f"{n}.json").read_text())


class TestRound2Data(unittest.TestCase):
    @BUILT
    def test_storm_close_pass_between_fixes_counted(self):
        # Mangkhut 2013 passes ~97 km from Nghệ An's hex 19818 mid-segment; both track points are ~101 km away
        storms = json.loads((ROOT / "data" / "interim" / "_storms.json").read_text())["storms"]
        self.assertIn(19818, storms["2013217N11118"]["cells"])

    @BUILT
    def test_storm_dates_per_province(self):
        # a former province's storm date is when that storm first came within reach of it, never before the storm's
        # first mainland approach, and the earliest of them is that approach
        for sid, s in json.loads((ROOT / "data" / "interim" / "_storms.json").read_text())["storms"].items():
            if s["county_first"]:
                self.assertEqual(min(s["county_first"].values()), s["first"], sid)

    def test_preliminary_income_flagged(self):
        # income per person 2024 and 2025 and the quintile ratio 2025: the tables' footnote says "Số sơ bộ"
        for f in ("income_per_capita_monthly", "income_quintile_ratio"):
            st = {r["status"] for r in csv.DictReader(open(STATS / "series" / f"{f}.csv", encoding="utf-8"))}
            self.assertEqual(st, {"prel"}, f)
        for f in ("2025/income_per_capita_monthly", "p34/income_per_capita_monthly", "2024/income_per_capita_monthly"):
            yrs = {r["year"] for r in csv.DictReader(open(STATS / f"{f}.csv", encoding="utf-8"))}
            self.assertTrue(all("prel" in y for y in yrs), f)

    def test_timeline_status_follows_drawn_level(self):
        s = load("timeline")["series"]["hdi"]
        self.assertEqual(s["status_levels"]["63"]["2024"], "prel")
        self.assertEqual(s["status_levels"]["34"]["2024"], "final")
        self.assertEqual(s["status"]["2024"], "final")  # the HDI lens is drawn by the 34 provinces

    def test_nation_gdp_is_nso_national(self):
        nat = load("nation")
        row = next(r for r in csv.DictReader(open(STATS / "national.csv", encoding="utf-8")) if r["indicator"] == "gdp")
        self.assertEqual(row["year"], "2025 (est.)")
        self.assertAlmostEqual(nat["nation"]["gdp"], float(row["value"]) * 1e9 / nat["currency"]["fx"], delta=nat["nation"]["gdp"] * 1e-6)
        self.assertEqual(nat["nation"]["years"]["gdp"], "2025 (est.)")
        self.assertEqual(nat["nation"]["years"]["income"], "2025 (prel.)")
        self.assertAlmostEqual(sum(s["gdp"] for s in load("states")), nat["nation"]["gdp_provinces"], delta=34)  # rounding

    def test_lens_vintage_names_every_source(self):
        v = load("lenses")["vintage"]
        for s in ("CHELSA", "Hansen", "ETOPO1", "OpenStreetMap", "2019 census", "PCI", "WorldPop", "WorldCover", "IBTrACS"):
            self.assertIn(s, v)

    def test_cover_note_sample_count(self):
        from pipeline.build.world import COVER_NOTE, COVER_STEP, R, hex_lattice
        n = len(hex_lattice(R, COVER_STEP))
        self.assertIn(f"({n} points)", COVER_NOTE.format(n=n))
        self.assertEqual(n, 64)


    def test_no_invented_event_dates(self):
        # a full date needs a source; otherwise the year alone (no invented day and month)
        for e in load("timeline")["events"]:
            if not re.fullmatch(r"-?\d{4}", e["date"]):
                self.assertTrue(e.get("source"), e)
        ev = {e["id"]: e["date"] for e in load("timeline")["events"]}
        self.assertEqual(ev["unesco_wh-678"], "1993-12-11")  # Huế: the day Wikidata gives, not an invented 1 July
        self.assertEqual(ev["unesco_wh-672"], "1994")  # Wikidata has the year only (stored as 1 January)

    @BUILT
    def test_commune_names_as_published(self):
        raw = json.loads((ROOT / "data" / "raw" / "vn_wards_gis" / "full_json_generated_data_vn_units.json").read_text())
        name = {w["Code"]: w["Name"] for p in raw for w in p["Wards"]}
        c = load("communes")
        for x in c["communes"]:
            self.assertEqual(x["n"], name[x["id"]])
        self.assertIn("as the source spells them", c["rules"]["names"])


if __name__ == "__main__":
    unittest.main()
