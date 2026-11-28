// Fly-along journeys ("Hành trình bay"): the camera travels along a real line at a steady speed with a caption naming
// the province (and the nearest provincial seat) under the camera, read from the hex under it.
//   rail_ns  the North–South railway, Hà Nội → TP. Hồ Chí Minh: motion_routes.json rail "north_south" (OpenStreetMap
//            main-line rail hexes, 2026; the data has no stations)
//   mekong   down the Mekong: the river's longest joined course in world.json (geo_rivers.json names it)
//   red      down the Red River (sông Hồng), the same way
// One app.motion tween drives the camera (paused / resumed / re-timed for the speed); Effects off or reduced motion:
// the camera jumps between waypoints (where the province under it changes), every 2.5 s or with ⏮ ⏭.
// A drag on the map pauses; Esc or ✕ ends. Hash key fly=<id>.
import { t, lang } from "../../i18n.js";
import { esc } from "../../format.js";
import { smoothPath, cumulative, pointAt, pathKm } from "./geom.js";

const BASE_KMS = 40; // km of route per second at ×1
const SPEEDS = [0.5, 1, 2, 4];
const STILL_MS = 2500;

export const JOURNEYS = [
  { id: "rail_ns", icon: "🚆", title: "Reunification Express: Hà Nội → Sài Gòn", sub: "Along the North–South railway",
    note: "The line through the main-line rail hexes (OpenStreetMap, 2026), smoothed: not the exact track. The map's data has no stations, so the caption names the province and the nearest provincial seat." },
  { id: "mekong", icon: "🌊", title: "Down the Mekong River", sub: "From Laos to the delta",
    note: "The river's longest mapped course (OpenStreetMap in Vietnam, Natural Earth outside), smoothed; outside Vietnam the caption says so." },
  { id: "red", icon: "🌊", title: "Down the Red River (sông Hồng)", sub: "From Yunnan (China) to the sea",
    note: "The river's longest mapped course (OpenStreetMap in Vietnam, Natural Earth outside), smoothed." },
];

