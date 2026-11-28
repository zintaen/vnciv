// Physical and cultural geography (stream geo): river names along the rivers, mountain peaks, mountain passes, lakes
// & dams, border gates, industrial parks, craft villages, historic battle sites and festivals. Each is a static layer
// in the cached map with a switch in "Show on the map", a hover tip with its source, and search entries.
// Rivers: the lines are world.json's (drawn by the base map); geo_rivers.json (small, loaded at start) names them
// and the browser joins a river's segments. Everything else is in geo.json, loaded when a switch turns on or the
// search box is first focused.
import { t, lang } from "../../i18n.js";
import { esc, fixed, int } from "../../format.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SERIF = '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';
const SANS = '-apple-system, "Segoe UI", system-ui, sans-serif';
const muted = (s) => `<span class="muted">${s}</span>`;
const OSM = "OpenStreetMap (ODbL); coverage depends on volunteer mappers.";

// --- rivers ------------------------------------------------------------------------------------------------------

// Zoom (hex radius in css px) from which a river's name shows, by the base map's width rank (4 = 400 km+ drawn).
const RIVER_RPX = { 4: 2, 6: 5, 8: 8 };

// Join one river's segments ([x, y, x, y, …] each) into runs by matching end points; → [{pts, len, box}] longest first.
function chain(segs) {
  const near = (a, b) => Math.abs(a[0] - b[0]) < 0.6 && Math.abs(a[1] - b[1]) < 0.6;
  const rest = segs.map((p) => { const q = []; for (let i = 0; i < p.length; i += 2) q.push([p[i], p[i + 1]]); return q; });
  const runs = [];
  while (rest.length) {
    let run = rest.pop(), grew = true;
    while (grew) {
      grew = false;
      for (let k = 0; k < rest.length; k++) {
        const s = rest[k], a = run[0], b = run[run.length - 1];
        if (near(b, s[0])) run = run.concat(s.slice(1));
        else if (near(b, s[s.length - 1])) run = run.concat(s.slice(0, -1).reverse());
        else if (near(a, s[s.length - 1])) run = s.slice(0, -1).concat(run);
        else if (near(a, s[0])) run = s.slice(1).reverse().concat(run);
        else continue;
        rest.splice(k, 1); grew = true; break;
      }
    }
    let len = 0;
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    run.forEach((p, i) => {
      if (i) len += Math.hypot(p[0] - run[i - 1][0], p[1] - run[i - 1][1]);
      box[0] = Math.min(box[0], p[0]); box[1] = Math.min(box[1], p[1]); box[2] = Math.max(box[2], p[0]); box[3] = Math.max(box[3], p[1]);
    });
    runs.push({ pts: run, len, box });
  }
  return runs.sort((a, b) => b.len - a.len);
}

function riverModel(world, meta) {
  const by = new Map(meta.rivers.map((r) => [r.name, { ...r, segs: [], rank: 9 }]));
  for (const s of world.rivers || []) {
    const r = by.get(s.name);
    if (r) { r.segs.push(s.pts); r.rank = Math.min(r.rank, s.rank); }
  }
  const out = [];
  for (const r of by.values()) {
    if (!r.segs.length) continue;
    r.runs = chain(r.segs);
    r.box = r.runs.reduce((b, u) => [Math.min(b[0], u.box[0]), Math.min(b[1], u.box[1]), Math.max(b[2], u.box[2]), Math.max(b[3], u.box[3])],
      [Infinity, Infinity, -Infinity, -Infinity]);
    out.push(r);
  }
  return out.sort((a, b) => a.rank - b.rank || b.drawn_km - a.drawn_km);
}

const riverLabel = (r) => (lang === "vi" || !r.en ? r.label : r.en);

