// Atmosphere: today's real weather from Open-Meteo (https://open-meteo.com, CC BY 4.0) and optional ambient sound.
//
// Live weather (Map → Show on map → Weather → "Live weather", OFF by default): on first switch-on, ONE batched
// request for the current conditions at a 0.75° grid of points over Vietnam's land (geo.js gridPoints, ~45 points),
// cached in sessionStorage for 30 minutes. Nothing personal is sent (coordinates of the fixed grid only, no referrer,
// no cookies). Drawn as a static layer (cloud-cover shading, wind arrows, temperatures; hover a point for its
// conditions) plus, while Effects are on, rain streaks drifting with the wind where it is raining now (app.motion,
// frame-capped, still after a minute without input, still streaks under reduced motion). A badge says it is live,
// with the observation and fetch times. Offline / blocked: no layer, the switch says "unavailable".
import { t, lang } from "../../i18n.js";
import { esc, fixed, int } from "../../format.js";
import { lonLatToMap, gridPoints, wmoLabel, rainLevel, parseCurrent, STEP } from "./geo.js";
import { createSound } from "./sound.js";

const API = "https://api.open-meteo.com/v1/forecast";
const VARS = "temperature_2m,precipitation,cloud_cover,weather_code,wind_speed_10m,wind_direction_10m";
const CACHE_KEY = "vnciv-atmos-weather-v1", CACHE_MS = 30 * 60e3;
const GROUP = "weather"; // app/api.js GROUPS ("Weather")
const STREAKS = 26; // rain streaks per rainy point at full strength

