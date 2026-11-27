"""Checks for the audit round 2 carry-over fixes (run after a build): universities, airport names, per-resident years,
counties labels, relic sources, the Dầu Tiếng solar double count, and two pure JS helpers (via node, when present)."""
import json
import shutil
import subprocess
import unicodedata
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "data"
INTERIM = ROOT / "data" / "interim"


def load(name):
    return json.loads((DATA / f"{name}.json").read_text())


def fold(s):
    s = (s or "").replace("Đ", "D").replace("đ", "d")
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()


class TestCarryFixes(unittest.TestCase):
    def test_universities(self):
        unis = [w for w in load("wonders")["wonders"] if w["rule"] == "research_university"]
        names = [w["name"] for w in unis]
        self.assertEqual(names[:2], ["Đại học Quốc gia Hà Nội", "Đại học Quốc gia Thành phố Hồ Chí Minh"])
        self.assertEqual(set(names[2:]), {"Đại học Huế", "Đại học Đà Nẵng", "Đại học Cần Thơ", "Đại học Thái Nguyên"})
        self.assertNotIn("uni-Q4116346", {w["id"] for w in unis}, "Q4116346 is a sponge genus, not Thái Nguyên")
        short = {w["name"]: (w["short"], w.get("short_en")) for w in unis}
        self.assertEqual(short["Đại học Quốc gia Hà Nội"], ("ĐHQG Hà Nội", "VNU Hà Nội"))
        self.assertEqual(short["Đại học Quốc gia Thành phố Hồ Chí Minh"], ("ĐHQG TP.HCM", "VNU TP.HCM"))
        tn = next(w for w in unis if w["name"] == "Đại học Thái Nguyên")
        self.assertEqual(tn["state"], "TNG")  # the OSM campus in Thái Nguyên city

    def test_airport_names(self):
        airports = load("infrastructure")["airports"]
        by = {a["id"]: a for a in airports}
        self.assertEqual(by["SGN"]["name_vi"], "Sân bay quốc tế Tân Sơn Nhất")
        self.assertEqual(by["SGN"]["name"], "Tan Son Nhat International Airport")  # English kept for en
        self.assertEqual(by["PQC"]["name_vi"], "Sân bay quốc tế Phú Quốc")  # not the old Dương Đông airfield
        for a in airports:
            self.assertTrue(a["name_vi"], a["id"])
            self.assertFalse(a["name_vi"].startswith("Dự án"), a["id"])

    def test_per_resident_same_year(self):
        d, cities = load("districts"), load("cities")
        years = json.loads((INTERIM / "_stats.json").read_text())["years"]
        rows = json.loads((INTERIM / "_stats.json").read_text())["rows"]
        for k in ("fdi", "students"):
            y = years[k][:4]
            nat = sum(rows[c["id"]][k] or 0 for c in cities) / sum(c["pop_series"][y] for c in cities)
            self.assertAlmostEqual(d["national"][k], round(nat, 2), places=2, msg=k)

    def test_counties_labels_say_the_year(self):
        years = json.loads((INTERIM / "_stats.json").read_text())["years"]
        f = {x["key"]: x["label"] for x in load("counties")["fields"]}
        for k in ("literacy", "housing", "students", "hdi", "fdi", "pci"):
            self.assertTrue(f[k].endswith(f"({years[k]})"), f[k])

    def test_relic_sources(self):
        r = load("relics")
        ids = {s["id"] for s in load("sources")}
        self.assertTrue(set(r["sources"]) <= ids)
        if any(x[-1] == "wikidata" for x in r["relics"]):
            self.assertIn("wikidata", r["sources"])

    def test_dau_tieng_counted_once(self):
        solar = [i for i in load("resources")["items"] if i["type"] == "solar" and "dau tieng" in fold(i["name"])]
        self.assertEqual(len(solar), 1, solar)

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_js_helpers(self):
        js = ("Promise.all([import('./web/js/app/search.js'), import('./web/js/app/share.js')]).then(([s, sh]) => {"
              "const e = s.exact; const ok = [['Hoà','Hòa'],['Hoá','Hóa'],['Thuỷ','Thủy'],['uỳ','ùy'],['Khánh Hoà','Khánh Hòa']]"
              ".every(([a, b]) => e(a) === e(b)) && e('Quý') !== e('Qúy') && s.norm('Hà Nội') === 'ha noi'"
              "&& sh.sharedUnit('≤ 1,3K mm mỗi năm', '≥ 3,4K mm mỗi năm') === ' mm mỗi năm'"
              "&& sh.sharedUnit('≤ 5 người', '≥ 5 người') === '' && sh.sharedUnit('≤ $1.3K', '≥ $16K') === '';"
              "process.stdout.write(String(ok)); })")
        out = subprocess.run(["node", "--input-type=module", "-e", js], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(out.stdout, "true", out.stderr)


if __name__ == "__main__":
    unittest.main()