// Text along a screen-space polyline, centred at arc length `at`; null when the line bends too much under it.
function placeAlong(ctx, P, cum, at, text, px) {
  const w = ctx.measureText(text).width;
  const a0 = at - w / 2, a1 = at + w / 2;
  if (a0 < 0 || a1 > cum[cum.length - 1]) return null;
  const pos = (s) => {
    let k = 1;
    while (k < cum.length - 1 && cum[k] < s) k++;
    const f = (s - cum[k - 1]) / (cum[k] - cum[k - 1] || 1);
    const [x0, y0] = P[k - 1], [x1, y1] = P[k];
    return [x0 + f * (x1 - x0), y0 + f * (y1 - y0), Math.atan2(y1 - y0, x1 - x0)];
  };
  const s = pos(a0), e = pos(a1);
  const flip = e[0] < s[0]; // read left to right
  const glyphs = [];
  let prev = null, bend = 0;
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  let acc = 0;
  for (const ch of text) {
    const cw = ctx.measureText(ch).width;
    const sAt = flip ? a1 - acc - cw / 2 : a0 + acc + cw / 2;
    const [x, y] = pos(sAt);
    const a = pos(Math.max(0, sAt - px)), b = pos(Math.min(cum[cum.length - 1], sAt + px)); // smooth over corners
    const ang0 = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const ang = flip ? ang0 + Math.PI : ang0;
    if (prev !== null) {
      let d = Math.abs(ang - prev);
      if (d > Math.PI) d = 2 * Math.PI - d;
      bend += d;
      if (d > 0.5 || bend > 1.4) return null;
    }
    prev = ang;
    glyphs.push([ch, x, y, ang]);
    box[0] = Math.min(box[0], x - px); box[1] = Math.min(box[1], y - px); box[2] = Math.max(box[2], x + px); box[3] = Math.max(box[3], y + px);
    acc += cw;
  }
  return { glyphs, box };
}

function riversLayer(app, st) {
  return {
    id: "geo-river-names", z: 88,
    visible: () => st.on.rivers && !!st.rivers,
    sig: () => "r1",
    draw(ctx, vp, w, o) {
      const t0 = performance.now();
      o.screen();
      const W = ctx.canvas.width / (o.dpr || 1), H = ctx.canvas.height / (o.dpr || 1);
      const placed = boxes(st, vp);
      const free = (b) => !placed.some((p) => b[0] < p[2] && p[0] < b[2] && b[1] < p[3] && p[1] < b[3]);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      for (const r of st.rivers) {
        if (o.Rpx < (RIVER_RPX[r.rank] ?? 12)) continue;
        if (r.box[2] < vp.x0 || r.box[0] > vp.x1 || r.box[3] < vp.y0 || r.box[1] > vp.y1) continue;
        const text = riverLabel(r);
        const px = r.rank <= 4 ? clamp(o.Rpx * 0.9, 12, 18) : clamp(o.Rpx * 0.75, 11, 15);
        ctx.font = `italic 600 ${px}px ${SERIF}`;
        const tw = ctx.measureText(text).width;
        for (const run of r.runs) {
          if (run.len * o.s < tw * 1.4) continue;
          if (run.box[2] < vp.x0 || run.box[0] > vp.x1 || run.box[3] < vp.y0 || run.box[1] > vp.y1) continue;
          const P = run.pts.map(([x, y]) => o.toScreen(x, y));
          const cum = [0];
          for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
          const L = cum[cum.length - 1];
          const gap = Math.max(tw * 4, 520);
          const n = Math.max(1, Math.floor(L / gap));
          for (let k = 0; k < n; k++) {
            // try the slot's centre, then a little either side, until one is straight enough and free
            for (const off of [0, 0.18, -0.18, 0.34, -0.34]) {
              const at = ((k + 0.5 + off) * L) / n;
              const pl = placeAlong(ctx, P, cum, at, text, px * 0.62);
              if (!pl) continue;
              const b = pl.box, mid = pl.glyphs[pl.glyphs.length >> 1];
              if (!inVietnam(app, mid[1] / o.s + vp.x0, mid[2] / o.s + vp.y0)) continue; // label the river in Vietnam
              if (b[2] < 0 || b[0] > W || b[3] < 0 || b[1] > H || !free(b)) continue;
              placed.push(b);
              for (const [ch, x, y, ang] of pl.glyphs) {
                ctx.save();
                ctx.translate(x, y);
                ctx.rotate(ang);
                ctx.strokeStyle = "rgba(240,250,255,.9)";
                ctx.lineWidth = 3;
                ctx.strokeText(ch, 0, 0);
                ctx.fillStyle = "#1b5a86";
                ctx.fillText(ch, 0, 0);
                ctx.restore();
              }
              break;
            }
          }
        }
      }
      o.world();
      st.ms.rivers = performance.now() - t0;
    },
    hit(x, y, Rpx) {
      if (!st.rivers) return null;
      const s = Rpx / app.w.grid.R, tol = (6 / s) ** 2;
      for (const r of st.rivers) {
        if (Rpx < (RIVER_RPX[r.rank] ?? 12)) continue;
        if (x < r.box[0] - 30 || x > r.box[2] + 30 || y < r.box[1] - 30 || y > r.box[3] + 30) continue;
        for (const run of r.runs) for (let i = 1; i < run.pts.length; i++) {
          if (segDist2(x, y, ...run.pts[i - 1], ...run.pts[i]) <= tol) return { kind: "river", r };
        }
      }
      return null;
    },
    tooltip: (it) => riverTip(it.r),
  };
}

