// Land-tile art: a painterly texture over the flat tile colours, then per-cell "stamps" for land cover (forests,
// rice paddies, pasture, grass, scrub, marsh, suburbs, barren rock, ice) and relief (rolling hills, mountain ranges,
// peaks), combined sensibly (forested hills, terraced slopes...), with Vietnamese countryside motifs on farmed land.
//
// Interface (used by render/map.js, ext/living and web/dev/gallery.js):
//
//   drawTerrainGlyphs(ctx, cells, w, {Rpx, s, lod, bridges})
//     ctx    2D context in WORLD transform (map units; s css px per unit already applied, dpr included)
//     cells  iterable of cell indices to decorate (water cells are skipped; pass every visible cell)
//     w      prepared world (world.js prepareWorld) or anything with the same fields:
//              grid {R, cols, rows, size, cx(i), cy(i), corners, neighbour(i, d)}, cover[], relief[], water[],
//              pct? {forest[], crop[], ...}, raw.elev[], raw.owner[], raw.margin, cityByCell: Map<cell, city>,
//              coverRGB? [id] → [r, g, b]
//     Rpx    hex radius in css px (grid.R * s)
//     s      css px per map unit
//     lod    "far" | "mid" | "near" | "close" (render/art/lod.js lodFor(Rpx)); optional
//     bridges  join relief across neighbouring hexes (default: on, except when `cells` is a single cell)
//   fieldArt(w, i) → "paddy" | "terrace" | "rows": the field art of a cropland hex; isFieldCell(w, i, Rpx): drawn as
//   a field tile; pondSpot(w, i): where a delta hex's pond sits (ext/hexlife)
//   STAMP_KIND: sprite canvas → stamp name (ext/living/sway.js, ext/hexlife)
//
//   Cells under a full city tile are skipped (render/art/city.js draws them); a city drawn as a dot keeps its
//   relief. Foreign land (owner -2) is painted at 40% opacity ("fog of war").
//
// How it is drawn (fast enough to re-render the static layer on every zoom settle):
//   1. Texture: one world-anchored repeating pattern per texture family (grass strokes, canopy dapples, sand
//      ripples, rock speckle, marsh streaks, snow), filled through one Path2D of hexes per family.
//   2. Fields: each cropland hex is its own tile, like the other terrain: a world-anchored pattern (wet-rice paddies
//      with dikes, terraced paddies, coffee rows) clipped to the hex and turned one of six ways per cell, with a
//      soft hex edge, so neighbouring field hexes match in style but never run into one patchwork.
//   3. Stamps: every piece of art is a sprite (render/art/sprites.js) painted once per (kind, variant, zoom
//      bucket) in "R units" (1 unit = the hex radius) and blitted with drawImage. Ground-level stamps (pastures,
//      marsh pools, ponds, terrace and coffee patches) go first; upright stamps (trees, hills, mountains, houses,
//      palms) are then sorted by their base line so nearer things overlap farther ones, also across cells.
//   Relief is composed per cell, not stamped once: 1–3 jittered, rescaled massifs or mounds, plus "bridge"
//   stamps on the edges shared with neighbours of the same relief so ranges run on across hexes. Wooded hills
//   are earthy mounds strung along the local ridge direction (NW–SE where the slope gives none, like the ranges of
//   the north and the Trường Sơn) with single trees on their crests and flanks; snow follows the highest sample
//   (elev_max).
//   Sprites are never mirrored: the light always comes from the upper left, so variety comes from variants,
//   jitter, scale and composition instead.
//   LOD: far = texture, fields, mountains, hills and one clump per forest; mid = + marsh, suburbs, sparse scrub,
//   ponds, terraces; near = full composition, meadows, villages, palms; close = denser clusters, flowers. Sprite
//   detail (rice hills, roof tiles, windows, cattails) also scales with the sprite's pixel size.
//   Everything is deterministic per cell (hash01(cell, salt)), so tiles never shimmer between renders.
//   The Vietnamese motifs (paddies, terraces, villages, stilt houses, bamboo, palms, ponds, coffee) are
//   illustrative: placed by the simple lon/lat, elevation and cropland rules at "Where the Vietnamese motifs go",
//   not from farm surveys.
//
// Geography: lon/lat come from the shipped grid's projection (see geo()); other worlds (the dev gallery) get no
// regional motifs.
import { hash01 } from "../../hex.js";
import { COVER } from "../../terrain.js";
import { FOREIGN } from "../../world.js";
import { css, mix, shade, parseHex } from "../../color.js";
import { cityIsDot, metroSpill, SUBURB_ART, INDUSTRIAL_CELLS } from "./city.js";
import { lodFor, atLeast, hexAt } from "./lod.js";
import { bucketPx, deviceScale, getSprite, drawSprite, makePattern, wrapDraw, rng, spriteStats } from "./sprites.js";

/** Below this hex radius (css px) no terrain art is drawn at all (map.js checks it too). */
export const GLYPHS_MIN_RPX = 7;

/** Sprite cache counters, for profiling ({count, pixels, hits, misses, painted ms}). */
export const terrainArtStats = spriteStats;

/** Sprite canvas → stamp name ("tree", "clump", "village", "stilt", ...): ext/living finds the trees it sways and the houses it
 *  lights among the stamps a render draws. */
export const STAMP_KIND = new WeakMap();

const TAU = Math.PI * 2;
const FOREIGN_ALPHA = 0.4;
const C = parseHex;
const WARM = [255, 241, 196], COOL = [38, 52, 86];

// --- entry point -------------------------------------------------------------------------------------------------

export function drawTerrainGlyphs(ctx, cells, w, { Rpx, s, lod, bridges } = {}) {
  const R = w.grid.R;
  s = s ?? Rpx / R;
  Rpx = Rpx ?? R * s;
  lod = lod ?? lodFor(Rpx);
  const dev = deviceScale(ctx); // device px per km
  const dpr = dev / s || 1;
  const upx = bucketPx(R * dev, { min: 6, max: 256 });
  ctx.save();
  drawTextures(ctx, cells, w, s, dpr, lod, Rpx);
  drawFields(ctx, cells, w, s, dpr, lod, Rpx);
  const ground = [], upright = [];
  // Bridges join relief across neighbouring hexes; a lone specimen hex (the dev gallery) is drawn without them.
  bridges = bridges ?? !(Array.isArray(cells) && cells.length === 1);
  const env = { w, R, Rpx, lod, upx, bridges, ground: null, upright: null, memo: new Map() };
  const plans = planCache(w, `${lod}|${upx}|${Rpx}|${bridges}`);
  for (const i of cells) {
    let pl = plans.get(i);
    if (!pl) {
      env.ground = [];
      env.upright = [];
      planCell(env, i);
      pl = { g: env.ground.length ? env.ground : NONE, u: env.upright.length ? env.upright : NONE };
      plans.set(i, pl);
    }
    for (const st of pl.g) ground.push(st);
    for (const st of pl.u) upright.push(st);
  }
  upright.sort((a, b) => a.z - b.z);
  // Stamps wholly outside the canvas are skipped (the visible range includes a margin of cells).
  const vis = visibleBounds(ctx);
  let alpha = -1;
  for (const list of [ground, upright]) {
    for (const st of list) {
      const spr = st.spr, x0 = st.x + spr.x0 * st.k, y0 = st.y + spr.y0 * st.k;
      if (vis && (x0 > vis.x1 || y0 > vis.y1 || x0 + spr.w * st.k < vis.x0 || y0 + spr.h * st.k < vis.y0)) continue;
      if (st.a !== alpha) ctx.globalAlpha = alpha = st.a;
      drawSprite(ctx, spr, st.x, st.y, st.k);
    }
  }
  ctx.restore();
}

// Per-cell stamp plans depend only on the world, the cell and the zoom (lod, sprite bucket, Rpx for city tiles),
// so while the map pans at one zoom the static layer re-renders without re-planning the cells it has seen. A few
// zooms are kept (main.js warms sprites for the next zoom steps in idle time, which plans those too), least
// recently used first out, each capped at PLAN_CACHE_CELLS cells. Plans hold their sprites, so a palette change
// that clears the sprite cache (sprites.js clearSprites, unused today) would also need to clear this one.
const NONE = [];
const PLAN_CACHE_ZOOMS = 3, PLAN_CACHE_CELLS = 40000;
const planCaches = new WeakMap(); // world → Map<zoom key, Map<cell, {g, u}>> (Map order = recency)
function planCache(w, key) {
  let byKey = planCaches.get(w);
  if (!byKey) planCaches.set(w, (byKey = new Map()));
  let map = byKey.get(key);
  if (map) byKey.delete(key);
  if (!map || map.size > PLAN_CACHE_CELLS) map = new Map();
  byKey.set(key, map);
  while (byKey.size > PLAN_CACHE_ZOOMS) byKey.delete(byKey.keys().next().value);
  return map;
}

/** The canvas rectangle in ctx user units ({x0, y0, x1, y1}), or null when it cannot be worked out. */
function visibleBounds(ctx) {
  const cv = ctx.canvas;
  if (!cv || !(cv.width > 0) || !(cv.height > 0)) return null;
  const m = ctx.getTransform();
  if (!m.is2D || m.b || m.c) return null; // only plain scale + translate (the world transform)
  const inv = m.inverse();
  if (!Number.isFinite(inv.a) || !Number.isFinite(inv.d)) return null;
  const p = inv.transformPoint({ x: 0, y: 0 }), q = inv.transformPoint({ x: cv.width, y: cv.height });
  return { x0: Math.min(p.x, q.x), y0: Math.min(p.y, q.y), x1: Math.max(p.x, q.x), y1: Math.max(p.y, q.y) };
}

// --- 1. textures ---------------------------------------------------------------------------------------------------

const TEX_SIZE = 200; // css px per pattern tile
const TEX_ALPHA = { far: 0.55, mid: 0.8, near: 1, close: 1 };

function texFamily(w, i) {
  const cv = w.cover[i], rel = w.relief[i];
  if (cv === COVER.ICE) return "snow";
  if (rel >= 2) return rel === 3 || w.raw.elev[i] > 2600 ? "snowrock" : "rock";
  switch (cv) {
    case COVER.DECIDUOUS: case COVER.EVERGREEN: case COVER.MIXED: return "canopy";
    case COVER.SCRUB: return "sand";
    case COVER.WETLAND: return "marsh";
    case COVER.URBAN: return "grass";
    case COVER.BARREN: return "rock";
    case COVER.NONE: return w.raw.elev[i] > 1500 ? "rock" : "grass";
    default: return "grass";
  }
}

function drawTextures(ctx, cells, w, s, dpr, lod, Rpx) {
  const owner = w.raw.owner;
  const groups = new Map(); // family key → cells
  for (const i of cells) {
    if (w.water[i] || isFieldCell(w, i, Rpx)) continue; // fields are opaque: no texture under them
    const key = texFamily(w, i) + (owner[i] === FOREIGN ? "|f" : "");
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(i);
  }
  // Pattern pixels are device pixels at the nearest power-of-two zoom, so brush strokes keep roughly the same
  // screen size at every zoom while staying anchored to the ground.
  const sb = 2 ** Math.round(Math.log2(s));
  const m = new DOMMatrix([1 / (sb * dpr), 0, 0, 1 / (sb * dpr), 0, 0]);
  const base = TEX_ALPHA[lod] ?? 1;
  for (const [key, list] of groups) {
    const [fam, f] = key.split("|");
    // The LOD opacity is baked into the tile (see bakedAlpha), so the common case fills at globalAlpha 1.
    const pat = makePattern(ctx, `terrain-tex:${fam}@${base}`, TEX_SIZE, dpr, bakedAlpha(base, (g, size) => TEXTURES[fam](g, size)));
    pat.setTransform(m);
    ctx.globalAlpha = f ? FOREIGN_ALPHA : 1;
    ctx.fillStyle = pat;
    ctx.fill(hexRunsPath(w.grid, list));
  }
  ctx.globalAlpha = 1;
}

// Perf helpers for the big pattern fills (textures and fields), which dominate the static-layer cost at mid zoom.
// Both keep the output the same (within ±2 levels of 8-bit rounding):
//  - hexRunsPath outlines each horizontal run of neighbouring cells as one polygon instead of one hexagon per cell
//    (same union, a third fewer edges and far fewer contours for the rasterizer);
//  - bakedAlpha multiplies the tile's alpha by the LOD opacity once, since filling a complex path with a pattern at
//    globalAlpha < 1 is markedly slower in Chrome than at 1.

/** Path2D covering the hexes of `list`; consecutive same-row neighbours (i, i + 1, ...) become one polygon. */
function hexRunsPath(grid, list) {
  const K = grid.corners, cols = grid.cols, p = new Path2D();
  // Corners (pointy-top, y down): 0 upper right, 1 lower right, 2 bottom, 3 lower left, 4 upper left, 5 top.
  for (let a = 0; a < list.length; ) {
    let b = a;
    while (b + 1 < list.length && list[b + 1] === list[b] + 1 && list[b] % cols !== cols - 1) b++;
    let i = list[a];
    p.moveTo(grid.cx(i) + K[4][0], grid.cy(i) + K[4][1]);
    for (let k = a; k <= b; k++) {
      i = list[k];
      const x = grid.cx(i), y = grid.cy(i);
      p.lineTo(x + K[5][0], y + K[5][1]);
      p.lineTo(x + K[0][0], y + K[0][1]);
    }
    p.lineTo(grid.cx(i) + K[1][0], grid.cy(i) + K[1][1]);
    for (let k = b; k >= a; k--) {
      i = list[k];
      const x = grid.cx(i), y = grid.cy(i);
      p.lineTo(x + K[2][0], y + K[2][1]);
      p.lineTo(x + K[3][0], y + K[3][1]);
    }
    p.closePath();
    a = b + 1;
  }
  return p;
}

/** Wrap a pattern painter so the finished tile's alpha is multiplied by `a` (no-op for a = 1). */
function bakedAlpha(a, paint) {
  if (a >= 1) return paint;
  return (g, size) => {
    g.save();
    paint(g, size);
    g.restore();
    g.save();
    g.globalCompositeOperation = "destination-in";
    g.globalAlpha = 1;
    g.fillStyle = `rgba(0,0,0,${a})`;
    g.fillRect(-1, -1, size + 2, size + 2);
    g.restore();
  };
}

const TEXTURES = {
  grass(g, S) {
    const r = rng(11);
    blotches(g, S, r, 26, 10, 26, "rgba(255,250,210,.05)", "rgba(20,40,0,.05)");
    for (let k = 0; k < 260; k++) {
      const x = r() * S, y = r() * S, len = 3 + r() * 4, a = -1.1 + (r() - 0.5) * 0.7;
      g.strokeStyle = k % 2 ? "rgba(255,252,200,.13)" : "rgba(25,45,5,.13)";
      g.lineWidth = 0.9 + r() * 0.5;
      wrapDraw(S, (dx, dy) => {
        g.beginPath();
        g.moveTo(x + dx, y + dy);
        g.lineTo(x + dx + Math.cos(a) * len, y + dy + Math.sin(a) * len);
        g.stroke();
      });
    }
  },
  canopy(g, S) {
    const r = rng(23);
    blotches(g, S, r, 30, 8, 22, "rgba(200,230,120,.05)", "rgba(0,20,0,.07)");
    for (let k = 0; k < 170; k++) {
      const x = r() * S, y = r() * S, rr = 2 + r() * 3.5;
      wrapDraw(S, (dx, dy) => {
        g.beginPath();
        g.arc(x + dx, y + dy, rr, 0, TAU);
        g.fillStyle = "rgba(5,25,5,.13)";
        g.fill();
        g.beginPath();
        g.arc(x + dx - rr * 0.3, y + dy - rr * 0.35, rr * 0.55, 0, TAU);
        g.fillStyle = "rgba(220,240,150,.09)";
        g.fill();
      });
    }
  },
  sand(g, S) {
    const r = rng(37);
    blotches(g, S, r, 22, 12, 30, "rgba(255,240,200,.06)", "rgba(90,60,20,.05)");
    for (let k = 0; k < 70; k++) {
      const x = r() * S, y = r() * S, len = 9 + r() * 12;
      wrapDraw(S, (dx, dy) => {
        const X = x + dx, Y = y + dy;
        g.beginPath();
        g.moveTo(X - len, Y);
        g.quadraticCurveTo(X, Y - 4, X + len, Y);
        g.strokeStyle = "rgba(255,244,210,.16)";
        g.lineWidth = 1.1;
        g.stroke();
        g.beginPath();
        g.moveTo(X - len * 0.8, Y + 1.6);
        g.quadraticCurveTo(X, Y - 2.2, X + len * 0.8, Y + 1.6);
        g.strokeStyle = "rgba(110,70,25,.12)";
        g.lineWidth = 0.9;
        g.stroke();
      });
    }
    speckle(g, S, r, 220, "rgba(90,60,25,.16)", "rgba(255,245,215,.16)");
  },
  rock(g, S) {
    const r = rng(41);
    blotches(g, S, r, 26, 8, 24, "rgba(255,250,235,.05)", "rgba(30,20,10,.06)");
    speckle(g, S, r, 320, "rgba(40,30,20,.17)", "rgba(255,250,235,.15)");
    for (let k = 0; k < 16; k++) {
      let x = r() * S, y = r() * S;
      const pts = [[x, y]];
      for (let n = 0; n < 4; n++) pts.push([(x += (r() - 0.3) * 9), (y += (r() - 0.5) * 7)]);
      wrapDraw(S, (dx, dy) => {
        g.beginPath();
        pts.forEach(([px, py], n) => (n ? g.lineTo(px + dx, py + dy) : g.moveTo(px + dx, py + dy)));
        g.strokeStyle = "rgba(35,25,15,.12)";
        g.lineWidth = 0.8;
        g.stroke();
      });
    }
  },
  snowrock(g, S) {
    TEXTURES.rock(g, S);
    const r = rng(43);
    blotches(g, S, r, 18, 10, 24, "rgba(255,255,255,.08)", "rgba(80,100,140,.05)");
  },
  marsh(g, S) {
    const r = rng(53);
    blotches(g, S, r, 30, 8, 22, "rgba(170,210,200,.06)", "rgba(10,35,20,.08)");
    for (let k = 0; k < 120; k++) {
      const x = r() * S, y = r() * S, len = 4 + r() * 9;
      g.strokeStyle = k % 3 ? "rgba(185,225,230,.12)" : "rgba(15,40,25,.14)";
      g.lineWidth = 1;
      wrapDraw(S, (dx, dy) => {
        g.beginPath();
        g.moveTo(x + dx, y + dy);
        g.lineTo(x + dx + len, y + dy);
        g.stroke();
      });
    }
  },
  snow(g, S) {
    const r = rng(61);
    blotches(g, S, r, 24, 10, 28, "rgba(255,255,255,.12)", "rgba(110,140,190,.07)");
    for (let k = 0; k < 60; k++) {
      const x = r() * S, y = r() * S, len = 8 + r() * 14;
      wrapDraw(S, (dx, dy) => {
        g.beginPath();
        g.moveTo(x + dx - len, y + dy);
        g.quadraticCurveTo(x + dx, y + dy - 3, x + dx + len, y + dy);
        g.strokeStyle = "rgba(120,150,195,.12)";
        g.lineWidth = 1.2;
        g.stroke();
      });
    }
  },
};

