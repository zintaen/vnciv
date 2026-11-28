"""Embed mode (web/js/app/embed.js): the iframe code builder and the static oEmbed file (node self-test), and the
index.html links that go with them."""
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class EmbedTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_snippet_builder(self):
        out = subprocess.run(["node", str(ROOT / "web/js/app/embed.test.mjs")], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)

    def test_index_links(self):
        html = (ROOT / "web/index.html").read_text()
        self.assertIn('href="css/embed.css"', html)
        self.assertIn('type="application/json+oembed" href="https://atlasvn.online/oembed.json"', html)
        self.assertTrue((ROOT / "web/oembed.json").exists())

    def test_embed_module_first(self):
        # embed.js swaps localStorage before i18n.js reads the saved language: it must be main.js's first import
        # and import nothing itself.
        main = (ROOT / "web/js/main.js").read_text()
        self.assertTrue(main.lstrip().startswith('import { EMBED } from "./app/embed.js";'))
        self.assertNotRegex((ROOT / "web/js/app/embed.js").read_text(), r"(?m)^import ")


if __name__ == "__main__":
    unittest.main()
