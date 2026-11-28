"""Ops: the split lens files (pipeline/build/pack.py) carry exactly lenses.json's values; telemetry
(web/js/app/telemetry.js → supabase/functions/vnciv-telemetry) keeps to its allow-list and stores nothing personal."""
import json
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

from pipeline.build.pack import pack

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "data"


class PackTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.L = json.loads((DATA / "lenses.json").read_text())

    def check(self, out):
        index = json.loads((out / "lenses_index.json").read_text())
        self.assertEqual({k: v for k, v in index.items() if k != "lenses"}, {k: v for k, v in self.L.items() if k != "lenses"})
        self.assertEqual([l["id"] for l in index["lenses"]], [l["id"] for l in self.L["lenses"]])
        for meta, full in zip(index["lenses"], self.L["lenses"]):
            self.assertNotIn("values", meta)
            self.assertEqual(meta, {k: v for k, v in full.items() if k != "values"})
            self.assertEqual(json.loads((out / "lens" / f"{full['id']}.json").read_text()), full["values"], full["id"])
        self.assertEqual(sorted(p.stem for p in (out / "lens").glob("*.json")), sorted(l["id"] for l in self.L["lenses"]))

    def test_pack_equals_lenses_json(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            (out / "lens").mkdir()
            (out / "lens" / "gone.json").write_text("[]")  # a removed lens's file is deleted
            pack(self.L, out)
            self.check(out)
            self.assertLess((out / "lenses_index.json").stat().st_size, 100_000)

    def test_local_split_is_current(self):
        """The served copy (gitignored; made on every lenses.json write) matches lenses.json, when present."""
        if not (DATA / "lenses_index.json").exists():
            self.skipTest("not packed here (CI packs before the upload)")
        self.check(DATA)


class TelemetryTest(unittest.TestCase):
    def test_client_and_function(self):
        out = subprocess.run(["node", "--experimental-strip-types", "--no-warnings", str(ROOT / "web/js/app/telemetry.test.mjs")],
                             cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)

    def test_migration(self):
        sql = (ROOT / "supabase/migrations/20261128130000_telemetry.sql").read_text().lower()
        tables = re.findall(r"create table if not exists public\.(\w+)", sql)
        self.assertEqual(tables, ["vnciv_client_errors", "vnciv_events", "vnciv_telemetry_rate"])
        for t in tables:
            self.assertIn(f"alter table public.{t} enable row level security", sql)
        self.assertNotIn("create policy", sql)
        self.assertRegex(sql, r"revoke all on table [^;]*from anon, authenticated")
        self.assertRegex(sql, r"revoke all on function [^;]*from public, anon, authenticated")
        self.assertRegex(sql, r"revoke all on public\.vnciv_events_daily, public\.vnciv_errors_daily from anon, authenticated")
        self.assertNotRegex(sql, r"\n\s+(ip|ip_hash|user_agent|ua|email|session_id|visitor_id)\s")  # no personal columns
        self.assertIn("interval '2 days'", sql)  # rate rows only; error/event rows are kept (Anh, 2026-11-28)
        self.assertNotIn("delete from public.vnciv_events", sql)
        for name in re.findall(r"create (?:table if not exists|or replace (?:function|view)) public\.(\w+)", sql):
            self.assertTrue(name.startswith("vnciv_"), name)

    def test_function_guards(self):
        ts = (ROOT / "supabase/functions/vnciv-telemetry/index.ts").read_text()
        self.assertIn('o === "https://atlasvn.online"', ts)
        self.assertIn(r"/^http:\/\/127\.0\.0\.1(:\d{1,5})?$/", ts)
        self.assertIn("IP_HASH_SALT", ts)
        self.assertRegex(ts, r"MAX_BODY = 4096")
        self.assertNotRegex(ts, r"\bip(_hash)?\s*:")  # neither the IP nor its hash goes into a row
        self.assertNotIn("user_agent", ts)

    def test_config(self):
        src = (ROOT / "web/js/app/config.js").read_text()
        self.assertIn('export const TELEMETRY_ENDPOINT = "https://lvnzcwjxreamelewdwql.supabase.co/functions/v1/vnciv-telemetry";', src)
        self.assertRegex((ROOT / "web/js/app/version.js").read_text(), r'export const VERSION = "[^"]+";')


if __name__ == "__main__":
    unittest.main()
