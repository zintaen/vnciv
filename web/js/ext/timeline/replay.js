// Data replays for the timeline (all through app.motion; docs/DATA_CONTRACTS.md "Motion"):
//  * storms   a storm (or every storm of a season, one after another) along its IBTrACS best track in compressed time
//             (1 day ≈ 1.5 s at ×1): a spinning eye coloured by the wind of the latest fix, a trail coloured by wind
//             (grey dashes where the agency gives no wind), and the hexes within 100 km lighting up as the eye passes
//             (the Typhoons lens rule: the hex centre within 100 km of a stretch of track where either end has 34 kt or
//             more; a weaker pass lights nothing). Times are shown in Vietnam time.
//  * merger   1 July 2025: the 11 unchanged provinces pulse, then the 23 merged ones in merger.json `order` lose their
//             inner (former-province) borders while the former names glide to the new name.
//  * forest   the forest_loss lens accumulating year by year (2001 → 2025, the per-year Hansen loss, not interpolated),
//             with a running national hectare total; an overlay over the lens as published (its end state).
// Every replay has a still end state: Effects off / reduced motion jumps to it (app.motion.tween ends at once).
// One replay at a time, in a bar at the bottom; Esc or ✕ closes it (the map keeps the static year view).
import { t, lang } from "../../i18n.js";
import { esc, int, pct } from "../../format.js";
import { adminBorders, LABEL_FONT, LABEL_SPACING, lensScale, stateOutline } from "../../world.js";
import { css, parseHex, rampColor, shade } from "../../color.js";
import { stateLabelAlpha } from "../../render/map.js";

const SEC_PER_DAY = 1.5; // replay seconds per day of storm time at ×1
const SPEEDS = [1, 2, 4];
const REACH_KM = 100; // pipeline/build/lenses.py STORM_RADIUS_KM
const MERGE_MS = 10500;
const MERGE_T0 = 1.2, MERGE_STEP = 0.32, MERGE_LEN = 1.8; // s: first merger, stagger, length of one
const FOREST_YEAR_MS = 500;
// Wind bands (kt: JMA 10-minute or JTWC 1-minute wind, the lens's agency rule)
const BANDS = [
  { color: "#6fb7e0", label: "Tropical depression (under 34 kt)" },
  { color: "#f2c94c", label: "Tropical storm (34–63 kt)" },
  { color: "#eb5a3c", label: "Typhoon (64 kt or more)" },
];
const NO_WIND = "#9aa0a6";
const NODASH = [];
const bandOf = (kt) => (Number.isFinite(kt) ? (kt < 34 ? 0 : kt < 64 ? 1 : 2) : -1);
const colorOf = (b) => (b < 0 ? NO_WIND : BANDS[b].color);
const smooth = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

