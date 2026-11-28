// node web/js/ext/hexlife/hexlife.test.mjs — the Vietnamese field art and close-zoom life placement on the real
// world (run by tests/test_hexart.py): deterministic, few, and in the regions the rules name.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareWorld } from "../../world.js";
import { fieldArt, isFieldCell, pondSpot } from "../../render/art/terrain.js";
import { mapToLonLat } from "../daynight/sun.js";
import { lifeAt, riverSpots } from "./life.js";

const read = (f) => JSON.parse(readFileSync(new URL(`../../../data/${f}`, import.meta.url)));
const w = prepareWorld(read("world.json"), read("cities.json"));
const g = w.grid, ll = (i) => mapToLonLat(g.cx(i), g.cy(i));
const art = { paddy: 0, terrace: 0, rows: 0 }, life = { buffalo: 0, farmer: 0, boat: 0, ducks: 0 };
let fields = 0, ponds = 0, land = 0;
const rivers = riverSpots(w);
for (let i = 0; i < g.size; i++) {
  if (w.water[i] || w.raw.owner[i] < 0) continue;
  land++;
  const [lon, lat] = ll(i);
  if (isFieldCell(w, i, 60)) {
    fields++;
    const a = fieldArt(w, i);
    art[a]++;
    if (a === "terrace") assert.ok(w.relief[i] === 1 && (lat >= 20.3 || (lat > 11.3 && lat < 15.6 && lon < 108.9)), `terrace at ${i}`);
    if (a === "rows") assert.ok(w.relief[i] === 0 && lat > 11.3 && lat < 15.6 && w.raw.elev[i] >= 400 && w.raw.elev[i] <= 1000, `rows at ${i}`);
  }
  const p = pondSpot(w, i);
  if (p) {
    ponds++;
    assert.ok(w.raw.elev[i] < 15 && (lat < 11.1 || (lat > 19.8 && lat < 21.7)), `pond at ${i}`);
    assert.ok(Math.abs(p.x) <= 0.3 && p.y > 0 && p.y < 0.5, "pond inside the hex");
  }
  const it = lifeAt(w, i, rivers);
  if (it) {
    life[it.kind]++;
    assert.deepEqual(lifeAt(w, i, rivers), it, "deterministic");
    assert.ok(Math.hypot(it.x - g.cx(i), it.y - g.cy(i)) <= g.R, `${it.kind} inside its hex ${i}`);
  }
}
assert.ok(art.paddy > 400 && art.terrace >= 1 && art.rows >= 1, JSON.stringify(art));
assert.ok(ponds > 50, `ponds ${ponds}`);
const total = Object.values(life).reduce((p, q) => p + q, 0);
assert.ok(Object.values(life).every((n) => n > 0), JSON.stringify(life));
assert.ok(total < land * 0.05, `life is sparse: ${total} of ${land}`);
console.log("hexlife ok", { fields, ...art, ponds, ...life });
