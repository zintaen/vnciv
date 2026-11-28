// Validation for the Edge Function "vnciv-telemetry" (index.ts), kept free of imports so tests/test_telemetry.py can
// run it with Node. Every field is checked against a fixed shape; anything else is rejected or dropped.

const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/; // lens / layer / story / advisor ids, result and share kinds
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,62}\.)*[a-z0-9-]{1,63}$/; // a host name only (no path, no port)
const PATH = /^\/[A-Za-z0-9._~\/-]{0,99}$/; // a page path (no query, no hash)
const LANG = new Set(["vi", "en"]);
const VIEWPORT = new Set(["phone", "tablet", "desktop"]);

type Prop = (v: unknown) => boolean;
const str = (re: RegExp): Prop => (v) => typeof v === "string" && re.test(v);
const bool: Prop = (v) => typeof v === "boolean";
const lang: Prop = (v) => typeof v === "string" && LANG.has(v);

/** Allowed event names → their props (each optional, none other allowed). Mirrors web/js/app/telemetry.js EVENTS
 *  and the check constraint on vnciv_events.name. */
export const EVENTS: Record<string, Record<string, Prop>> = {
  page_view: { path: str(PATH), lang, ref: str(DOMAIN) },
  lens_chosen: { id: str(ID) },
  layer_toggled: { id: str(ID), on: bool },
  story_opened: { id: str(ID) },
  tour_started: {},
  search_used: { kind: str(ID) },
  advisor_opened: { id: str(ID) },
  share: { kind: str(ID) },
  contact_sent: { ok: bool },
  embed_view: { host: str(DOMAIN) },
};

/** Browser family from a user-agent string (the only thing kept of it). */
export function browserFamily(ua: string): string {
  if (/SamsungBrowser\//.test(ua)) return "samsung";
  if (/Edg\//.test(ua)) return "edge";
  if (/OPR\//.test(ua)) return "opera";
  if (/Firefox\/|FxiOS\//.test(ua)) return "firefox";
  if (/Chrome\/|CriOS\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua)) return "safari";
  return "other";
}

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.slice(0, max) : null);
const int = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1e7 ? v as number : null);

export type Row = { table: "vnciv_client_errors" | "vnciv_events"; row: Record<string, unknown> };

/** The parsed body → the row to insert, or {error}. */
export function check(b: Record<string, unknown>, ua = ""): Row | { error: string } {
  if (b.kind === "event") {
    const name = typeof b.name === "string" ? b.name : "";
    const spec = Object.hasOwn(EVENTS, name) ? EVENTS[name] : null;
    if (!spec) return { error: "unknown_event" };
    const p = b.props ?? {};
    if (typeof p !== "object" || Array.isArray(p) || p === null) return { error: "bad_props" };
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      if (!Object.hasOwn(spec, k) || !spec[k](v)) return { error: "bad_props" };
      props[k] = v;
    }
    return { table: "vnciv_events", row: { name, props } };
  }
  if (b.kind === "error") {
    const message = text(b.message, 300);
    if (!message) return { error: "bad_error" };
    return {
      table: "vnciv_client_errors",
      row: {
        message, source: text(b.source, 200), line: int(b.line), col: int(b.col), stack: text(b.stack, 2000),
        path: typeof b.path === "string" && PATH.test(b.path) ? b.path : null,
        lang: typeof b.lang === "string" && LANG.has(b.lang) ? b.lang : null,
        viewport: typeof b.viewport === "string" && VIEWPORT.has(b.viewport) ? b.viewport : null,
        version: typeof b.version === "string" && /^[A-Za-z0-9._-]{1,40}$/.test(b.version) ? b.version : null,
        browser: browserFamily(ua),
      },
    };
  }
  return { error: "bad_kind" };
}
