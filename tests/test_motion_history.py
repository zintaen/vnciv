"""Invariants the timeline replays (web/js/ext/timeline/replay.js) rely on."""
import json
import shutil
import subprocess
import unittest
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "web" / "data"


def load(name):
    return json.loads((DATA / f"{name}.json").read_text())


class ReplayData(unittest.TestCase):
    def test_storm_tracks_match_timeline(self):
        tracks, tl = load("storm_tracks")["storms"], load("timeline")["storms"]
        self.assertEqual(len(tracks), len(tl))  # storms[i] is storms[i]
        for a, b in zip(tracks, tl):
            self.assertEqual((a["name"], a["season"]), (b["name"], b["season"]))
            times = [p[0] for p in a["points"]]
            self.assertEqual(times, sorted(times))

    def test_merger_order_and_members(self):
        m, w = load("merger"), load("world")
        self.assertEqual(sorted(p["order"] for p in m["provinces"]), list(range(1, 24)))
        abbrs = {s["abbr"] for s in w["states"]}
        isos = {c["geoid"] for c in w["counties"]}
        for p in m["provinces"]:
            self.assertIn(p["abbr"], abbrs)
            for mem in p["members"]:
                self.assertIn(mem["iso"], isos)
        self.assertEqual(len(abbrs) - len(m["provinces"]), 11)  # the 11 unchanged provinces

    def test_forest_years(self):
        f = load("forest_loss")
        self.assertEqual(len(f["loss_ha"]), len(f["years"]))
        self.assertEqual(len(f["national"]["loss_ha"]), len(f["years"]))
        for row in f["loss_ha"]:
            self.assertEqual(len(row), len(f["cells"]))


@unittest.skipUnless(shutil.which("node"), "node not installed")
class MotionEngine(unittest.TestCase):
    def test_engine(self):  # hidden tab pauses tweens; effects off never lets a cancelled tween overwrite the end
        root = DATA.parents[1]
        out = subprocess.run(["node", str(root / "web/js/app/motion.test.mjs")], cwd=root, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr or out.stdout)

    def test_storm_hexes_light_on_counted_stretches(self):  # replay.js prepStorm follows the lens's 34 kt rule
        src = (DATA.parents[0] / "js/ext/timeline/replay.js").read_text()
        self.assertIn("if (!(Math.max(kt[j] || 0, kt[j + 1] || 0) >= 34)) continue;", src)


if __name__ == "__main__":
    unittest.main()