// True when world point (x, y) is on a Vietnamese hex (land of one of the 34 provinces).
function inVietnam(app, x, y) {
  const i = app.w.grid.cellAt(x, y);
  return i >= 0 && app.w.raw.owner[i] >= 0;
}

// Label boxes (screen px) shared by the geo layers in one cache render (vp is per render): names never overlap.
function boxes(st, vp) {
  if (st.vp !== vp) { st.vp = vp; st.boxes = []; }
  return st.boxes;
}

function segDist2(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy;
  const u = l ? clamp(((px - x1) * dx + (py - y1) * dy) / l, 0, 1) : 0;
  return (px - x1 - u * dx) ** 2 + (py - y1 - u * dy) ** 2;
}

function riverTip(r) {
  const head = lang !== "vi" && r.en ? `<b>${esc(r.en)}</b> ${muted(esc(r.label))}` : `<b>${esc(r.label)}</b>`;
  const lines = [head, esc(t("River"))];
  if (r.km) lines.push(t("Length {n} km (whole river, Wikidata)", { n: int(r.km) }));
  if (r.basin_km2) lines.push(t("Basin {n} km² (Wikidata)", { n: int(r.basin_km2) }));
  lines.push(t("{n} km drawn on this map", { n: int(r.drawn_km) }));
  lines.push(muted(esc(t("Line: OpenStreetMap (ODbL), Natural Earth outside Vietnam; length and basin: Wikidata (CC0)."))));
  return lines.join("<br>");
}

// --- point layers -------------------------------------------------------------------------------------------------

const GATE_CLASS = { intl: "International border gate", main: "Main border gate", minor: "Secondary border gate" };
const LAKE_KIND = { reservoir: "Reservoir", lake: "Lake", lagoon: "Lagoon" };

// One per switch. key = geo.json list; minRpx: glyphs from this zoom; labelRpx: names from this zoom (per row via fn).
const KINDS = [
  { id: "peaks", key: "peaks", group: "geography", label: "Mountain peaks", icon: "terrain", z: 66,
    title: "Named peaks of 1,500 m or more mapped in OpenStreetMap, with their heights, and notable lower mountains",
    color: "#7a4b25", glyph: "peak", minRpx: (r) => (r.ele >= 2800 ? 2.5 : r.ele >= 2000 ? 5 : 8), labelRpx: (r) => (r.ele >= 2800 ? 7 : r.ele >= 2000 ? 11 : 16) },
  { id: "passes", key: "passes", group: "geography", label: "Mountain passes", icon: "t-road", z: 66,
    title: "Mountain passes (đèo) mapped in OpenStreetMap",
    color: "#8a5a2b", glyph: "pass", minRpx: () => 5, labelRpx: () => 15 },
  { id: "lakes", key: "lakes", also: "dams", group: "geography", label: "Lakes & dams", icon: "r-hydro", z: 65,
    title: "Named lakes and reservoirs of 1 km² or more, and dams with their hydropower capacity, mapped in OpenStreetMap",
    color: "#2a7fb8", glyph: "drop", minRpx: (r) => (r.km2 >= 50 || r.mw >= 300 ? 2.5 : r.km2 >= 10 || r.mw >= 100 ? 5 : 9),
    labelRpx: (r) => (r.km2 >= 50 || r.mw >= 300 ? 10 : r.km2 >= 5 || r.mw >= 50 ? 16 : 24) },
  { id: "gates", key: "gates", group: "transport", label: "Border gates", icon: "t-road", z: 67,
    title: "Border crossings (cửa khẩu) mapped in OpenStreetMap, with the class given in their name",
    color: "#b23a48", glyph: "gate", minRpx: (r) => (r.cls === "intl" ? 2.5 : 6), labelRpx: (r) => (r.cls === "intl" ? 10 : 14) },
  { id: "parks", key: "parks", group: "economy", label: "Industrial parks", icon: "d-industrial-zone", z: 64,
    title: "Industrial parks (khu công nghiệp) of 20 ha or more mapped in OpenStreetMap",
    color: "#5d5f8f", glyph: "factory", minRpx: (r) => (r.ha >= 500 ? 4 : 7), labelRpx: (r) => (r.ha >= 500 ? 16 : 24) },
  { id: "crafts", key: "crafts", group: "culture", label: "Craft villages", icon: "w-landmark", z: 64,
    title: "Craft villages (làng nghề) named as such in OpenStreetMap",
    color: "#b5651d", glyph: "pot", minRpx: () => 5, labelRpx: () => 18 },
  { id: "battles", key: "battles", group: "history", label: "Battle sites", icon: "m-army", z: 67,
    title: "Battles fought in Vietnam with their own coordinates in Wikidata and articles in several Wikipedia languages",
    color: "#7d1f1f", glyph: "swords", minRpx: (r) => (r.sl >= 15 ? 2.5 : 5), labelRpx: (r) => (r.sl >= 15 ? 9 : 14) },
  { id: "festivals", key: "festivals", group: "culture", label: "Festivals", icon: "l-faith-tradition", z: 66,
    title: "Traditional festivals with their lunar start date, from the Vietnamese Wikipedia list of festivals",
    color: "#c0392b", glyph: "lantern", minRpx: () => 3, labelRpx: () => 12 },
];

