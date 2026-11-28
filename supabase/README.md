# Contact form backend (Supabase)

The Author card's contact form (`web/js/app/contact.js`) POSTs JSON to the Edge Function `contact`
(`functions/contact/index.ts`). The function checks the origin (CORS: `https://atlasvn.online`, and
`http://127.0.0.1:<any port>` for local testing), the honeypot and the 3-second fill time, validates the fields,
allows at most 5 messages per hour per hashed IP, stores the message in `public.vnciv_contact_messages`
(`migrations/*_contact.sql`) with the service-role key, and e-mails it to CyberSkill through Resend with
`reply_to` set to the visitor's address. Raw IPs are never stored: `ip_hash = sha256(IP_HASH_SALT | ip)`.

Until `CONTACT_ENDPOINT` in `web/js/app/config.js` is set, the form offers a prefilled `mailto:info@cyberskill.world`
link instead (it does the same when a request fails).

## Deploy

You need the Supabase CLI (`npm i -g supabase` or `brew install supabase/tap/supabase`), a Supabase project, and a
Resend account with a verified sending domain.

1. Log in: `supabase login` (opens the browser).
2. Link this repo to the project (run from the repo root): `supabase link --project-ref <project-ref>`
   (the ref is the `xxxx` in `https://xxxx.supabase.co`).
3. Create the table. The atlas uses a shared "playground" project (ref `lvnzcwjxreamelewdwql`), so its objects are
   prefixed `vnciv_` and the migration is applied by hand rather than with `supabase db push` (which would also
   compare this repo's migration history with the other apps' in that project): Dashboard → SQL Editor → paste
   `supabase/migrations/20261128120000_contact.sql` → Run.
4. Set the secrets (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically):

   ```sh
   supabase secrets set \
     RESEND_API_KEY=re_xxx \
     CONTACT_FROM="Atlas Việt Nam <atlas@your-verified-domain>" \
     CONTACT_TO=info@cyberskill.world \
     IP_HASH_SALT="$(openssl rand -hex 32)"
   ```

5. Deploy the function without JWT verification:
   `supabase functions deploy vnciv-contact --no-verify-jwt`
6. In `web/js/app/config.js` set
   `CONTACT_ENDPOINT = "https://<project-ref>.supabase.co/functions/v1/vnciv-contact"` (leave `SUPABASE_ANON_KEY` empty),
   and add `https://<project-ref>.supabase.co` to `connect-src` in the CSP `<meta>` of `web/index.html`.

### Why `--no-verify-jwt`

The form is anonymous: the only "JWT" a static site could send is the project's anon key, which is public by design
(anyone can read it from the page), so verifying it stops no one. The protection that matters is in the function
itself: the origin check, the honeypot, the minimum fill time, the validation and the per-IP rate limit, plus RLS with
no policies on the table. Skipping JWT also keeps the anon key out of the page and lets the browser's CORS preflight
(which carries no `Authorization` header) reach the function. If you prefer JWT verification anyway, deploy without
the flag and put the anon key in `SUPABASE_ANON_KEY`; the form then sends it as `apikey` and `Authorization: Bearer`.

## Check it

```sh
curl -i -X POST "https://<project-ref>.supabase.co/functions/v1/contact" \
  -H "Origin: https://atlasvn.online" -H "Content-Type: application/json" \
  -d "{\"email\":\"you@example.com\",\"message\":\"Hello from the deploy check\",\"website\":\"\",\"lang\":\"en\",\"opened_at\":0,\"sent_at\":5000}"
# → 200 {"ok":true,"emailed":true}; a sixth message within the hour → 429 {"ok":false,"error":"rate_limited"}
```

Messages: Supabase dashboard → Table editor → `vnciv_contact_messages` (only the service role can read it). Logs:
dashboard → Edge Functions → contact → Logs.

# Error reports and usage counts (Supabase)

`web/js/app/telemetry.js` POSTs small JSON bodies to the Edge Function `vnciv-telemetry`
(`functions/vnciv-telemetry/index.ts`, validation in `check.ts`), which stores them in `public.vnciv_client_errors`
and `public.vnciv_events` (`migrations/20261128130000_telemetry.sql`).

What is sent, and what is not:

* **Errors**: uncaught errors and unhandled promise rejections: the message, script path, line, column, the first
  2,000 characters of the stack (origins, queries and hashes removed), the page path, the language, a viewport bucket
  (phone / tablet / desktop) and the deployed commit (`web/js/app/version.js`, stamped by CI). At most 5 per page
  view, each message once.