function blotches(g, S, r, n, r0, r1, light, dark) {
  for (let k = 0; k < n; k++) {
    const x = r() * S, y = r() * S, rr = r0 + r() * (r1 - r0);
    g.fillStyle = k % 2 ? light : dark;
    wrapDraw(S, (dx, dy) => {
      g.beginPath();
      g.ellipse(x + dx, y + dy, rr, rr * 0.7, 0, 0, TAU);
      g.fill();
    });
  }
}

function speckle(g, S, r, n, dark, light) {
  for (let k = 0; k < n; k++) {
    const x = r() * S, y = r() * S, rr = 0.5 + r() * 0.9;
    g.fillStyle = k % 2 ? dark : light;
    g.fillRect(x, y, rr, rr);
  }
}

// --- geography (lon/lat of a cell) ---------------------------------------------------------------------------------

// Map units → lon/lat: the inverse Albers equal-area conic of pipeline/geo.py MapProjection (lat1 11°, lat2 21°,
// lat0 16°, lon0 106°) with pipeline/build/world.py FRAME min_x / max_y and MARGIN, 5 map units per km: the same
// maths as ext/daynight/sun.js mapToLonLat (keep in sync). Only the shipped grid has it; other worlds (the dev
// gallery) fall back to hash-based choices.
const RAD = Math.PI / 180;
const VN = (() => {
  const RE = 6371.0088, p1 = 11 * RAD, p2 = 21 * RAD, p0 = 16 * RAD;
  const n = (Math.sin(p1) + Math.sin(p2)) / 2, c = Math.cos(p1) ** 2 + 2 * n * Math.sin(p1);
  return { RE, n, c, rho0: (RE * Math.sqrt(c - 2 * n * Math.sin(p0))) / n, lon0: 106, unit: 5, margin: 200,
    min_x: -801.2961167935589, max_y: 822.7997851038526, grid: [25, 263, 235] };
})();
const geoTables = new WeakMap();

function geoTable(w) {
  let t = geoTables.get(w);
  if (t === undefined) {
    const g = w.grid, [R, cols, rows] = VN.grid;
    t = w.raw.margin === VN.margin && g.R === R && g.cols === cols && g.rows === rows
      ? { lon: new Float32Array(g.size).fill(NaN), lat: new Float32Array(g.size) } : null;
    geoTables.set(w, t);
  }
  return t;
}

/** The geo table with cell i's lon/lat filled in, or null when the world has no known projection. */
function geo(w, i) {
  const t = geoTable(w);
  if (t && Number.isNaN(t.lon[i])) {
    const { RE, n, c, rho0, lon0 } = VN;
    const X = (w.grid.cx(i) - VN.margin) / VN.unit + VN.min_x, Y = VN.max_y - (w.grid.cy(i) - VN.margin) / VN.unit;
    const dy = rho0 - Y, rho = Math.hypot(X, dy);
    const s = (c - ((rho * n) / RE) ** 2) / (2 * n);
    t.lon[i] = lon0 + Math.atan2(X, dy) / n / RAD;
    t.lat[i] = Math.asin(Math.max(-1, Math.min(1, s))) / RAD;
  }
  return t;
}
const inBox = (w, i, f) => { const t = geo(w, i); return !!t && f(t.lon[i], t.lat[i]); };

// Where the Vietnamese countryside motifs go. They are illustrative (no farm survey behind them): each rule is a
// lon/lat box plus the hex's elevation, relief and cropland share from world.json.
/** Red River delta: 19.8°–21.7° N, 105.4°–107.1° E, below 15 m. */
const redRiverDelta = (w, i) => w.raw.elev[i] < 15 && inBox(w, i, (lo, la) => la > 19.8 && la < 21.7 && lo > 105.4 && lo < 107.1);
/** Mekong delta: south of 11.1° N and west of 107° E, below 15 m. */
const mekongDelta = (w, i) => w.raw.elev[i] < 15 && inBox(w, i, (lo, la) => la < 11.1 && lo < 107);
/** Northern uplands: north of 20.3° N, 100 m and higher (the Red River delta and the coast stay lowland). */
const northUplands = (w, i) => w.raw.elev[i] >= 100 && inBox(w, i, (lo, la) => la >= 20.3);
/** Central Highlands: 11.3°–15.6° N, west of 108.9° E, at `minElev` m and higher. */
const highlands = (w, i, minElev = 300) => w.raw.elev[i] >= minElev && inBox(w, i, (lo, la) => la > 11.3 && la < 15.6 && lo < 108.9);
/** Terraced paddies (ruộng bậc thang): hilly or mountain ground in the northern uplands or on the Central
 *  Highlands' edges (from 200 m). */
const terraceLand = (w, i) => w.relief[i] >= 1 && w.relief[i] <= 2 && (northUplands(w, i) || highlands(w, i, 200));
/** Coffee / pepper rows: the Central Highlands' basalt plateaus, flat ground at 400–1000 m. */
const coffeeLand = (w, i) => w.relief[i] === 0 && w.raw.elev[i] <= 1000 && highlands(w, i, 400);
/** Stilt houses (nhà sàn) in the uplands (250 m and higher, or hills in the north); tiled-roof houses elsewhere. */
const uplandHome = (w, i) => w.raw.elev[i] >= 250 || (w.relief[i] >= 1 && northUplands(w, i));
/** Fish ponds (ao) in both deltas; shrimp ponds on the Mekong delta's coast, south of 9.9° N. */
const pondLand = (w, i) => redRiverDelta(w, i) || mekongDelta(w, i);
const shrimpCoast = (w, i) => w.raw.elev[i] < 5 && inBox(w, i, (lo, la) => la < 9.9 && lo < 107);
/** The pond on a farmed delta hex (40% of them), in R units from the hex centre: {x, y, f, shrimp}, or null. Only
 *  flat cropland and pasture outside city tiles get it (planCell); ext/hexlife puts its ducks there. */
export function pondSpot(w, i) {
  if (!pondLand(w, i) || hash01(i, 150) >= 0.4) return null;
  return { x: (hash01(i, 152) - 0.5) * 0.6, y: 0.25 + (hash01(i, 153) - 0.5) * 0.4, f: 1.1 + hash01(i, 154) * 0.3, shrimp: shrimpCoast(w, i) };
}
/** Coconut palms: the Mekong delta below 20 m, and the south-central coast (10.5°–16.2° N, east of 107.9° E) below
 *  40 m. */
const palmLand = (w, i) => (w.raw.elev[i] < 20 && inBox(w, i, (lo, la) => la < 11.1 && lo < 107))
  || (w.raw.elev[i] < 40 && inBox(w, i, (lo, la) => la > 10.5 && la < 16.2 && lo > 107.9));
/** The dry coast of Ninh Thuận – Bình Thuận (10.5°–12.3° N, east of 108.3° E): the only cactus and dunes. */
const dryCoast = (w, i) => inBox(w, i, (lo, la) => la > 10.5 && la < 12.3 && lo > 108.3);

// --- 2. cropland: one tile per hex --------------------------------------------------------------------------------

// Each cropland hex is its own tile: a world-anchored pattern (paddies, terraces or coffee rows) clipped to the hex,
// turned to one of six directions picked per cell, then a soft hex edge (a darker rim and a light dike, bờ ruộng),
// so neighbouring field hexes share a style but read as separate tiles, like the forest and grass hexes. Cells are
// grouped by (art, direction), so a render costs a handful of pattern fills and two strokes.
const FIELD_TILE_MAX_PX = 2048;
const FIELD_ALPHA = { far: 0.6, mid: 0.9, near: 1, close: 1 };

/** Cells drawn as field tiles: cropland on flat or hilly ground, not under a full city tile. */
export function isFieldCell(w, i, Rpx) {
  if (w.cover[i] !== COVER.CROP || w.relief[i] > 1 || w.water[i]) return false;
  const city = w.cityByCell.get(i);
  return !city || cityIsDot(city, Rpx);
}

/** The field art of a cropland hex: "terrace" (terraced paddies on hilly upland ground), "rows" (coffee / pepper on
 *  the highland plateaus) or "paddy" (wet rice with dikes, everywhere else). ext/hexlife reads it. */
export function fieldArt(w, i) {
  return terraceLand(w, i) ? "terrace" : coffeeLand(w, i) ? "rows" : "paddy";
}

function drawFields(ctx, cells, w, s, dpr, lod, Rpx) {
  const { grid } = w, R = grid.R;
  const groups = new Map(), all = [];
  for (const i of cells) {
    if (!isFieldCell(w, i, Rpx)) continue;
    const art = fieldArt(w, i), dir = Math.floor(hash01(i, 509) * 6), f = w.raw.owner[i] === FOREIGN;
    const key = `${art}|${dir}|${f ? 1 : 0}`;
    let gr = groups.get(key);
    if (!gr) groups.set(key, (gr = { art, dir, f, path: new Path2D() }));
    hexAt(gr.path, grid.cx(i), grid.cy(i), R, 1);
    all.push(i);
  }
  if (!all.length) return;
  const sb0 = 2 ** Math.round(Math.log2(s));
  const base = FIELD_ALPHA[lod] ?? 1;
  for (const { art, dir, f, path } of groups.values()) {
    const F = FIELD_ART[art];
    // Pattern pixels per map unit: the power-of-two bucket of the zoom, capped so the tile canvas stays small.
    let sb = sb0;
    while (F.T * sb * dpr > FIELD_TILE_MAX_PX && sb > 1 / 64) sb /= 2;
    const dpx = sb * dpr;
    const pat = makePattern(ctx, `terrain-fields:${art}@${base}`, F.T * sb, dpr, bakedAlpha(base, (g, size) => {
      g.scale(size / F.T, size / F.T);
      F.paint(g, dpx);
    }));
    const ox = hash01(dir, 511) * F.T, oy = hash01(dir, 512) * F.T;
    pat.setTransform(new DOMMatrix().translateSelf(ox, oy).rotateSelf(F.ang[dir] / RAD).scaleSelf(1 / dpx));
    ctx.globalAlpha = f ? FOREIGN_ALPHA : 1;
    ctx.fillStyle = pat;
    ctx.fill(path);
  }
  ctx.globalAlpha = 1;
  // The soft hex edge: a wide, faint earthy rim just inside the hex, then a thin light dike.
  if (Rpx < 9) return;
  const rim = new Path2D(), dike = new Path2D();
  for (const i of all) {
    const x = grid.cx(i), y = grid.cy(i);
    hexAt(rim, x, y, R, 0.95);
    hexAt(dike, x, y, R, 0.885);
  }
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(70,54,24,.22)";
  ctx.lineWidth = R * 0.09;
  ctx.stroke(rim);
  ctx.strokeStyle = "rgba(238,226,182,.34)";
  ctx.lineWidth = Math.max(R * 0.022, 0.8 / s);
  ctx.stroke(dike);
}

// Paddy colours (young and green rice, flooded plots, ripening and ripe rice, a fallow plot) and their weights.
// With "Rice seasons" on, ext/living recolours rice hexes by the month; the dikes keep their light tone under it.
const PADDY = [
  ["#6f9e3e", 3], ["#86b34a", 3], ["#5c8f37", 2], ["#7fae8f", 1.6], ["#9cc2a8", 1], ["#b6bd4c", 1.2], ["#d3b448", 0.8],
  ["#a58c5a", 0.4],
].map(([c, wgt]) => [C(c), wgt]);
const PADDY_W = PADDY.map((c) => c[1]);
const WET = new Set([3, 4]);

/** Field art by kind: T = pattern tile size (map units), paint(g, dpx) in map units, ang = the six directions (rad). */
const FIELD_ART = {
  paddy: { T: 96, paint: paintPaddyTile, ang: [-0.62, -0.3, 0.02, 0.33, 0.66, 1.05] },
  terrace: { T: 96, paint: paintTerraceTile, ang: [-0.2, -0.12, -0.05, 0.03, 0.1, 0.18] },
  rows: { T: 48, paint: paintRowsTile, ang: [-0.55, -0.25, 0, 0.28, 0.52, 0.8] },
};

/** Wet-rice paddies: small plots in long strips, light earthen dikes (bờ) between them, flooded plots shining. */
function paintPaddyTile(g, dpx) {
  const r = rng(5113), T = 96, px = 1 / dpx;
  g.fillStyle = "#a99a6a";
  g.fillRect(0, 0, T, T);
  const dike = Math.max(0.3, px * 1.1);
  for (let x = 0; x < T; ) {
    let cw = 3.5 + r() * 4.5;
    if (T - x - cw < 3) cw = T - x;
    for (let y = 0; y < T; ) {
      let rh = 2.5 + r() * 3.5;
      if (T - y - rh < 2) rh = T - y;
      paintPlot(g, r, x + dike / 2, y + dike / 2, cw - dike, rh - dike, px, dpx);
      y += rh;
    }
    // now and then a wider dike with a path along it
    if (r() < 0.18) {
      g.fillStyle = "#bcae80";
      g.fillRect(x + cw - dike * 0.9, 0, dike * 1.8, T);
    }
    x += cw;
  }
}

function paintPlot(g, r, x, y, w, h, px, dpx) {
  const k = pickWeighted(r, PADDY_W), c = PADDY[k][0];
  g.fillStyle = css(c);
  g.fillRect(x, y, w, h);
  const gr = g.createLinearGradient(x, y, x + w, y + h);
  if (WET.has(k)) {
    // standing water: a sky sheen across the plot
    gr.addColorStop(0, "rgba(235,248,250,.32)");
    gr.addColorStop(0.5, "rgba(235,248,250,0)");
    gr.addColorStop(1, "rgba(20,60,70,.12)");
  } else {
    gr.addColorStop(0, "rgba(255,248,215,.14)");
    gr.addColorStop(0.6, "rgba(255,248,215,0)");
    gr.addColorStop(1, "rgba(30,40,0,.12)");
  }
  g.fillStyle = gr;
  g.fillRect(x, y, w, h);
  if (dpx >= 3) {
    // rows of rice hills, close up
    const step = Math.max(0.55, px * 2.6);
    g.fillStyle = css(shade(c, WET.has(k) ? -0.3 : -0.22), 0.4);
    const d = Math.max(px * 0.8, step * 0.3);
    for (let yy = y + step / 2; yy < y + h; yy += step) for (let xx = x + step / 2; xx < x + w; xx += step) g.fillRect(xx, yy, d, d);
  }
  // the dike's lip: lit on the upper left, its shadow on the plot's lower right
  g.lineWidth = Math.max(px, 0.14);
  g.strokeStyle = "rgba(255,246,212,.24)";
  g.beginPath();
  g.moveTo(x, y + h); g.lineTo(x, y); g.lineTo(x + w, y);
  g.stroke();
  g.strokeStyle = "rgba(60,46,18,.26)";
  g.beginPath();
  g.moveTo(x + w, y); g.lineTo(x + w, y + h); g.lineTo(x, y + h);
  g.stroke();
}

/** Terraced paddies: contour bands that follow the slope, each with a light dike on its lip and a shaded riser
 *  below; seamless (the curves repeat across the tile and the bands wrap top to bottom). */
function paintTerraceTile(g, dpx) {
  const r = rng(7027), T = 96, px = 1 / dpx;
  const ys = [0];
  while (ys.at(-1) < T - 4) ys.push(ys.at(-1) + 2.4 + r() * 1.6);
  ys[ys.length - 1] = T;
  const K = ys.length - 1, ph = r() * TAU, ph2 = r() * TAU;
  const curve = (k, x) => ys[k] + 1.7 * Math.sin((TAU * x) / T + ph) + 0.7 * Math.sin((2 * TAU * x) / T + ph2 + (k % K) * (TAU / K));
  const STEP = 3;
  const line = (k, dy, back) => {
    if (!back) for (let x = 0; x <= T; x += STEP) g.lineTo(x, curve(k, x) + dy);
    else for (let x = T; x >= 0; x -= STEP) g.lineTo(x, curve(k, x) + dy);
  };
  for (let k = 0; k < K; k++) {
    const pk = pickWeighted(r, PADDY_W), c = PADDY[pk][0];
    for (const dy of [-T, 0, T]) {
      g.beginPath();
      g.moveTo(0, curve(k, 0) + dy);
      line(k, dy, false);
      line(k + 1, dy, true);
      g.closePath();
      g.fillStyle = css(c);
      g.fill();
      if (WET.has(pk)) {
        g.fillStyle = "rgba(235,248,250,.18)";
        g.fill();
      }
      // the riser's shade under the next band, then the dike on this band's lip
      g.beginPath();
      g.moveTo(0, curve(k + 1, 0) + dy - 0.35);
      line(k + 1, dy - 0.35, false);
      g.strokeStyle = "rgba(64,48,20,.42)";
      g.lineWidth = Math.max(px * 1.2, 0.6);
      g.stroke();
      g.beginPath();
      g.moveTo(0, curve(k + 1, 0) + dy - 0.75);
      line(k + 1, dy - 0.75, false);
      g.strokeStyle = "rgba(238,228,186,.7)";
      g.lineWidth = Math.max(px, 0.3);
      g.stroke();
    }
  }
}