function glyph(ctx, g, s) {
  ctx.save();
  ctx.scale(s / 20, s / 20);
  ctx.fillStyle = ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.2;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.beginPath();
  switch (g) {
    case "pass": // a road crossing a saddle
      ctx.moveTo(-8, 4); ctx.quadraticCurveTo(-4, -6, 0, -1); ctx.quadraticCurveTo(4, -6, 8, 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 7); ctx.lineTo(0, -1); ctx.stroke(); break;
    case "drop":
      ctx.moveTo(0, -7); ctx.bezierCurveTo(5, -1, 6, 2, 5, 4); ctx.arc(0, 3, 5, 0.2, Math.PI - 0.2); ctx.bezierCurveTo(-6, 2, -5, -1, 0, -7); ctx.fill(); break;
    case "gate":
      ctx.fillRect(-7, -6, 2.4, 13); ctx.fillRect(4.6, -6, 2.4, 13); ctx.fillRect(-7, -6, 14, 2.6); ctx.fillRect(-4, -1, 8, 1.8); break;
    case "factory":
      ctx.moveTo(-8, 7); ctx.lineTo(-8, -1); ctx.lineTo(-3, 2); ctx.lineTo(-3, -1); ctx.lineTo(2, 2); ctx.lineTo(2, -7); ctx.lineTo(6, -7);
      ctx.lineTo(6, 7); ctx.closePath(); ctx.fill(); break;
    case "pot":
      ctx.moveTo(-3, -6); ctx.lineTo(3, -6); ctx.lineTo(2, -3); ctx.bezierCurveTo(8, -1, 8, 6, 3, 7); ctx.lineTo(-3, 7);
      ctx.bezierCurveTo(-8, 6, -8, -1, -2, -3); ctx.closePath(); ctx.fill(); break;
    case "swords":
      ctx.moveTo(-6, -6); ctx.lineTo(6, 6); ctx.moveTo(6, -6); ctx.lineTo(-6, 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6, 2); ctx.lineTo(-2, 6); ctx.moveTo(6, 2); ctx.lineTo(2, 6); ctx.stroke(); break;
    case "lantern":
      ctx.ellipse(0, 1, 5, 5.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(-3, -7, 6, 2); ctx.fillRect(-0.8, 6, 1.6, 2.5); break;
  }
  ctx.restore();
}

function paint(ctx, k, s) {
  if (k.glyph === "peak") { // a brown triangle with a snow cap, not a disc
    ctx.beginPath(); ctx.moveTo(0, -s * 0.5); ctx.lineTo(s * 0.55, s * 0.4); ctx.lineTo(-s * 0.55, s * 0.4); ctx.closePath();
    ctx.fillStyle = k.color; ctx.fill();
    ctx.lineWidth = Math.max(1, s * 0.08); ctx.strokeStyle = "rgba(255,250,236,.95)"; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -s * 0.5); ctx.lineTo(s * 0.2, -s * 0.18); ctx.lineTo(-s * 0.2, -s * 0.18); ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill();
    return;
  }
  ctx.beginPath(); ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
  ctx.fillStyle = k.color; ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.09); ctx.strokeStyle = "rgba(255,250,236,.95)"; ctx.stroke();
  if (s >= 9) glyph(ctx, k.glyph, s * 0.8);
}

