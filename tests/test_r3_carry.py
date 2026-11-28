"""Checks for the audit round 3 carry-over fixes: Vietnamese alphabetical order, lens legend ticks."""
import json
import shutil
import subprocess
import unittest
from pathlib import Path

from pipeline.admin import vi_key

ROOT = Path(__file__).resolve().parent.parent


class TestR3Carry(unittest.TestCase):
    def test_vi_key(self):
        want = ["ca", "cà", "cả", "cã", "cá", "cạ", "Cà Mau", "Cao Bằng", "Cần Thơ", "Cầu Long Biên", "Chùa Một Cột",
                "Dinh Độc Lập", "Đền Hùng", "Địa đạo Củ Chi", "Ea Súp", "Ô Môn", "Ơn", "Uông Bí", "Ưng Hòa"]
        self.assertEqual(sorted(reversed(want), key=vi_key), want)

    def test_landmarks_in_vietnamese_order(self):
        w = json.loads((ROOT / "web/data/wonders.json").read_text())["wonders"]
        marks = sorted((x for x in w if x["rule"] == "landmark"), key=lambda x: x["rank"])
        self.assertEqual([x["short"] for x in marks], sorted((x["short"] for x in marks), key=vi_key))
        self.assertEqual(marks[0]["short"], "Cầu Long Biên")

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_lens_ticks(self):
        js = ("const L = await import('./web/js/ui/lenses.js');"
              "const d = JSON.parse((await import('fs')).readFileSync('web/data/lenses.json'));"
              "const ticks = (id) => { const l = d.lenses.find((x) => x.id === id); return [0, .25, .5, .75, 1].map((p, k) => L.formatLensTick(l, p, k)); };"
              "process.stdout.write(JSON.stringify([ticks('low_lying'), ticks('rainfall'), ticks('industry_jobs_2026')]));")
        out = subprocess.run(["node", "--input-type=module", "-e", js], cwd=ROOT, capture_output=True, text=True)
        low, rain, jobs = json.loads(out.stdout or "null") or self.fail(out.stderr)
        self.assertEqual((low[0], low[4]), ("0%", "100%"))  # a share's natural bounds: no ≤ / ≥
        self.assertEqual(rain[0], "≤ 1.302")  # mm in full, not "1,3K"
        self.assertTrue(jobs[0].startswith("≤ ") and jobs[4].startswith("≥ "))  # a growth rate does clamp


if __name__ == "__main__":
    unittest.main()