/** Coffee (or pepper) rows on red basalt soil: dark round shrubs in straight rows, a farm track every few rows. */
function paintRowsTile(g, dpx) {
  const r = rng(3301), T = 48, px = 1 / dpx;
  g.fillStyle = "#8c5636";
  g.fillRect(0, 0, T, T);
  blotches(g, T, r, 10, 2, 6, "rgba(200,120,70,.18)", "rgba(60,25,10,.16)");
  const row = 4, gap = 3.3, rad = Math.max(1.45, px * 1.2);
  for (let y = row / 2, n = 0; y < T; y += row, n++) {
    if (n % 5 === 4) continue; // a farm track
    for (let x = gap / 2 + (n % 2) * 0.8; x < T; x += gap) {
      const jx = (r() - 0.5) * 0.25, jy = (r() - 0.5) * 0.2, rr = rad * (0.85 + r() * 0.3);
      g.fillStyle = "rgba(40,20,8,.35)";
      g.beginPath();
      g.arc(x + jx + rr * 0.3, y + jy + rr * 0.3, rr, 0, TAU);
      g.fill();
      g.fillStyle = "#2f5524";
      g.beginPath();
      g.arc(x + jx, y + jy, rr, 0, TAU);
      g.fill();
      if (dpx >= 2) {
        g.fillStyle = "#5f913c";
        g.beginPath();
        g.arc(x + jx - rr * 0.3, y + jy - rr * 0.32, rr * 0.45, 0, TAU);
        g.fill();
      }
    }
  }
}

/**
 * A soft, continuous line of tree crowns along a polyline (hedgerow / windbreak), lit from the upper left.
 * cr = crown radius (in the caller's units); the line casts a shadow down-right.
 */
function treeLine(g, pts, cr, px, r) {
  const stroke = (dx, dy, col, lw) => {
    g.beginPath();
    pts.forEach(([x, y], k) => (k ? g.lineTo(x + dx, y + dy) : g.moveTo(x + dx, y + dy)));
    g.strokeStyle = col;
    g.lineWidth = lw;
    g.stroke();
  };
  stroke(cr * 0.9, cr * 0.6, "rgba(20,30,10,.25)", cr * 2.4);
  stroke(0, -cr * 0.5, "#2b4520", cr * 1.9);
  // Overlapping crowns (spacing < radius) so the line reads as one soft mass with a bumpy top.
  const crowns = [];
  let acc = 0;
  for (let k = 1; k < pts.length; k++) {
    const [x0, y0] = pts[k - 1], [x1, y1] = pts[k];
    const d = Math.hypot(x1 - x0, y1 - y0);
    for (; acc < d; acc += cr * (0.55 + r() * 0.35)) {
      const t = acc / d;
      crowns.push([x0 + (x1 - x0) * t + (r() - 0.5) * cr * 0.3, y0 + (y1 - y0) * t + (r() - 0.5) * cr * 0.3, cr * (0.8 + r() * 0.4)]);
    }
    acc -= d;
  }
  crowns.sort((p, q) => p[1] - q[1]);
  for (const [x, y, rr] of crowns) {
    g.fillStyle = "#3a5e27";
    g.beginPath();
    g.arc(x, y - rr * 0.7, rr, 0, TAU);
    g.fill();
  }
  if (cr / px < 1.5) return;
  for (const [x, y, rr] of crowns) {
    g.fillStyle = "#6a9440";
    g.beginPath();
    g.arc(x - rr * 0.28, y - rr * 1.0, rr * 0.6, 0, TAU);
    g.fill();
  }
  if (cr / px < 3) return;
  g.fillStyle = "rgba(176,206,112,.7)";
  for (const [x, y, rr] of crowns) {
    g.beginPath();
    g.arc(x - rr * 0.42, y - rr * 1.15, rr * 0.26, 0, TAU);
    g.fill();
  }
}

// --- 3. stamp planning ---------------------------------------------------------------------------------------------

// Candidate spots for small stamps (R units): centre, an inner ring and an outer ring.
const SPOTS = [[0, 0.05]]
  .concat([0, 1, 2, 3, 4, 5].map((k) => [Math.cos(k * (Math.PI / 3) + Math.PI / 6) * 0.38, Math.sin(k * (Math.PI / 3) + Math.PI / 6) * 0.34 + 0.08]))
  .concat([0, 1, 2, 3, 4, 5].map((k) => [Math.cos(k * (Math.PI / 3)) * 0.6, Math.sin(k * (Math.PI / 3)) * 0.46 + 0.1]));

// Forest clump layouts by count (R units, clump base points).
const CLUMPS = [
  [],
  [[0, 0.22]],
  [[-0.3, -0.02], [0.3, 0.32]],
  [[-0.32, -0.18], [0.34, -0.08], [0, 0.44]],
  [[-0.36, -0.28], [0.34, -0.26], [-0.3, 0.32], [0.36, 0.4]],
  [[-0.38, -0.3], [0.3, -0.38], [0.02, 0.08], [-0.38, 0.44], [0.42, 0.4]],
];

// Midpoints of the edges shared with the E, SE and SW neighbours (R units): where "bridge" stamps go, so a range
// runs on across hexes. Each pair of cells is bridged once (by the cell to the west / north).
const BRIDGE = [[Math.sqrt(3) / 2, 0], [Math.sqrt(3) / 4, 0.75], [-Math.sqrt(3) / 4, 0.75]];
const NV_MTN = 12, NV_HILL = 12, NV_RIDGE = 4;

// Ridge directions on screen (rad; 0 = east, negative = rising to the north-east, positive = falling to the
// south-east), already foreshortened.
const RIDGE_ANG = [-0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9];
// NW–SE, the trend of the Hoàng Liên Sơn and the Trường Sơn, used where the terrain gives no clear direction.
const RIDGE_BIAS = 0.45;

function planCell(env, i) {
  const { w, R, lod } = env;
  if (w.water[i]) return;
  const city = w.cityByCell.get(i);
  const spill = metroSpill(w).get(i);
  const tiled = (city && !cityIsDot(city, env.Rpx)) || (spill && !cityIsDot(spill, env.Rpx) && !cityIsDot(spill.of, env.Rpx));
  const x = w.grid.cx(i), y = w.grid.cy(i);
  const a = w.raw.owner[i] === FOREIGN ? FOREIGN_ALPHA : 1;
  const rel = w.relief[i], cv = w.cover[i];
  const elev = w.raw.elev[i];
  const h = (salt) => hash01(i, salt);
  const vary = (salt, n) => Math.floor(h(salt) * n) % n;
  const put = (list, name, arg, v, px, py, f = 1, z = py) =>
    list.push({ spr: sprite(env, name, arg, v), x: x + px * R, y: y + py * R, k: R * f, a, z: y + z * R });
  const up = (name, arg, v, px, py, f, z) => put(env.upright, name, arg, v, px, py, f, z);
  const flat = (name, arg, v, px = 0, py = 0, f = 1) => put(env.ground, name, arg, v, px, py, f);
  if (tiled) {
    // A full city tile covers the middle of the cell; its feathered edge fades into the urban-fringe ground and streets.
    if (cv === COVER.URBAN && atLeast(lod, "mid")) flat("suburbGround", "", vary(130, 8));
    return;
  }
  // An industrial park (render/art/city.js INDUSTRIAL_CELLS, from geo.json parks): a factory estate on flat land in
  // place of the cell's own art, from the region view in.
  if (rel === 0 && atLeast(lod, "mid") && INDUSTRIAL_CELLS.has(i)) {
    flat("suburbGround", "factory", vary(130, 8));
    up("suburbBuild", "factory", vary(130, 8), 0, 0, 1, 0);
    return;
  }

  const isForest = cv === COVER.DECIDUOUS || cv === COVER.EVERGREEN || cv === COVER.MIXED;
  const forestPct = w.pct?.forest ? w.pct.forest[i] || 0 : isForest ? 70 : 0;
  const desert = cv === COVER.SCRUB || cv === COVER.BARREN;
  // Snow from absolute height: the highest sample in the hex (world.json elev_max) catches peaks whose mean is held
  // down by their valleys. Arid ranges stay bare below ~3200 m.
  const emax = w.raw.elev_max ? w.raw.elev_max[i] : elev;
  const snowy = cv === COVER.ICE || rel === 3 || (desert ? elev > 3000 || emax > 3200 : elev > 2400 || emax > 3000);
  const alpine = rel === 3 || (rel === 2 && emax > 3500); // the tallest summits get the big snow-capped peak
  const near = atLeast(lod, "near"), mid = atLeast(lod, "mid"), close = lod === "close";
  const c = { w, i, h, vary, up, rel, cv, elev, alpine, isForest, forestPct, desert, snowy, near, lod, city, bridges: env.bridges };

  // Farmed patches on hexes that are not field tiles (illustrative; rules at "Where the Vietnamese motifs go"):
  // terraced paddies on the near flank of hill and mountain hexes with at least 5% cropland (world.json pct.crop) in
  // the northern uplands or on the Central Highlands' edges, often with a stilt house; coffee / pepper rows on flat
  // highland-plateau hexes with at least 15% cropland.
  if (mid && !city && cv !== COVER.CROP && w.pct?.crop) {
    const crop = w.pct.crop[i] || 0;
    if (crop >= 5 && terraceLand(w, i)) {
      // upright, sorted in front of the massifs: the steps are cut into the near slope
      const tx = (h(500) - 0.5) * 0.5, ty = rel === 2 ? 0.5 : 0.44;
      up("terraces", "", vary(501, 6), tx, ty + (h(502) - 0.5) * 0.08, 1 + h(503) * 0.3, 0.62);
      if (near && h(504) < 0.4) up("stilt", "", vary(505, 4), tx + (h(506) < 0.5 ? -0.46 : 0.46), ty + 0.16, 1.05, 0.66);
    } else if (crop >= 15 && coffeeLand(w, i)) {
      flat("coffee", "", vary(510, 6), (h(511) - 0.5) * 0.6, 0.3 + (h(512) - 0.5) * 0.3, 0.8 + h(513) * 0.3);
    }
  }
  if (rel >= 2) return planMountains(c);
  // tops: spots on the hills where small stamps can sit ([x, y, z, spread]); null on flat ground.
  const tops = rel === 1 ? planHills(c) : null;
  if (city || tops?.ridge) return; // a city dot keeps only its relief; forest ridges carry their own trees
  const onHill = !!tops;
  const hillSpot = (k, salt) => {
    const t = tops[k % tops.length];
    return [t[0] + (h(salt + k) - 0.5) * t[3], t[1] + (h(salt + 20 + k) - 0.5) * 0.05, t[2] + 0.001 * (k + 1)];
  };
  const onTops = (n, salt, fn) => {
    if (tops?.length) for (let k = 0; k < n; k++) fn(...hillSpot(k, salt), k);
  };

  const spots = (n, salt, start = 0) => {
    const idx = SPOTS.map((_, k) => k).slice(start);
    idx.sort((p, q) => hash01(i, salt + p) - hash01(i, salt + q));
    return idx.slice(0, n).map((k, j) => [SPOTS[k][0] + (hash01(i, salt + 40 + j) - 0.5) * 0.1, SPOTS[k][1] + (hash01(i, salt + 60 + j) - 0.5) * 0.08]);
  };

  // Forests on flat ground: clumps of trees, more and smaller as the zoom grows.
  if (isForest && forestPct >= 20 && !onHill) {
    const d = forestPct / 100;
    const n = lod === "far" ? (d >= 0.45 ? 1 : 0) : lod === "mid" ? (d >= 0.6 ? 3 : 2) : lod === "near" ? (d >= 0.6 ? 4 : d >= 0.4 ? 3 : 2) : d >= 0.6 ? 5 : 3;
    const kind = cv === COVER.DECIDUOUS ? "decid" : cv === COVER.EVERGREEN ? (elev > 2200 ? "conifsnow" : "conif") : "mixed";
    const L = CLUMPS[n] || [];
    const f = lod === "far" ? 1.3 : 1;
    L.forEach(([px, py], k) => up("clump", kind, vary(20 + k, 8), px + (h(30 + k) - 0.5) * 0.1, py + (h(40 + k) - 0.5) * 0.06, f * (0.88 + h(50 + k) * 0.22)));
    if (close) {
      spots(3, 300, 7).forEach(([px, py], k) => up("tree", kind === "decid" || (kind === "mixed" && k % 2) ? "decid" : "conif", vary(60 + k, 6), px, py, 0.8 + h(70 + k) * 0.2));
    }
    if (cv === COVER.DECIDUOUS && close) spots(2, 320).forEach(([px, py], k) => up("tuft", "", vary(80 + k, 6), px, py, 0.9));
    return;
  }

  if (!mid) return; // far: texture, fields, relief and forests only

  // Farm life (illustrative; rules at "Where the Vietnamese motifs go"), at near zoom unless noted:
  //   a village on `chance` of the hexes: tiled-roof houses (nhà mái ngói) in a bamboo hedge (lũy tre) in the
  //     lowlands, a stilt house (nhà sàn) in the uplands;
  //   fish ponds (ao) on 40% of the delta hexes from mid zoom, shrimp ponds on the Mekong delta's coast;
  //   1–3 coconut palms on 55% of the hexes in the Mekong delta and on the south-central coast.
  const farm = (chance) => {
    const pd = !onHill && pondSpot(w, i);
    if (pd) flat("pond", pd.shrimp ? "shrimp" : "", vary(151, 6), pd.x, pd.y, pd.f);
    if (!near) return;
    if (h(101) < chance) {
      const kind = uplandHome(w, i) ? "stilt" : "village", f = kind === "village" ? 1.3 : 1.15;
      if (onHill) onTops(1, 115, (px, py, z) => up(kind, "", vary(102, 4), px, py, f * 0.8, z));
      else up(kind, "", vary(102, 4), (h(103) - 0.5) * 0.6, 0.1 + (h(104) - 0.5) * 0.45, f);
    }
    if (!onHill && palmLand(w, i) && h(160) < 0.55) {
      spots(1 + vary(161, 3), 162, 1).forEach(([px, py], k) => up("palm", "", vary(163 + k, 6), px, py, 0.85 + h(166 + k) * 0.3));
    }
  };

  // Ground cover.
  switch (cv) {
    case COVER.CROP:
      // The fields themselves are hex tiles (drawFields); here the farm life on them.
      farm(0.3);
      break;
    case COVER.PASTURE:
      if (onHill) break;
      flat("pasture", "", vary(110, 8));
      farm(0.22);
      break;
    case COVER.WETLAND:
      if (!onHill) flat("marsh", "", vary(120, 8));
      break;
    case COVER.URBAN:
      // Urban fringe (render/art/city.js SUBURB_ART): townhouse rows, khu đô thị slabs or factory sheds on straight streets.
      if (!onHill) {
        flat("suburbGround", "", vary(130, 8));
        up("suburbBuild", "", vary(130, 8), 0, 0, 1, 0);
      } else if (near) onTops(1, 132, (px, py, z) => up("suburbBuild", "small", vary(130, 8), px, py + 0.1, 0.7, z));
      break;
    case COVER.ICE:
      if (!onHill) flat("ice", "", vary(140, 6));
      break;
    case COVER.BARREN:
      if (!onHill) {
        flat("cracks", "", vary(150, 6));
        spots(near ? (close ? 4 : 3) : 1, 160).forEach(([px, py], k) => up("rocks", "", vary(170 + k, 6), px, py, 0.9 + h(180 + k) * 0.3));
      } else onTops(near ? 2 : 1, 160, (px, py, z, k) => up("rocks", "", vary(170 + k, 6), px, py, 0.8 + h(180 + k) * 0.3, z));
      break;
    case COVER.SCRUB: {
      if (onHill) {
        // The hill sprite already carries sage; add a bush or a boulder up close.
        if (near) onTops(close ? 3 : 2, 200, (px, py, z, k) => up(h(220 + k) < 0.75 ? "sage" : "rocks", "", vary(240 + k, 6), px, py, 0.8 + h(260 + k) * 0.3, z));
        break;
      }
      // Dunes and cactus only on the dry Ninh Thuận – Bình Thuận coast; shrubs and boulders elsewhere.
      const low = elev < 800 && dryCoast(w, i);
      const n = lod === "mid" ? 3 : lod === "near" ? 5 : 8;
      if (low && h(190) < 0.35) up("dune", "", vary(191, 6), (h(192) - 0.5) * 0.3, 0.3 + (h(193) - 0.5) * 0.3, 1);
      spots(n, 200).forEach(([px, py], k) => {
        const t = h(220 + k);
        const kind = low && t < 0.3 ? "cactus" : t < 0.82 ? "sage" : "rocks";
        up(kind, "", vary(240 + k, 6), px, py, 0.85 + h(260 + k) * 0.3);
      });
      break;
    }
    case COVER.GRASS: {
      if (onHill) {
        if (near) onTops(close ? 3 : 2, 280, (px, py, z, k) => up("tuft", close && k === 0 ? "flowers" : "", vary(290 + k, 6), px, py, 0.85 + h(300 + k) * 0.2, z));
        break;
      }
      // A meadow underlay (grass strokes, wildflower patches, a few stones), then tufts in little groups.
      if (near) flat("meadow", close ? "c" : "n", vary(270, 6));
      const groups = lod === "mid" ? 2 : lod === "near" ? 3 : 5;
      spots(groups, 280).forEach(([px, py], k) => {
        const m = lod === "mid" ? 1 : 1 + (h(310 + k) < 0.6) + (close && h(312 + k) < 0.5);
        for (let q = 0; q < m; q++) {
          const ox = q ? (h(320 + k * 3 + q) - 0.5) * 0.2 : 0, oy = q ? (h(340 + k * 3 + q) - 0.3) * 0.1 : 0;
          up("tuft", close && (k + q) % 3 === 0 ? "flowers" : "", vary(290 + k * 3 + q, 6), px + ox, py + oy, (q ? 0.72 : 0.92) + h(300 + k) * 0.2);
        }
      });
      break;
    }
    default:
      break;
  }

  // Scattered trees in non-forest cells (woodlots, hedgerows, riparian strips).
  if (forestPct >= 20) {
    const kind = cv === COVER.SCRUB || elev > 1500 ? "conif" : "decid";
    if (onHill) {
      onTops(near && forestPct >= 30 ? 2 : 1, 410, (px, py, z, k) => up("clump", kind === "conif" ? "conif" : "mixed", vary(410 + k, 8), px, py + 0.04, 0.55 + h(430 + k) * 0.12, z));
    } else {
      const n = near ? Math.min(3, Math.round(forestPct / 18)) : 1;
      spots(n, 400, 7).forEach(([px, py], k) => up("tree", kind, vary(420 + k, 6), px, py, 0.8 + h(440 + k) * 0.25));
    }
  }
}

