"""Contact form (web/js/app/contact.js) and its Supabase backend (supabase/): the client validation test, and the
security invariants of the migration and the Edge Function that must not regress."""
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class ContactTest(unittest.TestCase):
    def test_client(self):
        out = subprocess.run(["node", str(ROOT / "web/js/app/contact.test.mjs")], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)

    def test_config_is_a_single_small_module(self):
        src = (ROOT / "web/js/app/config.js").read_text()
        self.assertRegex(src, r'export const CONTACT_ENDPOINT = "[^"]*";')
        self.assertRegex(src, r'export const SUPABASE_ANON_KEY = "[^"]*";')

    def test_migration_rls_without_policies(self):
        sql = "\n".join(p.read_text() for p in (ROOT / "supabase/migrations").glob("*_contact.sql")).lower()
        self.assertIn("enable row level security", sql)
        self.assertNotIn("create policy", sql)
        self.assertRegex(sql, r"on public\.vnciv_contact_messages \(ip_hash, created_at\)")
        for col in ("id", "created_at", "name", "email", "message", "lang", "page_url", "ip_hash", "user_agent"):
            self.assertRegex(sql, rf"\n\s+{col}\s")
        self.assertNotRegex(sql, r"\n\s+ip\s")  # no raw IP column

    def test_function_guards(self):
        ts = (ROOT / "supabase/functions/vnciv-contact/index.ts").read_text()
        self.assertIn('o === "https://atlasvn.online"', ts)
        self.assertIn(r"/^http:\/\/127\.0\.0\.1(:\d{1,5})?$/", ts)
        self.assertIn("str(b.website)", ts)  # honeypot
        self.assertRegex(ts, r"MIN_FILL_MS = 3000")
        self.assertRegex(ts, r"PER_HOUR = 5")
        self.assertIn("IP_HASH_SALT", ts)
        self.assertIn("https://api.resend.com/emails", ts)
        self.assertIn("reply_to: input.email", ts)
        self.assertNotRegex(ts, re.compile(r"ip:\s*ip\b"))  # never inserts the raw IP


if __name__ == "__main__":
    unittest.main()