export function createReplay(app, T, { onClose } = {}) {
  const M = app.motion, w = app.w, raw = w.raw, grid = w.grid;
  const R = grid.R, reach = REACH_KM / (raw.km_per_unit || 0.2);
  let session = null; // {kind, close(), pause?(), speed?(), follow?(on), skip?()}
  let opener = null; // focused when the replay started: focus goes back there when the bar closes with focus in it

  // --- the bar ----------------------------------------------------------------------------------------------------
  const bar = document.createElement("div");
  bar.className = "panel rp-bar";
  bar.hidden = true;
  bar.setAttribute("role", "region");
  bar.innerHTML = `<div class="rp-head"><b class="rp-title" aria-live="polite"></b><button type="button" class="icon-btn rp-close" aria-label="${esc(t("Close"))}" title="${esc(t("Close (Esc)"))}">✕</button></div>
    <div class="rp-read"></div><div class="rp-sub"></div>
    <div class="rp-ctl"><button type="button" class="tl-btn rp-pause"></button><button type="button" class="tl-btn rp-speed"></button>
      <label class="rp-follow"><input type="checkbox"> <span>${esc(t("Follow the eye"))}</span></label>
      <button type="button" class="tl-btn rp-skip"></button></div>`;
  document.body.appendChild(bar);
  const q = (s) => bar.querySelector(s);
  const titleEl = q(".rp-title"), readEl = q(".rp-read"), subEl = q(".rp-sub"), pauseBtn = q(".rp-pause"), speedBtn = q(".rp-speed"),
    followEl = q(".rp-follow"), followBox = q(".rp-follow input"), skipBtn = q(".rp-skip");
  function showBar({ title, sub = "", pause = false, speed = false, follow = false, skip = "" }) {
    // the title is the bar's live region (the replay, each storm, the end): a hidden live region would not announce it
    bar.hidden = false;
    titleEl.textContent = title;
    bar.setAttribute("aria-label", title);
    subEl.innerHTML = sub;
    readEl.textContent = "";
    pauseBtn.hidden = !pause; speedBtn.hidden = !speed; followEl.hidden = !follow;
    skipBtn.hidden = !skip; skipBtn.textContent = skip; skipBtn.title = skip;
    if (!bar.contains(document.activeElement)) opener = document.activeElement;
    bar.hidden = false;
  }
  function setPaused(p) {
    pauseBtn.textContent = p ? "▶" : "❚❚";
    const l = p ? t("Play") : t("Pause");
    pauseBtn.setAttribute("aria-label", l); pauseBtn.title = l;
  }
  bar.addEventListener("click", (ev) => {
    if (!session) return;
    if (ev.target.closest(".rp-close")) close();
    else if (ev.target.closest(".rp-pause")) session.pause?.();
    else if (ev.target.closest(".rp-speed")) session.speed?.();
    else if (ev.target.closest(".rp-skip")) session.skip?.();
  });
  followBox.addEventListener("change", () => session?.follow?.(followBox.checked));
  // Esc closes the replay first (registered before the timeline card's handler)
  app.on("escape", () => { if (!session) return false; close(); return true; });

  function close() {
    const s = session;
    const hadFocus = bar.contains(document.activeElement);
    session = null;
    bar.hidden = true;
    s?.close();
    if (s) onClose?.(s.kind);
    if (hadFocus) (opener !== document.body && opener?.isConnected && opener.getClientRects().length ? opener : document.querySelector("#turn .tl-hist-btn"))?.focus();
  }

  // --- storms -----------------------------------------------------------------------------------------------------
  const fmtTime = new Intl.DateTimeFormat(lang === "vi" ? "vi-VN" : "en-GB", { timeZone: "Asia/Ho_Chi_Minh", day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const corners = grid.corners.flat();

  function prepStorm(st, ts) {
    const pts = (st?.points || []).filter((p) => Number.isFinite(Date.parse(p[0])) && Number.isFinite(p[1]) && Number.isFinite(p[2]));
    if (pts.length < 2) return null;
    const m = pts.length, t0 = Date.parse(pts[0][0]);
    const tm = new Float64Array(m), x = new Float32Array(m), y = new Float32Array(m), band = new Int8Array(m), kt = new Float32Array(m);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach((p, j) => {
      tm[j] = (Date.parse(p[0]) - t0) / 1000; x[j] = p[1]; y[j] = p[2];
      kt[j] = p[3] == null ? NaN : +p[3]; band[j] = bandOf(kt[j]);
      const cx = Math.max(0, Math.min(raw.width, p[1])), cy = Math.max(0, Math.min(raw.height, p[2]));
      x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
    });
    // The time each of the storm's hexes first comes within reach of the moving eye (positions linear between fixes),
    // on the stretches the lens counts (pipeline/build/lenses.py typhoons(): either end at 34 kt or more; no wind = 0).
    const cells = ts?.cells || [], r2 = reach * reach, k = cells.length;
    const lit = cells.map((c) => {
      const cx = grid.cx(c), cy = grid.cy(c);
      for (let j = 0; j + 1 < m; j++) {
        if (!(Math.max(kt[j] || 0, kt[j + 1] || 0) >= 34)) continue;
        const ax = x[j] - cx, ay = y[j] - cy, dx = x[j + 1] - x[j], dy = y[j + 1] - y[j];
        const c0 = ax * ax + ay * ay - r2;
        if (c0 <= 0) return [c, tm[j]];
        const a = dx * dx + dy * dy, b = 2 * (ax * dx + ay * dy), disc = b * b - 4 * a * c0;
        if (a === 0 || disc < 0) continue;
        const u = (-b - Math.sqrt(disc)) / (2 * a);
        if (u >= 0 && u <= 1) return [c, tm[j] + u * (tm[j + 1] - tm[j])];
      }
      return [c, tm[m - 1]]; // within reach by the lens's own computation all the same (rounding): lit at the end
    }).sort((a, b) => a[1] - b[1]);
    const lx = new Float32Array(k), ly = new Float32Array(k), lt = new Float64Array(k);
    lit.forEach(([c, tt], i) => { lx[i] = grid.cx(c); ly[i] = grid.cy(c); lt[i] = tt; });
    return { st, m, t0, tm, x, y, band, kt, end: tm[m - 1], bbox: [x0, y0, x1, y1], lx, ly, lt,
      name: st.name && st.name !== "Unnamed" ? st.name : t("Unnamed") };
  }

  async function storms(indices, year) {
    const from = document.activeElement; // (before the await: a phone has just hidden the card with this ▶ in it)
    close();
    const S = await app.loadData("storm_tracks");
    if (!S?.storms || S.storms.length !== T.storms.length) { console.warn("storm_tracks.json missing or out of step with timeline.json"); return false; }
    const tracks = indices.map((i) => prepStorm(S.storms[i], T.storms[i])).filter(Boolean);
    if (!tracks.length) return false;
    close(); // something else started while loading
    const many = tracks.length > 1, id = {};
    let k = 0, clock = 0, speed = 0, paused = false, follow = false, spin = 0, last = 0, hour = -1, still = false, ticker = null;
    let j = 0, ex = 0, ey = 0; // the latest fix at or before the clock, and the eye's position
    let glide = null; // follow: the camera centre being glided to
    const legend = `<span class="rp-legend">${BANDS.map((b) => `<span><i style="background:${b.color}"></i>${esc(t(b.label))}</span>`).join("")}<span><i class="rp-nw"></i>${esc(t("no estimate"))}</span></span>
      <span class="rp-note">${esc(t("Hexes light up when the eye passes within 100 km at 34 kt or more (the lens's rule). Wind: the agency's estimate at each fix."))}</span>`;
    const setTitle = () => {
      const tr = tracks[k];
      titleEl.textContent = many ? `${tr.name} (${k + 1}/${tracks.length}) · ${t("Storms of {year}", { year })}` : `${tr.name} · ${tr.st.season}`;
    };
    showBar({ title: "", sub: legend, pause: true, speed: true, follow: true, skip: many ? t("Next storm ⏭") : "" });
    if (from !== document.body && from?.isConnected && !from.getClientRects().length) { opener = from; pauseBtn.focus({ preventScroll: true }); } // its ▶ is hidden: focus the bar, not the page
    setTitle();
    const setSpeed = () => { speedBtn.textContent = `×${SPEEDS[speed]}`; const l = t("Speed ×{n}", { n: SPEEDS[speed] }); speedBtn.setAttribute("aria-label", l); speedBtn.title = l; };
    setSpeed();
    followBox.checked = false;
    setPaused(false);
    // one framing for the whole run (every track of a season together): a re-fit per storm would re-render the
    // static map each time
    const grow = (u, x0, y0, x1, y1) => [Math.min(u[0], x0), Math.min(u[1], y0), Math.max(u[2], x1), Math.max(u[3], y1)];
    const EMPTY = [Infinity, Infinity, -Infinity, -Infinity];
    const box = tracks.reduce((u, tr) => grow(u, ...tr.bbox), EMPTY);
    // the hexes the storms reach (Vietnam's part of the story): framed instead when the whole track can't fit (phones)
    const litBox = tracks.reduce((u, tr) => { for (let i = 0; i < tr.lx.length; i++) u = grow(u, tr.lx[i], tr.ly[i], tr.lx[i], tr.ly[i]); return u; }, EMPTY);
    const fit = () => {
      const a = app.visibleArea(), fits = (b) => Math.min((a.x1 - a.x0) / (b[2] - b[0] + 2 * reach), (a.y1 - a.y0) / (b[3] - b[1] + 2 * reach)) >= app.cam.minScale;
      const [x0, y0, x1, y1] = fits(box) || !Number.isFinite(litBox[0]) ? box : litBox;
      app.fitBounds(x0 - reach, y0 - reach, x1 + reach, y1 + reach, { maxScale: app.cam.fitScale * 6 });
    };
    function locate() {
      const tr = tracks[k];
      if (clock < tr.tm[j]) j = 0;
      while (j + 1 < tr.m && tr.tm[j + 1] <= clock) j++;
      if (j + 1 < tr.m) {
        const u = (clock - tr.tm[j]) / (tr.tm[j + 1] - tr.tm[j] || 1);
        ex = tr.x[j] + u * (tr.x[j + 1] - tr.x[j]); ey = tr.y[j] + u * (tr.y[j + 1] - tr.y[j]);
      } else { ex = tr.x[tr.m - 1]; ey = tr.y[tr.m - 1]; }
    }
    function readout() {
      const tr = tracks[k], h = Math.floor(clock / 3600);
      if (h === hour) return; // the DOM changes once per storm hour
      hour = h;
      const kt = tr.kt[j], b = tr.band[j];
      readEl.innerHTML = `<time>${esc(fmtTime.format(new Date(tr.t0 + clock * 1000)))}</time> <span class="rp-tz">${esc(t("Vietnam time (UTC+7)"))}</span>
        <span class="rp-wind" style="--c:${colorOf(b)}">${b < 0 ? esc(t("wind: no estimate")) : `${esc(int(kt))} kt · ${esc(t(BANDS[b].label))}`}</span>`;
    }
    const next = () => { k++; clock = 0; j = 0; hour = -1; setTitle(); };
    function tick(v, p) {
      if (p >= 1) return; // the forced end (motion turned off): onDone draws the still state
      const now = performance.now(), dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      spin += dt * 4;
      clock += dt * SPEEDS[speed] * 86400 / SEC_PER_DAY;
      if (clock >= tracks[k].end) {
        if (k + 1 < tracks.length) next();
        else return close(); // the end: the static year view stays
      }
      locate();
      readout();
      if (follow && !app.cam.flight) {
        // soft follow: once the eye nears the edge of the view, glide (a pan at the same scale) to a new centre that
        // leads the eye along its heading. A same-scale pan blits the cached static map and re-renders it only when
        // it runs off the cache's margin; a flyTo's zoom arc re-rendered it several times per jump (~15 fps at 4×).
        const c = app.cam, a = app.visibleArea(), [sx, sy] = c.toScreen(ex, ey), mx = (a.x1 - a.x0) * 0.12, my = (a.y1 - a.y0) * 0.12;
        if (!glide && (sx < a.x0 + mx || sx > a.x1 - mx || sy < a.y0 + my || sy > a.y1 - my)) {
          const tr = tracks[k], j1 = Math.min(j + 1, tr.m - 1), j0 = j1 - 1;
          const hx = tr.x[j1] - tr.x[j0], hy = tr.y[j1] - tr.y[j0], hl = Math.hypot(hx, hy) || 1, lead = 0.3 * (a.x1 - a.x0) / c.scale;
          // the eye goes where the screen point (sx, sy) of the free area's centre is
          const ox = ((a.x0 + a.x1) / 2 - c.w / 2) / c.scale, oy = ((a.y0 + a.y1) / 2 - c.h / 2) / c.scale;
          glide = [ex + (hx / hl) * lead - ox, ey + (hy / hl) * lead - oy];
        }
        if (glide) {
          const x0 = c.x, y0 = c.y, u = Math.min(1, dt * 5); // ~90% of the way in 0.45 s
          c.centerOn(x0 + (glide[0] - x0) * u, y0 + (glide[1] - y0) * u);
          // there (or held by the map's edge): done
          if (Math.hypot(glide[0] - c.x, glide[1] - c.y) * c.scale < 0.5 || (c.x === x0 && c.y === y0)) glide = null;
        }
      }
    }
    // A tween that never ends drives the clock: it runs right before each frame draws, at full rate, and ends at
    // once when motion is turned off (onDone → the still state).
    const run = () => { last = 0; ticker = M.tween({ from: 0, to: 1, ms: 1e12, ease: "linear", onUpdate: tick, onDone: toStill }); };
    function toStill() {
      // Effects off / reduced motion: every track complete, every hex lit, the date span in the readout
      ticker = null;
      if (session?.id !== id) return;
      still = true;
      k = tracks.length - 1; clock = tracks[k].end; locate();
      const a = tracks[0], b = tracks[k], d = (tr, tt) => fmtTime.format(new Date(tr.t0 + tt * 1000));
      readEl.innerHTML = `<time>${esc(d(a, 0))} – ${esc(d(b, b.end))}</time> <span class="rp-tz">${esc(t("Vietnam time (UTC+7)"))}</span>`;
      titleEl.textContent = many ? t("Storms of {year}", { year }) : `${b.name} · ${b.st.season}`;
      pauseBtn.hidden = speedBtn.hidden = skipBtn.hidden = followEl.hidden = true;
      app.requestDraw();
    }
    const offLit = M.register({ id: "replay-storm-hexes", z: 96, ambient: false, active: () => !!ticker, draw: drawLit });
    const offEye = M.register({ id: "replay-storm-eye", z: 104, ambient: false, active: () => !!ticker, draw: drawTrack });
    const unfollow = (e) => { if (follow && e.target?.id === "map") { follow = false; glide = null; followBox.checked = false; } };
    addEventListener("pointerdown", unfollow, true);
    session = {
      kind: "storms", id,
      close() { ticker?.(); ticker = null; offLit(); offEye(); removeEventListener("pointerdown", unfollow, true); app.requestDraw(); },
      pause() { if (still) return; paused = !paused; setPaused(paused); if (paused) { ticker?.(); ticker = null; } else run(); app.requestDraw(); },
      speed() { speed = (speed + 1) % SPEEDS.length; setSpeed(); },
      follow(on) { follow = on; glide = null; if (!on) fit(); },
      skip() { if (k + 1 < tracks.length) { next(); locate(); readout(); app.requestDraw(); } },
    };
    fit();
    locate(); readout();
    run();

    // drawing, in world units (no allocation per frame)
    const dash = [0, 0];
    function hexPath(ctx, xs, ys, from, to, v) {
      for (let i = from; i < to; i++) {
        const cx = xs[i], cy = ys[i];
        if (cx < v.x0 - R || cx > v.x1 + R || cy < v.y0 - R || cy > v.y1 + R) continue;
        ctx.moveTo(cx + corners[0], cy + corners[1]);
        for (let c = 2; c < 12; c += 2) ctx.lineTo(cx + corners[c], cy + corners[c + 1]);
        ctx.closePath();
      }
    }
    function countLit(tr, tt) { // lt is sorted: how many are lit by time tt
      let lo = 0, hi = tr.lt.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (tr.lt[mid] <= tt) lo = mid + 1; else hi = mid; }
      return lo;
    }
    function drawLit(ctx, cam) {
      const v = cam.view(), flash = 0.5 * SPEEDS[speed] * 86400 / SEC_PER_DAY; // the last ~0.5 s of replay glow brighter
      for (let i = 0; i <= k; i++) {
        const tr = tracks[i], done = i < k || still, nLit = done ? tr.lt.length : countLit(tr, clock);
        const nOld = done ? nLit : countLit(tr, clock - flash);
        ctx.beginPath();
        hexPath(ctx, tr.lx, tr.ly, 0, nOld, v);
        ctx.fillStyle = i < k ? "rgba(255,236,170,.16)" : "rgba(255,236,170,.30)";
        ctx.fill();
        if (nLit > nOld) {
          ctx.beginPath();
          hexPath(ctx, tr.lx, tr.ly, nOld, nLit, v);
          ctx.fillStyle = "rgba(255,246,210,.62)";
          ctx.fill();
        }
      }
    }
    function drawTrack(ctx, cam) {
      const s = cam.scale;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (let i = 0; i <= k; i++) {
        const tr = tracks[i], done = i < k || still, upto = done ? tr.m - 1 : j;
        ctx.globalAlpha = i < k ? 0.55 : 1;
        // a dark casing, then the wind-coloured runs
        ctx.setLineDash(NODASH);
        ctx.lineWidth = 5.5 / s;
        ctx.strokeStyle = "rgba(10,8,6,.55)";
        ctx.beginPath();
        ctx.moveTo(tr.x[0], tr.y[0]);
        for (let p = 1; p <= upto; p++) ctx.lineTo(tr.x[p], tr.y[p]);
        if (!done) ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.lineWidth = 3 / s;
        // runs of one wind band (segment p → p + 1 takes the colour of fix p), then the stretch to the eye
        let p = 0;
        for (;;) {
          if (done ? p >= upto : p > upto) break;
          const b = tr.band[p];
          ctx.beginPath();
          ctx.moveTo(tr.x[p], tr.y[p]);
          while (p < upto && tr.band[p] === b) { p++; ctx.lineTo(tr.x[p], tr.y[p]); }
          const tail = !done && p === upto && tr.band[p] === b;
          if (tail) ctx.lineTo(ex, ey);
          ctx.strokeStyle = colorOf(b);
          if (b < 0) { dash[0] = 4 / s; dash[1] = 5 / s; ctx.setLineDash(dash); } else ctx.setLineDash(NODASH);
          ctx.stroke();
          if (tail || (done && p === upto)) break;
        }
      }
      ctx.setLineDash(NODASH);
      ctx.globalAlpha = 1;
      if (still) return;
      // the 100 km reach, then the eye (turning counter-clockwise, like a northern-hemisphere cyclone)
      const col = colorOf(tracks[k].band[j]);
      ctx.beginPath();
      ctx.arc(ex, ey, reach, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,236,170,.07)";
      ctx.fill();
      dash[0] = 6 / s; dash[1] = 6 / s;
      ctx.setLineDash(dash);
      ctx.lineWidth = 1.2 / s;
      ctx.strokeStyle = "rgba(255,236,170,.55)";
      ctx.stroke();
      ctx.setLineDash(NODASH);
      const r = Math.max(14 / s, Math.min(reach * 0.45, 22 / s));
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(-spin);
      ctx.lineWidth = r * 0.34;
      ctx.strokeStyle = "rgba(10,8,6,.6)";
      for (let pass = 0; pass < 2; pass++) {
        for (let a = 0; a < 2; a++) {
          const s0 = a * Math.PI;
          ctx.beginPath();
          ctx.moveTo(Math.cos(s0) * r * 0.3, Math.sin(s0) * r * 0.3);
          ctx.quadraticCurveTo(Math.cos(s0 + 0.9) * r * 1.05, Math.sin(s0 + 0.9) * r * 1.05, Math.cos(s0 + 2.1) * r, Math.sin(s0 + 2.1) * r);
          ctx.stroke();
        }
        ctx.lineWidth = r * 0.2;
        ctx.strokeStyle = col;
      }
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.lineWidth = r * 0.1;
      ctx.strokeStyle = "rgba(10,8,6,.7)";
      ctx.stroke();
      ctx.restore();
    }
    return true;
  }

  // --- the 2025 merger --------------------------------------------------------------------------------------------
  let mergerModel = null;
  async function mergerPrep() {
    if (mergerModel) return mergerModel;
    const D = await app.loadData("merger");
    if (!D?.provinces?.length || !Array.isArray(raw.county)) return null;
    const ownerOf = new Map(raw.states.map((s, i) => [s.abbr, i]));
    const countyOf = new Map((raw.counties || []).map((c, i) => [c.geoid, i]));
    const l63 = new Map(adminBorders(w, "63").stateLabels.map((l) => [l.state, l]));
    const labels34 = adminBorders(w, "34").stateLabels, l34 = new Map(labels34.map((l) => [l.state, l]));
    const owner = raw.owner, county = raw.county, n = grid.size;
    // inner borders: hex edges between two former provinces inside one new province
    const segs = new Map();
    for (let i = 0; i < n; i++) {
      const o = owner[i];
      if (o < 0 || county[i] < 0) continue;
      for (let d = 0; d < 3; d++) {
        const nb = grid.neighbour(i, d);
        if (nb < 0 || owner[nb] !== o || county[nb] < 0 || county[nb] === county[i]) continue;
        const cx = grid.cx(i), cy = grid.cy(i), a = grid.corners[d], b = grid.corners[(d + 1) % 6];
        if (!segs.has(o)) segs.set(o, []);
        segs.get(o).push(cx + a[0], cy + a[1], cx + b[0], cy + b[1]);
      }
    }
    const anchorXY = (cell, c) => (Number.isInteger(cell) && cell >= 0 ? [grid.cx(cell), grid.cy(cell)] : c);
    const merged = D.provinces.filter((p) => ownerOf.has(p.abbr)).sort((a, b) => a.order - b.order).map((p) => {
      const o = ownerOf.get(p.abbr), lbl = l34.get(o);
      // the name lands where the map sets the province's name (merger.json's anchor if the map has none)
      const [tx, ty] = lbl ? [lbl.x, lbl.y] : anchorXY(p.anchor, p.centroid);
      return {
        o, lbl, tx, ty, path: stateOutline(w, o).path, segs: new Float32Array(segs.get(o) || []),
        members: p.members.map((m) => {
          const ml = l63.get(countyOf.get(m.iso));
          const [x, y] = ml ? [ml.x, ml.y] : anchorXY(m.anchor, m.centroid);
          return { x, y, text: ml?.text || String(m.name).toUpperCase(), size: ml?.size || 30, angle: ml?.angle || 0 };
        }),
      };
    });
    const mergedSet = new Set(merged.map((p) => p.o));
    const kept = raw.states.map((s, o) => o).filter((o) => !mergedSet.has(o) && l34.has(o)).map((o) => ({ o, lbl: l34.get(o), path: stateOutline(w, o).path }));
    mergerModel = { merged, kept, labels34 };
    return mergerModel;
  }

  /** Called by index.js right after the borders switched to the 34 (or by the merger card's button). */
  async function merger({ home = false } = {}) {
    close();
    if (!M?.enabled) return false; // still: the 34 borders and names are the end state
    const mm = await mergerPrep();
    // (merger.json may land after the year went back before 2025: the map shows the 63 again, nothing to replay)
    if (!mm || session || w.stateLabels !== mm.labels34) return false;
    if (home) app.home?.(900);
    let p = 0, ticker = null;
    w.stateLabels = []; // the overlay draws every name until the end (the static labels come back after)
    app.refreshLens();
    const off = M.register({ id: "replay-merger", z: 104, ambient: false, active: () => !!ticker, draw: (ctx, cam, a, f) => drawMerger(ctx, cam, f, mm, p * MERGE_MS / 1000) });
    showBar({ title: t("1 July 2025: 63 provinces become 34"),
      sub: `<span class="rp-note">${esc(t("The 23 new provinces merge their former provinces one after another (in the order Resolution 202/2025/QH15 lists them, per Wikipedia); the 11 that stay as they were pulse once."))}</span>`,
      skip: t("Skip ⏭") });
    ticker = M.tween({ from: 0, to: 1, ms: MERGE_MS, ease: "linear", onUpdate: (v) => {
      p = v;
      const k = Math.min(mm.merged.length, Math.max(0, Math.floor((v * MERGE_MS / 1000 - MERGE_T0) / MERGE_STEP) + 1));
      const txt = t("{n} of {m} merged", { n: k, m: mm.merged.length });
      if (readEl.textContent !== txt) readEl.textContent = txt;
    }, onDone: () => { ticker = null; if (session?.kind === "merger") close(); } });
    session = {
      kind: "merger",
      close() {
        ticker?.(); ticker = null; off();
        if (w.stateLabels?.length === 0) { w.stateLabels = mm.labels34; app.refreshLens(); }
      },
      skip: () => close(),
    };
    return true;
  }

  function label(ctx, text, x, y, angle, px, alpha, glow) {
    if (alpha < 0.02 || px < 6) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.font = `${px.toFixed(1)}px ${LABEL_FONT}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${(px * LABEL_SPACING).toFixed(1)}px`;
    ctx.lineWidth = Math.max(2, px * 0.1);
    ctx.strokeStyle = `rgba(25,18,10,${0.6 * alpha})`;
    ctx.fillStyle = glow ? `rgba(255,226,150,${alpha})` : `rgba(255,246,222,${0.8 * alpha})`;
    ctx.strokeText(text, 0, 0);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  function drawMerger(ctx, cam, f, mm, ts) {
    const s = cam.scale, v = cam.view();
    // unchanged provinces: one pulse of their outline (0–2 s)
    const pulse = Math.sin(Math.PI * Math.max(0, Math.min(1, ts / 2)));
    if (pulse > 0.01) {
      ctx.lineJoin = "round";
      ctx.lineWidth = 3 / s;
      ctx.strokeStyle = `rgba(255,226,150,${0.8 * pulse})`;
      ctx.fillStyle = `rgba(255,226,150,${0.22 * pulse})`;
      for (const kp of mm.kept) { ctx.fill(kp.path); ctx.stroke(kp.path); }
    }
    // merged provinces: inner borders fade, a glow while they merge
    for (let i = 0; i < mm.merged.length; i++) {
      const pr = mm.merged[i], qq = (ts - MERGE_T0 - i * MERGE_STEP) / MERGE_LEN, fadeA = 1 - smooth(0, 0.6, qq);
      if (fadeA > 0.01 && pr.segs.length) {
        ctx.beginPath();
        for (let k = 0; k < pr.segs.length; k += 4) {
          const x0 = pr.segs[k], y0 = pr.segs[k + 1];
          if (x0 < v.x0 - R || x0 > v.x1 + R || y0 < v.y0 - R || y0 > v.y1 + R) continue;
          ctx.moveTo(x0, y0); ctx.lineTo(pr.segs[k + 2], pr.segs[k + 3]);
        }
        ctx.lineWidth = Math.max(1.2, Math.min(2.4, 0.08 * R * s)) / s;
        ctx.strokeStyle = `rgba(15,10,5,${0.75 * fadeA})`;
        ctx.stroke();
        ctx.lineWidth /= 2.4;
        ctx.strokeStyle = `rgba(255,240,205,${0.45 * fadeA})`;
        ctx.stroke();
      }
      const g = qq > 0 && qq < 1 ? Math.sin(Math.PI * qq) : 0;
      if (g > 0.01) { ctx.fillStyle = `rgba(255,226,150,${0.26 * g})`; ctx.fill(pr.path); }
    }
    // names, in screen px, at the static labels' size and zoom fade (render/map.js), so the hand-off does not jump
    ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const Rpx = R * s, size = (sz) => Math.max(10, Math.min(sz * s, 110)), vis = (l) => stateLabelAlpha(l, Rpx, s);
    for (const kp of mm.kept) {
      const [x, y] = cam.toScreen(kp.lbl.x, kp.lbl.y);
      label(ctx, kp.lbl.text, x, y, kp.lbl.angle, size(kp.lbl.size), Math.max(vis(kp.lbl), pulse), pulse > 0.2);
    }
    for (let i = 0; i < mm.merged.length; i++) {
      const pr = mm.merged[i], qq = (ts - MERGE_T0 - i * MERGE_STEP) / MERGE_LEN;
      const glide = smooth(0.12, 0.75, qq), memberA = 1 - smooth(0.5, 0.8, qq);
      if (memberA > 0.01) {
        const [x1, y1] = cam.toScreen(pr.tx, pr.ty);
        for (const m of pr.members) {
          const [x0, y0] = cam.toScreen(m.x, m.y);
          label(ctx, m.text, x0 + (x1 - x0) * glide, y0 + (y1 - y0) * glide, m.angle * (1 - glide), size(m.size) * (1 - 0.25 * glide), memberA * (qq > 0 ? 1 : vis(m)), false);
        }
      }
      const newA = smooth(0.6, 1, qq);
      if (newA > 0.01 && pr.lbl) {
        const [x, y] = cam.toScreen(pr.tx, pr.ty);
        label(ctx, pr.lbl.text, x, y, pr.lbl.angle, size(pr.lbl.size) * (1.25 - 0.25 * newA), newA * Math.max(vis(pr.lbl), 1 - smooth(1.2, 2, qq)), qq < 1.6);
      }
    }
  }

  // --- forest loss, year by year ----------------------------------------------------------------------------------
  // The static map keeps the lens as published (the 2001–2025 total, which is the end state); an overlay paints the
  // hexes whose loss so far is still below that total in the colour of their loss so far. It is painted into an
  // offscreen canvas once per year (and when the camera moves), so a year step costs no static-map re-render.
  function forest(F, lens) {
    close();
    const ys = F.years, nY = ys.length, nc = F.cells.length, stops = lens.ramp.map(parseHex), sc = lensScale(lens);
    const nat = F.national?.loss_ha || [], f2000 = F.national?.forest2000_ha || 0;
    const shareAt = (k) => { // per listed cell: loss in years[0..k] over its 2000 forest (null without forest)
      const out = new Array(nc);
      for (let j = 0; j < nc; j++) {
        const f = F.forest2000_ha[j];
        if (!(f > 0)) { out[j] = null; continue; }
        let sum = 0;
        for (let y = 0; y <= k; y++) sum += F.loss_ha[y][j];
        out[j] = sum / f;
      }
      return out;
    };
    const final = shareAt(nY - 1);
    const colorsAt = (k) => { // css colour per cell, null where the hex already shows its final colour
      const v = shareAt(k);
      return v.map((x, j) => (x == null || x >= final[j] ? null : css(shade(rampColor(stops, sc(x)), w.shadeK[F.cells[j]] * 0.6))));
    };
    let k = -1, pos = 0, paused = false, ticker = null, cols = null, sig = "", fadeP = 1, fadeStop = null;
    const cv = document.createElement("canvas"), cx = cv.getContext("2d");
    const prev = document.createElement("canvas"), px = prev.getContext("2d");
    const K = grid.corners.flat();
    function paint(ctx, cam, dpr) {
      const W = Math.ceil(cam.w * dpr), H = Math.ceil(cam.h * dpr), s = cam.scale;
      if (ctx.canvas.width !== W || ctx.canvas.height !== H) { ctx.canvas.width = W; ctx.canvas.height = H; } else ctx.clearRect(0, 0, W, H);
      if (!cols) return;
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (cam.w / 2 - cam.x * s), dpr * (cam.h / 2 - cam.y * s));
      const v = cam.view(), g = (R + 0.7 / s) / R; // corners grown like render/map.js tiles (no seams)
      for (let j = 0; j < nc; j++) {
        const c = cols[j];
        if (!c) continue;
        const c0 = F.cells[j], x = grid.cx(c0), y = grid.cy(c0);
        if (x < v.x0 - R || x > v.x1 + R || y < v.y0 - R || y > v.y1 + R) continue;
        ctx.beginPath();
        ctx.moveTo(x + K[0] * g, y + K[1] * g);
        for (let q2 = 2; q2 < 12; q2 += 2) ctx.lineTo(x + K[q2] * g, y + K[q2 + 1] * g);
        ctx.fillStyle = c;
        ctx.fill();
      }
    }
    const off = M.register({ id: "replay-forest", z: 30, ambient: false, active: () => !!ticker || fadeP < 1, draw(ctx, cam, a, f) {
      const s2 = `${cam.x},${cam.y},${cam.scale},${cam.w},${cam.h},${f.dpr},${k}`;
      if (s2 !== sig) {
        if (sig.endsWith(`,${k}`)) fadeP = 1; // only the camera moved: no crossfade
        sig = s2;
        paint(cx, cam, f.dpr);
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (fadeP < 1) { ctx.drawImage(prev, 0, 0); ctx.globalAlpha = fadeP; }
      ctx.drawImage(cv, 0, 0);
      ctx.restore();
    } });
    showBar({ title: t("Forest loss, {a}→{b}", { a: ys[0], b: ys.at(-1) }), sub: `<span class="rp-note rp-caveat">${esc(t(F.note || ""))}</span>`,
      pause: true, skip: t("Skip to {year} ⏭", { year: ys.at(-1) }) });
    readEl.innerHTML = `<b class="rp-year"></b> <span class="rp-ha"></span> <span class="rp-of"></span>`;
    const yEl = q(".rp-year"), haEl = q(".rp-ha"), ofEl = q(".rp-of");
    const show = (kk) => {
      if (kk === k) return;
      // the old year's canvas fades out under the new one (~250 ms): the data steps a year at a time
      if (k >= 0 && M.enabled) {
        prev.width = cv.width; prev.height = cv.height; px.drawImage(cv, 0, 0);
        fadeStop?.();
        fadeStop = M.tween({ from: 0, to: 1, ms: 250, ease: "out", onUpdate: (v) => { fadeP = v; } });
      }
      k = kk;
      cols = colorsAt(k);
      app.requestDraw();
      yEl.textContent = `${ys[0]}–${ys[k]}`;
      let ha = 0;
      for (let y = 0; y <= k; y++) ha += nat[y] || 0;
      // the national total counts up between years (app.motion.countTo); each year lands on the exact sum
      M.countTo(haEl, ha, (v) => t("{ha} ha lost", { ha: int(v) }), FOREST_YEAR_MS * 0.9);
      ofEl.textContent = f2000 ? t("({pct} of the 2000 forest)", { pct: pct(ha / f2000) }) : "";
    };
    const finish = () => { ticker = null; show(nY - 1); pauseBtn.hidden = skipBtn.hidden = true; };
    const run = () => {
      ticker = M.tween({ from: pos, to: nY - 1, ms: Math.max(1, (nY - 1 - pos) * FOREST_YEAR_MS), ease: "linear",
        onUpdate: (v) => { pos = v; show(Math.floor(v + 1e-9)); }, onDone: finish });
    };
    session = {
      kind: "forest",
      close() { ticker?.(); ticker = null; fadeStop?.(); fadeP = 1; off(); },
      pause() { paused = !paused; setPaused(paused); if (paused) { ticker?.(); ticker = null; } else run(); },
      skip() { ticker?.(); finish(); },
    };
    setPaused(false);
    show(0);
    run();
  }

  injectStyle();
  return {
    storms, merger, forest, close,
    prefetch: () => { if (!mergerModel) mergerPrep(); },
    get kind() { return session?.kind || null; },
  };
}

function injectStyle() {
  const css = `
.rp-bar { position: fixed; left: calc(var(--dock-left, 0px) + (100vw - var(--dock-left, 0px) - var(--dock-right, 0px)) / 2); transform: translateX(-50%); bottom: 64px; z-index: 21; width: min(540px, calc(100vw - var(--dock-left, 0px) - var(--dock-right, 0px) - 16px));
  padding: 8px 10px; font-size: 13px; color: var(--ink); box-sizing: border-box; }
.rp-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-family: var(--serif); color: var(--gold-bright); font-size: 14px; }
.rp-read { margin: 3px 0; min-height: 18px; font-variant-numeric: tabular-nums; }
.rp-read time { color: var(--gold-bright); font-weight: 600; }
.rp-tz { color: var(--ink-dim); font-size: 11px; }
.rp-wind { display: inline-block; margin-left: 6px; padding-left: 14px; position: relative; }
.rp-wind::before { content: ""; position: absolute; left: 0; top: 50%; width: 10px; height: 10px; margin-top: -5px; border-radius: 50%; background: var(--c); }
.rp-year { color: var(--gold-bright); }
.rp-of { color: var(--ink-dim); font-size: 12px; }
.rp-sub { color: var(--ink-dim); font-size: 11px; line-height: 1.35; }
.rp-legend { display: flex; flex-wrap: wrap; gap: 2px 10px; align-items: center; margin-bottom: 2px; }
.rp-legend i { display: inline-block; width: 14px; height: 4px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
.rp-legend i.rp-nw { background: repeating-linear-gradient(90deg, #9aa0a6 0 4px, transparent 4px 7px); }
.rp-note { display: block; }
.rp-ctl { display: flex; align-items: center; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
.rp-ctl:not(:has(> :not([hidden]))) { display: none; }
.rp-bar [hidden] { display: none !important; }
.rp-bar .tl-btn { background: none; border: 1px solid var(--line); border-radius: 4px; color: var(--gold-bright); cursor: pointer; min-width: 28px; height: 26px; padding: 0 7px; font: inherit; }
.rp-bar .tl-btn:hover { background: rgba(201,164,92,.15); }
.rp-follow { display: inline-flex; align-items: center; gap: 4px; color: var(--ink-dim); font-size: 12px; cursor: pointer; }
.tl-storms li.rp-row { grid-template-columns: auto 1fr auto auto; align-items: baseline; }
.rp-go { font-size: 12px; padding: 0 2px; }
.rp-all { display: block; margin-bottom: 6px; font-size: 12px; text-decoration: underline; }
.rp-merge { display: block; margin-top: 8px; font-size: 13px; text-decoration: underline; }
@media (max-width: 700px) { .rp-bar { bottom: 62px; padding: 6px 8px; } .rp-note:not(.rp-caveat) { display: none; }
  /* a city sheet (z 25) or a dock sheet (z 24), 55dvh tall, would cover the bar: sit just above it */
  body:is(.panel-open, .dock-open) .rp-bar { bottom: calc(55vh + 8px); bottom: calc(55dvh + 8px); } }`;
  const el = document.createElement("style");
  el.id = "rp-style";
  el.textContent = css;
  document.head.appendChild(el);
}