/** Mountains and peaks: 1–3 massifs per cell (jittered, rescaled), bridges toward mountain neighbours, foothills. */
function planMountains(c) {
  const { w, i, h, vary, up, cv, elev, desert, isForest, snowy, near, city, lod, bridges } = c;
  const hf = Math.min(1.14, Math.max(0.82, 0.8 + (elev - 1200) / 6000)); // higher ground, taller peaks
  const style = mtnStyle(c);
  const jx = (h(1) - 0.5) * 0.5, jy = (h(2) - 0.5) * 0.22;
  up("mtn", style, vary(4, NV_MTN), jx, 0.26 + jy, (0.8 + h(5) * 0.3) * hf);
  const extra = lod === "far" ? 0 : h(8) < 0.3 ? 0 : h(8) < 0.78 ? 1 : 2;
  const side = h(9) < 0.5 ? -1 : 1;
  for (let k = 0; k < extra; k++) {
    const sd = k ? -side : side;
    const ex = jx * 0.4 + sd * (0.45 + h(10 + k) * 0.2);
    const ey = k ? 0.5 + (h(12 + k) - 0.5) * 0.1 : 0.02 + (h(12 + k) - 0.5) * 0.14;
    up("mtn", style, vary(16 + k, NV_MTN), ex, ey, (0.5 + h(14 + k) * 0.22) * hf);
  }
  for (let d = 0; d < (bridges ? 3 : 0); d++) {
    const j = w.grid.neighbour(i, d);
    if (j < 0 || w.water[j] || w.relief[j] < 2 || h(20 + d) > 0.8) continue;
    const [bx, by] = BRIDGE[d];
    up("mtn", style, vary(24 + d, NV_MTN), bx + (h(27 + d) - 0.5) * 0.2, by + 0.2 + (h(30 + d) - 0.5) * 0.1, (0.55 + h(33 + d) * 0.2) * hf);
  }
  if (!near || city) return;
  // Foothills: a stand of trees or some sage and boulders at the foot of the range.
  const foot = (k) => [(h(40 + k) - 0.5) * 1.2, 0.6 + h(42 + k) * 0.14];
  if (isForest) {
    const kind = snowy ? "conifsnow" : cv === COVER.DECIDUOUS ? "mixed" : "conif";
    for (let k = 0, n = 1 + (h(44) < 0.5); k < n; k++) up("clump", kind, vary(45 + k, 8), ...foot(k), 0.5 + h(47 + k) * 0.15);
  } else if (desert) {
    up("sage", "", vary(45, 6), ...foot(0), 0.9);
    if (h(46) < 0.6) up("rocks", "", vary(47, 6), ...foot(1), 0.85);
  }
}

function mtnStyle({ alpine, cv, desert, snowy, isForest }) {
  if (alpine) return snowy ? "peak" : "arid";
  if (desert) return snowy ? "rocksnow" : "arid";
  if (isForest || cv === COVER.GRASS || cv === COVER.PASTURE || cv === COVER.CROP || cv === COVER.WETLAND) return snowy ? "greensnow" : "green";
  return snowy ? "rocksnow" : "rock";
}

/** Hills: forest ridges or 1–3 cover-tinted mounds plus bridges. Returns the spots on top. */
function planHills(c) {
  const { w, i, h, vary, up, cv, isForest, forestPct, lod, bridges } = c;
  const tops = [];
  if (isForest ? forestPct >= 20 : forestPct >= 40) {
    planWoodedHills(c);
    tops.ridge = true;
    return tops;
  }
  const tone = hillTone(w, cv);
  const mound = (v, px, py, f) => {
    up("hill", tone, v, px, py, f, py);
    tops.push([px - 0.04 * f, py - 0.17 * f, py, 0.34 * f]);
  };
  const jx = (h(1) - 0.5) * 0.5, jy = (h(2) - 0.5) * 0.22;
  mound(vary(4, NV_HILL), jx, 0.22 + jy, 0.85 + h(5) * 0.3);
  const extra = lod === "far" ? 0 : h(8) < 0.35 ? 0 : h(8) < 0.8 ? 1 : 2;
  const side = h(9) < 0.5 ? -1 : 1;
  for (let k = 0; k < extra; k++) {
    const sd = k ? -side : side;
    mound(vary(16 + k, NV_HILL), jx * 0.4 + sd * (0.46 + h(10 + k) * 0.16), k ? 0.5 + (h(12 + k) - 0.5) * 0.1 : -0.06 + (h(12 + k) - 0.5) * 0.12, 0.55 + h(14 + k) * 0.25);
  }
  for (let d = 0; d < (bridges ? 3 : 0); d++) {
    const j = w.grid.neighbour(i, d);
    if (j < 0 || w.water[j] || w.relief[j] < 1 || h(20 + d) > 0.65) continue;
    const [bx, by] = BRIDGE[d];
    const py = by + 0.15 + (h(30 + d) - 0.5) * 0.1;
    up("hill", tone, vary(24 + d, NV_HILL), bx + (h(27 + d) - 0.5) * 0.2, py, 0.5 + h(33 + d) * 0.2, py);
  }
  return tops;
}

/**
 * Wooded hills: 1–3 earthy hill mounds strung along the local ridge direction (so the ranges of the north and the
 * Trường Sơn run NW–SE), then individual trees scattered over their crests and flanks, depth-sorted with them. Each
 * cell varies the count, size, spacing and tilt, so ranges never look stamped.
 */
function planWoodedHills(c) {
  const { w, i, h, vary, up, cv, elev, isForest, forestPct, lod, bridges } = c;
  const conif = cv === COVER.EVERGREEN || (!isForest && (cv === COVER.SCRUB || elev > 1500));
  const mixed = cv === COVER.MIXED;
  const base = (w.coverRGB && w.coverRGB[cv]) || [96, 120, 64];
  const tone = `${cv}.${mix(base, [134, 124, 78], 0.5).map((q) => q | 0).join(".")}`;
  const ang = RIDGE_ANG[ridgeAngle(w, i)] + (h(7) - 0.5) * 0.35; // ±10° of tilt per cell
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const n = lod === "far" ? 1 : h(8) < 0.28 ? 1 : h(8) < 0.8 ? 2 : 3;
  const spread = 0.62 + h(9) * 0.3;
  const mounds = [];
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? (h(11) - 0.5) * 0.2 : (k / (n - 1) - 0.5) * spread + (h(11 + k) - 0.5) * 0.12;
    const f = (n === 1 ? 1.15 : k === 1 || (n === 2 && k === 0) ? 1.0 : 0.8) + h(14 + k) * 0.22;
    const px = ux * t + (h(17 + k) - 0.5) * 0.1, py = 0.16 + uy * t * 0.7 + (h(20 + k) - 0.5) * 0.1;
    up("hill", tone, vary(24 + k, NV_HILL), px, py, f, py);
    mounds.push([px, py, f]);
  }
  for (let d = 0; d < (bridges && lod !== "far" ? 3 : 0); d++) {
    const j = w.grid.neighbour(i, d);
    if (j < 0 || w.water[j] || w.relief[j] !== 1 || h(30 + d) > 0.55) continue;
    const [bx, by] = BRIDGE[d];
    const py = by + 0.15 + (h(33 + d) - 0.5) * 0.1, f = 0.48 + h(36 + d) * 0.18;
    up("hill", tone, vary(39 + d, NV_HILL), bx + (h(42 + d) - 0.5) * 0.2, py, f, py);
    mounds.push([bx, py, f]);
  }
  // Trees: more where the forest is denser and the zoom closer; each stands on a mound's profile.
  const dens = Math.max(0.45, Math.min(1, forestPct / 75));
  const total = Math.round((lod === "far" ? 4 : lod === "mid" ? 8 : lod === "near" ? 11 : 15) * dens);
  for (let k = 0; k < total; k++) {
    const [mx, my, f] = mounds[k % Math.min(mounds.length, n + 1)];
    const u = (h(100 + k) - 0.5) * 1.8; // -0.9 … 0.9 across the mound
    const hh = 0.26 * f * Math.max(0, 1 - u * u * 0.95);
    const tx = mx + u * 0.46 * f - 0.03 * f, ty = my - hh * (0.2 + h(120 + k) * 0.75);
    const kind = conif || (mixed && h(140 + k) < 0.5) ? "conif" : "decid";
    const ts = (0.46 + h(160 + k) * 0.16) * (0.7 + 0.3 * f);
    up("tree", kind, vary(180 + k, 6), tx, ty, ts, my + 0.001 + (ty - my + 0.3) * 0.01);
  }
  // A few trees on the flat around the foot, so the hill stands in woods rather than on a lawn.
  if (lod !== "far") {
    for (let k = 0, m = lod === "mid" ? 2 : 4; k < m; k++) {
      const tx = (h(200 + k) - 0.5) * 1.3, ty = 0.42 + h(210 + k) * 0.22;
      const kind = conif || (mixed && h(220 + k) < 0.5) ? "conif" : "decid";
      up("tree", kind, vary(230 + k, 6), tx, ty, 0.6 + h(240 + k) * 0.2);
    }
  }
}

/** Ridge direction bucket: across the local elevation gradient, pulled toward SW–NE where the slope is gentle. */
function ridgeAngle(w, i) {
  const { grid } = w, e = w.raw.elev;
  // Elevation gradient (m per km, x east / y south) at a cell; smoothed over the cell and its ring so one noisy
  // neighbour cannot swing the direction and neighbouring ridges stay parallel.
  const grad = (c) => {
    const z = e[c];
    const E = (d) => {
      const j = grid.neighbour(c, d);
      return j < 0 || w.water[j] ? z : e[j];
    };
    return [(E(0) - E(3)) / (2 * grid.W), (E(1) + E(2) - E(4) - E(5)) / (6 * grid.R)]; // rows are 1.5 R apart
  };
  let [gx, gy] = grad(i);
  for (let d = 0; d < 6; d++) {
    const j = grid.neighbour(i, d);
    if (j < 0 || w.water[j]) continue;
    const [jx, jy] = grad(j);
    gx += jx * 0.5;
    gy += jy * 0.5;
  }
  gx /= 4;
  gy /= 4;
  const bx = Math.cos(RIDGE_BIAS), by = Math.sin(RIDGE_BIAS);
  let ax = -gy, ay = gx * 0.62; // across the gradient, foreshortened like the art
  const m = Math.hypot(ax, ay);
  let vx = bx, vy = by;
  if (m > 1e-6) {
    if (ax * bx + ay * by < 0) (ax = -ax), (ay = -ay);
    const wgt = Math.min(0.65, Math.hypot(gx, gy) / 8);
    vx = bx * (1 - wgt) + (ax / m) * wgt;
    vy = by * (1 - wgt) + (ay / m) * wgt;
  }
  let ang = Math.atan2(vy, vx) + (hash01(i, 77) - 0.5) * 0.1;
  if (ang > Math.PI / 2) ang -= Math.PI; // a line, not an arrow: keep it in [-90°, 90°]
  else if (ang < -Math.PI / 2) ang += Math.PI;
  let best = 0;
  for (let k = 1; k < RIDGE_ANG.length; k++) if (Math.abs(RIDGE_ANG[k] - ang) < Math.abs(RIDGE_ANG[best] - ang)) best = k;
  return best;
}

/** Hill tint key: the cover's own colour, so hills sit naturally on their tile. */
function hillTone(w, cv) {
  const c = (w.coverRGB && w.coverRGB[cv]) || (cv === COVER.NONE ? [138, 136, 110] : [150, 160, 100]);
  return `${cv}.${c.map((v) => v | 0).join(".")}`;
}

// --- sprite registry ----------------------------------------------------------------------------------------------

// Boxes are in R units around the stamp's anchor (base point for upright art, hex centre for ground art).
const HEX_BOX = { x0: -0.92, y0: -1.02, x1: 0.92, y1: 1.02 };
const SPRITES = {
  clump: { box: { x0: -0.54, y0: -0.76, x1: 0.7, y1: 0.18 }, paint: paintClump },
  tree: { box: { x0: -0.2, y0: -0.6, x1: 0.32, y1: 0.1 }, paint: paintTree },
  mtn: { box: { x0: -1.0, y0: -1.46, x1: 1.12, y1: 0.26 }, paint: paintMountain },
  hill: { box: { x0: -0.76, y0: -0.5, x1: 0.94, y1: 0.2 }, paint: paintHill },
  ridge: { box: { x0: -1.2, y0: -1.02, x1: 1.3, y1: 1.16 }, paint: paintRidge },
  tuft: { box: { x0: -0.17, y0: -0.26, x1: 0.2, y1: 0.06 }, paint: paintTuft },
  sage: { box: { x0: -0.17, y0: -0.17, x1: 0.26, y1: 0.07 }, paint: paintSage },
  cactus: { box: { x0: -0.1, y0: -0.32, x1: 0.2, y1: 0.06 }, paint: paintCactus },
  rocks: { box: { x0: -0.22, y0: -0.2, x1: 0.32, y1: 0.07 }, paint: paintRocks },
  dune: { box: { x0: -0.46, y0: -0.2, x1: 0.6, y1: 0.12 }, paint: paintDune },
  village: { box: { x0: -0.48, y0: -0.42, x1: 0.56, y1: 0.12 }, paint: paintVillage },
  stilt: { box: { x0: -0.32, y0: -0.46, x1: 0.42, y1: 0.08 }, paint: paintStilt },
  palm: { box: { x0: -0.3, y0: -0.66, x1: 0.42, y1: 0.06 }, paint: paintPalm },
  pond: { box: { x0: -0.36, y0: -0.22, x1: 0.42, y1: 0.24 }, paint: paintPond },
  terraces: { box: { x0: -0.56, y0: -0.36, x1: 0.56, y1: 0.36 }, paint: paintTerraces },
  coffee: { box: { x0: -0.54, y0: -0.36, x1: 0.54, y1: 0.36 }, paint: paintCoffee },
  pasture: { box: HEX_BOX, paint: paintPasture },
  meadow: { box: HEX_BOX, paint: paintMeadow },
  marsh: { box: HEX_BOX, paint: paintMarsh },
  suburbGround: SUBURB_ART.ground,
  suburbBuild: SUBURB_ART.build,
  ice: { box: HEX_BOX, paint: paintIce },
  cracks: { box: HEX_BOX, paint: paintCracks },
};

function sprite(env, name, arg, v) {
  const key = `terrain:${name}:${arg}:${v}`;
  let spr = env.memo.get(key);
  if (!spr) {
    const def = SPRITES[name];
    spr = getSprite(key, env.upx, def.box, (g, upx) => def.paint(g, upx, v, arg));
    STAMP_KIND.set(spr.canvas, name);
    env.memo.set(key, spr);
  }
  return spr;
}

// --- painting helpers (all in R units; px = one device pixel) -------------------------------------------------------


function softShadow(g, x, y, rx, ry, a) {
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  gr.addColorStop(0, `rgba(12,16,6,${a})`);
  gr.addColorStop(0.55, `rgba(12,16,6,${a * 0.55})`);
  gr.addColorStop(1, "rgba(12,16,6,0)");
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, rx, 0, TAU);
  g.fill();
  g.restore();
}

function hexClip(g, f) {
  g.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = ((60 * k - 30) * Math.PI) / 180;
    k ? g.lineTo(Math.cos(a) * f, Math.sin(a) * f) : g.moveTo(Math.cos(a) * f, Math.sin(a) * f);
  }
  g.closePath();
  g.clip();
}

function poly(g, pts) {
  g.beginPath();
  pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
}

/** A smooth irregular closed blob (quadratic curves through edge midpoints). */
function blobPath(g, x, y, rx, ry, r, n = 9, wob = 0.3) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU, f = 1 - wob / 2 + r() * wob;
    pts.push([x + Math.cos(a) * rx * f, y + Math.sin(a) * ry * f]);
  }
  g.beginPath();
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const m0 = mid(pts[n - 1], pts[0]);
  g.moveTo(m0[0], m0[1]);
  for (let k = 0; k < n; k++) {
    const p = pts[k], m = mid(p, pts[(k + 1) % n]);
    g.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  g.closePath();
}

// --- trees -------------------------------------------------------------------------------------------------------

const DECID = [
  { deep: "#203a17", dark: "#2f5220", mid: "#4f7d2e", light: "#80ab49", hi: "#bcd77d" },
  { deep: "#2a3f16", dark: "#3e5c22", mid: "#678c34", light: "#9bbd55", hi: "#d2e391" },
  { deep: "#1b3416", dark: "#2a4a1f", mid: "#3f6b2c", light: "#6b9a43", hi: "#a6c873" },
  { deep: "#3a3412", dark: "#5c5420", mid: "#8c8132", light: "#bfa54a", hi: "#e7cf82" },
  { deep: "#3c2410", dark: "#6a3c1a", mid: "#a35c2a", light: "#cf8a3e", hi: "#efc27a" },
];
const CONIF = [
  { deep: "#0d2318", dark: "#163423", mid: "#25523a", light: "#3e7650", hi: "#6e9e6e" },
  { deep: "#10281a", dark: "#1b3a26", mid: "#2f5f3a", light: "#4d8455", hi: "#82b078" },
  { deep: "#0c2420", dark: "#132e28", mid: "#1f4a3f", light: "#356c5a", hi: "#629682" },
];

