"""Living map (ext/living): living.json invariants and the node self-test of its date logic."""
import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web" / "data"


class LivingData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.L = json.loads((WEB / "living.json").read_text())
        cls.W = json.loads((WEB / "world.json").read_text())

    def test_sources_registered(self):
        from pipeline import sources
        for sid in self.L["sources"]:
            self.assertIn(sid, sources.BY_ID, sid)

    def test_rice(self):
        r, cal = self.L["rice"], self.L["crop_calendar"]
        n = len(r["cells"])
        self.assertTrue(n > 300)
        self.assertEqual(len(r["region"]), n)
        self.assertEqual(len(r["share"]), n)
        regions = list(cal["regions"])
        for c, k, s in zip(r["cells"], r["region"], r["share"]):
            self.assertGreaterEqual(self.W["owner"][c], 0)
            self.assertFalse(self.W["water"][c])
            self.assertTrue(0 <= k < len(regions))
            self.assertTrue(0 < s <= 100)
        for reg in cal["regions"].values():
            self.assertTrue(reg["seasons"])
            for s in reg["seasons"]:
                for m in s["plant"] + s["harvest"]:
                    self.assertTrue(1 <= m <= 12)
        self.assertTrue(cal["source"] and cal["rule"])

    def test_flood(self):
        f = self.L["flood"]
        self.assertEqual(len(f["cells"]), len(f["share"]))
        self.assertTrue(len(f["cells"]) > 50)
        months = {int(m) for m, v in f["months"].items() if v > 0}
        self.assertTrue(months <= {7, 8, 9, 10, 11, 12}, months)
        self.assertIn("illustrative", f["note"].lower())
        # every flood hex is in the south (the Mekong Delta)
        ys = [c // self.W["grid"]["cols"] for c in f["cells"]]
        self.assertTrue(min(ys) > self.W["grid"]["rows"] * 0.6)

    def test_fishing_and_tet(self):
        fi = self.L["fishing"]
        self.assertTrue(0 < fi["min_nm"] < fi["max_nm"])
        self.assertIn("illustrative", fi["rule"].lower())
        dates = self.L["tet"]["dates"]
        for y in range(2000, 2041):
            self.assertIn(str(y), dates)
        self.assertEqual(dates["2027"][:4], "2027")

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_node_calendar(self):
        out = subprocess.run(["node", str(ROOT / "web/js/ext/living/living.test.mjs")], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stdout + out.stderr)


if __name__ == "__main__":
    unittest.main()
