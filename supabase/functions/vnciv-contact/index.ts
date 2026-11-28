// Supabase Edge Function "vnciv-contact": receives the atlas's contact form (web/js/app/contact.js), stores it in
// public.vnciv_contact_messages and e-mails it to CyberSkill through Resend. Deploy steps: supabase/README.md.
//
// Env (supabase secrets set …): RESEND_API_KEY, CONTACT_FROM (a sender on a domain verified in Resend),
// CONTACT_TO (default info@cyberskill.world), IP_HASH_SALT (a long random string). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
//
// Request: POST JSON {name?, email, message, website (honeypot, must be empty), lang, page_url, opened_at, sent_at}
// (opened_at / sent_at: the client's clock in ms, when the form opened and when it was sent).
// Response: JSON {ok: true} or {ok: false, error: "<code>"} with a 4xx / 5xx status.
import { createClient } from "jsr:@supabase/supabase-js@2";

const LIMITS = { name: 120, email: 254, messageMin: 10, messageMax: 4000, pageUrl: 500, userAgent: 300, body: 16_000 };
const MIN_FILL_MS = 3000; // faster than this from opening the form = a bot
const PER_HOUR = 5; // messages per IP hash per hour
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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

const chars = (s: string) => [...s].length; // code points, as Postgres char_length counts them
const str = (v: unknown) => (typeof v === "string" ? v : "");
const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, " ").trim();

type Input = { name: string; email: string; message: string; lang: string | null; pageUrl: string | null };

/** Validates the parsed body: {input} or {error} (an error code for the client). */
export function check(b: Record<string, unknown>): { input?: Input; error?: string } {
  if (str(b.website)) return { error: "rejected" }; // the honeypot is filled: a bot
  const opened = Number(b.opened_at), sent = Number(b.sent_at);
  if (!Number.isFinite(opened) || !Number.isFinite(sent) || sent - opened < MIN_FILL_MS) return { error: "rejected" };
  const name = oneLine(str(b.name)), email = str(b.email).trim(), message = str(b.message).trim();
  if (chars(name) > LIMITS.name) return { error: "invalid_name" };
  if (!email || email.length > LIMITS.email || !EMAIL_RE.test(email)) return { error: "invalid_email" };
  if (chars(message) < LIMITS.messageMin || chars(message) > LIMITS.messageMax) return { error: "invalid_message" };
  const lang = b.lang === "vi" || b.lang === "en" ? b.lang : null;
  const pageUrl = str(b.page_url).slice(0, LIMITS.pageUrl) || null;
  return { input: { name, email, message, lang, pageUrl } };
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
  const salt = env("IP_HASH_SALT"), resendKey = env("RESEND_API_KEY"), from = env("CONTACT_FROM");
  const to = env("CONTACT_TO") || "info@cyberskill.world";
  if (!salt || !resendKey || !from) {
    console.error("contact: missing IP_HASH_SALT, RESEND_API_KEY or CONTACT_FROM");
    return json(500, { ok: false, error: "config" });
  }

  const raw = await req.text();
  if (raw.length > LIMITS.body) return json(413, { ok: false, error: "too_large" });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
  } catch {
    return json(400, { ok: false, error: "bad_json" });
  }
  const { input, error } = check(body);
  if (!input) return json(400, { ok: false, error });

  // The caller's IP, hashed with a secret salt (never stored raw). Supabase's gateway sets x-forwarded-for.
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "").trim() || "unknown";
  const ipHash = await sha256Hex(`${salt}|${ip}`);

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count, error: countErr } = await db.from("vnciv_contact_messages")
    .select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", since);
  if (countErr) {
    console.error("contact: rate-limit query failed", countErr.message);
    return json(500, { ok: false, error: "db" });
  }
  if ((count ?? 0) >= PER_HOUR) return json(429, { ok: false, error: "rate_limited" });

  const { error: insErr } = await db.from("vnciv_contact_messages").insert({
    name: input.name || null, email: input.email, message: input.message, lang: input.lang, page_url: input.pageUrl,
    ip_hash: ipHash, user_agent: (req.headers.get("user-agent") || "").slice(0, LIMITS.userAgent) || null,
  });
  if (insErr) {
    console.error("contact: insert failed", insErr.message);
    return json(500, { ok: false, error: "db" });
  }

  // The message is stored; a failed e-mail is logged and still reported as sent (CyberSkill reads the table too),
  // so the visitor does not send it twice.
  const who = input.name ? `${input.name} <${input.email}>` : input.email;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: [to], reply_to: input.email,
      subject: oneLine(`Atlas contact: ${input.name || input.email}`).slice(0, 150),
      text: `${input.message}\n\n— ${who}\nLanguage: ${input.lang ?? "?"}\nPage: ${input.pageUrl ?? "?"}`,
    }),
  }).catch((e) => ({ ok: false, status: 0, text: () => Promise.resolve(String(e)) }));
  if (!res.ok) console.error("contact: Resend failed", res.status, (await res.text()).slice(0, 300));
  return json(200, { ok: true, emailed: res.ok });
});
