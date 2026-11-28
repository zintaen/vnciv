"""Hex art (render/art/terrain.js Vietnamese motifs) and living tiles (ext/hexlife): the node self-test of the field
art and life placement, and no US farm motifs left in the tile art."""
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class HexArt(unittest.TestCase):
    def test_no_us_farm_motifs(self):
        src = (ROOT / "web/js/render/art/terrain.js").read_text()
        for word in ("paintBarn", "paintPivot", "pivotCountry", "inGreatBasin", "onPlateau", "township"):
            self.assertNotIn(word, src, word)
        sway = (ROOT / "web/js/ext/living/sway.js").read_text()
        for name in ("village", "stilt", "tree", "clump"):  # the stamp names sway.js looks for exist in terrain.js
            self.assertIn(f"{name}:", sway)
            self.assertIn(f"  {name}: {{", src)

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_node_placement(self):
        out = subprocess.run(["node", str(ROOT / "web/js/ext/hexlife/hexlife.test.mjs")], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr + out.stdout)


if __name__ == "__main__":
    unittest.main()
