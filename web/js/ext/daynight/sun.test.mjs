// node web/js/ext/daynight/sun.test.mjs: the solar formula against reference elevations (astral 3.2,
// geometric, no refraction) and the map inverse projection against pipeline/geo.py MapProjection.
import assert from "node:assert/strict";
import { sunElevation, mapToLonLat, nightness } from "./sun.js";

const SUN = [ // lat, lon, UTC time, elevation (°)
  [21.0285, 105.8542, "2026-06-21T05:00:00Z", 87.56],
  [21.0285, 105.8542, "2026-12-21T12:00:00Z", -22.556],
  [10.7769, 106.7009, "2026-03-20T05:00:00Z", 79.063],
  [10.7769, 106.7009, "2026-09-23T11:30:00Z", -10.939],
  [16.0544, 108.2022, "2026-11-28T23:00:00Z", -0.276],
  [23.3636, 105.3167, "2026-01-15T02:00:00Z", 26.161],
];
for (const [lat, lon, iso, want] of SUN) {
  const got = sunElevation(lat, lon, Date.parse(iso));
  assert.ok(Math.abs(got - want) < 0.05, `${iso} ${lat},${lon}: ${got.toFixed(3)} vs ${want}`);
}
const PROJ = [ // lon, lat → map x, y (pipeline/geo.py)
  [105.8542, 21.0285, 4130.8144993994465, 1511.105679372613],
  [106.7009, 10.7769, 4589.420024629818, 7224.261566413479],
  [112.0, 16.5, 7392.444411582288, 3989.142643711675],
  [103.0, 23.3, 2667.73688360524, 239.84878916075104],
];
for (const [lon, lat, x, y] of PROJ) {
  const [lo, la] = mapToLonLat(x, y);
  assert.ok(Math.abs(lo - lon) < 1e-6 && Math.abs(la - lat) < 1e-6, `${x},${y} → ${lo},${la}`);
}
assert.equal(nightness(10), 0);
assert.equal(nightness(-12), 1);
console.log("sun ok");