const sprites = new Map();
function stamp(ctx, k, x, y, s, dpr) {
  const sz = Math.round(s * 2) / 2, key = `${k.id}|${sz}|${dpr}`;
  let c = sprites.get(key);
  if (!c) {
    c = document.createElement("canvas");
    c.width = c.height = Math.ceil((sz + 4) * dpr);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    g.translate((sz + 4) / 2, (sz + 4) / 2);
    paint(g, k, sz);
    if (sprites.size > 300) sprites.clear();
    sprites.set(key, c);
  }
  ctx.drawImage(c, x - (sz + 4) / 2, y - (sz + 4) / 2, sz + 4, sz + 4);
}

function rowsOf(d, k) {
  if (!d) return [];
  if (!k._rows || k._d !== d) { // lakes and dams share one switch: biggest first, so the declutter keeps them
    k._d = d;
    k._rows = k.also ? [...d[k.key], ...d[k.also].map((r) => ({ ...r, dam: true }))]
      .sort((a, b) => Math.max(b.km2 || 0, (b.mw || 0) / 10) - Math.max(a.km2 || 0, (a.mw || 0) / 10)) : d[k.key];
  }
  return k._rows;
}

function label(k, r) {
  if (k.id === "peaks") return `${r.n} ${int(r.ele)} m`;
  if (k.id === "battles") return lang !== "vi" && r.en ? r.en : r.n;
  return r.n;
}

function pointLayer(app, k, st) {
  let drawn = [];
  return {
    id: `geo-${k.id}`, z: k.z, minRpx: 2.5,
    visible: () => !!st.on[k.id] && !!st.geo,
    sig: () => "g1",
    draw(ctx, vp, w, o) {
      const t0 = performance.now();
      const s = o.s, size = clamp(o.Rpx * 0.6, 12, 20);
      const gap = size * (o.Rpx < 8 ? 1.8 : 1.2), gap2 = gap * gap;
      const pad = (gap + size) / s;
      const grid = new Map(), labels = boxes(st, vp);
      const near = (gx, gy, px, py) => {
        for (let i = gx - 1; i <= gx + 1; i++) for (let j = gy - 1; j <= gy + 1; j++) {
          for (const q of grid.get(i * 100003 + j) || []) if ((q[0] - px) ** 2 + (q[1] - py) ** 2 < gap2) return true;
        }
        return false;
      };
      drawn = [];
      o.screen();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      for (const r of rowsOf(st.geo, k)) {
        if (r.x < vp.x0 - pad || r.x > vp.x1 + pad || r.y < vp.y0 - pad || r.y > vp.y1 + pad) continue;
        if (o.Rpx < k.minRpx(r)) continue;
        const px = r.x * s, py = r.y * s, gx = Math.floor(px / gap), gy = Math.floor(py / gap);
        if (near(gx, gy, px, py)) continue;
        const key = gx * 100003 + gy;
        (grid.get(key) || grid.set(key, []).get(key)).push([px, py]);
        const [sx, sy] = o.toScreen(r.x, r.y);
        stamp(ctx, r.dam ? DAM : k, sx, sy, size, o.dpr || 1);
        drawn.push({ k, r, x: r.x, y: r.y, rad: (size / 2 + 2) / s });
        if (o.Rpx >= k.labelRpx(r)) {
          const text = label(k, r), fs = clamp(o.Rpx * 0.45, 10, 13);
          ctx.font = `600 ${fs}px ${k.id === "peaks" ? SERIF : SANS}`;
          const tw = ctx.measureText(text).width, ly = sy + size / 2 + fs * 0.75;
          const b = [sx - tw / 2 - 2, ly - fs * 0.6, sx + tw / 2 + 2, ly + fs * 0.6];
          if (labels.some((p) => b[0] < p[2] && p[0] < b[2] && b[1] < p[3] && p[1] < b[3])) continue;
          labels.push(b);
          ctx.strokeStyle = "rgba(255,248,230,.9)"; ctx.lineWidth = 3; ctx.strokeText(text, sx, ly);
          ctx.fillStyle = "#2b2116"; ctx.fillText(text, sx, ly);
        }
      }
      o.world();
      st.ms[k.id] = performance.now() - t0;
    },
    hit(x, y) {
      let best = null, bd = Infinity;
      for (const it of drawn) {
        const dd = (it.x - x) ** 2 + (it.y - y) ** 2;
        if (dd <= it.rad * it.rad && dd < bd) { best = it; bd = dd; }
      }
      return best;
    },
    tooltip: (it) => tip(app, it.k, it.r),
    click(it) { app.flyTo(it.x, it.y, Math.max(app.cam.scale, 22 / app.w.grid.R), 700); return true; },
  };
}
const DAM = { id: "dam", color: "#1f5f8b", glyph: "gate" };

