// node web/js/ext/tour/tour.test.mjs: every stop of the tour resolves from web/data, in order, with 1–2 facts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildStops } from "./stops.js";
import { makeGrid } from "../../hex.js";

const load = (n) => JSON.parse(readFileSync(new URL(`../../../data/${n}.json`, import.meta.url)));
const world = load("world");
const stops = buildStops({ cities: load("cities"), wonders: load("wonders"), places: load("places"), world, lenses: load("lenses"), grid: makeGrid(world.grid) });
const IDS = ["lungcu", "sapa", "halong", "hanoi", "hue", "hoian", "hoangsa", "truongsa", "dalat", "hcmc", "mekong", "phuquoc", "camau"];
assert.deepEqual(stops.map((s) => s.id), IDS);
for (const s of stops) {
  assert.ok(s.title && Number.isFinite(s.x) && Number.isFinite(s.y), s.id);
  assert.ok(s.facts.length >= 1 && s.facts.length <= 2, `${s.id}: ${s.facts.length} facts`);
  for (const f of s.facts) assert.ok(!/undefined|NaN|\{\w+\}/.test(f), `${s.id}: ${f}`);
}
assert.ok(stops.find((s) => s.id === "hoangsa").slogan);
if (process.argv.includes("-v")) for (const s of stops) console.log(s.id, "|", s.title, "|", s.facts.join(" | "), s.slogan || "");
console.log("tour ok");
