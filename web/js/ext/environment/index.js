// Sea-level-rise exposure: a Layers-menu switch that tints land hexes by the share of their ETOPO1 samples at or
// below a chosen level (sealevel.json, precomputed for 0.5/1/2/3 m), with a slider and a live readout of affected
// land, WorldPop residents and the most affected provinces. Lazy: sealevel.json loads the first time it is switched on.
// Motion (app.motion): a level change (slider or "▶ 0 → 3 m") steps through the real thresholds only, never an
// in-between level. Per step, the cells whose share changes fade in (or out) in order of their share at the higher
// level (deepest first), drawn over the cached map, which keeps the lower level until the step ends and then shows
// the higher one exactly as before; the readout counts the cells faded so far. Flooded water carries a faint
// drifting ripple texture (one shared pattern, cells culled to the view). Effects off / reduced motion: no fades,
// no texture, the level is set at once.
import { t } from "../../i18n.js";
import { esc, int, compact, dec } from "../../format.js";

const COLOR = "#2a7fc1";
const BUCKETS = 10; // alpha steps: one path per step keeps the draw cheap
const GROUPS = 12; // per threshold step, cells fade in 12 batches in order of their share
const PLAY_MS = 1300, SLIDE_MS = 700, HOLD_MS = 350; // per threshold step; pause between steps while playing
const TEX = 0.16; // ripple texture opacity on flooded water

const bucketAlpha = (b) => 0.4 + 0.5 * ((b + 1) / BUCKETS); // the static draw's alpha for bucket b
const alphaOf = (sh) => (sh > 0 ? bucketAlpha(Math.min(BUCKETS - 1, Math.floor((sh / 100) * BUCKETS))) : 0);