// --- tips ---------------------------------------------------------------------------------------------------------

const provName = (app, p) => app.data.world?.states?.[p]?.name || "";

function lunarDate(r) {
  return t("Starts on day {d} of lunar month {m}", { d: r.day, m: r.month });
}

function tip(app, k, r) {
  const place = muted(esc(provName(app, r.p)));
  const lines = [];
  let name = r.n, kind = "", src = t(OSM);
  if (k.id === "peaks") {
    kind = t(r.kind === "volcano" ? "Volcano" : "Mountain peak");
    lines.push(t("Height {n} m", { n: int(r.ele) }));
    if (lang !== "vi" && r.en) lines.push(muted(esc(r.en)));
  } else if (k.id === "passes") {
    kind = t("Mountain pass");
    if (r.ele) lines.push(t("Height {n} m", { n: int(r.ele) }));
    if (r.how === "road") lines.push(muted(esc(t("Marked at the middle of the mapped pass road, not necessarily its summit."))));
  } else if (k.id === "lakes" && r.dam) {
    kind = t(r.how === "plant" ? "Hydropower plant" : "Dam");
    if (r.mw) lines.push(t("Hydropower capacity {n} MW", { n: int(r.mw) }));
    if (r.plant && r.plant !== r.n) lines.push(esc(r.plant));
  } else if (k.id === "lakes") {
    kind = t(LAKE_KIND[r.kind] || "Lake");
    lines.push(t("Mapped area {n} km²", { n: r.km2 >= 100 ? int(r.km2) : fixed(r.km2, 1) }));
    if (r.vol_m3) lines.push(t("Capacity {n} million m³", { n: int(r.vol_m3 / 1e6) }));
  } else if (k.id === "gates") {
    kind = t(GATE_CLASS[r.cls] || "Border gate");
    if (!r.cls) lines.push(muted(esc(t("Class not given in the mapped name"))));
  } else if (k.id === "parks") {
    kind = t("Industrial park");
    lines.push(t("Mapped area {n} ha", { n: int(r.ha) }));
  } else if (k.id === "crafts") {
    kind = t("Craft village");
  } else if (k.id === "battles") {
    kind = t("Battle");
    if (lang !== "vi" && r.en) name = r.en;
    if (r.year != null) lines.push(r.year < 0 ? t("{n} BC", { n: -r.year }) : t("Year {n}", { n: r.year }));
    lines.push(t("Articles in {n} Wikipedia languages", { n: r.sl }));
    src = t("Wikidata (CC0).");
  } else if (k.id === "festivals") {
    kind = t("Festival");
    lines.push(esc(lunarDate(r)));
    lines.push(esc(r.place));
    src = t({
      wikidata: "Vietnamese Wikipedia list of festivals (CC BY-SA); position from the linked article's Wikidata item (CC0).",
      place: "Vietnamese Wikipedia list of festivals (CC BY-SA); approximate position: the place named in the list.",
    }[r.pos] || "Vietnamese Wikipedia list of festivals (CC BY-SA); position from the linked article.");
  }
  return [`<b>${esc(name)}</b> ${place}`, esc(kind), ...lines, muted(esc(src))].join("<br>");
}

