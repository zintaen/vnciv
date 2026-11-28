"""cityart: the rule-based parts of the Vietnamese city and wonder art (render/art/city.js, render/art/sites.js,
ext/layers/model.js) stay in step with the data."""
import json
import math
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
CITY = (WEB / "js/render/art/city.js").read_text(encoding="utf-8")
SITES = (WEB / "js/render/art/sites.js").read_text(encoding="utf-8")
MODEL = (WEB / "js/ext/layers/model.js").read_text(encoding="utf-8")


def js_object_keys(src, name):
    body = re.search(r"export const " + name + r" = \{(.*?)\n\};", src, re.S).group(1)
    return set(re.findall(r"^\s*(\w+):", body, re.M)) | set(re.findall(r",\s*(\w+):", body))


class CityArt(unittest.TestCase):
    def test_old_quarter_rule(self):
        """OLD_QUARTER = cities whose hex or a neighbouring hex holds a UNESCO cultural World Heritage site."""
        world = json.loads((WEB / "data/world.json").read_text(encoding="utf-8"))
        R, cols = world["grid"]["radius"], world["grid"]["cols"]
        W, H = math.sqrt(3) * R, 1.5 * R
        cx = lambda i: W * ((i % cols) + 0.5 * ((i // cols) & 1))
        cy = lambda i: H * (i // cols)
        cities = json.loads((WEB / "data/cities.json").read_text(encoding="utf-8"))
        wonders = json.loads((WEB / "data/wonders.json").read_text(encoding="utf-8"))["wonders"]
        sites = [w["cell"] for w in wonders if w.get("rule") == "world_heritage" and w.get("kind") == "landmark"]
        want = {c["id"] for c in cities for s in sites if math.hypot(cx(s) - cx(c["cell"]), cy(s) - cy(c["cell"])) <= W * 1.01}
        have = set(re.findall(r'"([^"]+)"', re.search(r"export const OLD_QUARTER = new Set\(\[(.*?)\]\)", CITY).group(1)))
        self.assertEqual(have, want)

    def test_industrial_cells_rule(self):
        """INDUSTRIAL_CELLS = the hex holding the centre of each geo.json industrial park (same rounding as hex.js)."""
        g = json.loads((WEB / "data/world.json").read_text(encoding="utf-8"))["grid"]
        R, cols, rows = g["radius"], g["cols"], g["rows"]

        def cell_at(x, y):
            q, r = ((math.sqrt(3) / 3) * x - y / 3) / R, ((2 / 3) * y) / R
            rx, rz, ry = math.floor(q + 0.5), math.floor(r + 0.5), math.floor(-q - r + 0.5)
            dx, dy, dz = abs(rx - q), abs(ry + q + r), abs(rz - r)
            if dx > dy and dx > dz:
                rx = -ry - rz
            elif dy <= dz:
                rz = -rx - ry
            col = rx + ((rz - (rz & 1)) >> 1)
            return -1 if col < 0 or rz < 0 or col >= cols or rz >= rows else rz * cols + col

        parks = json.loads((WEB / "data/geo.json").read_text(encoding="utf-8"))["parks"]
        want = {c for p in parks if (c := cell_at(p["x"], p["y"])) >= 0}
        body = re.search(r"export const INDUSTRIAL_CELLS = new Set\(\[(.*?)\]\)", CITY, re.S).group(1)
        self.assertEqual({int(x) for x in re.findall(r"\d+", body)}, want)

    def test_no_us_landmarks_left(self):
        for word in ("drawChurch", "drawWaterTower", "steeple", "obelisk", "capitol dome", "cul-de-sac", "Cul-de-sac", "capitol", "Capitol"):
            self.assertNotIn(word, CITY, word)
        for word in ("paintStatue", "paintBallpark", "paintCarved", "paintSpike", "paintGantry", "paintAdobe", "paintMission", "joshua"):
            self.assertNotIn(word, SITES, word)

    def test_every_mapped_motif_is_drawn(self):
        paint = js_object_keys(SITES, "MOTIF_LABELS")
        mapped = set(re.findall(r'"[a-z]+-Q?\w+": "(\w+)"', MODEL)) | {"campus", "forest"}
        self.assertTrue(mapped <= paint, mapped - paint)
        body = re.search(r"const MOTIF_PAINT = \{(.*?)\n\};", SITES, re.S).group(1)
        self.assertEqual(set(re.findall(r"(\w+):", body)), paint)
        for kind, motifs in re.findall(r"^\s*(natural|university|landmark): \[(.*?)\]", SITES, re.M):
            self.assertTrue(set(re.findall(r'"(\w+)"', motifs)) <= paint, kind)
        wonders = json.loads((WEB / "data/wonders.json").read_text(encoding="utf-8"))["wonders"]
        for w in wonders:  # every university, World Heritage site and landmark has a motif chosen for it
            if w["kind"] in ("landmark",) or w.get("rule") == "world_heritage":
                self.assertIn(f'"{w["id"]}"', MODEL, w["id"])

    def test_living_stamp_names_kept(self):
        """ext/living/sway.js finds houses by these terrain.js stamp names; the suburb sprite must keep its name."""
        terrain = (WEB / "js/render/art/terrain.js").read_text(encoding="utf-8")
        self.assertIn("suburbBuild: SUBURB_ART.build", terrain)
        for name in ("village", "stilt", "palm"):
            self.assertIn(f"{name}: {{ box:", terrain, name)
        self.assertIn("suburbBuild: 4", (WEB / "js/ext/living/sway.js").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
