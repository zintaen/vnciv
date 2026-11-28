// app.motion: the shared animation engine (docs/DATA_CONTRACTS.md "Motion"). main.js owns the frame loop; this
// module keeps the registered motion items and tweens, says whether the loop must keep running, and draws the items.
// An idle map still draws no frames: frames are requested only while a tween runs or an item's active() is true,
// and only while motion is enabled (the user's Effects switch, prefers-reduced-motion, tab visible).

const KEY = "vnciv-motion";
const BUDGET_MS = 6; // average motion draw time per frame above which ambient items drop to half rate (lowPower)
const WINDOW_MS = 2000;
const MAX_STEP_MS = 50;

export const EASE = {
  linear: (p) => p,
  out: (p) => 1 - (1 - p) ** 3,
  in: (p) => p * p * p,
  inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2),
};

export function createMotion({ requestDraw }) {
  const reduce = (() => {
    try { return matchMedia("(prefers-reduced-motion: reduce)"); } catch { return { matches: false }; }
  })();
  let user = true;
  try { user = localStorage.getItem(KEY) !== "0"; } catch { /* storage blocked: default on */ }
  const items = []; // sorted by z
  const tweens = new Set();
  const listeners = new Set();
  const t0 = performance.now();
  let lastNow = 0, lastOn = null;
  let lowPower = false, winStart = 0, winMs = 0, winN = 0, frameMs = 0;
  // Reused every frame (no garbage per frame).
  const f = { t: 0, dt: 0, dpr: 1, w: null, raw: null, cssW: 0, cssH: 0, lowPower: false, moving: false, still: false, active: false };

  const enabled = () => user && !reduce.matches && !document.hidden;

  function finishAll() {
    for (const tw of [...tweens]) end(tw);
  }
  function end(tw) {
    tweens.delete(tw);
    try { tw.onUpdate?.(tw.to, 1); tw.onDone?.(); } catch (err) { console.error("motion tween failed", err); }
  }
  function check() {
    const on = enabled();
    document.documentElement.classList.toggle("no-motion", !user);
    if (on === lastOn) return;
    lastOn = on;
    if (!on) finishAll();
    lastNow = 0;
    for (const fn of [...listeners]) {
      try { fn(on); } catch (err) { console.error("motion change handler failed", err); }
    }
    requestDraw();
  }
  document.addEventListener("visibilitychange", check);
  reduce.addEventListener?.("change", check);

  const isActive = (it) => {
    try { return !!it.active?.(); } catch (err) { warn(it, err); return false; }
  };
  function warn(it, err) {
    if (it._warned) return;
    it._warned = true;
    console.error(`motion item "${it.id}" failed`, err);
  }

  const motion = {
    get enabled() { return enabled(); },
    get lowPower() { return lowPower; },
    /** The user switch (persisted). */
    get userEnabled() { return user; },
    setEnabled(on) {
      user = !!on;
      try { localStorage.setItem(KEY, user ? "1" : "0"); } catch { /* ignore */ }
      check();
    },
    on(name, fn) {
      if (name !== "change" || typeof fn !== "function") return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    register(it) {
      if (!it || !it.id || typeof it.draw !== "function") throw new Error("motion.register({id, z, active(), draw(ctx, cam, app, f)})");
      const k = items.findIndex((x) => x.id === it.id);
      if (k >= 0) items.splice(k, 1);
      items.push(it);
      items.sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
      requestDraw();
      return () => {
        const j = items.indexOf(it);
        if (j >= 0) items.splice(j, 1);
        requestDraw();
      };
    },
    tween({ from = 0, to = 1, ms = 400, ease = "inOut", onUpdate, onDone } = {}) {
      const tw = { from: +from, to: +to, ms: Math.max(1, +ms || 1), ease: typeof ease === "function" ? ease : EASE[ease] || EASE.inOut, onUpdate, onDone, last: performance.now(), elapsed: 0 };
      if (!enabled()) { end(tw); return () => {}; }
      tweens.add(tw);
      requestDraw();
      return () => { tweens.delete(tw); };
    },
    /** Count an element's text from its last number to `to`, formatted by fmt(v) (the end shows fmt(to) exactly). */
    countTo(el, to, fmt = String, ms = 650) {
      if (!el) return;
      const from = parseFloat(el.dataset.motionNum);
      el.dataset.motionNum = String(to);
      counting.get(el)?.();
      if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) { el.textContent = fmt(to); return; }
      counting.set(el, motion.tween({
        from, to, ms, ease: "out",
        onUpdate: (v, p) => { el.textContent = fmt(p >= 1 ? to : v); },
        onDone: () => counting.delete(el),
      }));
    },
    items: () => items.map((x) => x.id),
  };
  const counting = new WeakMap();

  // --- called by main.js -----------------------------------------------------------------------------------------
  /** Advance the tweens (before drawing). */
  motion._step = (now) => {
    if (lastOn === null) check();
    f.t = (now - t0) / 1000;
    f.dt = lastNow && now - lastNow < 250 ? (now - lastNow) / 1000 : 1 / 60;
    lastNow = now;
    if (frameMs > 0) {
      // Frame budget: the 2 s average of the time spent in active items' draws, per frame that drew them.
      winMs += frameMs;
      winN++;
      frameMs = 0;
      if (!winStart) winStart = now;
      if (now - winStart >= WINDOW_MS) {
        const avg = winMs / winN;
        if (!lowPower && avg > BUDGET_MS) lowPower = true;
        else if (lowPower && avg < BUDGET_MS / 2) lowPower = false;
        winStart = winMs = winN = 0;
      }
    }
    for (const tw of [...tweens]) {
      // Each frame advances a tween by at most MAX_STEP_MS, so a slow frame (a static re-render right after a lens
      // change, a 4x-throttled phone) stretches the animation instead of skipping it.
      tw.elapsed += Math.min(MAX_STEP_MS, Math.max(0, now - tw.last));
      tw.last = now;
      const p = Math.min(1, tw.elapsed / tw.ms);
      if (p >= 1) { end(tw); continue; }
      try { tw.onUpdate?.(tw.from + (tw.to - tw.from) * tw.ease(p), p); } catch (err) { console.error("motion tween failed", err); tweens.delete(tw); }
    }
  };
  /** 0 = nothing to animate, 1 = full rate (tweens, non-ambient items), 2 = ambient items only (half rate if lowPower). */
  // pause(true) stops the loop's frame requests while another view covers the map (ext/view3d); tweens still settle.
  let paused = false;
  motion.pause = (v) => { paused = !!v; if (!paused) requestDraw(); };
  motion._wants = () => {
    if (!enabled() || paused) return 0;
    if (tweens.size) return 1;
    let want = 0;
    for (const it of items) if (isActive(it)) { if (it.ambient === false) return 1; want = 2; }
    return want;
  };
  /** Draw the items with zMin <= z < zMax in the world transform. */
  motion._draw = (ctx, cam, app, { dpr, zMin = -Infinity, zMax = Infinity, moving = false }) => {
    if (!items.length) return;
    const on = enabled();
    f.dpr = dpr; f.w = app.w; f.raw = app.w?.raw ?? null; f.cssW = cam.w; f.cssH = cam.h;
    f.lowPower = lowPower; f.moving = moving; f.still = !on;
    const s = cam.scale, tStart = performance.now();
    let drew = false;
    for (const it of items) {
      const z = it.z ?? 0;
      if (z < zMin || z >= zMax || it.hidden) continue;
      f.active = on && isActive(it);
      drew ||= f.active;
      ctx.save();
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (cam.w / 2 - cam.x * s), dpr * (cam.h / 2 - cam.y * s));
      try { it.draw(ctx, cam, app, f); } catch (err) { warn(it, err); }
      ctx.restore();
    }
    if (drew) frameMs += performance.now() - tStart || 1e-3;
  };
  return motion;
}
