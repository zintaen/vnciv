// node web/js/ext/story/story.test.mjs [-v]: every chapter builds from web/data with real numbers on every step.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildChapters } from "./chapters.js";
import { makeGrid } from "../../hex.js";
import { pairRows, ROWS } from "./pair.js";

const load = (n) => JSON.parse(readFileSync(new URL(`../../../data/${n}.json`, import.meta.url)));
const raw = load("world");
const D = { T: load("timeline"), N: load("nation"), states: load("states"), raw, grid: makeGrid(raw.grid), lenses: load("lenses"),
  cities: load("cities"), history: load("history"), merger: load("merger"), disasters: load("disasters"), sealevel: load("sealevel") };
const ch = buildChapters(D);
assert.deepEqual(ch.map((c) => c.id), ["doimoi", "mekong", "yagi", "p34"]);
const lensIds = new Set(D.lenses.lenses.map((l) => l.id));
const abbr = new Set(D.states.map((s) => s.abbr));
for (const c of ch) {
  assert.ok(c.title && c.blurb && c.steps.length >= 4, c.id);
  for (const [i, s] of c.steps.entries()) {
    const id = `${c.id}#${i + 1}`;
    assert.ok(s.title, id);
    assert.ok(s.facts.length >= 1 && s.facts.length <= 2, `${id}: ${s.facts.length} facts`);
    for (const f of s.facts) assert.ok(typeof f === "string" && !/undefined|NaN|null|Infinity|\{\w+\}/.test(f), `${id}: ${f}`);
    assert.ok(s.lens === null || lensIds.has(s.lens), `${id}: lens ${s.lens}`);
    assert.ok(s.year === null || D.T.years.includes(s.year), `${id}: year ${s.year}`);
    assert.ok(s.cam || s.fit, `${id}: no camera`);
    for (const a of [...(s.fit || []), ...(s.hl || [])]) assert.ok(abbr.has(a), `${id}: ${a}`);
    assert.ok(s.cite.length >= 1 && s.cite.every((x) => /^https:\/\//.test(x.url) && x.label), `${id}: cite`);
    if (s.replay === "storm") assert.equal(D.T.storms[s.storm]?.name, "Yagi");
  }
}
// the merger steps cross from 63 to 34 (the replay plays on the crossing)
for (const c of ch) c.steps.forEach((s, i) => { if (s.replay === "merger") assert.equal(s.year, 2025, `${c.id}#${i + 1}`); });
// two provinces: every row has both values formatted (or "–"), bars in 0..1, a year label
const st = (a) => D.states.find((s) => s.abbr === a);
const rows = pairRows(st("AGI"), st("HCM"));
assert.ok(rows.length >= ROWS.length - 2, `${rows.length} rows`);
for (const r of rows) {
  for (const s of [r.a, r.b]) { assert.ok(s.text && !/NaN|undefined/.test(s.text), r.field); assert.ok(s.w >= 0 && s.w <= 1, r.field); }
  assert.ok(r.year, `${r.field}: no year`);
}
assert.equal(rows.find((r) => r.field === "poverty").better, rows.find((r) => r.field === "poverty").a.v < rows.find((r) => r.field === "poverty").b.v ? "a" : "b");
if (process.argv.includes("-v")) for (const c of ch) { console.log("##", c.title); for (const s of c.steps) console.log(" -", s.title, "|", s.facts.join(" | ")); }
console.log("story ok");
