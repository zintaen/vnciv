// Living map (phase D): the world moves with the wind, the clock, the month and the year.
//   trees     sway in the wind up close (sway.js; illustrative wind)                          motion, capped, idle-stop
//   homes     kitchen smoke at cooking time, lit windows at night (sway.js; illustrative)    motion (smoke), still lights
//   seasons   rice paddies by the month's crop stage per region (FAO crop calendar), the Mekong flood season over the
//             delta's low-lying hexes (illustrative of the season, not a forecast)          static layers, sig = month
//   sea       fishing-boat lights at night (illustrative positions in the offshore zones)    motion, capped, idle-stop
//   tết       fireworks over the big cities on Tết eve, Vietnam clock (lunar new-year table) motion, only that night
//   growth    GHSL built-up hexes by epoch and expressways by opening year, following the timeline year, with a
//             ▶ 1975→now replay                                                              overlay (cached paths)
// Everything continuous goes through app.motion register + frameCap and stops when idle, off-screen, hidden or with
// Effects off; reduced motion / Effects off draws a still, complete state. Time: the Vietnam clock (UTC+7), or the
// day–night ▶ 24 h play when it runs. Hidden preview: ?living=tet (Tết eve), ?living=m8 (month 8),
// ?living=t2027-02-05T22:00 (a Vietnam time); several comma-separated.
import { t, lang } from "../../i18n.js";
import { esc } from "../../format.js";
import { vnParts, tetEve, nextTet, tetEveMs } from "./calendar.js";
import { createSway, SWAY_MIN_RPX } from "./sway.js";
import { createNight } from "./night.js";
import { createSeasons, STAGE_COLOR } from "./seasons.js";
import { createGrowth } from "./growth.js";
import { nightness } from "../daynight/sun.js";

const STAGE_NAME = { plant: "Transplanting (flooded fields)", grow: "Green rice", ripe: "Ripening", harvest: "Harvest (gold)", fallow: "Fallow" };

