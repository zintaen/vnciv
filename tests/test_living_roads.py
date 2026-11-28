import json
import unittest
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web" / "data"


class LivingRoads(unittest.TestCase):
    def test_links(self):
        d = json.loads((WEB / "living_roads.json").read_text())
        c0 = {(a, b) for a, b, c, _ in json.loads((WEB / "infrastructure.json").read_text())["roads"] if c == 0}
        links = d["links"]
        self.assertEqual({(a, b) for a, b, _ in links}, c0)
        self.assertEqual(len(links), len(c0))
        for a, b, y in links:
            self.assertLess(a, b)
            self.assertTrue(y is None or (type(y) is int and 1990 <= y <= 2026), y)
        self.assertEqual(sum(d["by_method"].values()), len(links))
        self.assertEqual(d["by_method"]["unknown"], sum(y is None for *_, y in links))
        self.assertEqual(sum(d["years"].values()), len(links) - d["by_method"]["unknown"])
        for y, n in d["years"].items():
            self.assertEqual(n, sum(l[2] == int(y) for l in links))
        self.assertEqual(d["sources"], ["osm_roads", "wikidata_roads", "viwiki_roads"])
        self.assertEqual(set(d["by_method"]), {"osm", "wikidata", "viwiki", "name", "unknown"})
        for name, r in d["routes"].items():
            self.assertTrue(name.startswith("Đường cao tốc "), name)
            self.assertTrue(1990 <= r["year"] <= 2026 and str(r["year"]) in r["quote"], name)
            self.assertTrue(r["source"].startswith("https://vi.wikipedia.org/wiki/"), name)
        self.assertTrue(d["rule"] and d["note"])


if __name__ == "__main__":
    unittest.main()