export function install(app) {
  const M = app.motion, w = app.w, grid = w.grid, raw = w.raw;
  const phone = !!app.isMobile?.();
  const pts = gridPoints(raw.width, raw.height, (x, y) => {
    const c = grid.cellAt(x, y);
    return c >= 0 && !w.water[c] && raw.owner[c] >= 0;
  });
  const url = `${API}?latitude=${pts.map((p) => p.lat).join(",")}&longitude=${pts.map((p) => p.lon).join(",")}&current=${VARS}&wind_speed_unit=kmh&timezone=GMT`;
  const spacing = Math.hypot(...[0, 1].map((k) => lonLatToMap(106 + STEP, 16)[k] - lonLatToMap(106, 16)[k])); // ~80 km, map units

  let on = false, status = "idle", cur = null, fetchedAt = 0, obsTime = "";
  // --- data ---------------------------------------------------------------------------------------------------------
  function readCache() {
    try {
      const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
      if (c && c.url === url && Date.now() - c.at < CACHE_MS && Array.isArray(c.cur) && c.cur.length === pts.length) return c;
    } catch { /* storage blocked or bad JSON: fetch */ }
    return null;
  }
  async function load() {
    if (status === "loading" || status === "ok") return;
    const c = readCache();
    if (c) return accept(c.cur, c.at);
    status = "loading";
    renderToggle();
    try {
      if (navigator.onLine === false) throw new Error("offline");
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 12000);
      const r = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", signal: ctl.signal });
      clearTimeout(to);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = parseCurrent(await r.json(), pts.length), at = Date.now();
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ url, at, cur: data })); } catch { /* full / blocked */ }
      accept(data, at);
    } catch (err) {
      status = "fail";
      console.info(`live weather unavailable (${err.message || err})`); // expected offline / blocked: not an error
      on = false;
      renderToggle();
      renderBadge();
      app.requestDraw();
    }
  }
  function accept(data, at) {
    cur = data.map((d, k) => ({ ...d, ...pts[k], rain: rainLevel(d.code, d.mm) }));
    fetchedAt = at;
    obsTime = cur.map((d) => d.time).filter(Boolean).sort().pop() || "";
    status = "ok";
    buildStreaks();
    renderToggle();
    renderBadge();
    app.requestDraw();
  }

  // --- static layer: clouds, wind, temperatures ---------------------------------------------------------------------
  let cloudSprite = null;
  function makeCloud() {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d"), rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, "#e8eef5ff"); rg.addColorStop(0.55, "#dfe7f0b0"); rg.addColorStop(1, "#dfe7f000");
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
    return c;
  }
  const near = (p, vp, pad) => p.x > vp.x0 - pad && p.x < vp.x1 + pad && p.y > vp.y0 - pad && p.y < vp.y1 + pad;
  const tempColor = (v) => (v >= 33 ? "#ffb08a" : v >= 27 ? "#ffd59a" : v >= 20 ? "#fff3c4" : v >= 12 ? "#cfe8ff" : "#a9cbff");
  app.registerStaticLayer({
    id: "atmos-weather", z: 87, snapshot: true,
    visible: () => on && status === "ok",
    sig: () => `${fetchedAt}|${M?.enabled ? 1 : 0}`,
    draw(ctx, vp, _w, o) {
      cloudSprite ||= makeCloud();
      const r = spacing * 0.95;
      for (const p of cur) { // cloud cover: white shading, its opacity the cover fraction
        if (p.cloud < 5 || !near(p, vp, r)) continue;
        ctx.globalAlpha = 0.5 * (p.cloud / 100);
        ctx.drawImage(cloudSprite, p.x - r, p.y - r, 2 * r, 2 * r);
      }
      ctx.globalAlpha = 1;
      if (!M?.enabled) drawRain(ctx, o.s, 0, vp); // still streaks (motion off): where it rains is still shown
      o.screen();
      const big = o.Rpx >= 3, fs = big ? 12 : 10;
      ctx.font = `600 ${fs}px -apple-system, "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
      for (const p of cur) {
        if (!near(p, vp, r)) continue;
        const [x, y] = o.toScreen(p.x, p.y);
        // wind: an arrow pointing downwind (Open-Meteo gives the direction it blows FROM), length by speed
        const a = ((p.wd + 180) * Math.PI) / 180, L = 7 + Math.min(14, p.ws * 0.7);
        const dx = Math.sin(a) * L, dy = -Math.cos(a) * L;
        ctx.strokeStyle = "#0b1a2acc"; ctx.lineWidth = 3.2;
        arrow(ctx, x, y, dx, dy);
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.4;
        arrow(ctx, x, y, dx, dy);
        const txt = `${Math.round(p.t)}°`;
        ctx.strokeStyle = "#0b1a2ae0"; ctx.lineWidth = 3;
        ctx.strokeText(txt, x, y - fs);
        ctx.fillStyle = tempColor(p.t);
        ctx.fillText(txt, x, y - fs);
      }
      o.world();
    },
    hit(x, y, Rpx) {
      if (!cur) return null;
      const tol = 16 / (Rpx / grid.R);
      let best = null, bd = tol;
      for (const p of cur) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
      return best;
    },
    tooltip: (p) => tipHtml(p),
  });
  function arrow(ctx, x, y, dx, dy) {
    const L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, h = 4;
    ctx.beginPath();
    ctx.moveTo(x - dx / 2, y - dy / 2); ctx.lineTo(x + dx / 2, y + dy / 2);
    ctx.moveTo(x + dx / 2 - ux * h - uy * h * 0.7, y + dy / 2 - uy * h + ux * h * 0.7);
    ctx.lineTo(x + dx / 2, y + dy / 2);
    ctx.lineTo(x + dx / 2 - ux * h + uy * h * 0.7, y + dy / 2 - uy * h - ux * h * 0.7);
    ctx.stroke();
  }
  const vnTime = new Intl.DateTimeFormat(lang === "vi" ? "vi-VN" : "en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hour12: false });
  const obsFmt = () => (obsTime ? vnTime.format(new Date(obsTime + "Z")) : "–");
  function tipHtml(p) {
    const rain = p.mm > 0 ? ` · ${esc(t("{mm} mm in the last 15 min", { mm: fixed(p.mm, 1) }))}` : "";
    return `<b>${esc(t("Live weather"))}</b> <span class="muted">${esc(fixed(p.lat, 2))}° N, ${esc(fixed(p.lon, 2))}° E</span><br>`
      + `${esc(fixed(p.t, 1))} °C · ${esc(t(wmoLabel(p.code)))}${rain}<br>`
      + `${esc(t("Cloud cover {pct}", { pct: `${int(p.cloud)}%` }))} · ${esc(t("Wind {speed} km/h from {dir}", { speed: int(p.ws), dir: compass(p.wd) }))}<br>`
      + `<span class="muted">${esc(t("Observed {time} (Vietnam time) · Weather data by Open-Meteo.com (CC BY 4.0)", { time: obsFmt() }))}</span>`;
  }
  const DIRS = ["the north", "the north-east", "the east", "the south-east", "the south", "the south-west", "the west", "the north-west"];
  const compass = (deg) => t(DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]);

  // --- rain streaks (animated with Effects on, still otherwise) ------------------------------------------------------
  let streaks = null; // Float32Array [dx, dy, phase] per streak; rainy points listed in `wet`
  let wet = [];
  function buildStreaks() {
    wet = cur.filter((p) => p.rain > 0);
    const n = wet.reduce((s, p) => s + Math.round(STREAKS * p.rain), 0);
    streaks = new Float32Array(n * 3);
    let k = 0;
    for (const p of wet) {
      p.s0 = k;
      p.n = Math.round(STREAKS * p.rain);
      const a = ((p.wd + 180) * Math.PI) / 180;
      p.vx = Math.sin(a); p.vy = -Math.cos(a); // downwind unit vector (map y is down = south)
      for (let j = 0; j < p.n; j++, k++) {
        const rr = Math.sqrt(Math.random()) * spacing * 0.55, th = Math.random() * 6.283;
        streaks[3 * k] = Math.cos(th) * rr; streaks[3 * k + 1] = Math.sin(th) * rr; streaks[3 * k + 2] = Math.random();
      }
    }
  }
  function drawRain(ctx, s, time, vp) {
    if (!wet.length) return;
    ctx.strokeStyle = "#a8d4ff";
    ctx.lineWidth = 1.5 / s;
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    const len = 9 / s, drift = spacing * 0.25;
    for (const p of wet) {
      if (!near(p, vp, spacing)) continue;
      // streaks fall "down" the screen, slanted by the wind and drifting downwind as they go
      const sx = p.vx * 0.6, sy = 1 + Math.max(-0.5, p.vy * 0.6);
      for (let j = 0; j < p.n; j++) {
        const k = 3 * (p.s0 + j), ph = (streaks[k + 2] + time * (0.5 + 0.5 * p.rain)) % 1;
        const x = p.x + streaks[k] + p.vx * drift * (ph - 0.5), y = p.y + streaks[k + 1] + (p.vy * drift + spacing * 0.15) * (ph - 0.5);
        ctx.moveTo(x, y); ctx.lineTo(x + sx * len, y + sy * len);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  const cap = M?.frameCap ? M.frameCap(1000 / 30) : { due: () => true, drew() {} };
  let clock = 0, clockAt = 0, rainInView = false;
  const running = () => on && status === "ok" && rainInView && !M.idle;
  M?.register?.({
    id: "atmos-rain", z: 88,
    active: () => running() && cap.due(),
    draw(ctx, cam, _a, f) {
      if (!on || status !== "ok" || f.still) { rainInView = false; return; } // still: the static layer draws them
      const v = cam.view();
      rainInView = wet.some((p) => near(p, v, spacing));
      if (!rainInView) return;
      const now = performance.now();
      if (running()) { clock += clockAt ? Math.min(now - clockAt, 250) : 0; clockAt = now; } else clockAt = 0;
      cap.drew();
      drawRain(ctx, cam.scale, clock / 1000, v);
    },
  });

  // --- the switch and the badge -------------------------------------------------------------------------------------
  function setWeather(v) {
    if (v && status === "fail") { on = false; return; } // unavailable this visit (the switch already says so)
    on = !!v;
    if (on) load();
    renderBadge();
    app.requestDraw();
  }
  function renderToggle() {
    app.ui?.addMapToggle?.({
      id: "weather", group: GROUP, icon: status === "fail" ? "⚠" : "🌦", default: false,
      label: status === "fail" ? t("Live weather (unavailable)") : status === "loading" ? t("Live weather (loading…)") : t("Live weather"),
      title: status === "fail"
        ? t("Today's weather could not be loaded (offline, or the request was blocked). Reload the page to try again.")
        : t("Today's real weather, now: cloud cover, rain and wind at a grid of points over Vietnam, with temperatures. Live data from Open-Meteo.com (CC BY 4.0), refreshed every 30 minutes at most."),
      get: () => on,
      set: setWeather,
    });
  }
  renderToggle();
  M?.on?.("change", () => app.requestDraw());

  const badge = document.createElement("div");
  badge.className = "panel at-badge";
  badge.hidden = true;
  badge.setAttribute("role", "status");
  document.body.appendChild(badge);
  function renderBadge() {
    badge.hidden = !on && status !== "fail";
    if (badge.hidden) return;
    if (status === "fail") {
      badge.innerHTML = `<span class="at-off">${esc(t("Live weather unavailable"))}</span>`;
      setTimeout(() => { if (status === "fail" && !on) badge.hidden = true; }, 6000);
      return;
    }
    if (status !== "ok") { badge.innerHTML = `<span>${esc(t("Loading today's weather…"))}</span>`; return; }
    const fetched = vnTime.format(fetchedAt);
    badge.innerHTML = `<span class="at-live">${esc(t("LIVE"))}</span>`
      + `<span>${esc(t("Weather now, observed {time}", { time: obsFmt() }))}</span>`
      + `<span class="at-key"><i class="at-cloud"></i>${esc(t("clouds"))} <i class="at-rain"></i>${esc(t("rain"))} <b>→</b> ${esc(t("wind"))}</span>`
      + `<span class="at-src">${esc(t("Fetched {time} · Weather data by Open-Meteo.com", { time: fetched }))}</span>`;
  }

  // --- sound --------------------------------------------------------------------------------------------------------
  const sound = createSound(app);
  app.ui?.addMapToggle?.({
    id: "atmos-sound", group: GROUP, icon: "🔈", default: false, hash: false,
    label: t("Ambient sound"),
    title: t("Quiet sound synthesised in the browser: surf near the coast, wind over the mountains, a city hum when zoomed into a city, mixed by what is on screen. Off with Effects off or when the tab is hidden."),
    get: () => sound.on,
    set: (v) => sound.set(v),
  });

  injectStyle();
  app.atmos = { get status() { return status; }, get points() { return pts; }, get data() { return cur; }, url, sound, get rainInView() { return rainInView; } };
}

function injectStyle() {
  const s = document.createElement("style");
  s.id = "atmos-style";
  s.textContent = `
.at-badge { position: fixed; left: 50%; transform: translateX(-50%); bottom: 14px; z-index: 18; display: flex; flex-wrap: wrap; justify-content: center;
  align-items: center; gap: 2px 10px; max-width: min(560px, calc(100vw - 20px)); box-sizing: border-box; padding: 5px 10px; font-size: 12px; color: var(--ink); }
.at-badge[hidden] { display: none; }
.at-live { font-weight: 700; font-size: 10.5px; letter-spacing: .06em; color: #fff; background: #c0392b; border-radius: 3px; padding: 1px 5px; }
.at-live::before { content: "● "; }
.at-key { color: var(--ink-dim); white-space: nowrap; }
.at-key i { display: inline-block; width: 11px; height: 9px; margin: 0 3px 0 6px; border-radius: 5px; vertical-align: -1px; }
.at-key i.at-cloud { background: #dfe7f0; opacity: .8; }
.at-key i.at-rain { background: repeating-linear-gradient(100deg, #a8d4ff 0 1.5px, transparent 1.5px 4px); border-radius: 0; }
.at-key b { margin-left: 6px; }
.at-src { color: var(--ink-dim); font-size: 10.5px; }
.at-off { color: var(--ink-dim); }
@media (max-width: 700px) { /* phones: top right under the top bar, compact (the bottom holds the dock and timeline) */
  .at-badge { top: 84px; bottom: auto; left: auto; right: 6px; transform: none; max-width: min(240px, calc(100vw - 12px)); justify-content: flex-start;
    font-size: 11px; padding: 4px 8px; gap: 1px 6px; }
  .at-key { display: none; }
  body:has(.dn-clock:not([hidden])) .at-badge { top: 146px; } }`;
  document.head.appendChild(s);
}
