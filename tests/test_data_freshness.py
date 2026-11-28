"""Freshness invariants: storms through the latest IBTrACS season (provisional ones labelled), the FX year is the
newest World Bank year with a value, and airport passenger years come from the newest figure in the cached table."""
import csv
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web" / "data"
RAW = ROOT / "data" / "raw"
IBTRACS = RAW / "ibtracs" / "ibtracs.WP.list.v04r01.csv"


def load(name):
    return json.loads((WEB / f"{name}.json").read_text())


class StormsFreshness(unittest.TestCase):
    def test_every_season_present_and_contiguous(self):
        t = load("disasters")["typhoons"]
        years = [b["year"] for b in t["national"]["by_year"]]
        self.assertEqual(years, list(range(1980, years[-1] + 1)))
        self.assertGreaterEqual(years[-1], 2026)
        self.assertEqual(sum(b["storms"] for b in t["national"]["by_year"]), t["national"]["storms"])

    @unittest.skipUnless(IBTRACS.exists(), "IBTrACS not downloaded")
    def test_last_season_is_ibtracs_latest_and_provisional_labelled(self):
        with open(IBTRACS, newline="") as f:
            r = csv.reader(f)
            head = next(r)
            next(r)
            s, tt = head.index("SEASON"), head.index("TRACK_TYPE")
            seasons, prov = set(), set()
            for row in r:
                seasons.add(int(row[s]))
                if "PROVISIONAL" in row[tt]:
                    prov.add(int(row[s]))
        d = load("disasters")
        t = d["typhoons"]
        self.assertEqual(t["national"]["by_year"][-1]["year"], max(seasons))
        ps = t["provisional_seasons"]
        self.assertTrue(set(ps) <= prov)
        if ps:
            self.assertIn("provisional", t["rule"])
            self.assertIn("provisional", d["vintage"])
        for st in t["national"]["recent"] + t["national"]["strongest"]:
            self.assertEqual(st["provisional"], st["season"] in ps)

    def test_storms_unique(self):
        ids = [s["id"] for s in load("storm_tracks")["storms"]]
        self.assertEqual(len(ids), len(set(ids)))


class FxFreshness(unittest.TestCase):
    def test_fx_year_is_newest_published(self):
        rows = json.loads((ROOT / "data" / "stats" / "wb_fx.json").read_text())[1]
        newest = max(int(r["date"]) for r in rows if r["value"] is not None)
        cur = load("nation")["currency"]
        self.assertEqual(int(cur["fx_year"]), newest)
        if any(r["value"] is None and int(r["date"]) > newest for r in rows):
            self.assertIn("not yet published", cur["note"])  # the note says which year stands in
        else:
            self.assertNotIn("not yet published", cur["note"])


class AirportFreshness(unittest.TestCase):
    @unittest.skipUnless((RAW / "wikipedia_airports" / "busiest_airports.json").exists(), "airports table not downloaded")
    def test_passenger_year_is_newest_figure(self):
        from pipeline.build.infrastructure import airport_passengers
        pax = airport_passengers()
        for a in load("infrastructure")["airports"]:
            if a["id"] in pax:
                self.assertEqual((a["enplanements"], a["year"]), pax[a["id"]], a["id"])
            else:
                self.assertIsNone(a["enplanements"], a["id"])
        years = {y for _, y in pax.values()}
        self.assertIn(max(years), (2025, 2026))


if __name__ == "__main__":
    unittest.main()
