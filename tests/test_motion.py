"""Checks on the motion data: storm_tracks.json, merger.json, motion_routes.json, night_lights.json."""
import gzip
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "data"
sys.path.insert(0, str(ROOT))
from pipeline.admin import NEW, OLD  # noqa: E402

FILES = ("storm_tracks", "merger", "motion_routes", "night_lights")


def load(name):
    return json.loads((DATA / f"{name}.json").read_text())


@unittest.skipUnless(all((DATA / f"{f}.json").exists() for f in FILES), "motion data not built")
class TestMotion(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world = load("world")
        cls.W, cls.H = cls.world["width"], cls.world["height"]

    def inside(self, pts, what):
        for x, y in pts:
            self.assertTrue(0 <= x <= self.W and 0 <= y <= self.H, f"{what}: ({x}, {y}) outside the map")

    def test_sizes(self):
        for f in FILES:
            self.assertLess(len(gzip.compress((DATA / f"{f}.json").read_bytes())), 1_500_000, f)

    def test_storms(self):
        tl = load("timeline")["storms"]
        st = load("storm_tracks")["storms"]
        self.assertEqual(len(st), len(tl))
        for s, t in zip(st, tl):  # same storms, same order
            self.assertEqual((s["name"], s["season"], s["date"], s["max_kt"]),
                             (t["name"], t["season"], t["date"], t["max_kt"]))
            self.assertIn(s["agency"], ("JMA", "JTWC"))
            times = [p[0] for p in s["points"]]
            self.assertTrue(times, s["id"])
            self.assertEqual(times, sorted(times), f"{s['id']} not sorted in time")
            self.assertEqual(len(set(times)), len(times), f"{s['id']} repeats a time")
            self.assertTrue(any(0 <= p[1] <= self.W and 0 <= p[2] <= self.H for p in s["points"]))
            self.assertTrue(all(p[3] is None or 0 <= p[3] <= 200 for p in s["points"]))
        self.assertEqual(len({s["id"] for s in st}), len(st))
        interim = ROOT / "data" / "interim" / "_storms.json"
        if interim.exists():
            self.assertEqual({s["id"] for s in st}, set(json.loads(interim.read_text())["storms"]))

    def test_merger(self):
        m = load("merger")["provinces"]
        iso = {name: i for i, name, _ in OLD.values()}
        want = {a: olds for a, olds in NEW.values() if len(olds) > 1}
        self.assertEqual(len(m), 23)
        self.assertEqual([p["order"] for p in m], list(range(1, 24)))
        self.assertEqual({p["abbr"] for p in m}, set(want))
        for p in m:
            self.assertEqual([x["name"] for x in p["members"]], want[p["abbr"]])
            self.assertEqual([x["iso"] for x in p["members"]], [iso[o] for o in want[p["abbr"]]])
            self.assertEqual(sum(x["keeps_name"] for x in p["members"]), 1, p["name"])
            self.inside([p["centroid"]] + [x["centroid"] for x in p["members"]], p["name"])
            self.assertEqual(self.world["states"][self.world["owner"][p["anchor"]]]["abbr"], p["abbr"])

    def test_routes(self):
        r = load("motion_routes")
        self.assertTrue(set(r["rules"]) >= {"rail", "sea", "air"})
        self.assertIn("llustrative", r["rules"]["sea"])
        self.assertIn("OpenFlights", r["rules"]["air"])
        self.assertEqual(r["rail"][0]["id"], "north_south")
        for line in r["rail"]:
            self.assertGreater(len(line["pts"]), 2)
            self.inside(line["pts"], line["id"])
        infra = load("infrastructure")
        self.assertEqual({s["port"] for s in r["sea"]}, {p["id"] for p in infra["ports"]})
        for s in r["sea"]:
            self.inside(s["pts"], s["port"])
            self.assertGreaterEqual(len(s["pts"]), 2)
        self.assertEqual(len(r["air"]), len(load("trade")["routes"]))
        for a in r["air"]:
            self.inside([a["p0"], a["c"], a["p1"]], f"{a['a']}-{a['b']}")  # a Bézier stays in its control hull

    def test_night_lights(self):
        n = load("night_lights")
        self.assertIn("population", n["rules"]["brightness"])
        self.assertEqual(len(n["values"]), len(self.world["owner"]))
        for v, o in zip(n["values"], self.world["owner"]):
            self.assertEqual(v is None, o < 0)
            self.assertTrue(v is None or 0 <= v <= 1)
        self.assertEqual(len(n["seats"]), 63)


if __name__ == "__main__":
    unittest.main()
