// Communes, wards and special zones (xã, phường, đặc khu) of the two-tier local government from 1 July 2025, with
// the types of the current NSO register (communes.json as_of; later commune → ward changes in its "changes")
// (communes.json, lazy). A static layer draws their borders (thin, from close zoom) and names (closer still, no
// overlaps); hovering shows name, kind, province, population, area and density (communes.json "stats"; a missing
// value says why), a click opens a card with the province's largest communes; a search pick flies to one and outlines it.
// "Population density by commune" (a second switch) fills every commune by its density class, from any zoom, with a
// legend under the lens legend.
// Search: adds communes, towns and islands (places.json) and wonders (wonders.json) to the top-bar search through
// app.search.addEntries(entries) when main provides it (see the stream report for the proposed hook).
import { t, lang } from "../../i18n.js";
import { airportName, esc, fixed, int } from "../../format.js";

const KIND_EN = ["Commune", "Ward", "Special zone"];
const BORDER_MIN_RPX = 12; // hex radius in css px from which borders are drawn (communes are ~2 hexes across)
const NAME_MIN_RPX = 34;   // ... and names
const STYLE = { under: "#fff8e666", line: "#2b2116c0", sel: "#d6202f", name: "#3a2e20", halo: "#fff8e6e0" };
const SANS = '-apple-system, "Segoe UI", system-ui, sans-serif';
// The two archipelago special zones: their official outlines take in reefs, shoals and lagoons, so the area is not land.
const REEF_ZONES = new Set(["Trường Sa", "Hoàng Sa"]);
// An ISO date as 20/9/2026 (vi) or 20 September 2026 (en).
// Density classes (people per km²): upper bounds, fill colours (light to dark), and the no-data fill.
const DENSITY_BREAKS = [50, 100, 300, 1000, 3000, 10000, 30000, Infinity];
const DENSITY_FILL = ["#fff5d6", "#fde3a0", "#fdc46c", "#f99b45", "#ec6a2c", "#cf3a20", "#a01c1e", "#650f1f"];
const NO_DATA_FILL = "#9a958c";
const FILL_ALPHA = "c0";
const densityClass = (d) => (d == null ? -1 : DENSITY_BREAKS.findIndex((b) => d < b));
// Why a figure is missing (communes.json stats.reasons, shortened for the tooltip).
const REASON = {
  copy: "the source gives it exactly the figures of another unit",
  no_area: "the source gives no area",
  reef: "the outline takes in reefs and lagoons",
  area_mismatch: "the source's figures do not fit this unit's outline (likely a former commune's)",
  pending: "the source gives no population",
  province_total: "the source gives a whole province's population",
  implausible: "the source's figure has evidently lost digits",
};
const day = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-GB",
  { timeZone: "UTC", day: "numeric", month: lang === "vi" ? "numeric" : "long", year: "numeric" });

// --- model ----------------------------------------------------------------------------------------------------

function decode(d) {
  const q = d.q || 1;
  const arcs = d.arcs.map((a) => {
    const n = a.length / 2, pts = new Float32Array(a.length);
    let x = 0, y = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      x += a[2 * i]; y += a[2 * i + 1];
      const px = x / q, py = y / q;
      pts[2 * i] = px; pts[2 * i + 1] = py;
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
    return { pts, x0, y0, x1, y1 };
  });
  const chg = new Map((d.changes || []).flatMap((r) => r.ids.map((id) => [id, r])));
  const communes = d.communes.map((c) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const ring of c.r) for (const r of ring) {
      const a = arcs[r < 0 ? ~r : r];
      if (a.x0 < x0) x0 = a.x0; if (a.x1 > x1) x1 = a.x1;
      if (a.y0 < y0) y0 = a.y0; if (a.y1 > y1) y1 = a.y1;
    }
    return { ...c, x0, y0, x1, y1, full: `${d.kinds[c.k]} ${c.n}`, chg: chg.get(c.id) };
  });
  return { arcs, communes, asOf: d.as_of, stats: d.stats || null, byId: new Map(communes.map((c) => [c.id, c])) };
}