/** Deciduous tree with its base at (x, y) and height h: trunk, a canopy of shaded lobes, highlight dabs. */
function decidTree(g, x, y, h, pal, px, shadow = true) {
  if (shadow) softShadow(g, x + h * 0.24, y - h * 0.01, h * 0.42, h * 0.13, 0.34);
  g.fillStyle = "#4a3622";
  g.fillRect(x - h * 0.035, y - h * 0.42, h * 0.07, h * 0.42);
  g.fillStyle = "#2a1e12";
  g.fillRect(x + h * 0.005, y - h * 0.42, h * 0.03, h * 0.42);
  const r = h * 0.3, cx = x, cy = y - h * 0.64;
  const lobes = [[-0.5, 0.18, 0.72], [0.52, 0.22, 0.7], [0.02, -0.42, 0.78], [-0.22, 0.4, 0.66], [0.28, 0.42, 0.64], [0, 0.02, 0.9]];
  const body = (grow) => {
    g.beginPath();
    for (const [dx, dy, f] of lobes) {
      g.moveTo(cx + dx * r + f * r + grow, cy + dy * r);
      g.arc(cx + dx * r, cy + dy * r, f * r + grow, 0, TAU);
    }
  };
  body(px * 1.1);
  g.fillStyle = "rgba(18,28,10,.8)";
  g.fill();
  body(0);
  g.fillStyle = pal.dark;
  g.fill();
  // Lobes back to front, each lit from the upper left; lobes on the lit side are brighter.
  for (const [dx, dy, f] of [...lobes].sort((p, q) => p[1] - q[1])) {
    const lx = cx + dx * r, ly = cy + dy * r, lr = f * r;
    const gr = g.createRadialGradient(lx - lr * 0.4, ly - lr * 0.45, lr * 0.05, lx, ly, lr * 1.05);
    const lit = dx + dy < -0.2;
    gr.addColorStop(0, lit ? pal.hi : pal.light);
    gr.addColorStop(0.45, lit ? pal.light : pal.mid);
    gr.addColorStop(1, pal.dark);
    g.fillStyle = gr;
    g.beginPath();
    g.arc(lx, ly, lr, 0, TAU);
    g.fill();
  }
  // Dark underside.
  g.save();
  body(0);
  g.clip();
  g.fillStyle = "rgba(10,25,5,.32)";
  g.beginPath();
  g.ellipse(cx + r * 0.25, cy + r * 1.05, r * 1.1, r * 0.55, 0, 0, TAU);
  g.fill();
  g.restore();
  if (h / px > 18) {
    g.fillStyle = pal.hi;
    g.globalAlpha = 0.7;
    for (const [dx, dy, f] of [[-0.45, -0.25, 0.14], [-0.1, -0.7, 0.12], [-0.6, 0.15, 0.1]]) {
      g.beginPath();
      g.arc(cx + dx * r, cy + dy * r, f * r, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  }
}

/** Conifer with its base at (x, y) and height h: stacked two-tone tiers, optional snow on the tier tops. */
function conifTree(g, x, y, h, pal, px, shadow = true, snow = false) {
  if (shadow) softShadow(g, x + h * 0.26, y, h * 0.34, h * 0.1, 0.34);
  g.fillStyle = "#3a2a1a";
  g.fillRect(x - h * 0.025, y - h * 0.16, h * 0.05, h * 0.16);
  const tiers = 3;
  for (let t = 0; t < tiers; t++) {
    const yb = y - h * (0.1 + t * 0.24);
    const ya = t === tiers - 1 ? y - h : yb - h * (0.42 - t * 0.04);
    const wd = h * (0.25 - t * 0.055);
    const path = () => {
      g.beginPath();
      g.moveTo(x, ya);
      g.quadraticCurveTo(x - wd * 0.3, yb - (yb - ya) * 0.35, x - wd, yb);
      g.lineTo(x - wd * 0.45, yb - h * 0.025);
      g.lineTo(x, yb + h * 0.02);
      g.lineTo(x + wd * 0.45, yb - h * 0.025);
      g.lineTo(x + wd, yb);
      g.quadraticCurveTo(x + wd * 0.3, yb - (yb - ya) * 0.35, x, ya);
      g.closePath();
    };
    path();
    g.strokeStyle = pal.deep;
    g.lineWidth = px * 1.6;
    g.stroke();
    const gr = g.createLinearGradient(x - wd, 0, x + wd, 0);
    gr.addColorStop(0, pal.light);
    gr.addColorStop(0.46, pal.mid);
    gr.addColorStop(0.54, pal.dark);
    gr.addColorStop(1, pal.deep);
    g.fillStyle = gr;
    g.fill();
    if (snow) {
      g.fillStyle = "rgba(245,249,253,.92)";
      g.beginPath();
      g.moveTo(x, ya);
      g.quadraticCurveTo(x - wd * 0.2, ya + (yb - ya) * 0.3, x - wd * 0.55, ya + (yb - ya) * 0.62);
      g.lineTo(x - wd * 0.1, ya + (yb - ya) * 0.45);
      g.lineTo(x + wd * 0.2, ya + (yb - ya) * 0.35);
      g.closePath();
      g.fill();
    }
  }
  if (h / px > 20) {
    g.strokeStyle = pal.hi;
    g.globalAlpha = 0.55;
    g.lineWidth = px;
    g.beginPath();
    g.moveTo(x - h * 0.02, y - h * 0.95);
    g.lineTo(x - h * 0.09, y - h * 0.62);
    g.stroke();
    g.globalAlpha = 1;
  }
}

function paintClump(g, upx, v, kind) {
  const r = rng(v * 7919 + kind.length * 131 + 7);
  const px = 1 / upx;
  const n = 5 + Math.floor(r() * 3);
  const trees = [];
  for (let k = 0; k < n; k++) {
    const ang = (k / n) * TAU + r() * 0.6;
    const rad = k === 0 ? 0 : 0.6 + r() * 0.4;
    const conif = kind.startsWith("conif") || (kind === "mixed" && r() < 0.5);
    trees.push({
      x: Math.cos(ang) * 0.3 * rad, y: Math.sin(ang) * 0.1 * rad, conif,
      h: conif ? 0.44 + r() * 0.14 : 0.36 + r() * 0.1,
      pal: conif ? CONIF[Math.floor(r() * CONIF.length)] : DECID[Math.floor(r() * (kind === "mixed" ? 5 : 4))],
    });
  }
  trees.sort((p, q) => p.y - q.y);
  softShadow(g, 0.14, 0.03, 0.46, 0.14, 0.3);
  for (const t of trees) softShadow(g, t.x + t.h * 0.24, t.y, t.h * 0.36, t.h * 0.1, 0.22);
  for (const t of trees) {
    if (t.conif) conifTree(g, t.x, t.y, t.h, t.pal, px, false, kind === "conifsnow");
    else decidTree(g, t.x, t.y, t.h, t.pal, px, false);
  }
}

function paintTree(g, upx, v, kind) {
  const px = 1 / upx;
  if (kind === "conif") conifTree(g, 0, 0, 0.5, CONIF[v % CONIF.length], px);
  else decidTree(g, 0, 0, 0.44, DECID[v % 4], px);
}

// --- mountains ---------------------------------------------------------------------------------------------------

// Rock palettes. arid = bare grey-brown ranges (scrub on the lower slopes, no snow).
const MTN = {
  rock: { lit: "#b9a990", lit2: "#8d7d68", sh: "#5f5246", sh2: "#43392f", line: "#2a2119", snow: 0, h: 0.95 },
  rocksnow: { lit: "#aea89f", lit2: "#837c72", sh: "#5b5752", sh2: "#3d3a37", line: "#24211e", snow: 0.42, h: 1.02 },
  peak: { lit: "#b3aea7", lit2: "#8a847c", sh: "#5c5956", sh2: "#3e3c3a", line: "#211f1d", snow: 0.6, h: 1.24 },
  arid: { lit: "#c3b296", lit2: "#9a876b", sh: "#6b6052", sh2: "#4a4239", line: "#2b241c", snow: 0, h: 0.84, sage: true },
  green: { lit: "#a59b85", lit2: "#6c7a4a", sh: "#4f5442", sh2: "#2e3a25", line: "#1d2317", snow: 0, h: 0.9, trees: true },
  greensnow: { lit: "#aaa49a", lit2: "#6f7b52", sh: "#55574d", sh2: "#30392a", line: "#1f2219", snow: 0.36, h: 1.02, trees: true },
};
const HAZE = [150, 170, 190];

/** One massif: a main peak, sometimes a hazy shoulder behind and a low spur in front. Base centre at (0, 0). */
function paintMountain(g, upx, v, style) {
  const S = MTN[style] || MTN.rock;
  const r = rng(v * 104729 + style.length * 977 + 3);
  const px = 1 / upx;
  const H = S.h * (0.9 + r() * 0.16);
  const lean = r() < 0.5 ? -1 : 1;
  const peaks = [];
  if (r() < 0.65) peaks.push({ x: lean * (0.36 + r() * 0.1), h: H * (0.5 + r() * 0.2), wl: 0.34 + r() * 0.06, wr: 0.36 + r() * 0.06, haze: 0.24, y: -0.04 });
  peaks.push({ x: (r() - 0.5) * 0.1, h: H, wl: 0.48 + r() * 0.14, wr: 0.46 + r() * 0.14, haze: 0, y: 0 });
  if (r() < 0.45) peaks.push({ x: -lean * (0.36 + r() * 0.1), h: H * (0.3 + r() * 0.12), wl: 0.26, wr: 0.3, haze: 0, y: 0.07, foot: true });
  softShadow(g, 0.28, 0.04, 0.82, 0.17, 0.38);
  for (const p of peaks) drawPeak(g, p, S, r, px);
  // Scree: darken the lower slopes into the ground.
  g.save();
  g.globalCompositeOperation = "source-atop";
  const gr = g.createLinearGradient(0, -0.3, 0, 0.1);
  gr.addColorStop(0, "rgba(30,22,14,0)");
  gr.addColorStop(1, "rgba(30,22,14,.35)");
  g.fillStyle = gr;
  g.fillRect(-1.3, -0.3, 2.6, 0.6);
  g.restore();
  if (S.sage && upx > 24) {
    // Sparse sagebrush and juniper dots on the lower slopes.
    for (let k = 0, n = 7 + Math.floor(r() * 6); k < n; k++) {
      const x = (r() - 0.5) * 1.05, y = -0.02 - r() * 0.16 * (1 - Math.abs(x));
      const br = Math.max(px * 1.4, 0.014 + r() * 0.01);
      g.fillStyle = "rgba(40,44,24,.55)";
      g.beginPath();
      g.arc(x + br * 0.4, y + br * 0.3, br, 0, TAU);
      g.fill();
      g.fillStyle = k % 3 ? "#7d8656" : "#5f6b45";
      g.beginPath();
      g.arc(x, y, br, 0, TAU);
      g.fill();
    }
  }
  if (S.trees) {
    const n = 5 + Math.floor(r() * 3);
    const ts = [];
    for (let k = 0; k < n; k++) ts.push([(k / (n - 1) - 0.5) * 1.05 + (r() - 0.5) * 0.1, 0.03 + r() * 0.1, 0.17 + r() * 0.09]);
    ts.sort((p, q) => p[1] - q[1]);
    for (const [tx, ty, th] of ts) conifTree(g, tx, ty, th, CONIF[Math.floor(r() * CONIF.length)], px, true, S.snow > 0 && r() < 0.4);
  }
}

function drawPeak(g, p, S, r, px) {
  const by = p.y, sx = p.x, sy = by - p.h;
  const col = (c) => css(p.haze ? mix(C(c), HAZE, p.haze) : C(c));
  const L = [[sx - p.wl, by]], Rr = [];
  for (const t of [0.28, 0.52, 0.76]) {
    L.push([sx - p.wl * (1 - t) + (r() - 0.5) * 0.05, by - p.h * t + (r() - 0.5) * p.h * 0.1]);
    Rr.push([sx + p.wr * (1 - t) + (r() - 0.5) * 0.05, by - p.h * t + (r() - 0.5) * p.h * 0.1]);
  }
  Rr.reverse(); // summit → base
  const top = [sx, sy];
  const rEnd = sx + p.wr * (0.15 + r() * 0.15);
  const ridge = [top];
  for (const t of [0.22, 0.45, 0.7]) ridge.push([sx + (rEnd - sx) * t + (r() - 0.5) * 0.09, sy + p.h * t]);
  ridge.push([rEnd, by]);
  const lit = [...L, top, ...ridge.slice(1)];
  const shd = [top, ...Rr, [sx + p.wr, by], ...ridge.slice(1).reverse()];
  const sil = [...L, top, ...Rr, [sx + p.wr, by]];

  // Outline under the faces, then the lit and shaded faces.
  g.beginPath();
  sil.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.strokeStyle = S.line;
  g.globalAlpha = p.haze ? 0.45 : 0.8;
  g.lineWidth = px * 2.2;
  g.stroke();
  g.globalAlpha = 1;
  let gr = g.createLinearGradient(sx - p.wl * 0.4, sy, sx - p.wl * 0.2, by);
  gr.addColorStop(0, col(S.lit));
  gr.addColorStop(1, col(S.lit2));
  poly(g, lit);
  g.fillStyle = gr;
  g.fill();
  gr = g.createLinearGradient(sx, sy, sx + p.wr * 0.4, by);
  gr.addColorStop(0, col(S.sh));
  gr.addColorStop(1, col(S.sh2));
  poly(g, shd);
  g.fillStyle = gr;
  g.fill();

  // Gullies on both faces.
  g.lineWidth = Math.max(px, 0.012);
  for (let k = 1; k < ridge.length - 1; k++) {
    const [rx, ry] = ridge[k];
    g.beginPath();
    g.moveTo(rx, ry);
    g.quadraticCurveTo(rx - 0.06, ry + 0.08, rx - 0.12 - r() * 0.1, ry + 0.16 + r() * 0.1);
    g.strokeStyle = col(S.sh);
    g.globalAlpha = 0.55;
    g.stroke();
    g.beginPath();
    g.moveTo(rx + 0.02, ry + 0.02);
    g.quadraticCurveTo(rx + 0.08, ry + 0.1, rx + 0.12 + r() * 0.08, ry + 0.18 + r() * 0.08);
    g.strokeStyle = "rgba(255,255,255,.5)";
    g.globalAlpha = 0.28;
    g.stroke();
    g.globalAlpha = 1;
  }

  // Snow cap: everything above a jagged snow line, white on the lit face and blue-grey in shade.
  const snowF = S.snow * (p.foot ? 0 : p.haze ? 0.85 : 1);
  if (snowF > 0) {
    const y0 = sy + p.h * snowF;
    const cap = new Path2D();
    cap.moveTo(sx - p.wl - 0.2, sy - 0.2);
    cap.lineTo(sx + p.wr + 0.2, sy - 0.2);
    cap.lineTo(sx + p.wr + 0.2, y0 - p.h * 0.08);
    const n = 9;
    for (let k = 0; k <= n; k++) {
      const xx = sx + p.wr + 0.1 - ((p.wl + p.wr + 0.2) * k) / n;
      const drip = k % 2 ? p.h * (0.05 + r() * 0.09) : -p.h * (0.02 + r() * 0.04);
      cap.lineTo(xx, y0 + drip - (xx - sx) * 0.12);
    }
    cap.lineTo(sx - p.wl - 0.2, y0);
    cap.closePath();
    for (const [face, color] of [[lit, "#f6f9fc"], [shd, "#aebfd4"]]) {
      g.save();
      poly(g, face);
      g.clip();
      g.fillStyle = p.haze ? css(mix(C(color), HAZE, p.haze * 0.6)) : color;
      g.fill(cap);
      g.restore();
    }
  }

  // Sunlit ridge highlight near the summit.
  g.beginPath();
  g.moveTo(L[2][0], L[2][1]);
  g.lineTo(L[3][0], L[3][1]);
  g.lineTo(top[0], top[1]);
  g.strokeStyle = snowF > 0 ? "rgba(255,255,255,.85)" : "rgba(255,240,210,.45)";
  g.lineWidth = Math.max(px * 1.2, 0.012);
  g.stroke();
}

// --- hills -------------------------------------------------------------------------------------------------------

/** Hill colours from the cover colour: pulled toward olive (green covers) or ochre (dry ones) and darkened, so a
 *  hill never reads as pale snow; highlights stay well below white. */
function hillPalette(cv, c) {
  const dry = cv === COVER.SCRUB || cv === COVER.BARREN;
  const ice = cv === COVER.ICE;
  // Unknown / foreign land keeps its own (elevation-ramp) hue, only darkened.
  const pull = cv === COVER.NONE ? 0 : 0.38;
  const base = ice ? shade(c, -0.08) : shade(mix(c, dry ? [170, 128, 72] : [100, 116, 54], pull), -0.1);
  return {
    hi: mix(shade(base, 0.24), WARM, 0.22), light: mix(shade(base, 0.12), WARM, 0.12), base,
    dark: mix(shade(base, -0.3), COOL, 0.14), deep: mix(shade(base, -0.5), COOL, 0.2), dry, ice,
  };
}

/** One hill (base centre at 0, 0): a main mound, sometimes a shoulder behind and a knoll in front. */
function paintHill(g, upx, v, toneKey) {
  const [cvStr, ...rgb] = toneKey.split(".");
  const cv = +cvStr;
  const T = hillPalette(cv, rgb.map(Number));
  const r = rng(v * 613 + cv * 37 + 11);
  const px = 1 / upx;
  const mounds = [];
  if (v % 3 === 0) mounds.push({ x: 0.3 + r() * 0.1, w: 0.3 + r() * 0.06, h: 0.16 + r() * 0.05, y: -0.04 });
  mounds.push({ x: (r() - 0.5) * 0.08, w: 0.46 + r() * 0.1, h: 0.26 + r() * 0.08, y: 0 });
  if (v % 4 === 1) mounds.push({ x: -0.36 - r() * 0.05, w: 0.24, h: 0.11 + r() * 0.04, y: 0.05 });
  for (const m of mounds) softShadow(g, m.x + m.w * 0.35, m.y + 0.02, m.w * 0.95, 0.11, 0.34);
  for (const m of mounds) paintMound(g, m, T, r, px, upx);
}

function paintMound(g, { x, y, w, h }, T, r, px, upx) {
  const top = x - w * 0.12 + (r() - 0.5) * 0.08;
  const path = new Path2D();
  path.moveTo(x - w, y);
  path.bezierCurveTo(x - w * 0.62, y - h * 0.78, top - w * 0.28, y - h * 1.02, top, y - h);
  path.bezierCurveTo(top + w * 0.36, y - h * 0.98, x + w * 0.72, y - h * 0.45, x + w, y);
  path.quadraticCurveTo(x, y + h * 0.12, x - w, y);
  path.closePath();
  g.strokeStyle = css(T.deep, 0.6);
  g.lineWidth = px * 2;
  g.stroke(path);
  let gr = g.createLinearGradient(x - w, y - h, x + w * 0.6, y);
  gr.addColorStop(0, css(T.light));
  gr.addColorStop(0.45, css(T.base));
  gr.addColorStop(1, css(T.dark));
  g.fillStyle = gr;
  g.fill(path);
  g.save();
  g.clip(path);
  // Shadow side: right of a soft terminator through the summit.
  gr = g.createLinearGradient(top + w * 0.05, 0, x + w * 0.85, 0);
  gr.addColorStop(0, css(T.dark, 0));
  gr.addColorStop(0.35, css(T.dark, 0.55));
  gr.addColorStop(1, css(T.deep, 0.75));
  g.fillStyle = gr;
  g.fillRect(x - w, y - h * 1.2, w * 2.2, h * 1.4);
  // Sunlit upper-left slope, and the foot darkening into the ground.
  gr = g.createRadialGradient(top - w * 0.25, y - h * 0.85, 0, top - w * 0.2, y - h * 0.7, w * 0.55);
  gr.addColorStop(0, css(T.hi, 0.7));
  gr.addColorStop(1, css(T.hi, 0));
  g.fillStyle = gr;
  g.fillRect(x - w, y - h * 1.2, w * 2.2, h * 1.4);
  gr = g.createLinearGradient(0, y - h * 0.35, 0, y);
  gr.addColorStop(0, css(T.deep, 0));
  gr.addColorStop(1, css(T.deep, 0.35));
  g.fillStyle = gr;
  g.fillRect(x - w, y - h * 0.35, w * 2.2, h * 0.5);
  // Surface: sage and juniper dots on dry hills, grass strokes on green ones.
  if (upx * w > 20 && !T.ice) {
    const prof = (t) => Math.sin(Math.PI * (0.12 + t * 0.76));
    if (T.dry) {
      for (let k = 0, n = 6 + Math.floor(r() * 6); k < n; k++) {
        const t = r(), gx = x - w * 0.8 + t * w * 1.6, gy = y - h * (0.15 + r() * 0.7) * prof(t);
        const br = Math.max(px * 1.3, 0.016 + r() * 0.012);
        g.fillStyle = css(T.deep, 0.5);
        g.beginPath();
        g.arc(gx + br * 0.5, gy + br * 0.35, br, 0, TAU);
        g.fill();
        g.fillStyle = k % 3 ? "#7a8352" : "#5d6942";
        g.beginPath();
        g.arc(gx, gy, br, 0, TAU);
        g.fill();
        if (br / px > 3) {
          g.fillStyle = "rgba(205,212,160,.6)";
          g.beginPath();
          g.arc(gx - br * 0.35, gy - br * 0.35, br * 0.35, 0, TAU);
          g.fill();
        }
      }
    } else {
      g.lineWidth = Math.max(px, 0.01);
      for (let k = 0; k < 16; k++) {
        const t = r(), gx = x - w * 0.8 + t * w * 1.6, gy = y - h * (0.1 + r() * 0.75) * prof(t);
        g.strokeStyle = k % 2 ? css(T.hi, 0.5) : css(T.deep, 0.35);
        g.beginPath();
        g.moveTo(gx, gy);
        g.lineTo(gx - 0.008, gy - 0.035);
        g.stroke();
      }
    }
  }
  g.restore();
  // Sunlit crest.
  g.beginPath();
  g.moveTo(x - w * 0.82, y - h * 0.3);
  g.bezierCurveTo(x - w * 0.6, y - h * 0.78, top - w * 0.28, y - h * 1.0, top + w * 0.1, y - h * 0.99);
  g.strokeStyle = css(T.hi, 0.8);
  g.lineWidth = Math.max(px * 1.4, 0.014);
  g.stroke();
}

// --- forested ridges ---------------------------------------------------------------------------------------------

/**
 * A long, low, tree-crowned ridge centred on its base line at (0, 0), running along RIDGE_ANG[ai] (R units, about
 * 1.7 R long). The face toward the viewer grades from a lit crest to a dark foot with a clear shadow line along the
 * base; crowns of trees stand along the crest. arg = "kind|angle index|density" (kind: decid / conif / mixed;
 * density: d dense, s sparse).
 */
function paintRidge(g, upx, v, arg) {
  const [kind, ais, dens] = arg.split("|");
  const ai = +ais, ang = RIDGE_ANG[ai];
  const r = rng(v * 4241 + ai * 71 + kind.length * 13 + (dens === "d" ? 5 : 0) + 1);
  const px = 1 / upx;
  const ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux; // n: toward the viewer (down the screen)
  const L = 0.82 + r() * 0.1, H = 0.2 + r() * 0.07, wf = 0.17 + r() * 0.04;
  const k1 = 5 + r() * 4, p1 = r() * TAU, k2 = 11 + r() * 5, p2 = r() * TAU;
  const pal = kind === "conif" ? CONIF[v % 2] : DECID[v % 3];
  const N = 30, crest = [], foot = [], envs = [];
  for (let k = 0; k <= N; k++) {
    const t = -1 + (2 * k) / N, env = Math.pow(1 - t * t, 0.55);
    const prof = env * (1 + 0.13 * Math.sin(t * k1 + p1) + 0.06 * Math.sin(t * k2 + p2));
    const bx = ux * t * L, by = uy * t * L, fw = wf * (0.35 + 0.65 * env);
    crest.push([bx, by - H * prof]);
    foot.push([bx + nx * fw, by + ny * fw]);
    envs.push(env);
  }
  // Cast shadow down-right of the whole ridge.
  g.save();
  g.translate(nx * wf * 0.9 + 0.06, ny * wf * 0.9 + 0.02);
  g.rotate(ang);
  softShadow(g, 0, 0, L * 1.05, wf * 0.95, 0.42);
  g.restore();
  const face = new Path2D();
  crest.forEach(([x, y], k) => (k ? face.lineTo(x, y) : face.moveTo(x, y)));
  for (let k = N; k >= 0; k--) face.lineTo(foot[k][0], foot[k][1]);
  face.closePath();
  g.strokeStyle = css(C(pal.deep), 0.85);
  g.lineWidth = px * 2.2;
  g.stroke(face);
  let gr = g.createLinearGradient(0, -H, nx * wf, ny * wf);
  gr.addColorStop(0, pal.light);
  gr.addColorStop(0.35, pal.mid);
  gr.addColorStop(0.75, pal.dark);
  gr.addColorStop(1, pal.deep);
  g.fillStyle = gr;
  g.fill(face);
  g.save();
  g.clip(face);
  // Light from the upper left: the western end brighter, the eastern end cooler.
  gr = g.createLinearGradient(-ux * L, -uy * L, ux * L, uy * L);
  gr.addColorStop(0, "rgba(255,240,190,.2)");
  gr.addColorStop(0.5, "rgba(255,240,190,0)");
  gr.addColorStop(1, "rgba(10,20,40,.22)");
  g.fillStyle = gr;
  g.fillRect(-1.3, -1.1, 2.6, 2.3);
  // Canopy texture on the face: dark dabs with lit tops, plus a few gullies running down.
  const dabs = Math.round((dens === "d" ? 90 : 55) * Math.min(1, upx / 40));
  for (let k = 0; k < dabs; k++) {
    const q = Math.floor(r() * N), s = 0.12 + r() * 0.85;
    const cx = crest[q][0] + (foot[q][0] - crest[q][0]) * s, cy = crest[q][1] + (foot[q][1] - crest[q][1]) * s;
    const br = Math.max(px * 1.2, 0.02 + r() * 0.015);
    g.fillStyle = css(C(pal.deep), 0.45);
    g.beginPath();
    g.arc(cx + br * 0.3, cy + br * 0.3, br, 0, TAU);
    g.fill();
    g.fillStyle = css(C(pal.light), 0.4);
    g.beginPath();
    g.arc(cx - br * 0.3, cy - br * 0.35, br * 0.6, 0, TAU);
    g.fill();
  }
  g.strokeStyle = css(C(pal.deep), 0.35);
  g.lineWidth = Math.max(px, 0.01);
  for (let k = 0; k < 4; k++) {
    const q = 4 + Math.floor(r() * (N - 8));
    g.beginPath();
    g.moveTo(crest[q][0], crest[q][1] + 0.02);
    g.quadraticCurveTo(crest[q][0] + 0.03, (crest[q][1] + foot[q][1]) / 2, foot[q][0] + 0.02, foot[q][1]);
    g.stroke();
  }
  g.restore();
  // Lit crest line (upper-left edge) and the shadow line along the foot.
  g.beginPath();
  for (let k = 1; k <= Math.round(N * 0.75); k++) (k > 1 ? g.lineTo : g.moveTo).call(g, crest[k][0], crest[k][1]);
  g.strokeStyle = css(C(pal.hi), 0.85);
  g.lineWidth = Math.max(px * 1.5, 0.012);
  g.stroke();
  g.beginPath();
  foot.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.strokeStyle = "rgba(12,20,8,.6)";
  g.lineWidth = Math.max(px * 1.5, 0.012);
  g.stroke();
  // Crowns along the crest, back to front.
  const step = dens === "d" ? 0.07 : 0.11;
  const crowns = [];
  for (let t = -0.94; t <= 0.94; t += step * (0.75 + r() * 0.5)) {
    const q = Math.round(((t + 1) / 2) * N), env = envs[q];
    if (env < 0.3 && r() < 0.5) continue;
    const conif = kind === "conif" || (kind === "mixed" && r() < 0.5);
    crowns.push({
      x: crest[q][0] + (r() - 0.5) * 0.02, y: crest[q][1] + 0.012 + r() * 0.025, s: (0.055 + r() * 0.028) * (0.6 + 0.4 * env), conif,
      pal: conif ? CONIF[Math.floor(r() * CONIF.length)] : DECID[Math.floor(r() * (kind === "mixed" ? 5 : 4))],
    });
  }
  crowns.sort((p, q) => p.y - q.y);
  for (const c of crowns) crown(g, c.x, c.y, c.s, c.pal, c.conif, px);
}

/** A small tree crown with its base at (x, y), height ~s: a two-tone spire or a round lit ball, outlined. */
function crown(g, x, y, s, pal, conif, px) {
  if (conif) {
    const w2 = s * 0.42, tip = y - s * 1.45;
    poly(g, [[x, tip], [x + w2, y], [x - w2, y]]);
    g.strokeStyle = pal.deep;
    g.lineWidth = px * 1.4;
    g.stroke();
    const gr = g.createLinearGradient(x - w2, 0, x + w2, 0);
    gr.addColorStop(0, pal.light);
    gr.addColorStop(0.48, pal.mid);
    gr.addColorStop(0.52, pal.dark);
    gr.addColorStop(1, pal.deep);
    g.fillStyle = gr;
    g.fill();
    return;
  }
  const cr = s * 0.62, cy = y - cr * 0.9;
  g.beginPath();
  g.arc(x, cy, cr + px * 1.1, 0, TAU);
  g.fillStyle = pal.deep;
  g.fill();
  const gr = g.createRadialGradient(x - cr * 0.4, cy - cr * 0.45, cr * 0.05, x, cy, cr);
  gr.addColorStop(0, pal.hi);
  gr.addColorStop(0.45, pal.mid);
  gr.addColorStop(1, pal.dark);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, cy, cr, 0, TAU);
  g.fill();
}

// --- small cover stamps -----------------------------------------------------------------------------------------

function paintTuft(g, upx, v, kind) {
  const r = rng(v * 97 + kind.length * 13 + 3);
  const px = 1 / upx;
  softShadow(g, 0.05, 0.005, 0.13, 0.035, 0.26);
  const n = 11;
  const tips = [];
  for (let k = 0; k < n; k++) {
    const bx = (r() - 0.5) * 0.13, lean = bx * 0.9 + (r() - 0.5) * 0.1, hh = 0.11 + r() * 0.1;
    const wd = Math.max(0.011, px * 1.3);
    g.beginPath();
    g.moveTo(bx - wd, 0);
    g.quadraticCurveTo(bx + lean * 0.25, -hh * 0.6, bx + lean, -hh);
    g.quadraticCurveTo(bx + lean * 0.25 + wd * 0.6, -hh * 0.55, bx + wd, 0);
    g.closePath();
    g.fillStyle = k < n * 0.4 ? "#3f5a22" : k < n * 0.75 ? "#6f9238" : "#a8c660";
    g.fill();
    tips.push([bx + lean, -hh]);
  }
  if (kind === "flowers") {
    const cols = ["#f4dc5c", "#fbf6ea", "#c79ade", "#f0a04a"];
    for (let k = 0; k < 4; k++) {
      const [tx, ty] = tips[n - 1 - k];
      g.fillStyle = cols[(v + k) % cols.length];
      g.beginPath();
      g.arc(tx, ty, Math.max(0.014, px * 1.4), 0, TAU);
      g.fill();
    }
  }
}

function paintSage(g, upx, v) {
  const r = rng(v * 151 + 9);
  const px = 1 / upx;
  const blobs = [];
  const n = 3 + Math.floor(r() * 2);
  for (let k = 0; k < n; k++) blobs.push([(r() - 0.5) * 0.18, -(r() * 0.04), 0.035 + r() * 0.025]);
  blobs.sort((p, q) => p[1] - q[1]);
  for (const [bx, by, br] of blobs) softShadow(g, bx + br * 0.8, by + 0.005, br * 1.4, br * 0.45, 0.28);
  for (const [bx, by, br] of blobs) {
    const cy = by - br * 0.8;
    g.beginPath();
    g.arc(bx, cy, br + px * 1.1, 0, TAU);
    g.fillStyle = "rgba(48,52,28,.75)";
    g.fill();
    const gr = g.createRadialGradient(bx - br * 0.4, cy - br * 0.45, br * 0.05, bx, cy, br);
    gr.addColorStop(0, "#d2d6a4");
    gr.addColorStop(0.45, "#97a06d");
    gr.addColorStop(1, "#5c6743");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(bx, cy, br, 0, TAU);
    g.fill();
  }
}

function paintCactus(g, upx, v) {
  const r = rng(v * 173 + 21);
  const px = 1 / upx;
  const H = 0.2 + r() * 0.07, W = 0.04;
  softShadow(g, 0.07, 0.0, 0.12, 0.03, 0.3);
  const armL = r() < 0.8, armR = r() < 0.8;
  const ya = -H * (0.45 + r() * 0.15), yb = -H * (0.55 + r() * 0.15);
  const stems = [[[0, 0], [0, -H]]];
  if (armR) stems.push([[0, ya], [0.065, ya], [0.065, ya - 0.07]]);
  if (armL) stems.push([[0, yb], [-0.055, yb], [-0.055, yb - 0.055]]);
  const strokeAll = (width, style) => {
    g.strokeStyle = style;
    g.lineWidth = width;
    for (const s of stems) {
      g.beginPath();
      s.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
  };
  strokeAll(W + px * 2.2, "#1f3518");
  const gr = g.createLinearGradient(-0.08, 0, 0.09, 0);
  gr.addColorStop(0, "#9cc777");
  gr.addColorStop(0.5, "#5f8f46");
  gr.addColorStop(1, "#365a2b");
  strokeAll(W, gr);
  g.save();
  g.translate(-W * 0.22, 0);
  strokeAll(Math.max(W * 0.18, px), "rgba(210,240,170,.6)");
  g.restore();
}

function paintRocks(g, upx, v) {
  const r = rng(v * 199 + 31);
  const px = 1 / upx;
  const n = 2 + Math.floor(r() * 2);
  const rocks = [];
  for (let k = 0; k < n; k++) rocks.push([(r() - 0.5) * 0.2, -r() * 0.04, 0.04 + r() * 0.04]);
  rocks.sort((p, q) => p[1] - q[1]);
  for (const [bx, by, br] of rocks) softShadow(g, bx + br * 0.7, by + 0.005, br * 1.4, br * 0.4, 0.3);
  for (const [bx, by, br] of rocks) {
    const pts = [];
    for (let k = 0; k < 7; k++) {
      const a = Math.PI + (k / 6) * Math.PI;
      const f = 0.8 + r() * 0.35;
      pts.push([bx + Math.cos(a) * br * f, by + Math.min(0, Math.sin(a) * br * 1.1 * f)]);
    }
    poly(g, pts);
    g.strokeStyle = "rgba(35,28,22,.8)";
    g.lineWidth = px * 2;
    g.stroke();
    g.fillStyle = "#71675a";
    g.fill();
    g.save();
    g.clip();
    poly(g, [[bx - br * 1.2, by - br * 1.3], [bx + br * 0.25, by - br * 1.3], [bx - br * 0.1, by - br * 0.3], [bx - br * 1.2, by - br * 0.1]]);
    g.fillStyle = "#b9ad99";
    g.fill();
    g.restore();
  }
}

function paintDune(g, upx, v) {
  const r = rng(v * 223 + 7);
  const px = 1 / upx;
  const w = 0.32 + r() * 0.08, h = 0.1 + r() * 0.04, cx = (r() - 0.5) * 0.08;
  softShadow(g, 0.1, 0.03, w * 1.1, 0.05, 0.18);
  const body = new Path2D();
  body.moveTo(-w, 0.02);
  body.quadraticCurveTo(cx - w * 0.4, -h * 1.1, cx + 0.04, -h);
  body.quadraticCurveTo(cx + w * 0.5, -h * 0.6, w, 0.03);
  body.quadraticCurveTo(0, 0.07, -w, 0.02);
  let gr = g.createLinearGradient(-w, -h, w * 0.3, 0.05);
  gr.addColorStop(0, "#f2e1b0");
  gr.addColorStop(1, "#d3b37a");
  g.fillStyle = gr;
  g.fill(body);
  // Slip face in shade.
  const slip = new Path2D();
  slip.moveTo(cx + 0.04, -h);
  slip.quadraticCurveTo(cx + w * 0.5, -h * 0.6, w, 0.03);
  slip.quadraticCurveTo(cx + w * 0.35, 0.02, cx + 0.1, -h * 0.25);
  slip.closePath();
  gr = g.createLinearGradient(cx, -h, w, 0);
  gr.addColorStop(0, "#a27c4a");
  gr.addColorStop(1, "#c29d66");
  g.fillStyle = gr;
  g.fill(slip);
  g.beginPath();
  g.moveTo(-w * 0.6, -h * 0.55);
  g.quadraticCurveTo(cx - w * 0.3, -h * 1.05, cx + 0.04, -h);
  g.quadraticCurveTo(cx + w * 0.5, -h * 0.6, w * 0.9, 0.02);
  g.strokeStyle = "rgba(255,250,228,.8)";
  g.lineWidth = Math.max(px * 1.2, 0.01);
  g.stroke();
  if (upx > 40) {
    g.strokeStyle = "rgba(160,120,70,.35)";
    g.lineWidth = px;
    for (let k = 1; k <= 3; k++) {
      g.beginPath();
      g.moveTo(-w * 0.8 + k * 0.08, 0.01 - k * 0.012);
      g.quadraticCurveTo(-w * 0.4 + k * 0.05, -h * 0.4 - k * 0.01, cx - 0.05 + k * 0.02, -h * 0.5);
      g.stroke();
    }
  }
}

// --- Vietnamese countryside (illustrative motifs; placement rules at "Where the Vietnamese motifs go") -------------

/** A bamboo clump (tre) with its base at (x, y), height hh: arching culms and feathery leaf masses. */
function bamboo(g, x, y, hh, px, r) {
  softShadow(g, x + hh * 0.2, y, hh * 0.4, hh * 0.1, 0.28);
  g.strokeStyle = "#6f7a2e";
  g.lineWidth = Math.max(px, hh * 0.025);
  const tips = [];
  for (let k = 0; k < 5; k++) {
    const lean = (k - 2) * 0.22 + (r() - 0.5) * 0.15, top = hh * (0.85 + r() * 0.2);
    const tx = x + Math.sin(lean) * top * 0.75, ty = y - Math.cos(lean) * top;
    g.beginPath();
    g.moveTo(x + (k - 2) * hh * 0.03, y);
    g.quadraticCurveTo(x + Math.sin(lean) * top * 0.2, y - top * 0.6, tx, ty);
    g.stroke();
    tips.push([tx, ty]);
  }
  for (const [lit, col] of [[0, "#4f7426"], [1, "#86a83e"], [2, "#b9cf6a"]]) {
    g.fillStyle = col;
    for (const [tx, ty] of tips) {
      const n = lit === 2 ? 1 : 3;
      for (let q = 0; q < n; q++) {
        const ex = tx + (r() - 0.5) * hh * 0.25 - lit * hh * 0.03, ey = ty + hh * (0.12 + r() * 0.25) - lit * hh * 0.05;
        g.beginPath();
        g.ellipse(ex, ey, hh * (0.13 - lit * 0.03), hh * (0.06 - lit * 0.012), -0.4 + r() * 0.8, 0, TAU);
        g.fill();
      }
    }
  }
}

/** A Vietnamese tiled-roof house (nhà mái ngói) with its front-left foot at (x, y): long side facing the viewer,
 *  cream walls, a terracotta roof with tile rows up close, the gable end in shade. */
function tileHouse(g, x, y, wd, ht, px, upx, wall, roof) {
  const d = [wd * 0.32, -wd * 0.2]; // depth: back to the upper right
  const A = [x, y], B = [x + wd, y], Bt = [x + wd, y - ht], At = [x, y - ht];
  const eave = wd * 0.06, rise = ht * 0.95;
  const R0 = [x - eave, y - ht + eave * 0.2], R1 = [x + wd + eave, y - ht + eave * 0.2];
  const ridge0 = [x + d[0] * 0.5 + eave * 0.4, y - ht - rise + d[1] * 0.5], ridge1 = [x + wd + d[0] * 0.5 - eave * 0.4, y - ht - rise + d[1] * 0.5];
  const out = (pts, fill) => {
    poly(g, pts);
    g.fillStyle = fill;
    g.fill();
    g.strokeStyle = "rgba(40,22,12,.75)";
    g.lineWidth = px * 1.2;
    g.stroke();
  };
  // gable end (shade) and the front wall (lit), then the front roof slope
  out([B, [B[0] + d[0], B[1] + d[1]], [Bt[0] + d[0], Bt[1] + d[1]], [ridge1[0] + eave * 0.4, ridge1[1]], Bt], css(shade(wall, -0.3)));
  out([A, B, Bt, At], css(wall));
  out([R0, R1, ridge1, ridge0], css(roof));
  // the roof's lit upper half and the ridge line
  g.fillStyle = "rgba(255,220,180,.18)";
  poly(g, [R0, R1, [(R1[0] + ridge1[0]) / 2, (R1[1] + ridge1[1]) / 2], [(R0[0] + ridge0[0]) / 2, (R0[1] + ridge0[1]) / 2]]);
  g.fill();
  g.strokeStyle = css(shade(roof, -0.45));
  g.lineWidth = Math.max(px * 1.4, wd * 0.03);
  g.beginPath();
  g.moveTo(...ridge0); g.lineTo(...ridge1);
  g.stroke();
  if (upx > 60) {
    // tile rows and the door and windows
    g.strokeStyle = css(shade(roof, -0.3), 0.6);
    g.lineWidth = px;
    for (let t = 0.25; t < 1; t += 0.25) {
      g.beginPath();
      g.moveTo(R0[0] + (ridge0[0] - R0[0]) * t, R0[1] + (ridge0[1] - R0[1]) * t);
      g.lineTo(R1[0] + (ridge1[0] - R1[0]) * t, R1[1] + (ridge1[1] - R1[1]) * t);
      g.stroke();
    }
    g.fillStyle = "#5a3a22";
    g.fillRect(x + wd * 0.42, y - ht * 0.72, wd * 0.16, ht * 0.72);
    g.fillStyle = "#3e3a36";
    g.fillRect(x + wd * 0.14, y - ht * 0.66, wd * 0.14, ht * 0.32);
    g.fillRect(x + wd * 0.72, y - ht * 0.66, wd * 0.14, ht * 0.32);
  }
}

const WALLS = ["#ece0b8", "#e9d48f", "#efe7d0", "#dccf9e"].map(C);
const ROOFS = ["#b4532e", "#a54a2a", "#c0643a", "#9b4630"].map(C);

/** A lowland village hamlet: two or three tiled-roof houses with a brick yard, behind and inside a bamboo hedge. */
function paintVillage(g, upx, v) {
  const r = rng(v * 677 + 41);
  const px = 1 / upx;
  softShadow(g, 0.05, 0, 0.46, 0.13, 0.3);
  // the bamboo hedge behind
  for (let k = 0; k < 6; k++) bamboo(g, -0.36 + k * 0.15 + (r() - 0.5) * 0.04, -0.1 + Math.sin(k * 0.9) * 0.02, 0.24 + r() * 0.07, px, r);
  // a brick yard (sân gạch) for drying rice
  g.fillStyle = "#c98a62";
  poly(g, [[-0.14, 0.02], [0.2, 0.02], [0.28, -0.04], [-0.06, -0.04]]);
  g.fill();
  const n = 2 + (v % 2);
  const H = [[-0.3, -0.02, 0.2], [0.02, -0.06, 0.24], [0.2, 0.05, 0.16]].slice(0, n);
  H.sort((p, q) => p[1] - q[1]);
  for (const [hx, hy, wd] of H) tileHouse(g, hx, hy, wd, wd * 0.42, px, upx, WALLS[Math.floor(r() * 4)], ROOFS[Math.floor(r() * 4)]);
  // bamboo at the front corners
  bamboo(g, -0.36, 0.06, 0.2, px, r);
  bamboo(g, 0.4, 0.05, 0.22, px, r);
}

/** An upland stilt house (nhà sàn): a wooden house on posts under a big hipped roof of thatch or dark tile, a ladder
 *  up to the floor, a tree behind. */
function paintStilt(g, upx, v) {
  const px = 1 / upx;
  const thatch = v % 2 === 0;
  softShadow(g, 0.08, 0.01, 0.32, 0.09, 0.32);
  decidTree(g, 0.26, -0.06, 0.26, DECID[v % 3], px);
  const x0 = -0.2, x1 = 0.22, fy = -0.11, wh = 0.09; // floor level and wall height
  g.strokeStyle = "#3b2a1a";
  g.lineWidth = Math.max(px * 1.3, 0.012);
  g.beginPath();
  for (const px0 of [x0 + 0.02, x0 + 0.15, x1 - 0.15, x1 - 0.02]) { g.moveTo(px0, 0); g.lineTo(px0, fy); }
  for (const px0 of [x0 + 0.08, x1 + 0.04]) { g.moveTo(px0, -0.03); g.lineTo(px0, fy - 0.02); }
  g.stroke();
  // floor and walls (woven bamboo / planks)
  g.fillStyle = "#6e4a2a";
  g.fillRect(x0 - 0.01, fy - 0.012, x1 - x0 + 0.02, 0.016);
  g.fillStyle = "#b48a58";
  g.fillRect(x0, fy - wh, x1 - x0, wh);
  g.fillStyle = "#8a6438";
  poly(g, [[x1, fy], [x1 + 0.07, fy - 0.04], [x1 + 0.07, fy - 0.04 - wh], [x1, fy - wh]]);
  g.fill();
  if (upx > 50) {
    g.strokeStyle = "rgba(70,45,20,.5)";
    g.lineWidth = px;
    g.beginPath();
    for (let xx = x0 + 0.03; xx < x1; xx += 0.03) { g.moveTo(xx, fy - wh); g.lineTo(xx, fy); }
    g.stroke();
    g.fillStyle = "#3a2614";
    g.fillRect(-0.02, fy - wh * 0.8, 0.05, wh * 0.8);
  }
  // the ladder
  g.strokeStyle = "#4a3320";
  g.lineWidth = Math.max(px, 0.008);
  g.beginPath();
  g.moveTo(-0.03, 0.03); g.lineTo(-0.01, fy);
  g.moveTo(0.03, 0.03); g.lineTo(0.05, fy);
  for (let t = 0.2; t < 1; t += 0.25) { g.moveTo(-0.03 + 0.02 * t, 0.03 - (0.03 - fy) * t); g.lineTo(0.03 + 0.02 * t, 0.03 - (0.03 - fy) * t); }
  g.stroke();
  // the big hipped roof
  const top = fy - wh - 0.17, ey = fy - wh + 0.02;
  const roof = thatch ? ["#a7834a", "#7c5e30", "#5e4422"] : ["#6a625a", "#4e4842", "#36322e"];
  poly(g, [[x0 - 0.06, ey], [x1 + 0.03, ey], [x1 - 0.05, top], [x0 + 0.05, top]]);
  g.fillStyle = roof[0];
  g.fill();
  g.strokeStyle = "rgba(35,22,10,.8)";
  g.lineWidth = px * 1.3;
  g.stroke();
  poly(g, [[x1 + 0.03, ey], [x1 + 0.1, ey - 0.04], [x1 - 0.03, top - 0.01], [x1 - 0.05, top]]);
  g.fillStyle = roof[1];
  g.fill();
  g.stroke();
  g.strokeStyle = roof[2];
  g.lineWidth = Math.max(px * 1.5, 0.012);
  g.beginPath();
  g.moveTo(x0 + 0.05, top); g.lineTo(x1 - 0.04, top - 0.005);
  g.stroke();
  if (upx > 50) {
    g.strokeStyle = thatch ? "rgba(70,50,20,.45)" : "rgba(20,18,16,.4)";
    g.lineWidth = px;
    g.beginPath();
    for (let t = 0.1; t < 1; t += 0.09) {
      const bx = x0 - 0.06 + (x1 + 0.09 - x0) * t, tx = x0 + 0.05 + (x1 - 0.1 - x0) * t;
      g.moveTo(bx, ey); g.lineTo(tx, top);
    }
    g.stroke();
  }
}

/** One or two coconut palms (dừa): a leaning ringed trunk, a crown of drooping fronds, a cluster of nuts. */
function paintPalm(g, upx, v) {
  const r = rng(v * 263 + 11);
  const px = 1 / upx;
  const two = v % 3 === 0;
  const palms = two ? [[-0.06, 0.48, -0.12], [0.1, 0.38, 0.18]] : [[0, 0.5, (v % 2 ? 1 : -1) * (0.08 + r() * 0.1)]];
  for (const [x, hh, lean] of palms) {
    softShadow(g, x + hh * 0.3, 0, hh * 0.3, hh * 0.07, 0.3);
    const tx = x + lean * hh, ty = -hh;
    g.strokeStyle = "#7d6646";
    g.lineWidth = Math.max(px * 1.4, hh * 0.05);
    g.beginPath();
    g.moveTo(x, 0);
    g.quadraticCurveTo(x + lean * hh * 0.1, -hh * 0.5, tx, ty);
    g.stroke();
    if (upx * hh > 30) {
      g.strokeStyle = "rgba(60,45,25,.55)";
      g.lineWidth = px;
      for (let t = 0.15; t < 0.95; t += 0.1) {
        const bx = x + (tx - x) * t * t, by = -hh * t;
        g.beginPath();
        g.moveTo(bx - hh * 0.025, by); g.lineTo(bx + hh * 0.025, by);
        g.stroke();
      }
    }
    // fronds: back ones darker, then lit ones
    const fronds = 8;
    for (const [col, lw, off] of [["#2f5a22", 0.055, 0], ["#4f8a32", 0.042, 0.02], ["#8fbf55", 0.018, 0.035]]) {
      g.strokeStyle = col;
      g.lineWidth = Math.max(px * 1.2, hh * lw);
      for (let k = 0; k < fronds; k++) {
        const a = (k / fronds) * TAU + 0.3, len = hh * (0.42 + (k % 3) * 0.05);
        const ex = tx + Math.cos(a) * len, ey = ty + Math.sin(a) * len * 0.45 + len * 0.28;
        g.beginPath();
        g.moveTo(tx, ty - off * hh);
        g.quadraticCurveTo(tx + Math.cos(a) * len * 0.55, ty + Math.sin(a) * len * 0.3 - len * 0.22 - off * hh, ex, ey - off * hh);
        g.stroke();
      }
    }
    g.fillStyle = "#5c4422";
    for (const [dx, dy] of [[-0.02, 0.02], [0.02, 0.025], [0, 0.04]]) {
      g.beginPath();
      g.arc(tx + dx * hh * 2, ty + dy * hh * 2, hh * 0.035, 0, TAU);
      g.fill();
    }
  }
}

/** Fish ponds (ao) with earthen banks; "shrimp" = a grid of rectangular shrimp ponds with paddle-wheel aerators. */
function paintPond(g, upx, v, kind) {
  const r = rng(v * 919 + 7);
  const px = 1 / upx;
  const water = (x, y, w, h, rr) => {
    g.fillStyle = "#c9b685"; // the bank
    roundRect(g, x - 0.025, y - 0.02, w + 0.05, h + 0.04, rr + 0.02);
    g.fill();
    const gr = g.createLinearGradient(x, y, x + w, y + h);
    gr.addColorStop(0, "#6b9ea4");
    gr.addColorStop(0.5, "#3f727a");
    gr.addColorStop(1, "#2c5960");
    g.fillStyle = gr;
    roundRect(g, x, y, w, h, rr);
    g.fill();
    g.strokeStyle = "rgba(240,250,250,.45)";
    g.lineWidth = Math.max(px, 0.006);
    g.beginPath();
    g.moveTo(x + w * 0.15, y + h * 0.3); g.lineTo(x + w * 0.45, y + h * 0.3);
    g.stroke();
  };
  if (kind === "shrimp") {
    const cw = 0.17, ch = 0.11;
    for (let a = 0; a < 3; a++) for (let b = 0; b < 2; b++) {
      const x = -0.27 + a * (cw + 0.05), y = -0.12 + b * (ch + 0.045);
      water(x, y, cw, ch, 0.008);
      if (upx > 50 && r() < 0.6) {
        g.fillStyle = "rgba(255,255,255,.8)";
        g.fillRect(x + cw * 0.4, y + ch * 0.45, Math.max(px * 2, 0.02), Math.max(px, 0.006));
      }
    }
    return;
  }
  const n = 1 + (v % 3 === 0);
  for (let k = 0; k < n; k++) {
    const w = 0.26 + r() * 0.14, h = 0.14 + r() * 0.06;
    water(-w / 2 + (k ? 0.16 : -0.06), -h / 2 + (k ? 0.1 : -0.04), w, h, 0.05);
  }
}

function roundRect(g, x, y, w, h, rr) {
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/** A patch of terraced paddies (ruộng bậc thang) on a slope: curved contour steps, each with a light dike and a
 *  shaded riser, inside a soft irregular outline. Rice green, water and gold mixed like neighbouring families' plots. */
function paintTerraces(g, upx, v) {
  const r = rng(v * 787 + 3);
  const px = 1 / upx;
  blobPath(g, 0, 0, 0.5, 0.3, r, 10, 0.25);
  g.save();
  g.clip();
  g.fillStyle = "#8a7448";
  g.fillRect(-0.6, -0.4, 1.2, 0.8);
  const steps = 5 + (v % 3), hgt = 0.62 / steps, bow = 0.12 + r() * 0.08, tilt = (r() - 0.5) * 0.12;
  const yAt = (k, x) => -0.31 + k * hgt + bow * (x * x) / 0.25 + tilt * x;
  for (let k = 0; k < steps; k++) {
    const pk = pickWeighted(r, PADDY_W);
    g.beginPath();
    for (let x = -0.55; x <= 0.551; x += 0.05) g.lineTo(x, yAt(k, x));
    for (let x = 0.55; x >= -0.551; x -= 0.05) g.lineTo(x, yAt(k + 1, x) - hgt * 0.22);
    g.closePath();
    g.fillStyle = css(PADDY[pk][0]);
    g.fill();
    if (WET.has(pk)) {
      g.fillStyle = "rgba(235,248,250,.22)";
      g.fill();
    }
    g.beginPath();
    for (let x = -0.55; x <= 0.551; x += 0.05) g.lineTo(x, yAt(k + 1, x) - hgt * 0.22);
    g.strokeStyle = "rgba(236,226,186,.55)";
    g.lineWidth = Math.max(px, 0.008);
    g.stroke();
  }
  g.restore();
  // a soft edge into the hillside
  blobPath(g, 0, 0, 0.5, 0.3, rng(v * 787 + 3), 10, 0.25);
  g.strokeStyle = "rgba(70,60,30,.28)";
  g.lineWidth = Math.max(px * 2, 0.025);
  g.stroke();
}

/** A coffee (or pepper) garden on red basalt soil: rows of dark shrubs; every third variant has pepper vines on
 *  poles (tall dark columns) and a few shade trees. */
function paintCoffee(g, upx, v) {
  const r = rng(v * 557 + 13);
  const px = 1 / upx;
  const pepper = v % 3 === 0;
  blobPath(g, 0, 0, 0.48, 0.3, r, 9, 0.25);
  g.save();
  g.clip();
  g.fillStyle = "#8c5636";
  g.fillRect(-0.6, -0.4, 1.2, 0.8);
  const ang = (r() - 0.5) * 0.6, ca = Math.cos(ang), sa = Math.sin(ang);
  const sp = pepper ? 0.09 : 0.08, rad = pepper ? 0.022 : 0.03;
  for (let a = -0.6; a <= 0.6; a += sp) for (let b = -0.4; b <= 0.4; b += sp * 0.8) {
    const x = a * ca - b * sa, y = (a * sa + b * ca) * 0.75;
    if (pepper) {
      g.fillStyle = "rgba(40,20,8,.35)";
      g.fillRect(x + rad * 0.4, y - rad * 0.2, rad * 1.6, rad * 0.8);
      g.fillStyle = "#24461d";
      g.fillRect(x - rad * 0.8, y - rad * 3.4, rad * 1.6, rad * 3.4);
      g.fillStyle = "#4f7f33";
      g.fillRect(x - rad * 0.8, y - rad * 3.4, rad * 0.6, rad * 3);
    } else {
      g.fillStyle = "rgba(40,20,8,.35)";
      g.beginPath();
      g.arc(x + rad * 0.35, y + rad * 0.25, rad, 0, TAU);
      g.fill();
      g.fillStyle = "#2f5524";
      g.beginPath();
      g.arc(x, y, rad, 0, TAU);
      g.fill();
      if (upx > 40) {
        g.fillStyle = "#5f913c";
        g.beginPath();
        g.arc(x - rad * 0.3, y - rad * 0.35, rad * 0.45, 0, TAU);
        g.fill();
      }
    }
  }
  g.restore();
  blobPath(g, 0, 0, 0.48, 0.3, rng(v * 557 + 13), 9, 0.25);
  g.strokeStyle = "rgba(80,40,20,.3)";
  g.lineWidth = Math.max(px * 2, 0.022);
  g.stroke();
}

// --- ground sprites (whole hex) -------------------------------------------------------------------------------------

function pickWeighted(r, weights) {
  let t = r() * weights.reduce((p, q) => p + q, 0);
  for (let k = 0; k < weights.length; k++) if ((t -= weights[k]) <= 0) return k;
  return weights.length - 1;
}

/** Meadow underlay for grassland up close: dense grass strokes in mixed greens and straw, wildflower patches
 *  ("c" = close zoom only) and a few stones. Hex-clipped; strokes are short so the clip edge never shows. */
function paintMeadow(g, upx, v, kind) {
  const r = rng(v * 811 + 23);
  const px = 1 / upx;
  hexClip(g, 0.97);
  for (let k = 0; k < 6; k++) {
    blobPath(g, (r() - 0.5) * 1.4, (r() - 0.5) * 1.5, 0.18 + r() * 0.16, 0.1 + r() * 0.08, r);
    g.fillStyle = k % 2 ? "rgba(214,206,120,.16)" : "rgba(60,90,30,.14)";
    g.fill();
  }
  const cols = ["rgba(60,92,30,.5)", "rgba(110,146,52,.5)", "rgba(176,196,96,.55)", "rgba(206,196,128,.5)"];
  g.lineWidth = Math.max(px * 1.1, 0.008);
  const n = Math.round(Math.min(420, upx * 2.2));
  for (let k = 0; k < n; k++) {
    const x = (r() - 0.5) * 1.8, y = (r() - 0.5) * 2, len = 0.025 + r() * 0.035, lean = (r() - 0.6) * 0.5;
    g.strokeStyle = cols[k % cols.length];
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.sin(lean) * len, y - Math.cos(lean) * len);
    g.stroke();
  }
  if (kind === "c") {
    const flowers = ["#f4dc5c", "#fbf6ea", "#c79ade", "#f0a04a", "#e86a5a"];
    for (let p = 0; p < 3; p++) {
      const cx = (r() - 0.5) * 1.1, cy = (r() - 0.5) * 1.2, col = flowers[Math.floor(r() * flowers.length)];
      for (let k = 0; k < 9; k++) {
        const fx = cx + (r() - 0.5) * 0.2, fy = cy + (r() - 0.5) * 0.12;
        g.fillStyle = col;
        g.beginPath();
        g.arc(fx, fy, Math.max(px * 1.2, 0.01), 0, TAU);
        g.fill();
      }
    }
  }
  for (let k = 0, m = 1 + Math.floor(r() * 3); k < m; k++) {
    const x = (r() - 0.5) * 1.1, y = (r() - 0.5) * 1.2, br = 0.02 + r() * 0.015;
    softShadow(g, x + br * 0.6, y + br * 0.2, br * 1.5, br * 0.5, 0.3);
    g.fillStyle = "#8d877a";
    g.beginPath();
    g.ellipse(x, y - br * 0.3, br, br * 0.7, 0, 0, TAU);
    g.fill();
    g.fillStyle = "rgba(235,230,215,.7)";
    g.beginPath();
    g.ellipse(x - br * 0.3, y - br * 0.55, br * 0.45, br * 0.3, 0, 0, TAU);
    g.fill();
  }
}

function paintPasture(g, upx, v) {
  const r = rng(v * 389 + 17);
  const px = 1 / upx;
  hexClip(g, 0.94);
  const greens = ["rgba(176,204,104,.5)", "rgba(138,176,82,.5)", "rgba(196,210,120,.45)", "rgba(120,160,72,.45)"];
  g.fillStyle = greens[v % 4];
  g.fillRect(-1, -1.1, 2, 2.2);
  const lines = [];
  for (let k = 0; k < 2; k++) {
    const a = r() * Math.PI, ox = (r() - 0.5) * 0.5, oy = (r() - 0.5) * 0.5;
    lines.push({ a, ox, oy, dx: Math.cos(a), dy: Math.sin(a) });
  }
  // Half-plane patches in other greens, one of them mown in stripes.
  lines.forEach((L, k) => {
    const nx = -L.dy, ny = L.dx;
    poly(g, [[L.ox - L.dx * 3, L.oy - L.dy * 3], [L.ox + L.dx * 3, L.oy + L.dy * 3], [L.ox + L.dx * 3 + nx * 3, L.oy + L.dy * 3 + ny * 3], [L.ox - L.dx * 3 + nx * 3, L.oy - L.dy * 3 + ny * 3]]);
    g.fillStyle = greens[(v + k + 1) % 4];
    g.fill();
    if (k === 0) {
      g.save();
      g.clip();
      g.strokeStyle = "rgba(255,255,220,.1)";
      g.lineWidth = 0.05;
      for (let t = -1.4; t < 1.4; t += 0.1) {
        g.beginPath();
        g.moveTo(L.ox + nx * t - L.dx * 2, L.oy + ny * t - L.dy * 2);
        g.lineTo(L.ox + nx * t + L.dx * 2, L.oy + ny * t + L.dy * 2);
        g.stroke();
      }
      g.restore();
    }
  });
  // A hedgerow (a soft continuous tree line) along the first line, a fence along the second.
  const along = (L, step, fn) => {
    for (let t = -1.2; t <= 1.2; t += step) {
      const x = L.ox + L.dx * t, y = L.oy + L.dy * t;
      if (Math.hypot(x, y * 1.1) < 0.84) fn(x, y);
    }
  };
  const hedge = [];
  along(lines[0], 0.04, (x, y) => hedge.push([x, y]));
  if (hedge.length > 2) treeLine(g, hedge, 0.032, px, r);
  if (upx > 28) {
    const L = lines[1];
    g.strokeStyle = "rgba(110,80,45,.75)";
    g.lineWidth = Math.max(px, 0.007);
    g.beginPath();
    g.moveTo(L.ox - L.dx * 1.2, L.oy - L.dy * 1.2 - 0.025);
    g.lineTo(L.ox + L.dx * 1.2, L.oy + L.dy * 1.2 - 0.025);
    g.stroke();
    along(L, 0.08, (x, y) => {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y - 0.04);
      g.stroke();
    });
  }
  // Hay bales or a few grazing cattle.
  const pts = [];
  for (let k = 0; k < 4; k++) pts.push([(r() - 0.5) * 1.0, (r() - 0.5) * 0.9]);
  pts.sort((p, q) => p[1] - q[1]);
  for (const [x, y] of pts) {
    if (v % 2) {
      softShadow(g, x + 0.03, y + 0.005, 0.05, 0.015, 0.3);
      g.beginPath();
      g.arc(x, y - 0.025, 0.028, 0, TAU);
      g.fillStyle = "#d9c27c";
      g.fill();
      g.strokeStyle = "rgba(120,90,40,.7)";
      g.lineWidth = Math.max(px, 0.005);
      g.stroke();
      g.beginPath();
      g.arc(x, y - 0.025, 0.013, 0, TAU);
      g.stroke();
    } else if (upx > 36) {
      const c = ["#f2ede2", "#3b2f25", "#8a5a34", "#2a2420"][Math.floor(r() * 4)];
      softShadow(g, x + 0.02, y + 0.004, 0.04, 0.012, 0.3);
      g.fillStyle = c;
      g.beginPath();
      g.ellipse(x, y - 0.018, 0.03, 0.016, 0, 0, TAU);
      g.fill();
      g.beginPath();
      g.ellipse(x - 0.032, y - 0.026, 0.011, 0.009, 0, 0, TAU);
      g.fill();
      g.strokeStyle = "rgba(20,15,10,.6)";
      g.lineWidth = px * 0.8;
      g.stroke();
    }
  }
  // Feather the patch out toward the hex edge, so neighbouring pastures blend instead of showing the grid.
  g.globalCompositeOperation = "destination-in";
  const fe = g.createRadialGradient(0, 0, 0.5, 0, 0, 0.98);
  fe.addColorStop(0, "rgba(0,0,0,1)");
  fe.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = fe;
  g.fillRect(-1, -1.1, 2, 2.2);
  g.globalCompositeOperation = "source-over";
}

function paintMarsh(g, upx, v) {
  const r = rng(v * 211 + 41);
  const px = 1 / upx;
  hexClip(g, 0.94);
  // Boggy vegetation mottling.
  for (let k = 0; k < 7; k++) {
    blobPath(g, (r() - 0.5) * 1.3, (r() - 0.5) * 1.4, 0.16 + r() * 0.12, 0.1 + r() * 0.08, r);
    g.fillStyle = k % 2 ? "rgba(30,64,34,.28)" : "rgba(140,170,90,.22)";
    g.fill();
  }
  // Pools: dark water with a shallow rim and sky glints.
  const pools = [];
  const n = 3 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) pools.push([(r() - 0.5) * 1.05, (r() - 0.5) * 1.1, 0.1 + r() * 0.12, 0.05 + r() * 0.05]);
  for (const [x, y, rx, ry] of pools) {
    const seed = Math.floor(r() * 1e6);
    const shape = () => blobPath(g, x, y, rx, ry, rng(seed), 10, 0.35);
    shape();
    g.strokeStyle = "rgba(124,150,96,.55)";
    g.lineWidth = Math.max(px * 2.5, 0.025);
    g.stroke();
    const gr = g.createLinearGradient(0, y - ry, 0, y + ry);
    gr.addColorStop(0, "#2c6170");
    gr.addColorStop(1, "#4a8c98");
    g.fillStyle = gr;
    g.fill();
    g.strokeStyle = "rgba(25,45,28,.6)";
    g.lineWidth = Math.max(px, 0.008);
    g.stroke();
    g.strokeStyle = "rgba(235,250,255,.75)";
    g.lineWidth = Math.max(px * 1.1, 0.01);
    g.beginPath();
    g.moveTo(x - rx * 0.5, y - ry * 0.25);
    g.lineTo(x - rx * 0.15, y - ry * 0.25);
    g.moveTo(x + rx * 0.05, y + ry * 0.15);
    g.lineTo(x + rx * 0.25, y + ry * 0.15);
    g.stroke();
    if (upx > 40) {
      g.fillStyle = "#6f9a48";
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.arc(x + (r() - 0.5) * rx, y + (r() - 0.3) * ry * 0.8, 0.014, 0.4, TAU);
        g.fill();
      }
    }
  }
  // Reed and cattail clumps along the pool edges.
  const clumps = pools.flatMap(([x, y, rx, ry]) => [[x - rx * 0.9, y + ry * 0.6], [x + rx * 0.8, y + ry * 0.9]]);
  clumps.sort((p, q) => p[1] - q[1]);
  for (const [cx, cy] of clumps) {
    const m = 6 + Math.floor(r() * 4);
    const lw = Math.max(px * 1.1, 0.009);
    for (let k = 0; k < m; k++) {
      const bx = cx + (r() - 0.5) * 0.08, hh = 0.09 + r() * 0.09, lean = (r() - 0.5) * 0.05;
      g.strokeStyle = k % 3 ? "#5c7a36" : "#3c5626";
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(bx, cy);
      g.quadraticCurveTo(bx + lean * 0.3, cy - hh * 0.6, bx + lean, cy - hh);
      g.stroke();
      if (upx > 34 && k % 3 === 0) {
        g.fillStyle = "#6b4528";
        g.beginPath();
        g.ellipse(bx + lean * 0.9, cy - hh * 0.92, lw * 1.2, Math.max(0.022, px * 2.5), 0, 0, TAU);
        g.fill();
      }
    }
  }
}

