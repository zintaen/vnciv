// node web/js/camera.test.mjs: a flight to a far or non-finite target (a hand-edited #at=1e308,…) stays finite.
import assert from "node:assert/strict";
import { Camera } from "./camera.js";

for (const [x, y, s] of [[1e308, 1e308, 1e308], [-1e308, 0, 1], [NaN, NaN, NaN], [Infinity, 5, 0]]) {
  const c = new Camera(11335, 8800);
  c.resize(1440, 900);
  c.x = 5000; c.y = 4000; c.scale = 0.1;
  c.flyTo(x, y, s, 650);
  for (let i = 0; i < 200 && c.flight; i++) c.step(0.05);
  assert.ok([c.x, c.y, c.scale].every(Number.isFinite), `flyTo(${x}, ${y}, ${s}) → ${c.x}, ${c.y}, ${c.scale}`);
}
console.log("camera ok");
