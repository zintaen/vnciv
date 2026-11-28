// node web/js/ext/atmos/geo.test.mjs — projection round trip, grid, WMO codes, parsing.
import assert from "node:assert/strict";
import { lonLatToMap, mapToLonLat, gridPoints, rainLevel, wmoLabel, parseCurrent } from "./geo.js";

for (const [lo, la] of [[105.85, 21.03], [106.7, 10.78], [103.5, 22.5], [112, 9], [108.2, 16.05]]) {
  const [x, y] = lonLatToMap(lo, la), [lo2, la2] = mapToLonLat(x, y);
  assert.ok(Math.abs(lo - lo2) < 1e-9 && Math.abs(la - la2) < 1e-9, `round trip ${lo},${la}`);
}
const pts = gridPoints(11335, 8800, () => true);
assert.ok(pts.length > 100 && pts.every((p) => p.x >= 0 && p.y >= 0 && p.x <= 11335 && p.y <= 8800));
assert.equal(rainLevel(0, 0), 0);
assert.equal(rainLevel(3, 0), 0);
assert.ok(rainLevel(61, 0) > 0 && rainLevel(95, 0) === 1 && rainLevel(2, 0.4) > 0);
assert.equal(wmoLabel(63), "Rain");
assert.equal(wmoLabel(42), "Unknown");
const one = { current: { temperature_2m: 25, precipitation: 0.4, cloud_cover: 100, weather_code: 80, wind_speed_10m: 9, wind_direction_10m: 90, time: "2026-11-28T10:30" } };
assert.equal(parseCurrent(one, 1)[0].code, 80);
assert.equal(parseCurrent([one, one], 2).length, 2);
assert.throws(() => parseCurrent([one], 2));
assert.throws(() => parseCurrent([{}], 1));
console.log("atmos geo ok");
