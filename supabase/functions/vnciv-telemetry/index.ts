// Supabase Edge Function "vnciv-telemetry": anonymous error reports and usage counts from the atlas
// (web/js/app/telemetry.js) → public.vnciv_client_errors / public.vnciv_events. Deploy steps: supabase/README.md.
//
// Env (supabase secrets set …): IP_HASH_SALT (shared with vnciv-contact). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// are provided by Supabase.
//
// Request: POST (text/plain or application/json) {kind: "error", message, source?, line?, col?, stack?, path?, lang?,
// viewport?, version?} or {kind: "event", name, props} (names and props: check.ts EVENTS).
// Response: 204, or JSON {ok: false, error: "<code>"} with a 4xx / 5xx status.
//
// Privacy: no IP and no user agent is stored. The rate limit counts requests per sha256(IP_HASH_SALT | day | ip) in
// vnciv_telemetry_rate (rows kept 2 days; the day in the hash means yesterday's key cannot be linked to today's);
// only the browser family is kept of the user agent. Error and event rows are kept; vnciv_telemetry_purge() deletes only the 2-day rate-limit rows,
// which this function calls on about 1 request in 200.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { check } from "./check.ts";

const MAX_BODY = 4096;
const PER_HOUR = { error: 30, event: 600 }; // per IP hash
const PURGE_EVERY = 200;

const isAllowedOrigin = (o: string | null) =>
  !!o && (o === "https://atlasvn.online" || /^http:\/\/127\.0\.0\.1(:\d{1,5})?$/.test(o));

function cors(origin: string | null): Record<string, string> {
  const h: Record<string, string> = { "Vary": "Origin" };
  if (isAllowedOrigin(origin)) {
    h["Access-Control-Allow-Origin"] = origin!;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "content-type, apikey, authorization, x-client-info";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = cors(origin);
  const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: isAllowedOrigin(origin) ? 204 : 403, headers });
  if (req.method !== "POST") return json(405, { ok: false, error: "method" });
  if (!isAllowedOrigin(origin)) return json(403, { ok: false, error: "origin" });

  const env = (k: string) => Deno.env.get(k) || "";
  const salt = env("IP_HASH_SALT");
  if (!salt) {
    console.error("telemetry: missing IP_HASH_SALT");
    return json(500, { ok: false, error: "config" });
  }

  if (Number(req.headers.get("content-length") || 0) > MAX_BODY) return json(413, { ok: false, error: "too_large" });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { ok: false, error: "too_large" });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
  } catch {
    return json(400, { ok: false, error: "bad_json" });
  }
  const res = check(body, req.headers.get("user-agent") || "");
  if ("error" in res) return json(400, { ok: false, error: res.error });

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "").trim() || "unknown";
  const kind = res.table === "vnciv_events" ? "event" : "error";
  const key = `${await sha256Hex(`${salt}|${new Date().toISOString().slice(0, 10)}|${ip}`)}:${kind}`;
  const { data: allowed, error: rateErr } = await db.rpc("vnciv_telemetry_hit", { p_key: key, p_limit: PER_HOUR[kind] });
  if (rateErr) {
    console.error("telemetry: rate-limit call failed", rateErr.message);
    return json(500, { ok: false, error: "db" });
  }
  if (!allowed) return json(429, { ok: false, error: "rate_limited" });

  const { error: insErr } = await db.from(res.table).insert(res.row);
  if (insErr) {
    console.error("telemetry: insert failed", insErr.message);
    return json(500, { ok: false, error: "db" });
  }
  if (Math.random() < 1 / PURGE_EVERY) {
    const { error: purgeErr } = await db.rpc("vnciv_telemetry_purge");
    if (purgeErr) console.error("telemetry: purge failed", purgeErr.message);
  }
  return new Response(null, { status: 204, headers });
});