function paintIce(g, upx, v) {
  const r = rng(v * 541 + 3);
  const px = 1 / upx;
  hexClip(g, 0.94);
  for (let k = 0; k < 7; k++) {
    const x = (r() - 0.5) * 1.4, y = (r() - 0.5) * 1.6, w = 0.25 + r() * 0.25;
    g.beginPath();
    g.moveTo(x - w, y);
    g.quadraticCurveTo(x, y - 0.08, x + w, y);
    g.strokeStyle = "rgba(255,255,255,.75)";
    g.lineWidth = Math.max(px * 1.5, 0.014);
    g.stroke();
    g.beginPath();
    g.moveTo(x - w * 0.9, y + 0.02);
    g.quadraticCurveTo(x, y - 0.05, x + w * 0.9, y + 0.02);
    g.strokeStyle = "rgba(110,145,190,.35)";
    g.lineWidth = Math.max(px * 1.5, 0.016);
    g.stroke();
  }
  for (let k = 0; k < 3; k++) {
    let x = (r() - 0.5) * 1.2, y = (r() - 0.5) * 1.2;
    const pts = [[x, y]];
    for (let n = 0; n < 4; n++) pts.push([(x += 0.08 + r() * 0.06), (y += (r() - 0.5) * 0.1)]);
    for (const [col, off] of [["rgba(255,255,255,.8)", -px], ["rgba(60,95,140,.6)", 0]]) {
      g.beginPath();
      pts.forEach(([px2, py2], n) => (n ? g.lineTo(px2, py2 + off) : g.moveTo(px2, py2 + off)));
      g.strokeStyle = col;
      g.lineWidth = Math.max(px, 0.01);
      g.stroke();
    }
  }
  if (upx > 40) {
    g.fillStyle = "rgba(255,255,255,.95)";
    for (let k = 0; k < 6; k++) {
      const x = (r() - 0.5) * 1.3, y = (r() - 0.5) * 1.5, s = 0.02 + r() * 0.015;
      poly(g, [[x, y - s], [x + s * 0.25, y - s * 0.25], [x + s, y], [x + s * 0.25, y + s * 0.25], [x, y + s], [x - s * 0.25, y + s * 0.25], [x - s, y], [x - s * 0.25, y - s * 0.25]]);
      g.fill();
    }
  }
}

