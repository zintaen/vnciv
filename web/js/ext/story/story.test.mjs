// node web/js/ext/story/story.test.mjs [-v]: every chapter builds from web/data with real numbers on every step.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildChapters } from "./chapters.js";
import { makeGrid } from "../../hex.js";
import { pairRows, ROWS } from "./pair.js";

const load = (n) => JSON.parse(readFileSync(new URL(`../../../data/${n}.json`, import.meta.url)));
const raw = load("world");
const D = { T: load("timeline"), N: load("nation"), states: load("states"), raw, grid: makeGrid(raw.grid), lenses: load("lenses"),
  cities: load("cities"), history: load("history"), merger: load("merger"), disasters: load("disasters"), sealevel: load("sealevel"),
  roads: load("living_roads"), built: load("living_built"), geo: load("geo"), forest: load("forest_loss"), wonders: load("wonders"),
  places: load("places"), ethnic: load("ethnic"), sources: load("sources"), living: load("living") };
const ch = buildChapters(D);
const IDS = ["doimoi", "mekong", "yagi", "p34", "bachdang", "thanglong", "railway", "expressway", "bacninh", "hcmc", "forest",
  "unesco", "sea", "ageing", "floods", "highlands", "rice"];
assert.deepEqual(ch.map((c) => c.id), IDS.filter((id) => ch.some((c) => c.id === id)), "order");
for (const id of IDS) assert.ok(ch.some((c) => c.id === id), `chapter ${id} has fewer than 4 steps`);
// every toggle a step switches on is a real map toggle (the ids app.ui.mapToggles() lists)
const TOGGLES = new Set("resources motion roads rail hubs trade military wonders places communes relics worship hospitals universities markets beaches reserves metro bridges sealevel ambient traffic daynight rivers peaks passes lakes gates parks crafts battles festivals trees homes seasons boats tet growth split weather".split(" "));
const THEMES = new Set(["history", "growth", "nature", "people"]);
const storyIds = new Set(D.history.events.flatMap((e) => e.story || []));
for (const id of storyIds) assert.ok(IDS.includes(id), `history.json story id ${id} is not a chapter`);
const lensIds = new Set(D.lenses.lenses.map((l) => l.id));
const abbr = new Set(D.states.map((s) => s.abbr));
for (const c of ch) {
  assert.ok(c.title && c.blurb && c.steps.length >= 4 && c.steps.length <= 8, `${c.id}: ${c.steps.length} steps`);
  assert.ok(THEMES.has(c.theme), `${c.id}: theme ${c.theme}`);
  for (const [i, s] of c.steps.entries()) {
    const id = `${c.id}#${i + 1}`;
    assert.ok(s.title, id);
    assert.ok(s.facts.length >= 1 && s.facts.length <= 2, `${id}: ${s.facts.length} facts`);
    for (const f of s.facts) assert.ok(typeof f === "string" && !/undefined|NaN|null|Infinity|\{\w+\}/.test(f), `${id}: ${f}`);
    assert.ok(s.lens === null || lensIds.has(s.lens), `${id}: lens ${s.lens}`);
    const stormYears = s.lens === "disasters" ? D.T.storms.map((x) => x.season) : [];
    assert.ok(s.year === null || D.T.years.includes(s.year) || stormYears.includes(s.year), `${id}: year ${s.year}`);
    for (const l of s.layers) assert.ok(TOGGLES.has(l), `${id}: layer ${l}`);
    assert.ok([null, "storm", "merger", "growth", "forest"].includes(s.replay), `${id}: replay ${s.replay}`);
    assert.ok(s.cam || s.fit, `${id}: no camera`);
    for (const a of [...(s.fit || []), ...(s.hl || [])]) assert.ok(abbr.has(a), `${id}: ${a}`);
    assert.ok(s.cite.length >= 1 && s.cite.every((x) => /^https:\/\//.test(x.url) && x.label), `${id}: cite`);
    if (s.replay === "storm") assert.equal(D.T.storms[s.storm]?.season, s.year, `${id}: storm ${s.storm}`);
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
