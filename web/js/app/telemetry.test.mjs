// node --experimental-strip-types web/js/app/telemetry.test.mjs (tests/test_telemetry.py runs it)
// The client's allow-list matches the Edge Function's; the function rejects anything off the list; no personal field
// is ever sent or stored; nothing is sent on localhost (without ?telemetry=1) or with Do-Not-Track / GPC.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fn = await import("../../../supabase/functions/vnciv-telemetry/check.ts");
const sent = [];
const tick = () => new Promise((r) => setTimeout(r, 0)); // sends after the first wait for its answer
const load = async (hostname, search = "", nav = {}) => {
  globalThis.location = { hostname, search, pathname: "/", origin: `https://${hostname}` };
  Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true, writable: true });
  globalThis.innerWidth = 390;
  globalThis.fetch = (url, o) => { sent.push(JSON.parse(o.body)); return Promise.resolve({ ok: true }); };
  return import(`./telemetry.js?${hostname}${search}${JSON.stringify(nav)}`);
};

// --- the allow-lists agree: client, function, table check constraint
const client = await load("atlasvn.online");
assert.deepEqual(Object.keys(client.EVENTS).sort(), Object.keys(fn.EVENTS).sort());
for (const [k, props] of Object.entries(client.EVENTS)) assert.deepEqual([...props].sort(), Object.keys(fn.EVENTS[k]).sort(), k);
const sql = readFileSync(new URL("../../../supabase/migrations/20261128130000_telemetry.sql", import.meta.url), "utf8");
const inSql = sql.match(/name in \(([^)]*)\)/)[1].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1));
assert.deepEqual(inSql.sort(), Object.keys(fn.EVENTS).sort());

// --- the function's validation
const ok = (b) => assert.ok(!("error" in fn.check(b)), JSON.stringify(b));
const bad = (b) => assert.ok("error" in fn.check(b), JSON.stringify(b));
ok({ kind: "event", name: "page_view", props: { path: "/", lang: "vi", ref: "news.example.com" } });
ok({ kind: "event", name: "layer_toggled", props: { id: "roads", on: false } });
ok({ kind: "event", name: "tour_started" });
bad({ kind: "event", name: "search_used", props: { kind: "city", query: "Hà Nội" } }); // never the query
bad({ kind: "event", name: "page_view", props: { path: "/", ref: "https://x.com/a?b" } }); // a domain only
bad({ kind: "event", name: "page_view", props: { path: "/?lens=x" } });
bad({ kind: "event", name: "lens_chosen", props: { id: 5 } });
bad({ kind: "event", name: "toString", props: {} });
bad({ kind: "event", name: "constructor" });
bad({ kind: "event", name: "mouse_moved", props: {} });
bad({ kind: "event", name: "share", props: [] });
bad({ kind: "error", message: "" });
bad({ kind: "visitor", name: "page_view" });

// --- no personal fields: what the client sends and what the function stores
const PII = /ip|agent|ua$|email|user|href|url|query|cookie|session|visitor|fingerprint/i;
const err = client.errorReport("Boom", "https://atlasvn.online/js/main.js?v=1#lens=x", 10, 5,
  "Error: Boom\n    at f (https://atlasvn.online/js/main.js?x=1:10:5)\n" + "x".repeat(5000));
assert.deepEqual(Object.keys(err).sort(), ["col", "kind", "lang", "line", "message", "path", "source", "stack", "version", "viewport"]);
assert.equal(err.source, "/js/main.js");
assert.ok(!err.stack.includes("atlasvn.online") && !err.stack.includes("?x=1") && err.stack.length <= 2000);
const row = fn.check(err, "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15").row;
assert.equal(row.browser, "safari");
for (const k of Object.keys(row)) assert.ok(!PII.test(k), `stored field ${k}`);
for (const [name, props] of Object.entries(fn.EVENTS)) for (const k of Object.keys(props)) assert.ok(!PII.test(k), `${name}.${k}`);
assert.equal(fn.browserFamily("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0"), "edge");
assert.equal(fn.browserFamily("Mozilla/5.0 (Android 14; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0"), "firefox");

// --- when it sends
sent.length = 0;
client.track("search_used", { kind: "city", query: "Hà Nội" });
await tick();
assert.deepEqual(sent.at(-1), { kind: "event", name: "search_used", props: { kind: "city" } }); // extra props dropped
client.track("not_allowed", {});
await tick();
assert.equal(sent.length, 1);
for (let i = 0; i < 100; i++) client.track("tour_started");
await tick();
assert.equal(sent.length, 60); // per page view

// a failed first request (the function not deployed yet): nothing more is sent
const failing = await load("example.org");
globalThis.fetch = (url, o) => { sent.push(JSON.parse(o.body)); return Promise.resolve({ ok: false }); };
sent.length = 0;
failing.track("tour_started"); failing.track("share", { kind: "copy" }); failing.track("tour_started");
await tick(); failing.track("tour_started"); await tick();
assert.equal(sent.length, 1);

for (const [host, search, nav] of [["127.0.0.1", ""], ["localhost", ""], ["atlasvn.online", "", { doNotTrack: "1" }], ["atlasvn.online", "", { globalPrivacyControl: true }]]) {
  const m = await load(host, search, nav);
  sent.length = 0;
  m.track("tour_started");
  await tick();
  assert.equal(sent.length, 0, `${host} ${JSON.stringify(nav)}`);
}
const opted = await load("127.0.0.1", "?telemetry=1");
sent.length = 0;
opted.track("tour_started");
await tick();
assert.equal(sent.length, 1);
console.log("telemetry ok");
