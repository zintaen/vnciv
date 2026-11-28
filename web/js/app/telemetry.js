// Anonymous error reports and privacy-respecting usage counts, POSTed to the Edge Function
// supabase/functions/vnciv-telemetry (URL in app/config.js). No cookies, no stored IDs, no fingerprinting: each
// request carries only the fields below; the function keeps no IP and no user agent (only the browser family, which
// it derives itself). Nothing is sent when Do-Not-Track or Global Privacy Control is on, on localhost / 127.0.0.1
// (unless the page has ?telemetry=1), or after a request fails (a function not deployed yet costs one request).
//  * errors: uncaught errors and unhandled rejections; at most 5 per page view, each message once.
//  * events: an allow-list of names and props (EVENTS); at most 60 per page view. Never a search query.
import { TELEMETRY_ENDPOINT } from "./config.js";
import { VERSION } from "./version.js";
import { EMBED } from "./embed.js";
import { lang } from "../i18n.js";

/** Allowed event names → their prop names (the Edge Function checks the same list: check.ts). */
export const EVENTS = {
  page_view: ["path", "lang", "ref"], lens_chosen: ["id"], layer_toggled: ["id", "on"], story_opened: ["id"],
  tour_started: [], search_used: ["kind"], advisor_opened: ["id"], share: ["kind"], contact_sent: ["ok"], embed_view: ["host"],
};
const MAX_ERRORS = 5, MAX_EVENTS = 60, STACK = 2000;

const nav = typeof navigator === "object" ? navigator : {};
const loc = typeof location === "object" ? location : { hostname: "", search: "", pathname: "/" };
const local = /^(localhost|127\.0\.0\.1|\[::1\]|)$/.test(loc.hostname);
const optIn = new URLSearchParams(loc.search).get("telemetry") === "1";
const optOut = nav.doNotTrack === "1" || globalThis.doNotTrack === "1" || nav.globalPrivacyControl === true;
let live = !!TELEMETRY_ENDPOINT && !optOut && (!local || optIn) && typeof fetch === "function";
let errors = 0, events = 0;
const seen = new Set();

let first = null; // the first request's outcome (true = delivered): later ones wait for it, so a failure costs one
function send(body) {
  if (!live) return;
  // text/plain: a "simple" request (no CORS preflight); credentials omitted: no cookie goes or comes back.
  const go = () => fetch(TELEMETRY_ENDPOINT, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "text/plain" },
    credentials: "omit", keepalive: true, referrerPolicy: "no-referrer" }).then((r) => r.ok, () => false);
  if (!first) first = go().then((ok) => (live = ok));
  else first.then((ok) => ok && live && go().then((ok2) => { if (!ok2) live = false; }));
}

const viewport = () => (innerWidth <= 700 ? "phone" : innerWidth <= 1100 ? "tablet" : "desktop");
const host = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch { return null; } };
// a stack or file URL without the origin, query or hash (they could carry a link's state)
const trimUrl = (s) => String(s || "").replace(/https?:\/\/[^/\s)]+/g, "").replace(/[?#][^\s):]*/g, "");

/** The error report's fields (exported for the test). */
export function errorReport(message, file, line, col, stack) {
  return { kind: "error", message: String(message || "Error").slice(0, 300), source: trimUrl(file).slice(0, 200) || null,
    line: Number.isInteger(line) ? line : null, col: Number.isInteger(col) ? col : null, stack: trimUrl(stack).slice(0, STACK) || null,
    path: loc.pathname.slice(0, 200), lang, viewport: viewport(), version: VERSION };
}

function reportError(message, file, line, col, stack) {
  const key = String(message);
  if (!live || errors >= MAX_ERRORS || seen.has(key)) return;
  seen.add(key);
  errors++;
  send(errorReport(message, file, line, col, stack));
}

/** Count one event: name from EVENTS; props outside its list are dropped. */
export function track(name, props = {}) {
  if (!live || !EVENTS[name] || events >= MAX_EVENTS) return;
  events++;
  send({ kind: "event", name, props: Object.fromEntries(EVENTS[name].filter((k) => props[k] != null).map((k) => [k, props[k]])) });
}

if (typeof addEventListener === "function") {
  addEventListener("error", (e) => { if (e.error || e.message) reportError(e.message, e.filename, e.lineno, e.colno, e.error?.stack); });
  addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    reportError(r?.message || String(r), r?.fileName, null, null, r?.stack);
  });
}

/** Page view (or embed view) now; then the app's events: lens, layer, story, tour, advisor. */
export function watchApp(app) {
  if (!live) return;
  const ref = host(document.referrer);
  if (EMBED) track("embed_view", { host: ref });
  else track("page_view", { path: loc.pathname, lang, ref: ref && ref !== loc.hostname ? ref : null });
  // A lens chosen by the viewer (not one a story step or the tour sets).
  app.on("lens", (l) => { if (l?.id && app.mode !== "story" && !document.body.classList.contains("tour-on")) track("lens_chosen", { id: l.id }); });
  app.on("tour", () => track("tour_started"));
  app.on("mode", ({ name, params }) => {
    if (name === "advisor" && params?.id) track("advisor_opened", { id: params.id });
    if (name === "story") setTimeout(() => { const v = app.story?.view; track("story_opened", { id: v?.kind === "chapter" ? v.ch?.id : v?.kind }); }, 0);
  });
  // A switch flipped in the Map panel (not the ones a story step sets).
  document.addEventListener("click", (e) => {
    const id = e.target.closest?.("#lens-picker [data-toggle]")?.dataset.toggle;
    if (id) setTimeout(() => track("layer_toggled", { id, on: !!app.ui?.mapToggles?.().find((x) => x.id === id)?.on }), 0);
  }, true);
}