* **Events** (an allow-list; anything else is rejected): `page_view` (path, lang, referrer domain), `lens_chosen` (id),
  `layer_toggled` (id, on), `story_opened` (id), `tour_started`, `search_used` (the kind of result, never the
  query), `advisor_opened` (id), `share` (copy / image / embed), `contact_sent` (ok), `embed_view` (host domain).
  At most 60 per page view.
* **Never**: cookies, IDs in localStorage, fingerprints, IP addresses, user agents (the function keeps only the
  browser family it derives itself). The rate limit (30 errors / 600 events per hour) counts requests per
  `sha256(IP_HASH_SALT | day | ip)` in `vnciv_telemetry_rate`; that key changes every day and its rows are deleted
  after 2 days.
* Nothing is sent when the browser has Do-Not-Track or Global Privacy Control on, on `localhost` / `127.0.0.1`
  (add `?telemetry=1` to test locally), or after one request fails (so until the function is deployed each page view
  makes one failing request and then stays quiet).
* **Retention**: error and event rows are kept (they hold no personal data). `vnciv_telemetry_purge()` deletes only
  rate-limit rows older than 2 days; the function calls it on about 1 request in 200, so no pg_cron job is needed. Run it by hand any time with
  `select public.vnciv_telemetry_purge();`.

## Deploy (Anh)

From the repo root, with the Supabase CLI logged in and linked as for the contact form (steps 1–2 above):

1. Create the tables, functions and views: Dashboard → SQL Editor → New query → paste the whole of
   `supabase/migrations/20261128130000_telemetry.sql` → Run. It worked if the result says "Success. No rows returned"
   and Table editor lists `vnciv_client_errors`, `vnciv_events` and `vnciv_telemetry_rate`. (Not `supabase db push`:
   the project is shared, see step 3 above.)
2. The function reuses the contact form's `IP_HASH_SALT` secret, which is already set. Check with
   `supabase secrets list --project-ref lvnzcwjxreamelewdwql` (it lists `IP_HASH_SALT`).
3. Deploy without JWT verification (the same reasons as the contact form):
   `supabase functions deploy vnciv-telemetry --no-verify-jwt --project-ref lvnzcwjxreamelewdwql`
   It worked if the output ends with "Deployed Functions on project lvnzcwjxreamelewdwql: vnciv-telemetry".
4. Check it:

   ```sh
   curl -i -X POST "https://lvnzcwjxreamelewdwql.supabase.co/functions/v1/vnciv-telemetry" \
     -H "Origin: https://atlasvn.online" -H "Content-Type: text/plain" \
     -d '{"kind":"event","name":"tour_started","props":{}}'
   # → HTTP/2 204. A bad name → 400 {"ok":false,"error":"unknown_event"}; another origin → 403.
   ```

   Then in the SQL Editor `select * from vnciv_events order by id desc limit 5;` shows the row. Delete the test row
   with `delete from vnciv_events where name = 'tour_started' and created_at > now() - interval '10 minutes';`.

`TELEMETRY_ENDPOINT` in `web/js/app/config.js` already points at the function, and the CSP allows its origin.
To switch telemetry off, set it to `""`.

## Reading the numbers

Dashboard → SQL Editor (the dashboard's role can read the tables; the public API cannot). Days are in Vietnam time.

```sql
-- Page views per day, last 30 days
select day, sum(n) as views from vnciv_events_daily
where name = 'page_view' and day > current_date - 30 group by day order by day desc;

-- Every event per day (props are small: an id, a kind, on/off)
select day, name, props, n from vnciv_events_daily where day > current_date - 7 order by day desc, n desc;

-- Most chosen lenses, last 30 days
select props->>'id' as lens, sum(n) as times from vnciv_events_daily
where name = 'lens_chosen' and day > current_date - 30 group by 1 order by 2 desc;

-- Where visitors come from (referrer domains) and where the atlas is embedded
select name, coalesce(props->>'ref', props->>'host', '(direct)') as site, sum(n) from vnciv_events_daily
where name in ('page_view', 'embed_view') and day > current_date - 30 group by 1, 2 order by 3 desc;

-- Errors: the most frequent in the last 7 days, with the release and browsers
select message, source, version, sum(n) as times, max(last_seen) as last_seen, array_agg(distinct b) as browsers
from vnciv_errors_daily, unnest(browsers) b where day > current_date - 7 group by 1, 2, 3 order by times desc;

-- One error's stacks
select created_at, browser, viewport, stack from vnciv_client_errors where message like '%…%' order by id desc limit 10;
```

Logs: Dashboard → Edge Functions → vnciv-telemetry → Logs.

### Changing retention on a live database

The migration's `create or replace function public.vnciv_telemetry_purge()` block can be pasted again in the SQL
Editor on its own; it replaces the function in place (no data is touched).
