"""atmos: live weather + ambient sound (web/js/ext/atmos). Projection matches the pipeline, strings are translated,
the only network host is Open-Meteo, and the sound is synthesised (no audio files)."""
import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / "web/js/ext/atmos"


@unittest.skipUnless(shutil.which("node"), "node not installed")
class AtmosNode(unittest.TestCase):
    def test_geo_selftest(self):
        out = subprocess.run(["node", str(EXT / "geo.test.mjs")], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr + out.stdout)

    def test_projection_matches_pipeline(self):
        from pipeline.geo import MapProjection
        from pipeline.build.world import FRAME, MARGIN
        proj = MapProjection(FRAME["min_x"], FRAME["max_y"], MARGIN)
        pts = [(105.85, 21.03), (106.7, 10.78), (103.5, 22.5), (112.0, 9.0), (108.2, 16.05)]
        js = ("import('./web/js/ext/atmos/geo.js').then(m => console.log(JSON.stringify("
              + json.dumps(pts) + ".map(([a, b]) => m.lonLatToMap(a, b)))))")
        out = subprocess.run(["node", "--input-type=module", "-e", js], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        for (lo, la), (x, y) in zip(pts, json.loads(out.stdout)):
            px, py = proj(lo, la)
            self.assertAlmostEqual(x, px, places=6)
            self.assertAlmostEqual(y, py, places=6)


class AtmosStatic(unittest.TestCase):
    def src(self):
        return "\n".join(p.read_text() for p in sorted(EXT.glob("*.js")) if not p.name.endswith(".test.mjs"))

    def test_strings_translated(self):
        vi = (ROOT / "web/js/i18n/vi-atmos.js").read_text()
        keys = set(re.findall(r'^\s*"((?:[^"\\]|\\.)*)":', vi, re.M))
        src = self.src()
        used = set(re.findall(r'\bt\("((?:[^"\\]|\\.)*)"', src))
        # labels passed to t() indirectly: WMO codes and compass points
        used |= set(re.findall(r'\d+: "([^"]+)"', (EXT / "geo.js").read_text()))
        used |= set(re.findall(r'"(the (?:north|south|east|west)[a-z-]*)"', src))
        used |= set(re.findall(r'\bt\("((?:[^"\\]|\\.)*)"', (ROOT / "web/js/ext/view3d/index.js").read_text())) & {
            "Height ×{n}", "Vertical exaggeration: click for taller, then flatter hexes"}
        self.assertEqual(sorted(used - keys), [])

    def test_network_and_audio(self):
        src = self.src()
        hosts = set(re.findall(r"https?://([a-z0-9.-]+)", re.sub(r"(?m)^\s*//.*$", "", src)))
        self.assertEqual(hosts, {"api.open-meteo.com"})
        self.assertIn("Open-Meteo.com", src)  # attribution shown
        self.assertIn('credentials: "omit"', src)
        self.assertNotRegex(src, r"\.(mp3|ogg|wav|m4a)\b")
        self.assertEqual([p for p in EXT.rglob("*") if p.suffix in {".mp3", ".ogg", ".wav", ".m4a"}], [])
        self.assertIn("sessionStorage", src)
        self.assertRegex(src, r"default: false, hash: false")  # sound: off by default, not in the URL


if __name__ == "__main__":
    unittest.main()
