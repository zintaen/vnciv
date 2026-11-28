"""Story chapters and compare tools (web/js/ext/story): the node self-test builds every chapter from web/data, and
every English string the story passes to t() has a Vietnamese translation somewhere in web/js/i18n."""
import json
import pathlib
import re
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
STORY = ROOT / "web/js/ext/story"


class StoryTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_chapters_build_from_data(self):
        out = subprocess.run(["node", str(STORY / "story.test.mjs")], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr or out.stdout)

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_every_string_translated(self):
        keys = set()
        for f in STORY.glob("*.js"):
            for m in re.finditer(r'\bt\(\s*("(?:[^"\\]|\\.)*")', f.read_text(encoding="utf-8")):
                keys.add(json.loads(m.group(1)))
        js = "import { VI } from './web/js/i18n/vi.js'; const k = JSON.parse(process.argv[1]); console.log(JSON.stringify(k.filter((x) => VI[x] == null)));"
        out = subprocess.run(["node", "--input-type=module", "-e", js, json.dumps(sorted(keys))], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(json.loads(out.stdout), [])

    def test_external_facts_are_cited(self):
        src = (STORY / "sources.js").read_text(encoding="utf-8")
        for needle in ("NY.GDP.PCAP.KD", "SP.URB.TOTL.IN.ZS", "SI.POV.DDAY", "wikipedia.org/wiki/Typhoon_Yagi", "CC BY 4.0"):
            self.assertIn(needle, src)


if __name__ == "__main__":
    unittest.main()