export function install(app) {
  // Shim until app.motion is everywhere: no motion, every tween lands at once.
  const M = app.motion || { enabled: false, register: () => () => {}, on: () => () => {},
    tween({ to = 1, onUpdate, onDone }) { onUpdate?.(to, 1); onDone?.(); return () => {}; } };
  let on = false, data = null, level = 1; // index into data.levels (1 m); -1 = no rise (start of "▶ 0 → 3 m")
  let drawn = 1; // the level the static layer shows (the lower end while a step animates)
  let failed = false; // sealevel.json missing or broken (loadData gives null)
  let byAlpha = []; // per bucket: [cell, ...] for the drawn level
  let flooded = []; // cells with share > 0 at the drawn level (ripple texture)
  let panel = null;
  let anim = null, stopTw = null; // the running threshold step; cancel of its tween (or of the pause after it)

  const share = (L, k) => (L < 0 ? 0 : data.share[L][k]);

  function recompute() {
    byAlpha = Array.from({ length: BUCKETS }, () => []);
    flooded = [];
    if (drawn < 0) return;
    const sh = data.share[drawn];
    for (let k = 0; k < data.cells.length; k++) {
      if (sh[k] > 0) {
        byAlpha[Math.min(BUCKETS - 1, Math.floor((sh[k] / 100) * BUCKETS))].push(data.cells[k]);
        flooded.push(data.cells[k]);
      }
    }
  }
  function setDrawn(L) {
    if (L === drawn) return;
    drawn = L;
    recompute();
    app.requestDraw();
  }

  // One cell's land (km²) and residents at share sh (%).
  const dens = () => app.lensById.get("density")?.values || [];
  const cellKm2 = (k, sh) => (sh / 100) * (data.land_pct[k] / 100) * data.hex_area_km2;
  const cellPeople = (k, sh, d) => (sh / 100) * (d[data.cells[k]] || 0) * data.hex_area_km2;
  const topHtml = (prov) => {
    const states = app.w.raw.states;
    return [...prov].sort((x, y) => y[1].p - x[1].p).slice(0, 4)
      .map(([o, s]) => `<span>${esc(states[o]?.name || "")} <b>${compact(s.p)}</b></span>`).join("");
  };
  function stats(L) {
    const d = dens(), owner = app.w.raw.owner;
    let hexes = 0, km2 = 0, people = 0;
    const prov = new Map();
    for (let k = 0; k < data.cells.length; k++) {
      const sh = share(L, k);
      if (!sh) continue;
      const c = data.cells[k], a = cellKm2(k, sh), p = cellPeople(k, sh, d);
      hexes++; km2 += a; people += p;
      const s = prov.get(owner[c]) || { a: 0, p: 0 };
      s.a += a; s.p += p;
      prov.set(owner[c], s);
    }
    return { hexes, km2, people, prov };
  }

  function readout() {
    const s = stats(level);
    const h = level < 0 ? 0 : data.levels[level];
    return `<div class="slr-stats"><b class="slr-n-hex">${int(s.hexes)}</b> ${t("hexes")} · ≈ <b class="slr-n-km">${int(s.km2)}</b> ${t("km² of land")} · ≈ <b class="slr-n-pop">${compact(s.people)}</b> ${t("residents")}</div>
      <div class="slr-top">${topHtml(s.prov)}</div>
      <div class="slr-note">${esc(t("Land at or below {h} m. Coarse elevation (ETOPO1, ~1.8 km), no defences/tides: an exposure indicator, not a forecast. Residents are WorldPop 2025 in every timeline year, spread evenly over each hex's land.", { h: dec(h) }))}</div>`;
  }

  // --- threshold steps ------------------------------------------------------------------------------------------
  const fadeOf = (g, p) => Math.min(1, Math.max(0, (p - (g / GROUPS) * 0.7) / 0.3)); // batch g fades over 30% of the step

  // A step between two adjacent real levels: the changed cells in time order (rising: deepest share at the higher
  // level first; falling: the reverse), batched; fill bins per (batch, overlay alpha); cumulative readout deltas.
  function prep(from, to) {
    const lo = Math.min(from, to), hi = Math.max(from, to), rising = to > from;
    const ks = [];
    for (let k = 0; k < data.cells.length; k++) if (share(hi, k) !== share(lo, k)) ks.push(k);
    ks.sort((x, y) => share(hi, y) - share(hi, x) || x - y);
    if (!rising) ks.reverse();
    const N = ks.length, d = dens(), owner = app.w.raw.owner, sg = rising ? 1 : -1;
    const bins = new Map(), fresh = Array.from({ length: GROUPS }, () => []), size = new Array(GROUPS).fill(0);
    const cumH = new Float64Array(N + 1), cumA = new Float64Array(N + 1), cumP = new Float64Array(N + 1);
    const base = stats(from), prov = base.prov, tops = [topHtml(prov)];
    let g0 = 0;
    for (let r = 0; r < N; r++) {
      const k = ks[r], c = data.cells[k], g = Math.floor((r * GROUPS) / N);
      while (g0 < g) { tops.push(topHtml(prov)); g0++; } // the top provinces once batches 0..g-1 are in
      size[g]++;
      const sl = share(lo, k), sh = share(hi, k), al = alphaOf(sl);
      // Same-colour "over" compositing: alpha beta drawn over the lower level's al gives the higher level's alpha.
      const beta = 1 - (1 - alphaOf(sh)) / (1 - al);
      const key = g * 1000 + Math.round(beta * 1000);
      if (!bins.has(key)) bins.set(key, { g, beta, cells: [] });
      bins.get(key).cells.push(c);
      if (!sl) fresh[g].push(c);
      const da = cellKm2(k, sh) - cellKm2(k, sl), dp = cellPeople(k, sh, d) - cellPeople(k, sl, d);
      cumH[r + 1] = cumH[r] + (sl ? 0 : sg);
      cumA[r + 1] = cumA[r] + sg * da;
      cumP[r + 1] = cumP[r] + sg * dp;
      const s = prov.get(owner[c]) || { a: 0, p: 0 };
      s.a += sg * da; s.p += sg * dp;
      prov.set(owner[c], s);
    }
    while (tops.length <= GROUPS) tops.push(topHtml(prov));
    return { from, to, rising, p: 0, N, bins: [...bins.values()], fresh, size, cumH, cumA, cumP, base, tops, shown: -1, topShown: 0 };
  }

  // The readout while a step runs: the lower level plus the cells faded so far (never an in-between sea level).
  function counters() {
    const a = anim;
    if (!a || !panel) return;
    let n = 0, done = 0;
    for (let g = 0; g < GROUPS; g++) {
      const f = fadeOf(g, a.p);
      n += Math.floor(a.size[g] * f);
      if (f >= 0.5) done++;
    }
    if (n !== a.shown) {
      a.shown = n;
      const q = (s) => panel.querySelector(s);
      const h = q(".slr-n-hex"), km = q(".slr-n-km"), pop = q(".slr-n-pop");
      if (h) h.textContent = int(a.base.hexes + a.cumH[n]);
      if (km) km.textContent = int(a.base.km2 + a.cumA[n]);
      if (pop) pop.textContent = compact(Math.max(0, a.base.people + a.cumP[n]));
    }
    if (done !== a.topShown) {
      a.topShown = done;
      const top = panel.querySelector(".slr-top");
      if (top) top.innerHTML = a.tops[done];
    }
  }

  function cancel() {
    stopTw?.();
    stopTw = null;
    if (anim) { const to = anim.to; anim = null; setDrawn(to); }
  }
  function step(to, ms, then) {
    anim = prep(level, to);
    setDrawn(Math.min(level, to));
    level = to;
    render(true);
    stopTw = M.tween({ from: 0, to: 1, ms, ease: "inOut",
      onUpdate: (p) => { if (anim) { anim.p = p; counters(); } },
      onDone: () => { anim = null; stopTw = null; setDrawn(to); render(); then(); } });
  }
  // Walk through each real threshold between here and the last target, one step at a time.
  function run(targets, ms) {
    cancel();
    const next = () => {
      if (!targets.length || !on) return;
      step(targets.shift(), ms, () => {
        if (targets.length) stopTw = M.tween({ ms: HOLD_MS, onDone: () => { stopTw = null; next(); } });
      });
    };
    next();
  }
  function goTo(v) {
    cancel();
    const seq = [];
    for (let L = level; L !== v; ) seq.push((L += v > L ? 1 : -1));
    run(seq, SLIDE_MS);
  }
  function play() {
    cancel();
    level = -1;
    setDrawn(-1);
    render();
    run(data.levels.map((_, k) => k), PLAY_MS);
  }

  function render(keepBody = false) {
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "panel slr-panel";
      panel.setAttribute("role", "group");
      panel.setAttribute("aria-label", t("Sea level rise"));
      const area = document.getElementById("lens-area") || document.body;
      area.insertBefore(panel, area.firstChild);
      panel.addEventListener("input", (e) => {
        if (!e.target.matches("input[type=range]") || !data) return;
        goTo(+e.target.value);
      });
      panel.addEventListener("click", (e) => { if (e.target.closest(".slr-play") && data) play(); });
    }
    panel.hidden = !on;
    if (!on) return;
    if (!data) { panel.innerHTML = `<div class="slr-head">${esc(t("Sea level rise"))}</div><div class="slr-note">${esc(t(failed ? "Sea level data is not available." : "Loading…"))}</div>`; return; }
    const lv = data.levels;
    const head = `<div class="slr-head"><span>🌊 ${esc(t("Sea level rise"))}</span>
      <button type="button" class="slr-play" title="${esc(t("Play the rise from 0 to 3 m, one real threshold at a time"))}">▶ 0 → ${dec(lv[lv.length - 1])} m</button>
      <b class="slr-val">+${dec(level < 0 ? 0 : lv[level])} m</b></div>`;
    const slider = panel.querySelector("input[type=range]");
    if (slider) { // keep the slider (and its focus) while dragging: only the text changes
      panel.querySelector(".slr-head").outerHTML = head;
      slider.value = String(Math.max(0, level));
      if (!keepBody) panel.querySelector(".slr-body").innerHTML = readout();
      else panel.querySelector(".slr-note").textContent = t("Land at or below {h} m. Coarse elevation (ETOPO1, ~1.8 km), no defences/tides: an exposure indicator, not a forecast. Residents are WorldPop 2025 in every timeline year, spread evenly over each hex's land.", { h: dec(lv[level]) });
      return;
    }
    panel.innerHTML = `${head}
      <input type="range" min="0" max="${lv.length - 1}" step="1" value="${Math.max(0, level)}" aria-label="${esc(t("Sea level (m)"))}"
        list="slr-ticks"><datalist id="slr-ticks">${lv.map((_, k) => `<option value="${k}"></option>`).join("")}</datalist>
      <div class="slr-ticks">${lv.map((v) => `<span>${dec(v)}</span>`).join("")}</div>
      <div class="slr-body">${readout()}</div>`;
  }

  app.registerStaticLayer({
    id: "sealevel", z: 45, // above terrain glyphs (40), under rivers and borders (50)
    visible: () => on && !!data && drawn >= 0,
    sig: () => `${drawn}`,
    draw(ctx, vp, w, o) {
      const g = w.grid, rg = o.range;
      ctx.fillStyle = COLOR;
      for (let b = 0; b < BUCKETS; b++) {
        if (!byAlpha[b].length) continue;
        ctx.globalAlpha = bucketAlpha(b);
        ctx.beginPath(); // render/map.js hexPath, inlined so each alpha step is one fill
        for (const c of byAlpha[b]) {
          if (rg) { const r = (c / g.cols) | 0, cc = c % g.cols; if (r < rg.r0 || r > rg.r1 || cc < rg.c0 || cc > rg.c1) continue; }
          const x = g.cx(c), y = g.cy(c);
          ctx.moveTo(x + g.corners[0][0], y + g.corners[0][1]);
          for (let k = 1; k < 6; k++) ctx.lineTo(x + g.corners[k][0], y + g.corners[k][1]);
          ctx.closePath();
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  });

  // --- per-frame art (app.motion) -------------------------------------------------------------------------------
  let v = null, pad = 0; // this frame's view (world units) and cull margin
  function hexes(ctx, g, cells) { // add the in-view cells to the current path; false if none
    let any = false;
    for (let j = 0; j < cells.length; j++) {
      const c = cells[j], x = g.cx(c), y = g.cy(c);
      if (x < v.x0 - pad || x > v.x1 + pad || y < v.y0 - pad || y > v.y1 + pad) continue;
      ctx.moveTo(x + g.corners[0][0], y + g.corners[0][1]);
      for (let k = 1; k < 6; k++) ctx.lineTo(x + g.corners[k][0], y + g.corners[k][1]);
      ctx.closePath();
      any = true;
    }
    return any;
  }
  // One shared ripple pattern (a few soft wavy lines), kept a constant size on screen and drifting slowly.
  let pat = null;
  const mat = typeof DOMMatrix === "function" ? new DOMMatrix() : null;
  function pattern(ctx) {
    if (pat || !mat) return pat;
    const c = document.createElement("canvas");
    c.width = c.height = 96;
    const p = c.getContext("2d");
    p.strokeStyle = "#e6f4ff";
    p.lineWidth = 1.4;
    p.lineCap = "round";
    for (let r = 0; r < 4; r++) {
      const y0 = 12 + r * 24, x0 = (r % 2) * 40;
      p.beginPath();
      for (let x = 0; x <= 44; x += 4) p.lineTo((x0 + x) % 96, y0 + 3 * Math.sin((x / 44) * Math.PI * 2));
      p.stroke();
    }
    pat = ctx.createPattern(c, "repeat");
    return pat;
  }
  // Flooded cells in view? (asked every frame: a few hundred bbox tests at most)
  function anyInView() {
    const vv = app.cam.view(), R = app.w.grid.R, g = app.w.grid;
    for (let j = 0; j < flooded.length; j++) {
      const x = g.cx(flooded[j]), y = g.cy(flooded[j]);
      if (x >= vv.x0 - R && x <= vv.x1 + R && y >= vv.y0 - R && y <= vv.y1 + R) return true;
    }
    return false;
  }

  M.register({ // the threshold step the user started: full frame rate
    id: "sealevel-rise", z: 20, ambient: false,
    active: () => !!anim,
    draw(ctx, cam, a, f) {
      if (!anim || !on || f.still) return;
      const g = a.w.grid;
      v = cam.view(); pad = g.R;
      ctx.fillStyle = COLOR;
      for (const b of anim.bins) {
        const fd = fadeOf(b.g, anim.p), al = b.beta * (anim.rising ? fd : 1 - fd);
        if (al <= 0.002) continue;
        ctx.globalAlpha = al;
        ctx.beginPath();
        if (hexes(ctx, g, b.cells)) ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  });
  // Battery (the policy of ext/motion and ext/traffic): the ripple runs at 30 fps (20 on phones) and stops after a
  // minute without input; between capped frames active() is false and a timer asks for the next frame. A step the
  // user started (anim) runs at full rate.
  const GAP = 1000 / (app.isMobile?.() ? 20 : 30), IDLE_MS = 60000;
  let lastInput = performance.now(), lastRipple = 0, rippleTimer = 0;
  const wake = () => {
    const idle = performance.now() - lastInput > IDLE_MS;
    lastInput = performance.now();
    if (idle) app.requestDraw();
  };
  for (const ev of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"]) addEventListener(ev, wake, { passive: true, capture: true });
  // The timer re-checks when it fires: a frame drawn meanwhile (by anything) moved lastRipple, so it waits again.
  const arm = (wait) => {
    if (rippleTimer) return;
    rippleTimer = setTimeout(() => {
      rippleTimer = 0;
      const w = lastRipple + GAP - performance.now();
      if (w <= 9) app.requestDraw(); else arm(w);
    }, wait - 8);
  };
  function rippleDue() {
    if (performance.now() - lastInput > IDLE_MS || !flooded.length || !anyInView()) return false;
    const wait = lastRipple + GAP - performance.now();
    if (wait <= 9) return true;
    arm(wait);
    return false;
  }
  M.register({ // ambient: the ripple on flooded water, and a brighter shimmer on cells as they flood
    id: "sealevel-water", z: 21,
    active: () => on && !!data && (!!anim || rippleDue()),
    draw(ctx, cam, a, f) {
      // (drawn on every frame, capped or not, so the texture never blinks; pans/zooms skip the decoration)
      if (!on || !data || f.still || (!flooded.length && !anim) || (f.moving && !anim)) return;
      lastRipple = performance.now();
      const pt = pattern(ctx);
      if (!pt) return;
      const g = a.w.grid, s = cam.scale;
      v = cam.view(); pad = g.R;
      mat.a = mat.d = 1 / s;
      mat.e = (f.t * 7) / s;
      mat.f = (Math.sin(f.t * 0.7) * 5) / s;
      pt.setTransform(mat);
      ctx.fillStyle = pt;
      ctx.globalAlpha = TEX;
      ctx.beginPath();
      if (hexes(ctx, g, flooded)) ctx.fill();
      if (anim) {
        for (let k = 0; k < GROUPS; k++) {
          const fd = fadeOf(k, anim.p);
          // rising: the texture comes in with the cells, with a pulse while they fill; falling: it fades out
          const al = anim.rising ? TEX * fd + 0.35 * Math.sin(Math.PI * fd) : TEX * (1 - fd);
          if (al <= 0.002 || !anim.fresh[k].length) continue;
          ctx.globalAlpha = Math.min(1, al);
          ctx.beginPath();
          if (hexes(ctx, g, anim.fresh[k])) ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    },
  });
  M.on("change", () => app.requestDraw());

  const style = document.createElement("style");
  style.textContent = `.slr-panel{padding:8px 10px;width:300px;max-width:100%;font-size:11px;line-height:1.4}
.slr-head{font-family:var(--serif);color:var(--gold-bright);font-size:14px;display:flex;align-items:center;gap:6px}
.slr-head>span{flex:1}
.slr-play{font:11px var(--sans,inherit);color:var(--ink);background:transparent;border:1px solid ${COLOR};border-radius:10px;padding:1px 7px;cursor:pointer;white-space:nowrap}
.slr-play:hover,.slr-play:focus-visible{background:${COLOR}55}
.slr-panel input[type=range]{width:100%;margin:6px 0 0;accent-color:${COLOR};--range:${COLOR}}
.slr-ticks{display:flex;justify-content:space-between;color:var(--ink-dim);margin-bottom:4px}
.slr-stats{margin:2px 0;font-variant-numeric:tabular-nums}.slr-top{display:flex;flex-wrap:wrap;gap:2px 10px;color:var(--ink-dim)}
.slr-top b,.slr-stats b{color:var(--ink)}.slr-note{color:var(--ink-dim);margin-top:4px;font-size:10px}
@media (max-width:640px){.slr-panel{width:auto;margin:0 8px}}`;
  document.head.appendChild(style);

  // The share image names the tint (its caption has no other key for it).
  app.shareNote = () => (on && data && level >= 0 ? t("Blue hexes: land at or below {h} m above sea level (ETOPO1)", { h: dec(data.levels[level]) }) : null);

  app.ui.addMapToggle({
    id: "sealevel", label: t("Sea level rise"), icon: "l-wave", group: "Environment", default: false,
    title: t("Land hexes at or below a chosen sea level (ETOPO1): an exposure indicator, not a forecast"),
    get: () => on,
    set(val) {
      on = !!val;
      if (!on) cancel();
      if (on && !data) {
        app.loadData("sealevel").then((d) => {
          if (!d || !Array.isArray(d.levels)) { failed = true; render(); return; }
          data = d;
          level = drawn = Math.min(level, d.levels.length - 1);
          recompute();
          render();
          app.requestDraw();
        });
      }
      render();
      app.requestDraw();
    },
  });
}
