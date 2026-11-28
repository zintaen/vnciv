// node web/js/app/motion.test.mjs: app.motion engine checks (round 9). Run by tests/test_motion_history.py.
import assert from "node:assert/strict";

const listeners = {};
globalThis.document = {
  hidden: false,
  documentElement: { classList: { toggle() {} } },
  addEventListener: (k, fn) => { listeners[k] = fn; },
};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { createMotion } = await import("./motion.js");
const M = createMotion({ requestDraw() {} });
M._step(1);

// A hidden tab pauses tweens: they neither end nor jump.
let done = 0;
M.tween({ ms: 1000, onDone: () => done++ });
document.hidden = true; listeners.visibilitychange();
assert.equal(done, 0, "hiding the tab must not end a tween");
document.hidden = false; listeners.visibilitychange();
assert.equal(done, 0);

// Effects off ends every tween, but not one that an earlier onDone cancelled meanwhile (the forest replay: its year
// ticker ends first and counts the total to its final value; the old count-up must not then overwrite it).
const el = { textContent: "", dataset: {} };
M.countTo(el, 10); // the first call just sets it
M.tween({ ms: 1000, onDone: () => M.countTo(el, 99) }); // the ticker (created before the count-up)
M.countTo(el, 20); // a count-up 10 → 20, running
M.setEnabled(false);
assert.equal(el.textContent, "99", `the final number wins, got ${el.textContent}`);
assert.equal(done, 1, "effects off ends the running tween");
console.log("motion ok");
