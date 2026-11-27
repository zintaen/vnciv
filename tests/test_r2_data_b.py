"""Audit round 2 (data, b): relic article links, relic name typos, history citations."""
import json
import unittest
from pathlib import Path

from pipeline.build import ext_poi as E

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "data"


class TestRelicLinks(unittest.TestCase):
    def test_link_rules(self):
        L = lambda c: (m := E.relic_link(c)) and m.group(1)
        self.assertEqual(L("[[Chùa Tây Phương]]"), "Chùa Tây Phương")
        self.assertEqual(L('Khu di tích [[Phố Hiến]]<ref name="x">{{Chú thích web|url=a}}</ref>'), "Phố Hiến")
        self.assertEqual(L("Quần thể Hương Sơn ([[Chùa Hương]])<ref>r</ref>"), "Chùa Hương")
        self.assertIsNone(L("Tây Thiên - [[Tam Đảo]]<ref>r</ref>"))  # a link to part of the name only
        self.assertIsNone(L("Khu đền thờ [[Tây Sơn Tam Kiệt]]"))  # the people, not the temple

    def test_no_typo_names(self):
        names = [r["name"] for r in E.relic_rows()]
        self.assertIn("Quần thể di tích Tây Sơn Thượng Đạo", names)
        self.assertFalse([n for n in names if any(ch.isdigit() for ch in n) and ")" in n and "(" not in n], names)

    def test_categories_one_spelling(self):
        # the kinds web/js/ext/poi/index.js RELIC_CAT_EN translates, joined by ", "
        kinds = {"lịch sử", "kiến trúc nghệ thuật", "khảo cổ", "danh lam thắng cảnh"}
        for r in E.relic_rows():
            parts = r["category"].lower().removeprefix("di tích ").split(", ")
            self.assertTrue(set(parts) <= kinds, r["category"])

    def test_mid_name_links_placed(self):
        # needs `build ext_poi` after the relic_link fix
        r = json.loads((DATA / "relics.json").read_text())
        placed = {x[2]: x for x in r["relics"]}
        for name, art, st in (("Khu di tích Phố Hiến", "Phố Hiến", "HYE"), ("Quần thể Hương Sơn (Chùa Hương)", "Chùa Hương", "HN")):
            self.assertIn(name, placed)
            self.assertEqual(placed[name][6], art)
            self.assertEqual(r["states"][placed[name][3]], st)
        self.assertEqual(len(r["relics"]) + len(r["unplaced"]), r["listed"])


class TestHistoryCitations(unittest.TestCase):
    def test_split_1991_cites_the_article_that_lists_the_splits(self):
        ev = {e["id"]: e for e in json.loads((ROOT / "data" / "stats" / "history" / "events.json").read_text())}["split_1991"]
        page = json.loads((ROOT / "data" / "raw" / "wikipedia_history" / ev["raw_file"]).read_text())["query"]["pages"][0]
        for prov in ("Nghệ Tĩnh", "Hoàng Liên Sơn", "Hà Tuyên", "Gia Lai – Kon Tum", "Hà Sơn Bình", "Hà Tây"):
            self.assertIn(prov, ev["evidence"])
        self.assertIn(ev["evidence"], page["extract"])
        h = {e["id"]: e for e in json.loads((DATA / "history.json").read_text())["events"]}["split_1991"]
        self.assertEqual(h["cite"], ev["cite_url"])
        self.assertTrue(h["cite"].startswith("https://vi.wikipedia.org/"))


if __name__ == "__main__":
    unittest.main()