export function install(app) {
  const M = app.motion;
  if (!M?.register) return;
  const phone = !!app.isMobile?.();
  const perf = app.perf ? (app.perf.living = []) : [];

  // --- debug / preview (?living=...) --------------------------------------------------------------------------------
  let dbgMs = null, dbgMonth = null, dbgTet = false;
  try {
    for (const p of (new URLSearchParams(location.search).get("living") || "").split(",")) {
      if (p === "tet") dbgTet = true;
      else if (/^m\d{1,2}$/.test(p)) dbgMonth = Math.min(12, Math.max(1, +p.slice(1)));
      else if (/^t\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(p)) dbgMs = Date.parse(`${p.slice(1)}:00+07:00`);
    }
  } catch { /* no location */ }
  const perf0 = performance.now();
  // a debug time keeps running from where it was set
  const now = () => {
    if (dbgMs != null) return dbgMs + (performance.now() - perf0); // a ?living=t… / Tết preview beats the real clock
    if (app.daynight?.now) return app.daynight.now();
    if (app.daynight?.on) {
      const d = document.querySelector(".dn-time")?.dateTime; // the clock shows ▶ 24 h's simulated time while it plays
      const ms = d ? Date.parse(d) : NaN;
      if (Number.isFinite(ms) && Math.abs(ms - Date.now()) > 120e3) return ms;
    }
    return dbgMs != null ? dbgMs + (performance.now() - perf0) : Date.now();
  };

  // --- state ---------------------------------------------------------------------------------------------------------
  const on = { trees: !phone, homes: true, seasons: true, sea: true, tet: true, growth: false };
  let L = null, loading = null, monthPick = null, replayYear = null, replayCancel = null;
  const month = () => monthPick ?? dbgMonth ?? vnParts(now()).m;
  const lensOn = () => !!(app.state.lens || app.shownLens?.());
  const sway = createSway(app, { phone });
  const night = createNight(app, { phone });
  const growth = createGrowth(app);
  let seasons = null;
  // the six centrally run cities (thành phố trực thuộc trung ương, 2025)
  const BIG = ["Hà Nội", "TP. Hồ Chí Minh", "Hải Phòng", "Đà Nẵng", "Cần Thơ", "Huế"];
  const cities = (app.data.cities || []).filter((c) => c.x != null && BIG.includes(c.name));
  night.setCities(cities);

  function ensure() {
    return (loading ||= app.loadData("living").then((d) => {
      if (!d?.rice) { console.warn("living.json missing: seasons, boats and Tết are off"); return; }
      L = d;
      if (dbgTet && dbgMs == null) dbgMs = tetEveMs(nextTet(Date.now(), L.tet.dates)?.year, L.tet.dates); // the preview lands at 23:59:30 on the eve
      seasons = createSeasons(app, L, month);
      night.buildBoats(L.fishing);
      sway.setMonth(month());
      registerLayers();
      renderCard();
      app.requestDraw();
    }));
  }
  const ensureGrowth = () => Promise.all([app.loadData("living_built"), app.loadData("living_roads")]).then(([b, r]) => {
    growth.built = b?.cells ? b : null;
    growth.roads = r?.links ? r : null;
    renderCard();
    app.requestDraw();
  });

  const el = document.createElement("div");
  el.className = "panel lv-card";
  el.hidden = true;
  el.setAttribute("aria-label", t("Living map"));
  document.body.appendChild(el);

  // --- static layers: rice and flood ------------------------------------------------------------------------------------
  function registerLayers() {
    app.registerStaticLayer({
      id: "living-rice", z: 41, snapshot: true,
      visible: () => on.seasons && !!seasons,
      sig: () => `m${month()}`,
      draw: (ctx, vp, w, o) => { if (!o.lens) seasons.drawRice(ctx, vp, w, o); },
    });
    app.registerStaticLayer({
      id: "living-flood", z: 46, snapshot: true,
      visible: () => on.seasons && !!seasons && seasons.floodLevel(month()) > 0,
      sig: () => `m${month()}`,
      draw: (ctx, vp, w, o) => { if (!o.lens) seasons.drawFlood(ctx, vp, w, o); },
    });
  }

  // --- motion ------------------------------------------------------------------------------------------------------------
  const cap = M.frameCap(1000 / (phone ? 20 : 30));
  const V = { x0: 0, y0: 0, x1: 0, y1: 0 };
  const view = (cam) => {
    const hw = cam.w / 2 / cam.scale, hh = cam.h / 2 / cam.scale;
    V.x0 = cam.x - hw; V.x1 = cam.x + hw; V.y0 = cam.y - hh; V.y1 = cam.y + hh;
    return V;
  };
  // what the clock says (cheap; asked every frame)
  const sky = { ms: 0, night: 0, hour: 12, smoke: 0, lights: 0, boats: 0, tet: 0, roads: true };
  let skyAt = -1e9, skyX = NaN;
  function readSky(cam) {
    // once a second (or when the view moves far): a few small objects, not per frame
    const t1 = performance.now();
    if (t1 - skyAt < 1000 && Math.abs(cam.x - skyX) < 500) return;
    skyAt = t1; skyX = cam.x;
    sky.roads = app.ui?.mapToggles?.().find((x) => x.id === "roads")?.on ?? true;
    const ms = now();
    sky.ms = ms;
    const h = vnParts(ms).h;
    sky.hour = h;
    sky.night = nightness(sway.sunAt(cam, ms));
    const ramp = (a, b) => Math.max(0, Math.min(1, (h - a) * 3, (b - h) * 3)); // ~20 min fade in and out
    sky.smoke = Math.max(ramp(5, 7), ramp(16.5, 19));
    const dn = !!app.daynight?.on || dbgMs != null || dbgTet;
    sky.lights = dn && (h >= 16.5 || h < 6) ? Math.max(0, sky.night - 0.15) / 0.85 : 0;
    sky.boats = dn ? Math.max(0, sky.night - 0.3) / 0.7 : 0;
    sky.tet = dbgTet || (L && tetEve(ms, L.tet.dates)) ? 1 : 0;
  }
  const Rpx = (cam) => app.w.grid.R * cam.scale;
  let clock = 0, clockAt = 0;
  const wantsMotion = () => {
    if (!M.enabled || M.idle) return false;
    // phones: with the day–night shade on, every frame costs ~35–80 ms on a 4×-throttled phone (the shade blit), so
    // the night stays still there (lights shown, no twinkle or smoke drift)
    if (phone && app.daynight?.on) return false;
    return (on.trees && sway.stamps > 0 && !lensOn()) || (on.homes && sky.smoke > 0 && sway.houses > 0 && !lensOn())
      || (on.sea && sky.boats > 0 && night.boats > 0);
  };
  M.register({
    id: "living", z: 24,
    active: () => wantsMotion() && cap.due(),
    draw(ctx, cam, a, f) {
      const t1 = performance.now();
      readSky(cam);
      const v = view(cam);
      const still = f.still || !M.enabled;
      const running = !still && wantsMotion();
      if (running) { clock += clockAt ? Math.min(t1 - clockAt, 250) : 0; clockAt = t1; } else clockAt = 0;
      const tt = clock / 1000;
      if (running) cap.drew();
      const terrain = !lensOn() && Rpx(cam) >= SWAY_MIN_RPX;
      if (terrain && (on.trees || on.homes)) {
        if (!f.moving) sway.collect(cam, f.dpr);
        else sway.reset();
      }
      if (terrain && !f.moving) {
        if (on.trees && !still) sway.drawTrees(ctx, cam, f, tt);
        if (on.homes && sky.smoke > 0) sway.drawSmoke(ctx, cam, still ? 0.4 : tt, sky.smoke);
        if (on.homes && sky.lights > 0) sway.drawLights(ctx, cam, sky.lights);
      }
      if (on.sea && sky.boats > 0) night.drawBoats(ctx, cam, v, sky.boats, still ? null : tt);
      if (perf.push(performance.now() - t1) > 120) perf.shift();
    },
  });
  // fireworks above the banners, in screen px
  let fwT = 0, fwAt = 0;
  const fireworks = () => on.tet && sky.tet > 0;
  M.register({
    id: "living-tet", z: 110, ambient: false,
    active: () => fireworks() && M.enabled && !M.idle && cap.due(),
    draw(ctx, cam, a, f) {
      if (!fireworks()) return;
      const t1 = performance.now();
      const still = f.still || !M.enabled;
      if (!still) { fwT += fwAt ? Math.min(t1 - fwAt, 250) : 0; fwAt = t1; cap.drew(); } else fwAt = 0;
      ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
      night.drawFireworks(ctx, cam, view(cam), still ? null : fwT / 1000);
    },
  });
  // growth: drawn whenever the map draws; frames only while the ▶ replay runs
  M.register({
    id: "living-growth", z: 26, ambient: false,
    active: () => replayYear != null,
    draw(ctx, cam) {
      if (!on.growth || lensOn() && replayYear == null) return;
      readSky(cam);
      growth.draw(ctx, cam, shownYear(), sky.roads);
    },
  });
  const shownYear = () => replayYear ?? app.timeline?.year ?? null;

  function replay() {
    if (replayCancel) { replayCancel(); replayCancel = null; replayYear = null; renderCard(); app.requestDraw(); return; }
    const end = vnParts(Date.now()).y;
    replayYear = 1975;
    replayCancel = M.tween({
      from: 1975, to: end, ms: 11000, ease: "linear",
      onUpdate: (y) => { const yy = Math.floor(y); if (yy !== replayYear) { replayYear = yy; renderCard(); } },
      onDone: () => { replayYear = null; replayCancel = null; renderCard(); app.requestDraw(); },
    });
    renderCard();
  }

  // --- toggles -----------------------------------------------------------------------------------------------------------
  let cardWanted = false; // the card shows once someone switches seasons or growth on (not for the passive default)
  const set = (k, needs) => (v) => {
    on[k] = !!v;
    if (on[k] && (k === "seasons" || k === "growth")) cardWanted = true;
    if (on[k] && needs) needs();
    if (k === "growth" && !on[k] && replayCancel) replay();
    sway.reset();
    renderCard();
    app.requestDraw();
  };
  const tg = (id, k, icon, label, title, needs) => app.ui?.addMapToggle?.({
    id, group: "living", icon, label: t(label), title: t(title), default: on[k], get: () => on[k], set: set(k, needs),
  });
  tg("trees", "trees", "🌳", "Trees in the wind",
    "Up close, trees sway gently in the wind (illustrative: the wind comes from the monsoon's side for the month, not real-time wind). Off with Effects off or reduced motion.");
  tg("homes", "homes", "🏡", "Kitchen smoke & house lights",
    "Up close, smoke rises from farmhouses at cooking time (5–7 and 16:30–19:00 Vietnam time) and windows light up after dusk with Day–night on. Illustrative, not real data.");
  tg("seasons", "seasons", "🌾", "Rice seasons & floods",
    "Lowland rice paddies take the colour of this month's crop stage in the North and the South (USDA crop calendar), and from August to November water spreads over the Mekong Delta's low-lying hexes: illustrative of the flood season (mùa nước nổi), not a forecast.", ensure);
  tg("boats", "sea", "🚤", "Fishing-boat lights",
    "At night (Day–night on), the lights of fishing boats at sea. Illustrative: generic positions in Vietnam's offshore fishing zones, not vessel tracking.", ensure);
  tg("tet", "tet", "🎆", "Tết fireworks",
    "Fireworks over the biggest cities on Tết eve (lunar new year's eve, Vietnam time). Illustrative, not the official display programme.", ensure);
  tg("growth", "growth", "🏙️", "Cities & expressways by year",
    "Built-up hexes by the year they first appear (GHSL, satellite epochs 1975–2020) and expressways by their opening year, following the timeline year. ▶ replays 1975 to now.", ensureGrowth);
  if (on.seasons || on.sea || on.tet) setTimeout(ensure, 0);
  if (on.growth) ensureGrowth();
  app.on?.("year", () => { renderCard(); app.requestDraw(); });
  app.on?.("lens", () => { sway.reset(); app.requestDraw(); });
  app.on?.("data", ({ name }) => { if (name === "infrastructure") sway.reset(); });
  // the clock moves on: re-read the month and the night every minute (no frames meanwhile)
  let lastMonth = 0, lastTet = 0;
  setInterval(() => {
    if (document.hidden || !L) return;
    const m = month(), te = tetEve(now(), L.tet.dates);
    if (m !== lastMonth || te !== lastTet) { lastMonth = m; lastTet = te; sway.setMonth(m); renderCard(); }
    app.requestDraw();
  }, 60e3);

  // --- the card ----------------------------------------------------------------------------------------------------------
  const monthName = (m) => new Intl.DateTimeFormat(lang === "vi" ? "vi-VN" : "en-GB", { month: "long", timeZone: "UTC" }).format(Date.UTC(2001, m - 1, 15));
  function renderCard() {
    const showSeason = on.seasons && seasons, showGrowth = on.growth && growth.built;
    el.hidden = !(cardWanted || dbgMonth != null) || !(showSeason || showGrowth);
    if (el.hidden) return;
    let h = "";
    if (showSeason) {
      const m = month(), st = seasons.stageOf(m), fl = seasons.floodLevel(m);
      const regs = seasons.regionIds.map((id, k) => `<li><i style="background:${STAGE_COLOR[st[k]]}"></i><b>${esc(t(L.crop_calendar.regions[id].name))}</b> ${esc(t(STAGE_NAME[st[k]]))}</li>`).join("");
      h += `<div class="lv-row"><button type="button" class="lv-btn lv-prev" aria-label="${esc(t("Previous month"))}" title="${esc(t("Previous month"))}">‹</button>
        <b class="lv-month">${esc(monthName(m))}</b>
        <button type="button" class="lv-btn lv-next" aria-label="${esc(t("Next month"))}" title="${esc(t("Next month"))}">›</button>
        ${monthPick != null ? `<button type="button" class="lv-link lv-now">${esc(t("This month"))}</button>` : `<span class="lv-dim">${esc(dbgMonth != null ? t("preview") : t("this month, Vietnam time"))}</span>`}</div>
        <ul class="lv-stages">${regs}</ul>
        ${fl > 0 ? `<div class="lv-flood"><i></i>${esc(t("Mekong flood season (mùa nước nổi): illustrative, not a forecast"))}</div>` : ""}
        <div class="lv-note">${esc(t("Rice stages from the {src} crop calendar.", { src: L.crop_calendar.short || "FAO" }))}</div>`;
    }
    if (showGrowth) {
      const y = shownYear(), e = growth.epochFor(y), E = growth.built.epochs;
      const label = e < 0 ? t("before {y}", { y: E[0] }) : String(E[e]);
      h += `<div class="lv-row lv-grow"><span>${esc(t("Built-up area as of {epoch}", { epoch: label }))}${y != null ? ` · ${esc(t("year {y}", { y }))}` : ""}</span>
        <button type="button" class="lv-btn lv-play" title="${esc(t("Replay the growth of cities and expressways from 1975 to now"))}">${replayCancel ? esc(t("Stop")) : "▶ 1975→"}</button></div>
        <div class="lv-ramp">${growth.EPOCH_RAMP.map((c, k) => `<i style="background:${c}" title="${E[k]}"></i>`).join("")}<span>${E[0]}</span><span>${E.at(-1)}</span></div>
        <div class="lv-note">${esc(t("GHSL built-up surface (JRC, CC BY 4.0), observed epochs only; dashed orange: expressway not yet open that year."))}</div>`;
    }
    el.innerHTML = h;
  }
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.classList.contains("lv-prev") || b.classList.contains("lv-next")) {
      monthPick = ((month() - 1 + (b.classList.contains("lv-next") ? 1 : 11)) % 12) + 1;
      sway.setMonth(monthPick);
    } else if (b.classList.contains("lv-now")) { monthPick = null; sway.setMonth(month()); }
    else if (b.classList.contains("lv-play")) return replay();
    renderCard();
    app.requestDraw();
  });
  injectStyle();

  app.living = {
    get on() { return { ...on }; }, month, now, sky, sway, night, growth,
    get seasons() { return seasons; }, get data() { return L; },
    nextTet: () => (L ? nextTet(now(), L.tet.dates) : null),
    previewTet: () => { if (L) { const nt = nextTet(Date.now(), L.tet.dates); dbgMs = tetEveMs(nt.year, L.tet.dates); app.requestDraw(); } },
  };
}

