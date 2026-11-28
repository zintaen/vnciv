// node web/js/ext/living/living.test.mjs — the living map's date logic (run by tests/test_living.py).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { vnParts, riceStage, tetEve, nextTet, tetEveMs } from "./calendar.js";

// Vietnam time is UTC+7 all year
assert.deepEqual(vnParts(Date.parse("2026-12-31T17:30:00Z")), { y: 2027, m: 1, d: 1, h: 0.5 });

// a season planted Jan–Feb and harvested May–Jun: grow Mar, ripe Apr; wrap-around season planted Dec
const S = [{ plant: [1, 2], harvest: [5, 6] }];
assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((m) => riceStage(S, m)), ["plant", "plant", "grow", "ripe", "harvest", "harvest", "fallow"]);
const W = [{ plant: [12], harvest: [3] }];
assert.deepEqual([12, 1, 2, 3, 4].map((m) => riceStage(W, m)), ["plant", "grow", "ripe", "harvest", "fallow"]);
// overlapping seasons: the later stage wins
assert.equal(riceStage([{ plant: [5], harvest: [8] }, { plant: [8], harvest: [11] }], 8), "harvest");

// Tết eve on the real table
const L = JSON.parse(readFileSync(new URL("../../../data/living.json", import.meta.url)));
const tet = L.tet.dates;
const d27 = tet["2027"];
const eve = tetEveMs(2027, tet);
assert.equal(tetEve(eve, tet), 2027); // 23:59:30 on the eve
assert.equal(tetEve(eve - 3 * 3600e3, tet), 0); // 21:00 minus half a minute: not yet
assert.equal(tetEve(eve + 30e3 + 3600e3 - 1, tet), 2027); // 00:59:59 on mùng 1
assert.equal(tetEve(eve + 30e3 + 3600e3 + 1000, tet), 0);
assert.deepEqual(nextTet(Date.parse("2026-11-28T00:00:00Z"), tet), { year: 2027, date: d27 });
// every date is in the lunar new year window (21 Jan – 20 Feb)
for (const [y, d] of Object.entries(tet)) {
  assert.ok(d.startsWith(`${y}-`) && d >= `${y}-01-21` && d <= `${y}-02-20`, `${y} ${d}`);
}
console.log("living ok");
