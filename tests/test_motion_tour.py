"""Day–night sun formula and the tour's data-driven stops (node self-tests in web/js/ext/daynight and ext/tour)."""
import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


@unittest.skipUnless(shutil.which("node"), "node not installed")
class MotionTourTest(unittest.TestCase):
    def run_node(self, rel):
        out = subprocess.run(["node", str(ROOT / rel)], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr or out.stdout)

    def test_sun(self):
        self.run_node("web/js/ext/daynight/sun.test.mjs")

    def test_tour_stops(self):
        self.run_node("web/js/ext/tour/tour.test.mjs")


if __name__ == "__main__":
    unittest.main()