function injectStyle() {
  const css = `
.lv-card { position: fixed; right: calc(10px + var(--dock-right, 0px)); bottom: 64px; z-index: 18; width: min(300px, calc(100vw - 20px)); padding: 7px 10px; font-size: 12px; color: var(--ink); box-sizing: border-box; }
.lv-card[hidden] { display: none; }
/* the Map panel (lens picker) opens over this corner: step aside while it is open */
body:has(#lens-picker:not([hidden])) .lv-card { display: none; }
.lv-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.lv-month { font: 600 15px var(--serif); color: var(--gold-bright); min-width: 76px; text-align: center; text-transform: capitalize; }
.lv-btn { background: none; border: 1px solid var(--line); border-radius: 4px; color: var(--gold-bright); cursor: pointer; min-width: 26px; height: 24px; padding: 0 6px; font: inherit; }
.lv-btn:hover, .lv-link:hover { background: rgba(201,164,92,.15); }
.lv-link { background: none; border: 0; color: var(--gold-bright); text-decoration: underline; cursor: pointer; font: inherit; padding: 0 2px; }
.lv-dim { color: var(--ink-dim); font-size: 11px; }
.lv-stages { list-style: none; margin: 5px 0 2px; padding: 0; display: grid; gap: 2px; }
.lv-stages li { display: flex; align-items: center; gap: 6px; }
.lv-stages i, .lv-flood i { width: 11px; height: 11px; border-radius: 2px; flex: none; border: 1px solid rgba(0,0,0,.35); }
.lv-stages b { font-weight: 600; min-width: 0; }
.lv-flood { display: flex; gap: 6px; align-items: center; margin-top: 3px; }
.lv-flood i { background: #5f95ad; }
.lv-note { color: var(--ink-dim); font-size: 10.5px; margin-top: 3px; }
.lv-grow { justify-content: space-between; margin-top: 6px; }
.lv-ramp { display: flex; align-items: center; gap: 1px; margin-top: 4px; font-size: 10.5px; color: var(--ink-dim); }
.lv-ramp i { width: 18px; height: 8px; }
.lv-ramp span:first-of-type { margin-left: 6px; } .lv-ramp span:last-of-type { margin-left: auto; }
@media (max-width: 700px) { .lv-card { right: 6px; bottom: 178px; width: min(270px, calc(100vw - 12px)); padding: 4px 8px; font-size: 11.5px; } .lv-stages { gap: 0; margin: 2px 0 0; } .lv-card .lv-note { display: none; } .lv-month { font-size: 14px; } }`;
  const s = document.createElement("style");
  s.id = "lv-style";
  s.textContent = css;
  document.head.appendChild(s);
}
