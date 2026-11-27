// Communes, wards and special zones (xã, phường, đặc khu) of the two-tier local government from 1 July 2025
// (communes.json, lazy). A static layer draws their borders (thin, from close zoom) and names (closer still, no
// overlaps); hovering shows name, kind, province and area; a search pick flies to one and outlines it.
// Search: adds communes, towns and islands (places.json) and wonders (wonders.json) to the top-bar search through
// app.search.addEntries(entries) when main provides it (see the stream report for the proposed hook).
import { t, lang } from "../../i18n.js";
import { esc, fixed } from "../../format.js";

const KIND_EN = ["Commune", "Ward", "Special zone"];
const BORDER_MIN_RPX = 12; // hex radius in css px from which borders are drawn (communes are ~2 hexes across)
const NAME_MIN_RPX = 34;   // ... and names
const STYLE = { under: "#fff8e666", line: "#2b2116c0", sel: "#d6202f", name: "#3a2e20", halo: "#fff8e6e0" };
const SANS = '-apple-system, "Segoe UI", system-ui, sans-serif';

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
  const communes = d.communes.map((c) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const ring of c.r) for (const r of ring) {
      const a = arcs[r < 0 ? ~r : r];
      if (a.x0 < x0) x0 = a.x0; if (a.x1 > x1) x1 = a.x1;
      if (a.y0 < y0) y0 = a.y0; if (a.y1 > y1) y1 = a.y1;
    }
    return { ...c, x0, y0, x1, y1, full: `${d.kinds[c.k]} ${c.n}` };
  });
  return { arcs, communes, byId: new Map(communes.map((c) => [c.id, c])) };
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

// --- install --------------------------------------------------------------------------------------------------

export function install(app) {
  const state = { on: false, model: null, loading: null, sel: null };
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
    hit(x, y) {
      const m = state.model;
      if (!m) return null;
      for (const c of m.communes) if (x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1 && contains(m, c, x, y)) return c;
      return null;
    },
    tooltip(c) {
      return `<b>${esc(c.full)}</b><br>${esc(lang === "vi" ? provName(c.p) : `${t(KIND_EN[c.k])} · ${provName(c.p)}`)}<br>`
        + `${esc(t("Area"))}: ${esc(fixed(c.a, c.a < 10 ? 1 : 0))} km²<br>`
        + `<span class="muted">${esc(t("Units of 1 July 2025 (two-tier local government); outlines from the official reference map (sapnhap.bando.com.vn)."))}</span>`;
    },
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
    if (!state.sel) return false;
    state.sel = null;
    app.requestDraw();
    return true;
  });

  app.ui.addMapToggle({
    id: "communes", group: "places", icon: "pedia", default: false,
    label: t("Communes & wards"),
    title: t("The 3,321 communes, wards and special zones of 1 July 2025: borders when zoomed in, names when zoomed in close"),
    get: () => state.on,
    set: (v) => {
      state.on = !!v;
      if (state.on) load();
      app.requestDraw();
    },
  });
  // Close zoom: fetch the file ahead (so switching on, or searching, is instant).
  app.on("camera", (c) => { if (c.Rpx >= BORDER_MIN_RPX && !c.moving) load(); });

  // --- search ---------------------------------------------------------------------------------------------------
  function flyToBox(x0, y0, x1, y1, maxScale = 3) {
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
      kind: "commune", name: c.full, label: c.full, // full name, so "Phường Bến Thành" matches as typed icon: "pedia", emoji: "📍", pop: 0,
      sub: lang === "vi" ? provName(c.p) : `${t(KIND_EN[c.k])} · ${provName(c.p)}`, pick: () => pickCommune(c),
    })));
  }

  if (app.search?.addEntries) {
    const spot = (x, y, r = 40) => () => flyToBox(x - r, y - r, x + r, y + r);
    app.loadData("places").then((d) => {
      if (!d) return;
      app.search.addEntries([
        ...(d.towns || []).map((p) => ({ kind: "town", name: p.name, label: p.name, icon: "pop", emoji: "🏘️", pop: p.population || 0,
          sub: t("Town"), pick: spot(p.x, p.y) })),
        ...(d.islands || []).map((p) => ({ kind: "island", name: p.name, label: p.name, icon: "terrain", emoji: "🏝️", pop: 0,
          sub: t("Island"), pick: spot(p.x, p.y) })),
      ]);
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
