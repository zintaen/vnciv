"""History list (web/data/history.json) and the newer story chapters' sourced facts (web/js/ext/story/sources.js)."""
import gzip
import json
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
WEB = ROOT / "web" / "data"
RAW = ROOT / "data" / "raw" / "wikipedia_events"
HIST = ROOT / "data" / "stats" / "history"


def load(n):
    return json.loads((WEB / f"{n}.json").read_text(encoding="utf-8"))


class TestHistoryList(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.h = load("history")
        cls.ev = cls.h["events"]

    def test_ids_unique_and_old_ids_kept(self):
        ids = [e["id"] for e in self.ev]
        self.assertEqual(len(ids), len(set(ids)))
        for keep in ("provinces_34", "res_202_2025", "hue_city", "dong_nai_city", "quang_ninh_city", "bac_ninh_city", "thang_long"):
            self.assertIn(keep, ids)

    def test_every_event_is_dated_sourced_and_translated(self):
        web = set(json.loads((HIST / "web.json").read_text(encoding="utf-8")).values())
        cats = set(self.h["categories"])
        for e in self.ev:
            self.assertRegex(e["date"], r"^-?\d{3,4}(-\d{2}(-\d{2})?)?$", e["id"])
            self.assertIn(e["category"], cats, e["id"])
            for k in ("title", "text", "title_vi", "text_vi", "evidence", "placed"):
                self.assertTrue(e.get(k), (e["id"], k))
            self.assertTrue(e["cite"] in web or ("wikipedia.org/wiki/" in e["cite"] and isinstance(e["revid"], int)), e["id"])
            for a in e.get("also", []):
                self.assertTrue(a["cite"].startswith("https://") and a["evidence"], e["id"])

    def test_rules_and_size(self):
        for k in ("events", "date", "position", "cite", "neutral"):
            self.assertTrue(self.h["rules"].get(k), k)
        gz = len(gzip.compress((WEB / "history.json").read_bytes()))
        self.assertLess(gz, 200_000, f"history.json is {gz} bytes gzipped")

    def test_links_to_storms_and_wonders(self):
        storms = {(s["name"], s["season"]) for s in load("timeline")["storms"]}
        wonders = {w["id"] for w in load("wonders")["wonders"]}
        for e in self.ev:
            if e.get("storm"):
                self.assertIn((e["storm"]["name"], e["storm"]["season"]), storms, e["id"])
            if e.get("wonder"):
                self.assertIn(e["wonder"], wonders, e["id"])

    def test_coverage(self):
        """About 200+ events in every category; every round of province changes; the 2026 ward resolutions."""
        self.assertGreaterEqual(len(self.ev), 200)
        cats = {e["category"] for e in self.ev}
        self.assertEqual(cats, set(self.h["categories"]))
        admin_years = {e["year"] for e in self.ev if e["category"] == "admin"}
        for y in (1975, 1976, 1978, 1989, 1991, 1996, 2003, 2008, 2025, 2026):
            self.assertIn(y, admin_years, y)
        by = {e["id"]: e for e in self.ev}
        self.assertEqual(by["res_237_wards"]["cite"], "https://xaydungchinhsach.chinhphu.vn/thanh-lap-10-phuong-thuoc-tinh-dong-nai-119260421072221129.htm")
        self.assertEqual(by["res_388_wards"]["cite"], "https://en.daibieunhandan.vn/twelve-wards-established-in-bac-ninh-10427784.html")
        self.assertEqual((by["res_237_wards"]["date"], by["res_388_wards"]["date"]), ("2026-04-30", "2026-09-20"))
        for e in self.ev:
            self.assertTrue(e["placed_vi"], e["id"])
            if e["x"] is None:
                self.assertIn(e["placed"], ("No single place.", "Nationwide, before 968: no single place."), e["id"])

    @unittest.skipUnless(RAW.exists(), "raw Wikipedia extracts not downloaded")
    def test_evidence_is_in_the_cited_revision(self):
        arts = json.loads((HIST / "articles.json").read_text(encoding="utf-8"))
        cur = {}
        for f in HIST.glob("events*.json"):
            for e in json.loads(f.read_text(encoding="utf-8")):
                cur[e["id"]] = e
        for e in self.ev:
            name = cur[e["id"]]["raw_file"]
            if name not in arts:
                continue  # an official page (web.json)
            page = json.loads((RAW / name).read_text(encoding="utf-8"))["query"]["pages"][0]
            self.assertIn(e["evidence"], page["extract"], e["id"])
            self.assertEqual(e["revid"], page["revisions"][0]["revid"], e["id"])


class TestStorySources(unittest.TestCase):
    """Each ARTICLES entry in sources.js: its quotes are verbatim in the cached revision, its numbers are in its quotes."""

    def test_quotes(self):
        src = (ROOT / "web/js/ext/story/sources.js").read_text(encoding="utf-8")
        block = src[src.index("export const ARTICLES"):]
        entries = re.findall(r'raw: "([^"]+)", rev: (\d+),(.*?)quotes: \[(.*?)\] \}', block, re.S)
        self.assertGreaterEqual(len(entries), 7)
        for raw, rev, fields, quotes in entries:
            qs = [json.loads(q) for q in re.findall(r'"(?:[^"\\]|\\.)*"', quotes)]
            text = " ".join(qs)
            for k, v in re.findall(r'(\w+): (\d+)', fields):
                if k in ("rev",):
                    continue
                self.assertTrue(re.search(rf"(?<![\d,]){int(v):,}(?![\d,])|(?<!\d){v}(?!\d)", text), (raw, k, v))
            for d in re.findall(r'date: "(\d{4})-\d\d-\d\d"', fields):
                self.assertIn(d, text, raw)
            p = RAW / raw
            if not p.exists():
                continue
            page = json.loads(p.read_text(encoding="utf-8"))["query"]["pages"][0]
            self.assertEqual(int(rev), page["revisions"][0]["revid"], raw)
            for q in qs:
                self.assertIn(q, page["extract"], raw)


if __name__ == "__main__":
    unittest.main()
