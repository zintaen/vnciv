"""Bibliography and README facts agree with the built data (audit round 1)."""
import json
import math
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web" / "data"


def load(name):
    return json.loads((WEB / f"{name}.json").read_text())


class SourcesAudit(unittest.TestCase):
    def test_every_source_is_complete(self):
        for s in load("sources"):
            for k in ("license", "homepage", "used_for", "title", "publisher"):
                self.assertTrue(s.get(k), f"{s['id']} lacks {k}")

    def test_worldpop_used_only_for_density(self):
        # round 7: the Almanac claimed WorldPop weights the province lenses; they are spread by area (7 sample points)
        wp = next(s for s in load("sources") if s["id"] == "worldpop")
        self.assertEqual(wp["used_for"], ["Population density lens"])
        self.assertEqual([l["id"] for l in load("lenses")["lenses"] if l["source"] == "worldpop"], ["density"])

    def test_lens_sources_registered(self):
        ids = {s["id"] for s in load("sources")}
        for l in load("lenses")["lenses"]:
            self.assertIn(l["source"], ids, l["id"])

    def test_readme_hex_size_and_lens_count(self):
        readme = (ROOT / "README.md").read_text()
        w = load("world")
        km = w["grid"]["radius"] * w["km_per_unit"]
        self.assertIn(f"| Hexes | {km:g} km radius (~{round(1.5 * math.sqrt(3) * km * km)} km²)", readme)
        self.assertIn(f"1 map unit = {w['km_per_unit']:g} km", readme)
        n = len(load("lenses")["lenses"])
        self.assertEqual(re.findall(r"(\d+) lenses", readme), [str(n)])

    def test_ethnic_totals(self):
        e = load("ethnic")
        self.assertEqual(e["nation"]["total"], 96208984)  # census 1 April 2019, Table 2 "TOÀN QUỐC"
        self.assertEqual(sum(e["nation"]["pop"]), e["nation"]["total"])
        for lvl in ("former", "provinces"):
            self.assertEqual(sum(v["total"] for v in e[lvl].values()), 96208984, lvl)
            for v in e[lvl].values():
                self.assertEqual(sum(v["pop"]), v["total"], v["name"])


if __name__ == "__main__":
    unittest.main()