export function installFly(app) {
  const M = app.motion, cam = app.cam, w = app.w, grid = w.grid, raw = w.raw;
  const kmPerUnit = raw.km_per_unit || 0.2;
  let J = null; // the running journey: {def, pts, cum, L, km, wps}
  let s = 0, cancel = null, paused = false, speed = 1, still = false, stillTimer = 0, wpi = 0, opener = null;

  // --- routes ----------------------------------------------------------------------------------------------------
  async function route(id) {
    if (id === "rail_ns") {
      const d = await app.loadData("motion_routes");
      return d?.rail?.find((r) => r.id === "north_south")?.pts || null;
    }
    const name = id === "mekong" ? "Sông Mê Kông" : id === "red" ? "Sông Hồng" : null;
    if (!name) return null;
    await app.loadData("geo_rivers"); // ext/geo joins the river's segments when this arrives (its handler runs first)
    const r = app.geo?.st?.rivers?.find((x) => x.name === name);
    const pts = r?.runs?.[0]?.pts;
    if (!pts || pts.length < 2) return null;
    // downstream: from the higher end to the lower one (elevation of the hex under each end)
    const elev = (p) => { const i = grid.cellAt(p[0], p[1]); return i >= 0 && i < grid.size ? raw.elev[i] : 0; };
    return elev(pts[0]) >= elev(pts[pts.length - 1]) ? pts : [...pts].reverse();
  }

  // --- what is under the camera ---------------------------------------------------------------------------------------
  const cities = app.data.cities?.cities || app.data.cities || [];
  function where(x, y) {
    const i = grid.cellAt(x, y), o = i >= 0 && i < grid.size ? raw.owner[i] : -1;
    if (o < 0) return { key: `o${o}`, text: o === -2 ? t("Beyond Vietnam's borders") : t("Over water") };
    let best = null, bd = (30 / kmPerUnit) ** 2; // nearest provincial seat within 30 km
    for (const c of cities) { const d = (c.x - x) ** 2 + (c.y - y) ** 2; if (d < bd) { bd = d; best = c; } }
    const prov = raw.states[o]?.name || "";
    return { key: `${o}|${best?.id || ""}`, text: best && best.name !== prov ? t("{province} · near {city}", { province: prov, city: best.name }) : prov, o };
  }

  // --- UI --------------------------------------------------------------------------------------------------------
  const bar = document.createElement("div");
  bar.className = "panel xp-fly";
  bar.hidden = true;
  bar.tabIndex = -1;
  bar.setAttribute("role", "region");
  document.body.appendChild(bar);
  const q = (sel) => bar.querySelector(sel);
  function renderBar() {
    const d = J.def;
    bar.setAttribute("aria-label", t(d.title));
    bar.innerHTML = `<div class="tour-prog"><i></i></div>
      <div class="xp-head"><span class="tour-kick">${esc(t("Fly-along journey"))}</span>
        <button type="button" class="icon-btn xp-x" aria-label="${esc(t("Close"))}" title="${esc(t("Close (Esc)"))}">✕</button></div>
      <h3 class="xp-fly-t">${esc(d.icon)} ${esc(t(d.title))}</h3>
      <div class="xp-fly-cap" aria-live="polite"></div>
      <div class="xp-row xp-fly-ctl">
        <button type="button" class="tl-btn xp-prev" aria-label="${esc(t("Previous waypoint"))}" title="${esc(t("Previous waypoint"))}">⏮</button>
        <button type="button" class="tl-btn xp-play"></button>
        <button type="button" class="tl-btn xp-next" aria-label="${esc(t("Next waypoint"))}" title="${esc(t("Next waypoint"))}">⏭</button>
        <label class="xp-spd">${esc(t("Speed"))} <select class="xp-speed">${SPEEDS.map((v) => `<option value="${v}" ${v === speed ? "selected" : ""}>×${String(v).replace(".", lang === "vi" ? "," : ".")}</option>`).join("")}</select></label>
      </div>
      <p class="xp-note">${esc(t(d.note))}</p>`;
    renderCtl();
  }
  let capKey = "";
  function caption(x, y, force) {
    const wh = where(x, y);
    if (wh.key !== capKey || force) { capKey = wh.key; const el = q(".xp-fly-cap"); if (el) el.textContent = wh.text; }
    const pr = q(".tour-prog i");
    if (pr) pr.style.width = `${(100 * s / J.L).toFixed(2)}%`;
  }
  function renderCtl() {
    const b = q(".xp-play");
    if (!b) return;
    const playing = still ? !!stillTimer : !paused && !!cancel;
    b.textContent = playing ? "❚❚" : "▶";
    const l = playing ? t("Pause") : t("Play");
    b.title = `${l} (Space)`; b.setAttribute("aria-label", l);
  }
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.classList.contains("xp-x")) stop();
    else if (b.classList.contains("xp-play")) toggle();
    else if (b.classList.contains("xp-prev")) jump(-1);
    else if (b.classList.contains("xp-next")) jump(1);
  });
  bar.addEventListener("change", (e) => {
    if (!e.target.matches(".xp-speed")) return;
    speed = +e.target.value || 1;
    if (!still && !paused && J) run(); // re-time the rest of the way
  });

  // --- camera -------------------------------------------------------------------------------------------------------
  function scaleFor() { return cam.clampScale((cam.fitScale || cam.scale) * 2 ** (app.isMobile?.() ? 1.9 : 1.7)); }
  function place(x, y) {
    const a = app.visibleArea?.() || { x0: 0, y0: 0, x1: cam.w, y1: cam.h };
    const barTop = bar.hidden ? cam.h : bar.getBoundingClientRect().top;
    const vy = (a.y0 + Math.min(a.y1, barTop - 8)) / 2, vx = (a.x0 + a.x1) / 2, k = cam.scale;
    cam.stop();
    cam.x = x - (vx - cam.w / 2) / k;
    cam.y = y - (vy - cam.h / 2) / k;
  }
  function at(sv) {
    s = Math.max(0, Math.min(J.L, sv));
    const [x, y] = pointAt(J.pts, J.cum, s);
    place(x, y);
    caption(x, y);
    app.requestDraw();
  }
  function run() {
    cancel?.(); cancel = null;
    paused = false;
    if (s >= J.L) s = 0;
    const from = s, ms = ((J.L - from) / J.L) * (J.km / (BASE_KMS * speed)) * 1000;
    cancel = M.tween({ from, to: J.L, ms, ease: "linear", onUpdate: (v) => at(v), onDone: () => { cancel = null; renderCtl(); } });
    renderCtl();
  }
  function pause() { cancel?.(); cancel = null; paused = true; renderCtl(); }
  function toggle() {
    if (!J) return;
    if (still) { if (stillTimer) stopStill(); else playStill(); return; }
    if (cancel) pause(); else run();
  }
  // still mode: the waypoints
  function goWp(n) {
    wpi = Math.max(0, Math.min(J.wps.length - 1, n));
    at(J.wps[wpi]);
  }
  function playStill() {
    stopStill();
    if (wpi >= J.wps.length - 1) goWp(0);
    const tick = () => { if (wpi >= J.wps.length - 1) { stopStill(); return; } goWp(wpi + 1); stillTimer = setTimeout(tick, STILL_MS); };
    stillTimer = setTimeout(tick, STILL_MS);
    renderCtl();
  }
  function stopStill() { clearTimeout(stillTimer); stillTimer = 0; renderCtl(); }
  function jump(dir) {
    if (!J) return;
    if (still) { stopStill(); goWp(wpi + dir); return; }
    const wasRunning = !!cancel;
    pause();
    // the next / previous waypoint from here
    const k = dir > 0 ? J.wps.findIndex((v) => v > s + 1) : J.wps.findLastIndex((v) => v < s - 1);
    at(k >= 0 ? J.wps[k] : dir > 0 ? J.L : 0);
    if (wasRunning && s < J.L) run();
  }

  // --- start / stop -------------------------------------------------------------------------------------------------
  async function fly(id) {
    const def = JOURNEYS.find((j) => j.id === id);
    if (!def) return false;
    if (J) stop(true);
    opener = document.activeElement;
    if (app.mode) app.setMode(null);
    if (app.tour?.active) app.tour.stop();
    app.clearSelection?.();
    const raw0 = await route(id);
    if (!raw0) { app.ui.toast?.(t("This journey's line is not available.")); return false; }
    const pts = smoothPath(raw0, grid.R * 0.8, 6), cum = cumulative(pts);
    // the speed is in km of line (great-circle legs) per second; waypoints where the province changes
    const wps = [0];
    let last = where(...pts[0]).o;
    const minGap = 60 / kmPerUnit; // at least 60 km apart
    for (let i = 1; i < pts.length; i++) {
      const o = where(...pts[i]).o;
      if (o !== last && o != null && cum[i] - wps[wps.length - 1] >= minGap) { wps.push(cum[i]); }
      if (o != null) last = o;
    }
    if (cum[cum.length - 1] - wps[wps.length - 1] < minGap / 2) wps.pop();
    wps.push(cum[cum.length - 1]);
    J = { def, pts, cum, L: cum[cum.length - 1], km: pathKm(pts), wps };
    s = 0; wpi = 0; capKey = ""; paused = false;
    still = !M.enabled;
    document.body.classList.add("xp-fly-on");
    bar.hidden = false;
    renderBar();
    app.emit("tour"); // the timeline closes its card and a replay, as for the tour
    cam.scale = scaleFor();
    at(0);
    caption(...pts[0], true);
    app.hash.flush?.();
    if (still) playStill(); else run();
    bar.focus({ preventScroll: true });
    return true;
  }
  function stop(quiet) {
    if (!J) return;
    cancel?.(); cancel = null;
    stopStill();
    J = null;
    const had = bar.contains(document.activeElement);
    bar.hidden = true;
    document.body.classList.remove("xp-fly-on");
    app.markMoved?.();
    if (!quiet) app.hash.update?.();
    if (had) (opener?.isConnected && opener !== document.body && opener.getClientRects().length ? opener : document.getElementById("btn-more"))?.focus?.({ preventScroll: true });
    app.requestDraw();
  }

  M.on?.("change", (on) => {
    if (!J) return;
    if (!on && !still) {
      if (document.hidden) { if (cancel) pause(); return; } // a background tab: carry on when it is back
      cancel?.(); cancel = null; still = true;
      wpi = Math.max(0, J.wps.findLastIndex((v) => v <= s));
      goWp(wpi); renderCtl();
    }
  });
  app.on("escape", () => { if (!J) return false; stop(); return true; });
  app.on("mode", (e) => { if (J && e?.name) stop(); });
  document.getElementById("map")?.addEventListener("pointerdown", () => { if (J && !still && cancel) pause(); if (J && still) stopStill(); });
  addEventListener("keydown", (e) => {
    if (!J || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || (e.target?.tagName === "BUTTON" && e.key === " ")) return;
    if (e.key === " ") { e.preventDefault(); toggle(); }
    else if (e.key === "ArrowRight" && bar.contains(e.target)) { e.preventDefault(); jump(1); }
    else if (e.key === "ArrowLeft" && bar.contains(e.target)) { e.preventDefault(); jump(-1); }
  }, true);

  // the line, the part travelled and the traveller
  app.registerOverlay({
    id: "explore-fly", z: 130, space: "screen",
    draw(ctx) {
      if (!J) return;
      const v = cam.view(), pad = 40 / cam.scale;
      ctx.lineJoin = ctx.lineCap = "round";
      const path = (from, to) => {
        ctx.beginPath();
        let pen = false;
        for (let i = from; i <= to; i++) {
          const [x, y] = J.pts[i];
          if (x < v.x0 - pad || x > v.x1 + pad || y < v.y0 - pad || y > v.y1 + pad) { pen = false; continue; }
          const [sx, sy] = cam.toScreen(x, y);
          if (pen) ctx.lineTo(sx, sy); else { ctx.moveTo(sx, sy); pen = true; }
        }
      };
      let k = J.cum.findIndex((c) => c > s); if (k < 0) k = J.pts.length - 1;
      path(0, J.pts.length - 1);
      ctx.setLineDash([6, 6]); ctx.lineWidth = 2; ctx.strokeStyle = "rgba(236,208,142,.75)"; ctx.stroke(); ctx.setLineDash([]);
      path(0, Math.max(0, k - 1));
      ctx.lineWidth = 5; ctx.strokeStyle = "rgba(16,25,35,.55)"; ctx.stroke();
      ctx.lineWidth = 3; ctx.strokeStyle = "#ecd08e"; ctx.stroke();
      const [x, y] = pointAt(J.pts, J.cum, s), [sx, sy] = cam.toScreen(x, y);
      ctx.beginPath(); ctx.arc(sx, sy, 7, 0, 7); ctx.fillStyle = "#ecd08e"; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#1b1408"; ctx.stroke();
    },
  });

  app.hash.register("fly", { get: () => (J ? J.def.id : null), set: (v) => (v ? fly(v) : stop(true)) });
  return { fly, stop, journeys: JOURNEYS, get active() { return J ? J.def.id : null; }, get progress() { return J ? s / J.L : 0; },
    get still() { return still; }, get waypoints() { return J ? J.wps.length : 0; } };
}