// --- install ------------------------------------------------------------------------------------------------------

export function install(app) {
  const st = { on: { rivers: true }, rivers: null, geo: null, ms: {} };
  for (const k of KINDS) st.on[k.id] = false;
  let asked = null;
  const loadGeo = () => (asked ??= app.loadData("geo").then((d) => {
    if (d) { st.geo = d; addSearch(d); app.requestDraw(); }
    return d;
  }, (err) => { console.warn("geo: geo.json failed to load", err); return null; }));

  app.registerStaticLayer(riversLayer(app, st));
  for (const k of KINDS) app.registerStaticLayer(pointLayer(app, k, st));

  app.ui.addMapToggle({
    id: "rivers", group: "geography", icon: "l-wave", default: true, label: t("Rivers"),
    title: t("Names of the main rivers along their course (OpenStreetMap; lengths from Wikidata)"),
    get: () => st.on.rivers,
    set: (v) => { st.on.rivers = !!v; app.requestDraw(); },
  });
  for (const k of KINDS) {
    app.ui.addMapToggle({
      id: k.id, group: k.group, icon: k.icon, default: false, label: t(k.label), title: t(k.title),
      get: () => st.on[k.id],
      set: (v) => { st.on[k.id] = !!v; if (v) loadGeo(); app.requestDraw(); },
    });
    if (st.on[k.id]) loadGeo(); // switched on from the URL hash
  }

  const fly = (x0, y0, x1, y1, maxScale = 3) => {
    if (!app.mode) app.clearSelection?.();
    const pad = 0.4 * Math.max(x1 - x0, y1 - y0, 60);
    app.fitBounds(x0 - pad, y0 - pad, x1 + pad, y1 + pad, { maxScale });
  };
  const switchOn = (id) => { if (!st.on[id]) app.ui.setMapToggle(id, true); };

  app.loadData("geo_rivers").then((meta) => {
    if (!meta?.rivers || !app.data.world) return;
    st.rivers = riverModel(app.data.world, meta);
    app.requestDraw();
    app.search?.addEntries?.(st.rivers.map((r) => {
      const main = r.runs[0];
      return {
        kind: "river", name: r.label, label: riverLabel(r), icon: "l-wave", emoji: "🌊", pop: 0,
        sub: [t("River"), lang !== "vi" && r.en ? r.label : r.en].filter(Boolean).join(" · "),
        line: main.pts.map(([x, y]) => [x, y]),
        pick: () => { switchOn("rivers"); fly(...r.box, 4); },
      };
    }));
  }, (err) => console.warn("geo: geo_rivers.json failed to load", err));

  let searchAdded = false;
  function addSearch(d) {
    if (searchAdded || !app.search?.addEntries) return;
    searchAdded = true;
    const out = [];
    for (const k of KINDS) {
      for (const r of rowsOf(d, k)) {
        const kind = r.dam ? (r.how === "plant" ? "Hydropower plant" : "Dam") : k.id === "lakes" ? (LAKE_KIND[r.kind] || "Lake")
          : k.id === "gates" ? (GATE_CLASS[r.cls] || "Border gate") : KIND_ONE[k.id];
        const extra = k.id === "peaks" ? `${int(r.ele)} m` : k.id === "festivals" ? lunarDate(r) : k.id === "battles" && r.year != null ? String(r.year) : "";
        out.push({
          kind: `geo-${k.id}`, name: k.id === "battles" && lang !== "vi" && r.en ? r.en : r.n, icon: k.icon, pop: 0,
          sub: [t(kind), extra, provName(app, r.p), k.id !== "battles" && r.en].filter(Boolean).join(" · "), // en: "Fansipan" finds it
          at: { x: r.x, y: r.y },
          pick: () => { switchOn(k.id); fly(r.x - 40, r.y - 40, r.x + 40, r.y + 40); },
        });
      }
    }
    app.search.addEntries(out);
  }
  // geo.json loads on the first search (so its places are findable) or when a switch turns on.
  document.getElementById("search-input")?.addEventListener("focus", loadGeo, { once: true });

  app.geo = { st, loadGeo, kinds: KINDS }; // debugging and tests
}

const KIND_ONE = { peaks: "Mountain peak", passes: "Mountain pass", parks: "Industrial park", crafts: "Craft village",
  battles: "Battle", festivals: "Festival" };