function paintCracks(g, upx, v) {
  const r = rng(v * 467 + 13);
  const px = 1 / upx;
  hexClip(g, 0.92);
  const gr = g.createRadialGradient(-0.2, -0.2, 0.05, 0, 0, 0.9);
  gr.addColorStop(0, "rgba(255,250,236,.22)");
  gr.addColorStop(1, "rgba(255,250,236,0)");
  g.fillStyle = gr;
  g.fillRect(-1, -1.1, 2, 2.2);
  const walk = (x, y, a, n, depth) => {
    const pts = [[x, y]];
    for (let k = 0; k < n; k++) {
      a += (r() - 0.5) * 1.1;
      pts.push([(x += Math.cos(a) * 0.09), (y += Math.sin(a) * 0.09)]);
      if (depth < 2 && r() < 0.25) walk(x, y, a + (r() < 0.5 ? 1.2 : -1.2), 3, depth + 1);
    }
    for (const [col, off] of [["rgba(255,250,235,.3)", px], ["rgba(80,64,48,.4)", 0]]) {
      g.beginPath();
      pts.forEach(([px2, py2], k) => (k ? g.lineTo(px2 + off, py2 + off) : g.moveTo(px2 + off, py2 + off)));
      g.strokeStyle = col;
      g.lineWidth = Math.max(px, 0.008);
      g.stroke();
    }
  };
  for (let k = 0; k < 5; k++) walk((r() - 0.5) * 1.4, (r() - 0.5) * 1.6, r() * TAU, 7, 0);
}
