// Day–night: shades the map by the real sun position for the current time (sun.js, NOAA's solar formulas) and, where
// it is night, lets the hexes glow by night_lights.json (derived from WorldPop population density, NOT satellite night
// lights; the switch, the clock and the docs say so). A small clock shows Vietnam time; "▶ 24 h" plays one day in ~20 s.
// Cost: the shade is a tiny (48×38) canvas of sun elevations, redone at most once a minute and merged with the lights
// (one pre-rendered canvas masked by the shade) into one layer; a frame blits a screen-sized copy of it (see draw).
import { t, lang } from "../../i18n.js";
import { esc } from "../../format.js";
import { mapToLonLat, sunState, elevationAt, nightness } from "./sun.js";

const GX = 48, GY = 38; // shade grid (one sun computation per pixel)
const LPX = 12.5; // map units per lights-canvas pixel (half a hex radius)
const DAY_S = 20; // "▶ 24 h" plays a day in this many seconds
// NIGHT_A: how dark the deepest night gets (0 = no shade, 1 = the night colour). 0.6 hid the lens colours and labels;
// at 0.38 the map stays readable and the city lights still glow.
const NIGHT_RGB = [8, 14, 40], NIGHT_A = 0.38;

export function install(app) {
  const M = app.motion, raw = app.w.raw, grid = app.w.grid;
  const W = raw.width, H = raw.height;
  const cap = M.frameCap(1000 / 30);
  const perf = app.perf ? (app.perf.daynight = []) : [];
  let on = false, playing = false, playT0 = 0, simMs = 0, timer = 0, lights = null, loading = null;

  // --- shade: sun elevation per grid pixel -------------------------------------------------------------------------
  const lat = new Float32Array(GX * GY), lon = new Float32Array(GX * GY);
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
    const [lo, la] = mapToLonLat(((i + 0.5) * W) / GX, ((j + 0.5) * H) / GY);
    lat[j * GX + i] = la; lon[j * GX + i] = lo;
  }
  const shade = canvas(GX, GY), mask = canvas(GX, GY);
  const sctx = shade.getContext("2d"), mctx = mask.getContext("2d");
  const simg = sctx.createImageData(GX, GY), mimg = mctx.createImageData(GX, GY);
  // comp: the shade with the masked lights added, at the lights' resolution: one layer to blit per frame
  let view = null, vctx = null, viewKey = "";
  let comp = null, cctx = null, lit = null, lctx = null, maxNight = 0, shadedAt = -1, shadeSig = 0;

  // → true when the shade changed (a minute of full day or deep night changes nothing: no frame is drawn for it)
  function reshade(ms) {
    const st = sunState(ms);
    maxNight = 0;
    let sig = 0;
    for (let k = 0; k < GX * GY; k++) {
      const n = nightness(elevationAt(lat[k], lon[k], st));
      if (n > maxNight) maxNight = n;
      const o = k * 4;
      simg.data[o] = NIGHT_RGB[0]; simg.data[o + 1] = NIGHT_RGB[1]; simg.data[o + 2] = NIGHT_RGB[2];
      simg.data[o + 3] = Math.round(255 * NIGHT_A * n);
      sig = (sig * 31 + simg.data[o + 3]) | 0;
      mimg.data[o + 3] = Math.round(255 * n);
    }
    if (maxNight > 0.005) ensureLights(); // (fetched the first time it is dark somewhere on the map)
    sctx.putImageData(simg, 0, 0);
    mctx.putImageData(mimg, 0, 0);
    if (lights) {
      lctx.globalCompositeOperation = "copy";
      lctx.drawImage(lights, 0, 0);
      lctx.globalCompositeOperation = "destination-in";
      lctx.imageSmoothingEnabled = true;
      lctx.drawImage(mask, 0, 0, lit.width, lit.height);
      cctx.globalCompositeOperation = "copy";
      cctx.imageSmoothingEnabled = true;
      cctx.drawImage(shade, 0, 0, comp.width, comp.height);
      cctx.globalCompositeOperation = "lighter"; // premultiplied add: the glow over the shade
      cctx.drawImage(lit, 0, 0);
    }
    shadedAt = ms;
    const changed = sig !== shadeSig;
    shadeSig = sig;
    return changed;
  }

  // --- lights: one canvas, painted once from night_lights.json ------------------------------------------------------
  function paintLights(NL) {
    const cv = canvas(Math.ceil(W / LPX), Math.ceil(H / LPX)), c = cv.getContext("2d");
    const dot = glow(6), big = glow(32);
    c.globalCompositeOperation = "lighter";
    const vals = NL.values || [];
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (!(v > 0.45)) continue; // sparsely settled land stays dark (fields and forest)
      c.globalAlpha = Math.min(1, ((v - 0.45) / 0.55) ** 2.2);
      c.drawImage(dot, grid.cx(i) / LPX - 6, grid.cy(i) / LPX - 6);
    }
    const pmax = Math.max(1, ...(NL.seats || []).map((s) => s.population || 0));
    for (const s of NL.seats || []) {
      const r = 4 + 18 * Math.sqrt((s.population || 0) / pmax);
      c.globalAlpha = 0.35;
      c.drawImage(big, s.x / LPX - r, s.y / LPX - r, 2 * r, 2 * r);
    }
    lights = cv;
    comp = canvas(cv.width, cv.height);
    cctx = comp.getContext("2d");
    lit = canvas(cv.width, cv.height);
    lctx = lit.getContext("2d");
    shadedAt = -1;
  }
  const ensureLights = () => (loading ||= app.loadData("night_lights").then((NL) => {
    if (NL?.values) paintLights(NL);
    else console.warn("night_lights.json missing: day–night shows the shade only");
    app.requestDraw();
  }));

  // --- time ---------------------------------------------------------------------------------------------------------
  const now = () => (playing ? simMs : Date.now());
  // On each minute boundary (+50 ms), so the clock never shows the previous minute (an interval from the switch-on
  // time lagged up to 59 s).
  function schedule() { timer = setTimeout(() => { tick(); schedule(); }, 60050 - (Date.now() % 60000)); }
  function tick() {
    if (!on || playing) return;
    const changed = reshade(Date.now());
    renderClock();
    if (changed) app.requestDraw();
  }

  M.register({
    id: "daynight", z: 90, ambient: false,
    // Real time: never active (a timer redraws on each minute). "▶ 24 h": capped at 30 fps like
    // ext/motion; between capped frames active() is false and a timer asks for the next one. The play lasts DAY_S
    // (20 s), well under ext/motion's 60 s no-input pause, so it always ends by itself.
    active: () => on && playing && cap.due(), // a frame drawn meanwhile (traffic, hover) counts, so the cap holds
    draw(ctx, cam) {
      if (!on) return;
      const t1 = performance.now();
      if (playing) {
        cap.drew();
        const p = (performance.now() - playT0) / 1000 / DAY_S;
        if (p >= 1 || !M.enabled) stopPlay(); // back to now (reshaded), drawn in this frame: no shadeless frame
        else {
          simMs = playStart + p * 864e5;
          reshade(simMs);
          renderClock();
        }
      } else if (shadedAt < 0) reshade(Date.now());
      if (maxNight > 0.005) { // (full day: the shade is clear everywhere, nothing to draw)
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        // The shade is soft and the screen's every pixel is blended, which cost ~47 ms a frame on a 4x-throttled
        // phone (stretching two layers with smoothing): now one merged layer, upscaled once into a screen-sized
        // copy while the camera and the minute stay the same (the Living map's motion case), then blitted 1:1, ~3 ms.
        const src = comp || shade, k = comp ? LPX : W / GX; // (no comp: lights still loading)
        const cw = ctx.canvas.width, ch = ctx.canvas.height, key = `${cam.x},${cam.y},${cam.scale},${shadedAt},${cw},${ch},${!!comp}`;
        if (key !== viewKey) {
          viewKey = key;
          if (!view) { view = canvas(cw, ch); vctx = view.getContext("2d"); }
          if (view.width !== cw || view.height !== ch) { view.width = cw; view.height = ch; }
          vctx.setTransform(ctx.getTransform());
          vctx.globalCompositeOperation = "copy";
          vctx.imageSmoothingEnabled = true;
          vctx.drawImage(src, 0, 0, src.width * k, src.height * k);
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(view, 0, 0);
        ctx.restore();
      }
      if (perf.push(performance.now() - t1) > 120) perf.shift();
    },
  });

  // --- the clock ----------------------------------------------------------------------------------------------------
  const fmt = new Intl.DateTimeFormat(lang === "vi" ? "vi-VN" : "en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hour12: false });
  const el = document.createElement("div");
  el.className = "panel dn-clock";
  el.hidden = true;
  el.innerHTML = `<span class="dn-ic" aria-hidden="true"></span><time class="dn-time"></time><span class="dn-tz">${esc(t("Vietnam time (UTC+7)"))}</span>
    <button type="button" class="dn-play"></button>
    <span class="dn-note">${esc(t("Lights derived from population, not satellite data"))}</span>`;
  document.body.appendChild(el);
  const timeEl = el.querySelector(".dn-time"), icEl = el.querySelector(".dn-ic"), playBtn = el.querySelector(".dn-play");
  let playStart = 0;
  function renderClock() {
    const ms = now();
    timeEl.textContent = fmt.format(ms);
    timeEl.dateTime = new Date(ms).toISOString();
    const hn = elevationAt(21.03, 105.85, sunState(ms)); // Hà Nội's sky for the icon
    icEl.textContent = hn > 0 ? "☀" : "☾";
  }
  function renderPlay() {
    playBtn.hidden = !M.enabled && !playing;
    playBtn.textContent = playing ? t("Back to now") : t("▶ 24 h");
    playBtn.title = playing ? t("Back to now") : t("Play one day in about 20 seconds");
  }
  function stopPlay() {
    playing = false;
    reshade(Date.now());
    renderClock(); renderPlay();
    app.requestDraw();
  }
  playBtn.addEventListener("click", () => {
    if (playing) return stopPlay();
    if (!M.enabled) return;
    playing = true; playStart = Date.now(); simMs = playStart; playT0 = performance.now();
    renderPlay();
    app.requestDraw();
  });
  M.on?.("change", () => { if (playing && !M.enabled) stopPlay(); else renderPlay(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });

  function set(v) {
    on = !!v;
    el.hidden = !on;
    clearTimeout(timer);
    if (on) {
      schedule();
      shadedAt = -1;
      renderClock(); renderPlay();
    } else {
      playing = false;
      view = null; viewKey = ""; // (a screen-sized canvas: free it)
    }
    app.requestDraw();
  }

  set(true); // on by default (Anh, 2026-11-28); a layers= link without it turns it off as the toggle arrives
  app.ui?.addMapToggle?.({
    id: "daynight", group: "display", icon: "🌓", default: true,
    label: t("Day–night"),
    title: t("Shades the map by the real position of the sun right now, with a Vietnam-time clock. The night lights are derived from population density (WorldPop), not satellite data."),
    get: () => on,
    set,
  });
  injectStyle();
  app.daynight = { get on() { return on; }, reshade, get maxNight() { return maxNight; }, now };
}

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
function glow(r) {
  const c = canvas(2 * r, 2 * r), g = c.getContext("2d");
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, "#fff1c8"); grd.addColorStop(0.35, "#ffc867b0"); grd.addColorStop(1, "#ff9b3000");
  g.fillStyle = grd;
  g.fillRect(0, 0, 2 * r, 2 * r);
  return c;
}

function injectStyle() {
  const css = `
.dn-clock { position: fixed; left: calc(10px + var(--dock-left, 0px)); top: 86px; z-index: 19; display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px;
  max-width: min(330px, calc(100vw - 20px)); padding: 5px 9px; font-size: 12px; color: var(--ink); box-sizing: border-box; }
.dn-clock[hidden] { display: none; }
.dn-ic { color: var(--gold-bright); font-size: 15px; }
.dn-time { font: 600 17px var(--serif); color: var(--gold-bright); font-variant-numeric: tabular-nums; }
.dn-tz { color: var(--ink-dim); }
.dn-play { background: none; border: 1px solid var(--line); border-radius: 4px; color: var(--gold-bright); cursor: pointer; height: 24px; padding: 0 7px; font: inherit; }
.dn-play:hover { background: rgba(201,164,92,.15); }
.dn-play[hidden] { display: none; }
.dn-note { flex-basis: 100%; color: var(--ink-dim); font-size: 10.5px; }
/* an open timeline card sits where the clock is: step to its right (desktop) or give way (phone) */
body:has(.tl-card:not([hidden])) .dn-clock { left: calc(324px + var(--dock-left, 0px)); top: calc(var(--topbar-h) + 10px); }
@media (max-width: 700px) { .dn-clock { top: 84px; left: 6px; padding: 3px 7px; } .dn-time { font-size: 15px; }
  body:has(.tl-card:not([hidden])) .dn-clock { display: none; } }`;
  const s = document.createElement("style");
  s.id = "dn-style";
  s.textContent = css;
  document.head.appendChild(s);
}