export const FLY_CSS = `
.xp-fly { position: fixed; left: 50%; transform: translateX(-50%); bottom: 18px; z-index: 22; width: min(520px, calc(100vw - 16px)); padding: 0 12px 9px; font-size: 13px; color: var(--ink); box-sizing: border-box; overflow: hidden; }
.xp-fly[hidden] { display: none; }
.xp-fly:focus { outline: none; }
.xp-fly .tour-prog { height: 3px; margin: 0 -12px 7px; background: rgba(201,164,92,.18); }
.xp-fly .tour-prog i { display: block; height: 100%; width: 0; background: var(--gold-bright); }
.xp-fly .tour-kick { color: var(--ink-dim); font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
.xp-fly-t { margin: 2px 0 2px; font: 600 18px var(--serif); color: var(--gold-bright); }
.xp-fly-cap { font: 600 15px var(--serif); color: #f2d27a; min-height: 1.3em; margin-bottom: 6px; }
.xp-fly .tl-btn { background: none; border: 1px solid var(--line); border-radius: 4px; color: var(--gold-bright); cursor: pointer; min-width: 32px; height: 28px; padding: 0 8px; font: inherit; }
.xp-fly .tl-btn:hover, .xp-fly .tl-btn:focus-visible { background: rgba(201,164,92,.15); }
.xp-spd { display: inline-flex; align-items: center; gap: 4px; color: var(--ink-dim); margin-left: auto; }
.xp-spd select { background: rgba(0,0,0,.3); color: var(--ink); border: 1px solid var(--line); border-radius: 4px; font: inherit; padding: 2px; }
body.xp-fly-on #lens-area, body.xp-fly-on #minimap-wrap, body.xp-fly-on #btn-minimap { display: none !important; }
@media (max-width: 700px) { .xp-fly { bottom: 8px; padding: 0 10px 7px; } .xp-fly-t { font-size: 16px; } .xp-fly .xp-note { display: none; } }`;
