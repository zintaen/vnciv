// Split-screen compare: the live map is the left side (its lens and year are the app's own: app.setLens and the
// timeline), the right side is the same view drawn with another lens and/or year. The right side is rendered once
// per view change into an offscreen canvas (render/snapshot.js renderToCanvas, with a shallow copy of the prepared
// world recoloured by world.js applyLens), and every frame only that canvas is drawn, clipped to the right of the
// divider, by a world-space overlay. Year views follow ext/timeline's rules: a series lens shows that year's
// published values (no interpolation, the domain fixed over every year), the typhoon lens that season's storms, and
// years before the 2025 merger the 63 former provinces' borders.
import { t } from "../../i18n.js";
import { applyLens, adminBorders } from "../../world.js";
import { renderToCanvas } from "../../render/snapshot.js";

const SETTLE_MS = 220;

export function createSplit(app, T, { onRender } = {}) {
  const w = app.w, raw = w.raw, n = w.grid.size;
  const countyIso = (raw.counties || []).map((c) => c.geoid), stateAbbr = raw.states.map((s) => s.abbr);
  const seriesByLens = new Map(Object.values(T?.series || {}).filter((s) => s.lens).map((s) => [s.lens, s]));
  const mergerYear = +String(T?.merger?.date || "2025").slice(0, 4);
  const seasons = (T?.storms || []).map((s) => s.season);

  let on = false, frac = 0.5, moved = false, right = { lens: null, year: null };
  const off = { cv: document.createElement("canvas"), key: "", ready: false, x0: 0, y0: 0, wKm: 0, hKm: 0 };
  let timer = 0, pending = "";

  // --- year views ---------------------------------------------------------------------------------------------
  const domains = new Map();
  function seriesDomain(lens, s) {
    if (domains.has(lens.id)) return domains.get(lens.id);
    let lo = Infinity, hi = -Infinity;
    for (const lv of Object.values(s.lens_values || {})) for (const by of Object.values(lv)) for (const v of Object.values(by)) {
      if (!Number.isFinite(v) || (lens.scale === "log" && v <= 0)) continue;
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    const d = Number.isFinite(lo) && hi > lo ? [lo, hi] : lens.domain;
    domains.set(lens.id, d);
    return d;
  }
  const views = new Map();
  /** The lens as drawn for year y (null = now): {lens, note} — note says when no yearly figure exists. */
  function viewOf(lens, y) {
    if (!lens || y == null) return { lens, note: "" };
    const key = `${lens.id}@${y}`;
    if (views.has(key)) return views.get(key);
    let out;
    const s = seriesByLens.get(lens.id);
    if (s) {
      const pref = String(lens.level || "63");
      const lvl = [pref, pref === "63" ? "34" : "63"].find((l) => Object.values(s.lens_values?.[l] || {}).some((v) => v[y] != null));
      const values = new Array(n).fill(null);
      if (lvl) {
        const lv = s.lens_values[lvl], unit = lvl === "63" ? raw.county : raw.owner, keys = lvl === "63" ? countyIso : stateAbbr;
        for (let i = 0; i < n; i++) if (raw.owner[i] >= 0) { const v = lv[keys[unit[i]]]?.[y]; if (v != null) values[i] = v; }
      }
      out = { lens: { ...lens, id: key, values, domain: seriesDomain(lens, s) }, note: lvl ? "" : t("no data for this year") };
    } else if (lens.id === "disasters" && seasons.length) {
      const values = new Array(n).fill(null);
      for (let i = 0; i < n; i++) if (raw.owner[i] >= 0) values[i] = 0;
      for (const st of T.storms) if (st.season === y) for (const c of st.cells) if (values[c] != null) values[c]++;
      out = { lens: { ...lens, id: key, values, domain: [0, 4] }, note: "" };
    } else out = { lens, note: t("No yearly series: this lens shows {when}", { when: lens.year ? String(lens.year) : t("its latest data") }) };
    views.set(key, out);
    return out;
  }
  const borders = new Map();
  const bordersFor = (y) => {
    const lvl = y != null && y < mergerYear ? "63" : "34";
    if (!borders.has(lvl)) borders.set(lvl, adminBorders(w, lvl));
    return borders.get(lvl);
  };
  const yearsFor = (lensId) => (lensId === "disasters" && seasons.length
    ? Array.from({ length: Math.max(...seasons) - Math.min(...seasons) + 1 }, (_, k) => Math.min(...seasons) + k)
    : [...(T?.years || [])]);

  // --- render -------------------------------------------------------------------------------------------------
  const lensById = (id) => (id ? app.data.lenses?.lenses?.find((l) => l.id === id) || null : null);
  const layersSig = () => app.staticLayers().map((l) => (typeof l.visible === "function" ? (l.visible() ? 1 : 0) : 1)).join("");
  const keyNow = () => {
    const c = app.cam;
    return `${right.lens}|${right.year}|${c.x.toFixed(2)},${c.y.toFixed(2)},${c.scale.toFixed(5)},${c.w}x${c.h}|${layersSig()}|${app.state.selectedCity?.id || ""}|${app.state.selectedState ?? ""}`;
  };
  function render() {
    timer = 0;
    if (!on) return;
    const c = app.cam, dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.max(1, Math.round(c.w * dpr)), H = Math.max(1, Math.round(c.h * dpr));
    if (off.cv.width !== W || off.cv.height !== H) { off.cv.width = W; off.cv.height = H; }
    const base = lensById(right.lens);
    if (base && !base.values && app.lensValues) { app.lensValues(base).then((v) => { if (v && on) schedule(0); }); return; } // values load on demand
    const { lens } = viewOf(base, right.year);
    const wB = { ...w };
    applyLens(wB, lens, null);
    const b = bordersFor(right.year);
    wB.bands = b.bands; wB.stateLines = b.stateLines; wB.bandColor = b.bandColor; wB.stateLabels = b.stateLabels;
    const t0 = performance.now();
    renderToCanvas(off.cv, c, wB, { ...app.state, lens, band: null, hoverCell: -1 }, app.data.nation, {
      banners: false, dpr, fit: "same", app, staticLayers: app.staticLayers().filter((l) => l.snapshot !== false),
    });
    if (app.perf) app.perf.splitRender = performance.now() - t0;
    off.x0 = c.x - c.w / 2 / c.scale; off.y0 = c.y - c.h / 2 / c.scale; off.wKm = c.w / c.scale; off.hKm = c.h / c.scale;
    off.key = keyNow();
    off.ready = true;
    follow();
    app.requestDraw();
    onRender?.();
  }
  const schedule = (ms = SETTLE_MS) => { clearTimeout(timer); timer = setTimeout(render, ms); };

  // --- the divider --------------------------------------------------------------------------------------------
  const bar = document.createElement("div");
  bar.className = "story-split";
  bar.hidden = true;
  bar.innerHTML = `<div class="story-split-line"></div><button type="button" class="story-split-knob" role="slider" aria-valuemin="0" aria-valuemax="100"
      aria-label="${t("Split position")}" title="${t("Drag, or use ← → (Shift for big steps)")}">⇔</button>
    <span class="story-split-tag story-split-l"></span><span class="story-split-tag story-split-r"></span>`;
  document.body.appendChild(bar);
  const knob = bar.querySelector(".story-split-knob"), tagL = bar.querySelector(".story-split-l"), tagR = bar.querySelector(".story-split-r");
  function place() {
    const a = app.visibleArea();
    const x = a.x0 + frac * (a.x1 - a.x0);
    bar.style.left = `${x}px`;
    bar.style.top = `${a.y0}px`;
    bar.style.height = `${Math.max(60, a.y1 - a.y0)}px`;
    knob.setAttribute("aria-valuenow", String(Math.round(frac * 100)));
    knob.setAttribute("aria-valuetext", t("{p}% of the map shows the left side", { p: Math.round(frac * 100) }));
  }
  const setFrac = (f, user = true) => { moved = moved || user; frac = Math.max(0.03, Math.min(0.97, f)); place(); app.requestDraw(); };
  // Until the user moves it, the divider sits on the mean x of the land hexes in view (Vietnam is narrow: the middle
  // of the screen is mostly sea).
  const rem = new Set(raw.remote || []);
  const follow = () => { if (!moved) setFrac(Math.max(0.1, Math.min(0.9, landFrac())), false); };
  function landFrac() {
    const a = app.visibleArea(), v = app.cam.view();
    let sum = 0, k = 0;
    raw.owner.forEach((o, i) => {
      if (o < 0 || rem.has(i)) return;
      const x = w.grid.cx(i), y = w.grid.cy(i);
      if (x >= v.x0 && x <= v.x1 && y >= v.y0 && y <= v.y1) { sum += x; k++; }
    });
    if (!k) return 0.5;
    const [sx] = app.cam.toScreen(sum / k, 0);
    return (sx - a.x0) / Math.max(1, a.x1 - a.x0);
  }
  knob.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    knob.setPointerCapture(e.pointerId);
    const move = (ev) => { const a = app.visibleArea(); setFrac((ev.clientX - a.x0) / Math.max(1, a.x1 - a.x0)); };
    const up = () => { knob.removeEventListener("pointermove", move); knob.removeEventListener("pointerup", up); knob.removeEventListener("pointercancel", up); };
    knob.addEventListener("pointermove", move);
    knob.addEventListener("pointerup", up);
    knob.addEventListener("pointercancel", up);
  });
  knob.addEventListener("keydown", (e) => {
    const step = e.shiftKey || e.key.startsWith("Page") ? 0.1 : 0.02;
    const f = { ArrowLeft: frac - step, ArrowDown: frac - step, PageDown: frac - step, ArrowRight: frac + step, ArrowUp: frac + step, PageUp: frac + step, Home: 0, End: 1 }[e.key];
    if (f == null) return;
    e.preventDefault();
    e.stopPropagation();
    setFrac(f);
  });

  // --- per frame: the cached right side, clipped --------------------------------------------------------------
  app.registerOverlay({
    id: "story-split", z: 5, snapshot: false,
    draw(ctx, cam) {
      if (!on) return;
      // (other motion can draw every frame: the debounce restarts only when the view itself changed)
      const k = keyNow();
      if (off.key !== k && pending !== k) { pending = k; schedule(off.ready ? SETTLE_MS : 0); }
      if (!off.ready) return;
      const a = app.visibleArea();
      const [wx] = cam.toWorld(a.x0 + frac * (a.x1 - a.x0), 0);
      const v = cam.view();
      if (wx >= v.x1) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(wx, v.y0, v.x1 - wx, v.y1 - v.y0);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off.cv, off.x0, off.y0, off.wKm, off.hKm);
      ctx.restore();
    },
  });
  for (const ev of ["resize", "lens", "year", "data"]) app.on(ev, () => { if (on) { follow(); tags(); schedule(60); } });

  function labelOf(lensId, y) {
    const l = lensById(lensId);
    return `${l ? t(l.name) : t("Terrain")} · ${y == null ? t("Now") : y}`;
  }
  function tags() {
    tagL.textContent = labelOf(app.state.lens?.id || null, app.timeline?.year ?? null);
    tagR.textContent = labelOf(right.lens, right.year);
  }

  return {
    get on() { return on; },
    get right() { return { ...right }; },
    viewOf: (id, y) => viewOf(lensById(id), y),
    yearsFor,
    open(r) {
      on = true;
      right = { lens: r?.lens ?? null, year: r?.year ?? null };
      off.ready = false; off.key = "";
      bar.hidden = false;
      moved = false;
      place(); tags();
      schedule(0);
    },
    setRight(r) { right = { ...right, ...r }; off.key = ""; tags(); schedule(0); },
    tags,
    close() {
      on = false;
      clearTimeout(timer);
      bar.hidden = true;
      off.ready = false;
      off.cv.width = off.cv.height = 1; // free the pixels
      app.requestDraw();
    },
    knob,
  };
}
