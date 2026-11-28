// node web/js/ext/explore/geom.test.mjs — the pure helpers of ext/explore.
import assert from "node:assert/strict";
import { haversineKm, mapKm, pathKm, smoothPath, cumulative, pointAt, isFreeLicense, unsuitableTitle, parsePhotos, mergePhotos, addMonth } from "./geom.js";
import { lonLatToMap } from "../atmos/geo.js";

// Hà Nội (Hoàn Kiếm, 21.0285 N 105.8542 E) – TP.HCM (Bến Thành, 10.7724 N 106.6980 E): ≈ 1,140 km great-circle
const hn = [105.8542, 21.0285], sg = [106.698, 10.7724];
const d = haversineKm(...hn, ...sg);
assert.ok(Math.abs(d - 1140) / 1140 < 0.02, `HN–HCM ${d}`);
// through the map projection (forward then inverse) the same within 0.1 %
const a = lonLatToMap(...hn), b = lonLatToMap(...sg), dm = mapKm(...a, ...b);
assert.ok(Math.abs(dm - d) / d < 0.001, `map ${dm} vs ${d}`);
assert.ok(Math.abs(pathKm([a, b]) - dm) < 1e-9);
// a path's legs add up
const mid = lonLatToMap(108.2, 16.05); // Đà Nẵng
assert.ok(pathKm([a, mid, b]) > dm);
// smoothing keeps ends and spacing
const zig = [[0, 0], [10, 5], [20, 0], [30, 5], [40, 0]];
const sm = smoothPath(zig, 2, 3);
assert.deepEqual(sm[0], [0, 0]); assert.deepEqual(sm.at(-1), [40, 0]);
assert.ok(sm.every(([, y]) => y >= 0 && y <= 5));
const cum = cumulative([[0, 0], [3, 4], [3, 10]]);
assert.deepEqual(cum, [0, 5, 11]);
assert.deepEqual(pointAt([[0, 0], [3, 4], [3, 10]], cum, 8), [3, 7]);
// licences
for (const ok of ["CC BY-SA 4.0", "CC BY 2.0", "CC0", "Public domain", "PD-self", "CC BY-SA 3.0 de", "cc by 3.0"]) assert.ok(isFreeLicense(ok), ok);
for (const no of ["CC BY-NC 2.0", "CC BY-NC-SA 4.0", "CC BY-ND 2.0", "GFDL", "Fair use", "", null, "Attribution", "All rights reserved"]) assert.ok(!isFreeLicense(no), String(no));
// unsuitable titles
for (const bad of ["File:Vietnam location map.svg", "File:Flag of Vietnam.png", "File:Logo VTV.png", "File:Bản đồ Hà Giang.jpg", "File:Population_chart_2020.png"]) assert.ok(unsuitableTitle(bad), bad);
for (const good of ["File:Ha Long Bay 下龍灣 - panoramio.jpg", "File:Hội An, Ancient Town, 2020-01 CN-06.jpg", "File:Mù Cang Chải terraces.jpg"]) assert.ok(!unsuitableTitle(good), good);
// parsing a Commons answer: filters licence, mime and title; keeps order by index
const page = (index, title, mime, lic, artist = "<a href='x'>Ann</a>") => ({ index, title, imageinfo: [{ mime, thumburl: `https://upload.wikimedia.org/${index}.jpg`, thumbwidth: 320, thumbheight: 240, descriptionurl: `https://commons.wikimedia.org/wiki/${title}`, extmetadata: { LicenseShortName: { value: lic }, Artist: { value: artist } } }] });
const ph = parsePhotos({ query: { pages: [page(3, "File:C.jpg", "image/jpeg", "CC BY 4.0"), page(1, "File:A.jpg", "image/jpeg", "CC BY-SA 4.0"),
  page(2, "File:B.jpg", "image/jpeg", "CC BY-NC 2.0"), page(4, "File:D map.png", "image/png", "CC0"), page(5, "File:E.tif", "image/tiff", "CC0"), page(6, "File:F.png", "image/png", "Public domain")] } });
assert.deepEqual(ph.map((p) => p.title), ["File:A.jpg", "File:C.jpg", "File:F.png"]);
assert.equal(ph[0].author, "Ann");
assert.deepEqual(parsePhotos({}), []);
const merged = mergePhotos([[{ title: "File:X - panoramio (1).jpg" }], [{ title: "File:X - panoramio (2).jpg" }, { title: "File:Y.jpg" }]]);
assert.deepEqual(merged.map((p) => p.title), ["File:X - panoramio (1).jpg", "File:Y.jpg"]);
assert.deepEqual(addMonth(2026, 12, 1), [2027, 1]); assert.deepEqual(addMonth(2026, 1, -1), [2025, 12]);
console.log(`explore geom ok (HN–HCM ${d.toFixed(1)} km)`);