// Ring coordinates of a commune (arcs joined in order, reversed where the ref is negative), cached.
function rings(m, c) {
  if (c._rings) return c._rings;
  c._rings = c.r.map((ring) => {
    const out = [];
    for (const r of ring) {
      const p = m.arcs[r < 0 ? ~r : r].pts, n = p.length / 2;
      for (let k = 0; k < n; k++) {
        const i = r < 0 ? n - 1 - k : k;
        out.push(p[2 * i], p[2 * i + 1]);
      }
    }
    return out;
  });
  return c._rings;
}

function contains(m, c, x, y) {
  let inside = false;
  for (const p of rings(m, c)) {
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
      const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function strokeRings(ctx, m, c) {
  ctx.beginPath();
  for (const p of rings(m, c)) {
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.closePath();
  }
  ctx.stroke();
}

// Names: biggest communes first, only where the name fits inside the commune's box, never overlapping.
function drawNames(ctx, vp, o, m) {
  o.screen();
  const px = Math.max(10, Math.min(13, o.Rpx / 5));
  ctx.font = `500 ${px}px ${SANS}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  const vis = m.communes.filter((c) => c.x > vp.x0 && c.x < vp.x1 && c.y > vp.y0 && c.y < vp.y1).sort((a, b) => b.a - a.a);
  const placed = [];
  for (const c of vis) {
    const wd = ctx.measureText(c.n).width;
    if ((c.x1 - c.x0) * o.s < wd * 0.8) continue;
    const [x, y] = o.toScreen(c.x, c.y);
    const b = [x - wd / 2 - 2, y - px * 0.6, x + wd / 2 + 2, y + px * 0.6];
    if (placed.some((p) => b[0] < p[2] && p[0] < b[2] && b[1] < p[3] && p[1] < b[3])) continue;
    placed.push(b);
    ctx.strokeStyle = STYLE.halo;
    ctx.lineWidth = 3;
    ctx.strokeText(c.n, x, y);
    ctx.fillStyle = STYLE.name;
    ctx.fillText(c.n, x, y);
  }
  o.world();
}

// One Path2D per density class (index 0..7, then no data), built once: a cache render fills 9 paths.
function densityPaths(m) {
  if (m._dpaths) return m._dpaths;
  const paths = DENSITY_FILL.map(() => new Path2D()).concat([new Path2D()]);
  for (const c of m.communes) {
    const k = densityClass(c.density), p = paths[k < 0 ? paths.length - 1 : k];
    for (const r of rings(m, c)) {
      p.moveTo(r[0], r[1]);
      for (let i = 2; i < r.length; i += 2) p.lineTo(r[i], r[i + 1]);
      p.closePath();
    }
  }
  return (m._dpaths = paths);
}

const km2 = (a) => `${a < 10 ? fixed(a, 2) : a < 100 ? fixed(a, 1) : int(a)} km²`;
const perKm2 = (d) => `${d < 10 ? fixed(d, 1) : int(d)} ${t("people/km²")}`;
// Population, area and density lines of a commune (with the reason when a figure is missing) and the outline area.
function statsHtml(c) {
  const why = c.null_reason ? ` <span class="muted">(${esc(t(REASON[c.null_reason] || c.null_reason))})</span>` : "";
  const reef = REEF_ZONES.has(c.n) && c.k === 2;
  return `${esc(t("Population (2025)"))}: ${c.population != null ? `<b>${esc(int(c.population))}</b> ${esc(t("people"))}` : `${esc(t("no figure"))}${why}`}<br>`
    + (c.area_km2 != null ? `${esc(t("Area"))}: ${esc(km2(c.area_km2))}<br>` : c.population != null ? "" : `${esc(t("Area"))}: ${esc(t("no figure"))}<br>`)
    + (c.density != null ? `${esc(t("Density"))}: <b>${esc(perKm2(c.density))}</b><br>` : "")
    + `<span class="muted">${esc(t("Outline area"))}: ${esc(km2(c.a))}${reef ? ` ${esc(t("(includes reefs and lagoons, not only land)"))}` : ""}</span><br>`;
}

// The resolution the source cites for the unit, linked to its text on vanban.chinhphu.vn (only that host is linked).
function resHtml(m, c) {
  const r = m.stats?.resolutions?.[c.res];
  if (!r) return "";
  const ok = /^https:\/\/vanban\.chinhphu\.vn\//.test(r.link || "");
  const name = esc(r.id);
  return `<div class="cm-res">${esc(t("Formed by"))}: ${ok ? `<a href="${esc(r.link)}" target="_blank" rel="noopener">${name}</a>` : name}</div>`;
}

function basisHtml(m) {
  const s = m.stats;
  if (!s) return "";
  return `<span class="muted">${esc(t("2025 population from the administrative-units merger map (Vietnam Natural Resources, Environment and Cartography Publishing House), retrieved {date}. Outline area: computed from the boundary.",
    { date: day(s.as_of) }))}</span>`;
}

// --- install --------------------------------------------------------------------------------------------------

export function install(app) {
  const state = { on: false, density: false, model: null, loading: null, sel: null };
  const provName = (abbr) => app.w?.raw?.states?.find((s) => s.abbr === abbr)?.name || abbr;

  function load() {
    if (!state.loading) {
      state.loading = app.loadData("communes").then((d) => {
        if (d && d.communes) {
          state.model = decode(d);
          addSearch();
          app.requestDraw();
        }
        return state.model;
      }, (err) => { console.warn("communes: communes.json failed to load", err); return null; });
    }
    return state.loading;
  }

  const hitCommune = (x, y) => {
    const m = state.model;
    if (!m) return null;
    for (const c of m.communes) if (x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1 && contains(m, c, x, y)) return c;
    return null;
  };
  const tooltip = (c) => `<b>${esc(c.full)}</b><br>${esc(lang === "vi" ? provName(c.p) : `${t(KIND_EN[c.k])} · ${provName(c.p)}`)}<br>`
    + statsHtml(c)
    + (c.chg ? `${esc(t("{to} since {date} (Resolution {id}); a {from} before.", { to: t(KIND_EN[c.chg.kind_to]),
      from: t(KIND_EN[c.chg.kind_from]).toLowerCase(), date: day(c.chg.effective), id: c.chg.id }))}<br>` : "")
    + `<span class="muted">${esc(t("Units of 1 July 2025 with their types in the NSO register of {date}; outlines from the official reference map (sapnhap.bando.com.vn).",
      { date: day(state.model.asOf) }))}</span><br>${basisHtml(state.model)}`;
  const click = (c) => { showCard(c); return true; };

  // The density fill: under the borders, from any zoom (9 precomputed paths; the borders stay a close-zoom layer).
  app.registerStaticLayer({
    id: "communes-density", z: 51,
    visible: () => state.density && !!state.model,
    sig: () => (state.model?._dpaths ? "d1" : "d0"),
    draw(ctx) {
      const t0 = performance.now();
      const paths = state.model._dpaths; // built when the switch goes on (~0.1 s once), never inside a cache render
      if (!paths) return;
      paths.forEach((p, k) => {
        ctx.fillStyle = (DENSITY_FILL[k] || NO_DATA_FILL) + FILL_ALPHA;
        ctx.fill(p);
      });
      state.msDensity = performance.now() - t0;
    },
    hit: hitCommune, tooltip, click,
  });

  app.registerStaticLayer({
    id: "communes", z: 52, minRpx: BORDER_MIN_RPX,
    visible: () => state.on && !!state.model,
    sig: () => "c1",
    draw(ctx, vp, w, o) {
      const t0 = performance.now();
      const m = state.model;
      ctx.beginPath();
      for (const a of m.arcs) {
        if (a.x1 < vp.x0 || a.x0 > vp.x1 || a.y1 < vp.y0 || a.y0 > vp.y1) continue;
        const p = a.pts;
        ctx.moveTo(p[0], p[1]);
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
      }
      // A light casing under a fine dashed dark line: visible on both forest and paddy without shouting.
      const px = Math.max(1, Math.min(1.5, o.Rpx / 30)) / o.s;
      ctx.lineJoin = ctx.lineCap = "round";
      ctx.strokeStyle = STYLE.under;
      ctx.lineWidth = px * 2.6;
      ctx.stroke();
      ctx.setLineDash([px * 4, px * 2.5]);
      ctx.strokeStyle = STYLE.line;
      ctx.lineWidth = px;
      ctx.stroke();
      ctx.setLineDash([]);
      state.ms = performance.now() - t0;
    },
    hit: hitCommune, tooltip, click,
  });

  // Names above roads and city tiles, under the province names.
  app.registerStaticLayer({
    id: "communes-names", z: 89, minRpx: NAME_MIN_RPX,
    visible: () => state.on && !!state.model,
    draw(ctx, vp, w, o) {
      const t0 = performance.now();
      drawNames(ctx, vp, o, state.model);
      state.msNames = performance.now() - t0;
    },
  });

  // The searched-for commune's outline, drawn every frame above the map (until Esc or another pick).
  app.registerOverlay({
    id: "communes-sel", z: 50, space: "world",
    draw(ctx, cam) {
      if (!state.sel || !state.model) return;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#fff8e6";
      ctx.lineWidth = 5 / cam.scale;
      strokeRings(ctx, state.model, state.sel);
      ctx.strokeStyle = STYLE.sel;
      ctx.lineWidth = 2.5 / cam.scale;
      strokeRings(ctx, state.model, state.sel);
    },
  });
  app.on("escape", () => {
    if (!card.hidden) { hideCard(); return true; }
    if (!state.sel) return false;
    state.sel = null;
    app.requestDraw();
    return true;
  });

  app.ui.addMapToggle({
    id: "communes", group: "places", icon: "pedia", default: false,
    label: t("Communes & wards"),
    title: t("The 3,321 communes, wards and special zones, types as in the NSO register: borders when zoomed in, names when zoomed in close"),
    get: () => state.on,
    set: (v) => {
      state.on = !!v;
      if (state.on) load();
      else if (state.density) app.ui.setMapToggle("communes-density", false); // the density view is part of this layer
      app.requestDraw();
    },
  });
  app.ui.addMapToggle({
    id: "communes-density", group: "places", icon: "pop", default: false,
    label: t("Population density by commune"),
    title: t("Colours each commune, ward and special zone by people per km² (2025 population of the official merger map); grey: no checked figure"),
    get: () => state.density,
    set: (v) => {
      state.density = !!v;
      if (state.density) {
        if (!state.on) app.ui.setMapToggle("communes", true);
        load().then((m) => { if (m) densityPaths(m); legend(); app.requestDraw(); });
      } else legend();
      app.requestDraw();
    },
  });
  // --- density legend (under the lens legend) and the click card ------------------------------------------------
  const style = document.createElement("style");
  style.textContent = `
#cm-legend .lg-cat { cursor: default; }
#cm-card { position: fixed; z-index: 30; width: 290px; max-width: calc(100vw - 16px); padding: 9px 11px 10px; font-size: 12px; line-height: 1.45; }
#cm-card .cm-x { position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; }
#cm-card h3 { margin: 0 26px 2px 0; font-family: var(--serif); color: var(--gold-bright); font-size: 15px; font-weight: 600; }
#cm-card .cm-top { margin: 6px 0 0; padding: 0; list-style: none; }
#cm-card .cm-top button { display: flex; width: 100%; gap: 6px; padding: 2px 0; background: none; border: 0; color: var(--ink); font: inherit; text-align: left; cursor: pointer; }
#cm-card .cm-top button:hover, #cm-card .cm-top button:focus-visible { color: var(--gold-bright); }
#cm-card .cm-top span:first-child { flex: 1; }
#cm-card .cm-sub { margin-top: 7px; color: var(--ink-dim); font-size: 11px; letter-spacing: .04em; }
#cm-card .cm-res { margin-top: 6px; }
#cm-card .cm-res a { color: var(--gold-bright); }
#cm-card .cm-open { margin-top: 8px; padding: 4px 9px; }
@media (max-width: 700px) { #cm-legend .lg-hint { display: none; } }
@media (max-width: 700px) { #cm-card { left: 8px !important; right: 8px; width: auto; top: auto !important; bottom: calc(var(--bottom-ui, 56px) + 8px); } }`;
  document.head.appendChild(style);

  const leg = document.createElement("div");
  leg.id = "cm-legend";
  leg.className = "panel legend";
  leg.hidden = true;
  leg.setAttribute("role", "group");
  leg.setAttribute("aria-label", t("Population density by commune"));
  document.getElementById("legend")?.after(leg);
  function legend() {
    const m = state.model;
    leg.hidden = !(state.density && m);
    if (leg.hidden) return;
    const n = m.stats?.count?.density ?? m.communes.filter((c) => c.density != null).length;
    const lo = [0, ...DENSITY_BREAKS.slice(0, -1)];
    const label = (k) => (k === DENSITY_BREAKS.length - 1 ? `≥ ${int(lo[k])}` : `${int(lo[k])}–${int(DENSITY_BREAKS[k])}`);
    leg.innerHTML = `<div class="lg-head"><span class="title">${esc(t("Population density by commune"))}</span></div>
      <div class="lg-cats">${DENSITY_FILL.map((f, k) => `<span class="lg-cat"><i style="background:${f}"></i>${esc(label(k))}</span>`).join("")}
        <span class="lg-cat"><i style="background:${NO_DATA_FILL}"></i>${esc(t("no figure"))}</span></div>
      <div class="lg-meta"><span>${esc(t("people/km²"))}</span><span>${esc(t("{n} of {total} units have a figure", { n: int(n), total: int(m.communes.length) }))}</span></div>
      <div class="lg-hint">${basisHtml(m)}</div>`;
  }

  const card = document.createElement("div");
  card.id = "cm-card";
  card.className = "panel";
  card.hidden = true;
  card.setAttribute("role", "dialog");
  document.body.appendChild(card);
  let cardAt = null;
  function hideCard() {
    if (card.hidden) return;
    card.hidden = true;
    cardAt = null;
  }
  function placeCard() {
    if (card.hidden || !cardAt) return;
    if (innerWidth <= 700) return; // phones: a bottom sheet (CSS)
    const a = app.visibleArea?.() || { x0: 0, y0: 0, x1: innerWidth, y1: innerHeight };
    const [sx, sy] = app.cam.toScreen(cardAt[0], cardAt[1]);
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let x = sx + 14;
    if (x + cw > a.x1 - 6) x = sx - 14 - cw;
    card.style.left = `${Math.round(Math.max(a.x0 + 6, Math.min(x, a.x1 - cw - 6)))}px`;
    card.style.top = `${Math.round(Math.max(a.y0 + 6, Math.min(sy - ch / 2, a.y1 - ch - 6)))}px`;
  }
  // The clicked commune (outlined), its figures, and the province's five largest communes by population.
  function showCard(c) {
    const m = state.model;
    state.sel = c;
    app.requestDraw();
    const top = m.communes.filter((x) => x.p === c.p && x.population != null).sort((a, b) => b.population - a.population).slice(0, 5);
    const si = app.w?.raw?.states?.findIndex((s) => s.abbr === c.p) ?? -1;
    card.innerHTML = `<button type="button" class="cm-x icon-btn" aria-label="${esc(t("Close"))}">✕</button>
      <h3>${esc(c.full)}</h3>
      <div class="muted">${esc(lang === "vi" ? provName(c.p) : `${t(KIND_EN[c.k])} · ${provName(c.p)}`)}</div>
      ${statsHtml(c)}
      ${top.length ? `<div class="cm-sub">${esc(t("Largest communes in {province} by population", { province: provName(c.p) }))}</div>
      <ol class="cm-top">${top.map((x) => `<li><button type="button" data-id="${esc(x.id)}"><span>${esc(x.full)}</span><span>${esc(int(x.population))}</span></button></li>`).join("")}</ol>` : ""}
      ${si >= 0 ? `<button type="button" class="btn cm-open">${esc(t("Open {province}", { province: provName(c.p) }))}</button>` : ""}
      ${resHtml(m, c)}
      <div style="margin-top:6px">${basisHtml(m)}</div>`;
    card.setAttribute("aria-label", c.full);
    card.hidden = false;
    cardAt = [c.x, c.y]; // beside the commune's label point
    placeCard();
    card.onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.classList.contains("cm-x")) hideCard();
      else if (b.classList.contains("cm-open")) { hideCard(); app.selectState(si, { fly: true }); }
      else if (b.dataset.id) { const x = m.byId.get(b.dataset.id); if (x) { pickCommune(x); showCard(x); } }
    };
  }
  app.on("camera", placeCard);
  app.on("mode", hideCard);

  // Close zoom: fetch the file ahead (so switching on, or searching, is instant).
  app.on("camera", (c) => { if (c.Rpx >= BORDER_MIN_RPX && !c.moving) load(); });

  // --- search ---------------------------------------------------------------------------------------------------
  function flyToBox(x0, y0, x1, y1, maxScale = 3) {
    if (!app.mode) app.clearSelection(); // a province panel left open would name the wrong place
    const pad = 0.6 * Math.max(x1 - x0, y1 - y0, 20);
    app.fitBounds(x0 - pad, y0 - pad, x1 + pad, y1 + pad, { maxScale });
  }
  function pickCommune(c) {
    state.sel = c;
    if (!state.on) app.ui.setMapToggle("communes", true);
    flyToBox(c.x0, c.y0, c.x1, c.y1, 6); // closer than towns: an inner-city ward is only 1–3 km across
  }

  let communesAdded = false;
  function addSearch() {
    if (communesAdded || !app.search?.addEntries || !state.model) return;
    communesAdded = true;
    app.search.addEntries(state.model.communes.map((c) => ({
      kind: "commune", name: c.full, label: c.full, // full name, so "Phường Bến Thành" matches as typed
      icon: "pedia", emoji: "📍", pop: c.population || 0, // the population column (blank when the figure is withheld)
      sub: lang === "vi" ? provName(c.p) : `${t(KIND_EN[c.k])} · ${provName(c.p)}`, pick: () => pickCommune(c),
    })));
  }

  if (app.search?.addEntries) {
    const spot = (x, y, r = 40) => () => flyToBox(x - r, y - r, x + r, y + r);
    app.loadData("places").then((d) => {
      if (!d) return;
      // Which province: the archipelago's owner, else the province of the hex the place stands on.
      const arch = new Map((d.archipelagos || []).map((a) => [a.id, a]));
      const provAt = (x, y) => { const i = app.w.grid.cellAt(x, y), o = i >= 0 ? app.w.raw.owner[i] : -1; return o >= 0 ? app.w.raw.states[o]?.name || "" : ""; };
      const where = (p) => { const a = arch.get(p.group); return a ? `${a.name}, ${a.owner}` : provAt(p.x, p.y); };
      const sub = (kind, p) => [t(kind), where(p)].filter(Boolean).join(" · ");
      app.search.addEntries([
        ...(d.towns || []).map((p) => ({ kind: "town", name: p.name, label: p.name, icon: "pop", emoji: "🏘️", pop: p.population || 0,
          sub: sub("Town", p), pick: spot(p.x, p.y) })),
        ...(d.islands || []).map((p) => ({ kind: "island", name: p.name, label: p.name, icon: "terrain", emoji: "🏝️", pop: 0,
          sub: sub("Island", p), pick: spot(p.x, p.y) })),
      ]);
    });
    app.loadData("infrastructure").then((d) => {
      if (!d?.airports) return;
      app.search.addEntries(d.airports.filter((a) => a.x != null).map((a) => ({
        kind: "airport", name: airportName(a.name), label: airportName(a.name), icon: "t-airport", emoji: "✈️", pop: 0,
        sub: `${a.id} · ${provName(a.state)}`, pick: spot(a.x, a.y, 30),
      })));
    });
    app.loadData("wonders").then((d) => {
      if (!d?.wonders) return;
      app.search.addEntries(d.wonders.filter((x) => x.x != null).map((x) => ({
        kind: "wonder", name: x.name, label: x.name, icon: "w-landmark", emoji: "🏛️", pop: 0,
        sub: [x.short !== x.name ? x.short : "", provName(x.state)].filter(Boolean).join(" · "), pick: spot(x.x, x.y, 30),
      })));
    });
    // Communes load on the first search (a 0.4 MB file), not at startup.
    document.getElementById("search-input")?.addEventListener("focus", load, { once: true });
  }

  app.communes = { state, load }; // debugging
}
