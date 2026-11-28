// City-tile art: the city-centre hex (a village, or a pseudo-isometric street grid that grows from a small town into
// a dense skyline), the capital's Ba Đình square and hall, the small marker used for cities when hexes are too small
// for a tile, and the urban-fringe art that terrain.js stamps on urban cells.
//
// Interface (used by render/map.js, render/art/terrain.js and web/dev/gallery.js):
//
//   cityTileVisible(city, Rpx) → bool     is the city drawn at all at this zoom (small towns vanish zoomed out)
//   cityIsDot(city, Rpx) → bool           drawn as a dot (true) or as a full tile (false)
//   cityClass(population) → {id, ...}     size class: village, town, city, metropolis, megalopolis
//   metroSpill(w) → Map(cell → pseudo-city)  urban neighbours of 1.5M+ metros drawn as smaller city tiles (map.js);
//                                         terrain.js leaves them bare like real city cells
//   OLD_QUARTER                           city ids that get an old quarter (see the rule there)
//   drawCityTile(ctx, city, x, y, R, {Rpx, s, lod, selected, stateColor, seed})
//     ctx        2D context in WORLD transform (km; s css px per km applied)
//     city       a cities.json record (uses population, id, capital via world.js isCapital)
//     x, y, R    hex centre and radius in km
//     Rpx        hex radius in css px; s css px per km; lod "far"|"mid"|"near"|"close" (optional)
//     selected   true for the selected city; the selection ring itself is drawn by render/map.js drawOverlay
//     stateColor [r, g, b] of the owning state (crowns on towers, a few roofs, the hairline rim at close zoom)
//     seed       per-city integer for deterministic variation (map.js passes city.cell)
//   Draws a dot or a tile according to cityIsDot(); the caller checks cityTileVisible() first.
//   SUBURB_ART = {ground, build}: sprite definitions {box, paint(g, upx, v, kind)} in R units (1 unit = the hex
//     radius, kind "", "small" or "factory"), the same shape as terrain.js SPRITES entries. Urban cells (kind ""), by
//     variant v (0-7): 0-4 townhouse rows (nhà phố liền kề) on a straight street grid, 5-7 a new urban area (khu đô
//     thị: apartment slabs, townhouse rows, a small park); "small" (on hills) is one street of houses; "factory" is
//     a factory estate (sheds with corrugated roofs on concrete yards, an office by the gate) on a patch of the cell,
//     stamped on the INDUSTRIAL_CELLS hexes.
//   INDUSTRIAL_CELLS                      hexes that hold an industrial park (see the rule there)
//
// How a city tile is made (the Vietnamese townscape is illustrative, drawn from the population class and a seed):
//   village      6-10 tiled-roof houses along one or two roads, a đình (communal house) or a small chùa, garden
//                trees and a few fields around it, straight on the terrain, within ~45% of the hex.
//   town+        the hex gets a pale base; the built-up area is a paved pad (an asphalt street grid with a lighter
//                kerb and a short soft feather) made of iso blocks packed edge to edge. Each block has a sidewalk
//                and becomes: core (a podium with one or two modern towers: only the city class and up), mid
//                (taller tube-house rows, or a modern mid-rise block), residential (rows of tube houses, nhà ống:
//                narrow, 2-6 storeys, each its own façade colour, flat roofs with a water tank, a few small tiled
//                roofs, laundry and balconies up close), a park (paths, trees, a pond), a market (chợ: a hall with
//                a corrugated roof, coloured awnings round its yard) or a pagoda / đình in its courtyard. Old-quarter
//                blocks (OLD_QUARTER cities) are rows of low, deep shophouses under dark tiled roofs. Motorbikes
//                line the streets at close zoom. Bigger classes have smaller blocks, a bigger pad and taller towers;
//                outside the pad the hex has scattered houses and trees.
//   Buildings are boxes with a lit top, a half-lit south-west face and a shaded south-east face (light from the
//   upper left), cast shadows to the lower right (one fill, so overlaps don't darken twice), crowns in the state
//   colour, a spire on the tallest tower, windows at close zoom. The capital gets a Ba Đình-style complex: a pale
//   stone hall with a colonnade and a stepped flat roof at the head of a square of lawn plots, with the flag.
//
import { hash01 } from "../../hex.js";
import { css, mix, shade } from "../../color.js";
import { isCapital } from "../../world.js";
import { COVER } from "../../terrain.js";
import { lodFor } from "./lod.js";
import { rng } from "./sprites.js";

/** Cities draw as a dot (on top of the terrain) rather than a full tile when hexes are small. */
export const cityIsDot = (city, Rpx) =>
  Rpx < 9 || (Rpx < 18 && city.population < 2.5e5) || (Rpx < 26 && city.population < 1e5);

// --- metro spill ----------------------------------------------------------------------------------------------
const SPILL_MIN_POP = 1.5e6;
const spills = new WeakMap(); // world → Map(cell → pseudo-city)
/** Neighbour hexes of big metros drawn as smaller city tiles: 1 for 1.5M+, 2 for 5M+, the most developed urban ones. */
export function metroSpill(w) {
  let out = spills.get(w);
  if (out) return out;
  out = new Map();
  const { grid } = w, dev = w.pct?.developed;
  for (const [cell, city] of w.cityByCell) {
    if (!(city.population >= SPILL_MIN_POP)) continue;
    const cand = [];
    for (let d = 0; d < 6; d++) {
      const j = grid.neighbour(cell, d);
      if (j < 0 || w.water[j] || w.cityByCell.has(j) || out.has(j) || w.cover[j] !== COVER.URBAN) continue;
      cand.push([j, dev ? dev[j] || 0 : 50]);
    }
    cand.sort((a, b) => b[1] - a[1]);
    const n = city.population >= 5e6 ? 2 : 1;
    cand.slice(0, n).forEach(([j], k) => {
      out.set(j, { id: `spill-${j}`, name: city.name, capital: false, of: city, population: (city.population >= 5e6 ? 9e5 : 5e5) / (k + 1) });
    });
  }
  spills.set(w, out);
  return out;
}

/** Zoomed far out only the big cities show at all. */
export const cityTileVisible = (city, Rpx) => !(Rpx < 9 && city.population < (Rpx < 6 ? 1e6 : 2.5e5));

// --- size classes --------------------------------------------------------------------------------------------------
//   extent   how far (hex apothem = 1) the paved pad reaches
//   lot      block pitch in R at full zoom (never smaller than LOT_MIN_PX css px)
//   core     centrality (0 edge … 1 centre) above which blocks get towers; mid likewise for mid-rise blocks
//   height   tallest tower in R
//   park     share of blocks that are parks
//   ragged   chance that an outer block is left out (an irregular edge)
//   grey     how grey the base of the hex is (0 green … 1 concrete)
//   fringe   houses and trees on the unpaved rest of the hex
//   civic    one block becomes a pagoda or a đình in its courtyard (every class but the capital, which has Ba Đình)
export const CITY_CLASSES = [
  { id: "village", min: 0, village: true },
  { id: "town", min: 1.5e5, extent: 0.66, lot: 0.2, core: 1.01, mid: 0.55, height: 0.2, park: 0.05, ragged: 0.4, grey: 0.08, fringe: true, civic: true },
  { id: "city", min: 4e5, extent: 0.8, lot: 0.18, core: 0.8, mid: 0.33, height: 0.44, park: 0.06, ragged: 0.32, grey: 0.14, fringe: true, civic: true },
  { id: "metropolis", min: 1.5e6, extent: 0.9, lot: 0.16, core: 0.5, mid: 0.18, height: 0.58, park: 0.06, ragged: 0.25, grey: 0.2, fringe: true, civic: true },
  { id: "megalopolis", min: 5e6, extent: 0.96, lot: 0.145, core: 0.36, mid: 0.08, height: 0.68, park: 0.05, ragged: 0.12, grey: 0.26, fringe: false, civic: true },
];
const LOT_MIN_PX = 5.5;

/**
 * Cities with an old quarter (Phố Cổ-style rows of low shophouses under dark tiled roofs). Rule: the city's hex or
 * a neighbouring hex holds a UNESCO World Heritage cultural site (wonders.json rule "world_heritage", kind
 * "landmark"). That gives Hà Nội (Hoàng thành Thăng Long, same hex) and Huế (Cố đô Huế, the next hex); Hội An is
 * not a city tile and shows as its own wonder. tests/test_cityart.py recomputes this set from the data.
 */
export const OLD_QUARTER = new Set(["HN", "26"]);

/**
 * Hexes that hold an industrial park: the hex containing the centre of each park in geo.json "parks" (OpenStreetMap
 * industrial land named Khu công nghiệp / KCN / Industrial Park, 20 ha or more; see its rule there). terrain.js
 * stamps a factory estate there on flat land. tests/test_cityart.py recomputes this set from geo.json.
 */
export const INDUSTRIAL_CELLS = new Set([
  4293, 4571, 7195, 8774, 8799, 9029, 9038, 9060, 9557, 9561, 9820, 9824, 9825, 9827, 9828, 9829, 9830, 10088,
  10090, 10091, 10094, 10350, 10351, 10353, 10354, 10355, 10356, 10359, 10616, 10617, 10618, 10619, 10620, 10629,
  10875, 10879, 10880, 10884, 10889, 10890, 10892, 11136, 11138, 11139, 11144, 11145, 11146, 11147, 11150, 11151,
  11152, 11153, 11398, 11406, 11412, 11415, 11670, 11676, 11931, 11941, 12193, 12194, 12195, 12200, 12459, 12720,
  12725, 12985, 12987, 12988, 13246, 13248, 13253, 13773, 13774, 14039, 14297, 14298, 14827, 15348, 15611, 19292,
  19817, 22721, 24562, 24563, 24827, 25355, 27199, 27992, 28784, 29842, 30105, 30368, 30633, 31160, 32478, 33532,
  38796, 38798, 39059, 39061, 39850, 41429, 41956, 43779, 45372, 47204, 47475, 47970, 47974, 47986, 48234, 48237,
  48497, 48754, 49023, 49024, 49282, 49284, 49285, 49293, 49549, 49550, 49551, 49552, 49808, 49809, 49812, 49813,
  50073, 50074, 50075, 50076, 50077, 50078, 50079, 50080, 50083, 50092, 50094, 50334, 50336, 50338, 50339, 50340,
  50341, 50342, 50344, 50347, 50599, 50600, 50601, 50605, 50861, 50862, 50863, 50865, 50868, 51125, 51131, 51387,
  51388, 51389, 51390, 51391, 51395, 51398, 51658, 51659, 51660, 51912, 51924, 52185, 52427, 52438, 52690, 52692,
  52701, 52702, 53222, 53482, 53738, 53747, 55063, 56638
]);

export function cityClass(population) {
  let c = CITY_CLASSES[0];
  for (const k of CITY_CLASSES) if (population >= k.min) c = k;
  return c;
}

// --- palette -------------------------------------------------------------------------------------------------------
const P = {
  asphalt: [74, 72, 70], kerb: [182, 176, 160], walk: [196, 190, 174], concrete: [168, 162, 148],
  lawn: [118, 150, 80], park: [96, 146, 70], path: [218, 208, 176],
  plaza: [204, 194, 168], plazaInner: [224, 216, 194], pond: [92, 160, 206],
  tree: [60, 108, 50], treeMid: [82, 132, 60], treeLit: [128, 170, 82], conifer: [44, 88, 54],
  field: [[214, 186, 104], [176, 178, 86], [196, 160, 92], [150, 172, 80]],
  road: [196, 186, 160], roadEdge: [92, 84, 70],
  // tube-house façades: ochre, cream, mint, pink, sky blue, white, sand, lemon
  facades: [[236, 204, 116], [242, 232, 212], [204, 228, 198], [240, 198, 186], [192, 216, 234], [246, 244, 238], [228, 212, 160], [246, 226, 150]],
  walls: [[238, 226, 196], [242, 236, 222], [230, 210, 160], [226, 214, 190]],
  // terracotta tiles and corrugated sheet (tôn: blue, green, red)
  roofs: [[176, 80, 54], [158, 70, 48], [188, 104, 64], [78, 112, 146], [92, 128, 100], [160, 62, 52]],
  oldWalls: [[228, 196, 120], [214, 200, 170], [204, 176, 128], [222, 208, 180]],
  oldRoofs: [[118, 64, 48], [104, 70, 56], [96, 78, 62], [126, 72, 52]],
  stone: [[208, 196, 172], [188, 178, 160], [222, 214, 198], [196, 188, 176], [214, 204, 184]],
  glass: [[118, 160, 190], [96, 128, 158], [150, 178, 196], [196, 170, 112], [128, 170, 176]],
  templeWall: [226, 206, 160], templeRoof: [150, 66, 44], templeCol: [150, 44, 30],
  awnings: [[214, 64, 52], [60, 110, 180], [236, 176, 52], [70, 150, 96], [230, 120, 60]],
  bikes: ["#c8302a", "#2a4a8a", "#1c1c1e", "#e8e4da"],
  marble: [226, 224, 216], white: [244, 240, 230], tank: [214, 220, 226],
};

// --- geometry ------------------------------------------------------------------------------------------------------
// Iso ground axes (screen units per km along each axis); the up vector is (0, -1).
const AX = 0.866, AY = 0.5;
const iso = (u, v) => [(u - v) * AX, (u + v) * AY]; // ground (u along A, v along B) → screen offset
const CORNERS = [0, 1, 2, 3, 4, 5].map((k) => {
  const a = ((60 * k - 30) * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
});
function hexPath(ctx, x, y, R, f) {
  ctx.beginPath();
  ctx.moveTo(x + R * CORNERS[0][0] * f, y + R * CORNERS[0][1] * f);
  for (let k = 1; k < 6; k++) ctx.lineTo(x + R * CORNERS[k][0] * f, y + R * CORNERS[k][1] * f);
  ctx.closePath();
}
/** Pointy-top hex "radius" of an offset, as a fraction of the apothem (1 on the flat sides). */
const hexRho = (x, y, R) => Math.max(Math.abs(x), 0.5 * Math.abs(x) + 0.866 * Math.abs(y)) / (0.866 * R);

/** Footprint corners [N, E, S, W] of a lot/box centred at screen (x, y) with half sizes a (along A), b (along B). */
function foot(x, y, a, b) {
  const [ax, ay] = iso(a, 0), [bx, by] = iso(0, b);
  return [
    [x - ax - bx, y - ay - by], // N (back)
    [x + ax - bx, y + ay - by], // E
    [x + ax + bx, y + ay + by], // S (front)
    [x - ax + bx, y - ay + by], // W
  ];
}
const up = (p, h) => [p[0], p[1] - h];
function poly(ctx, pts) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
  ctx.closePath();
}
function fillPoly(g, pts, style) {
  g.beginPath();
  poly(g, pts);
  g.fillStyle = style;
  g.fill();
}
// Convex hull (monotone chain) for shadows.
function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (let k = p.length - 1; k >= 0; k--) {
    const q = p[k];
    while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop();
    hi.push(q);
  }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
/** Shadow polygon of a box of height h on footprint F (light from the upper left, so cast to the lower right). */
const shadowOf = (F, h) => hull(F.concat(F.map((p) => [p[0] + h * 0.62, p[1] + h * 0.26])));
const pick = (arr, t) => arr[Math.min(arr.length - 1, Math.floor(t * arr.length))];

/** A gabled house body on footprint F: walls of height hw, roof rise hr; ridge along A (along = 0) or B (1). */
function gable(g, F, hw, hr, wall, roof, along, lineW) {
  const [N, E, S, W] = F;
  const [Nt, Et, St, Wt] = F.map((p) => up(p, hw));
  const lit = css(wall), dark = css(shade(wall, -0.32));
  fillPoly(g, [W, S, St, Wt], lit);
  fillPoly(g, [S, E, Et, St], dark);
  const rLit = css(shade(roof, 0.14)), rDark = css(shade(roof, -0.28)), rBack = css(shade(roof, 0.26));
  if (along === 0) {
    const r0 = up([(Nt[0] + Wt[0]) / 2, (Nt[1] + Wt[1]) / 2], hr), r1 = up([(Et[0] + St[0]) / 2, (Et[1] + St[1]) / 2], hr);
    fillPoly(g, [Nt, Et, r1, r0], rBack); // back slope (faces NE, catches the light from above)
    fillPoly(g, [St, Et, r1], dark); // gable end on the SE face
    fillPoly(g, [Wt, St, r1, r0], rLit); // front slope
    if (lineW) {
      g.beginPath();
      g.moveTo(r0[0], r0[1]);
      g.lineTo(r1[0], r1[1]);
      g.strokeStyle = css(shade(roof, 0.45), 0.8);
      g.lineWidth = lineW;
      g.stroke();
    }
  } else {
    const r0 = up([(Nt[0] + Et[0]) / 2, (Nt[1] + Et[1]) / 2], hr), r1 = up([(Wt[0] + St[0]) / 2, (Wt[1] + St[1]) / 2], hr);
    fillPoly(g, [Wt, St, r1], lit); // gable end on the SW face
    fillPoly(g, [Nt, Wt, r1, r0], rBack);
    fillPoly(g, [Et, St, r1, r0], rDark);
    if (lineW) {
      g.beginPath();
      g.moveTo(r0[0], r0[1]);
      g.lineTo(r1[0], r1[1]);
      g.strokeStyle = css(shade(roof, 0.45), 0.8);
      g.lineWidth = lineW;
      g.stroke();
    }
  }
  if (lineW) {
    g.beginPath();
    poly(g, [W, Wt, Nt, Et, E, S]);
    g.strokeStyle = "rgba(40,28,18,.35)";
    g.lineWidth = lineW;
    g.stroke();
  }
}

/** A round deciduous tree (trunk, dark underside, mid canopy, lit crown) or a two-tier conifer; base at (x, y). */
function treeShape(g, x, y, r, conifer, shadowToo = true) {
  if (shadowToo) {
    g.beginPath();
    g.ellipse(x + r * 0.6, y + r * 0.1, r * 1.05, r * 0.5, 0, 0, Math.PI * 2);
    g.fillStyle = "rgba(20,30,10,.26)";
    g.fill();
  }
  if (conifer) {
    for (const [t, w0] of [[0, 0.85], [0.7, 0.62]]) {
      const yb = y - r * (0.1 + t), yt = yb - r * 1.5;
      g.beginPath();
      g.moveTo(x, yt);
      g.lineTo(x + r * w0, yb);
      g.lineTo(x - r * w0, yb);
      g.closePath();
      g.fillStyle = css(P.conifer);
      g.fill();
      g.beginPath();
      g.moveTo(x, yt);
      g.lineTo(x - r * w0, yb);
      g.lineTo(x - r * w0 * 0.1, yb);
      g.closePath();
      g.fillStyle = css(shade(P.conifer, 0.2));
      g.fill();
    }
    return;
  }
  g.beginPath();
  g.arc(x + r * 0.12, y - r * 0.62, r, 0, Math.PI * 2);
  g.fillStyle = css(P.tree);
  g.fill();
  g.beginPath();
  g.arc(x - r * 0.08, y - r * 0.78, r * 0.82, 0, Math.PI * 2);
  g.fillStyle = css(P.treeMid);
  g.fill();
  g.beginPath();
  g.arc(x - r * 0.34, y - r * 1.02, r * 0.42, 0, Math.PI * 2);
  g.fillStyle = css(P.treeLit);
  g.fill();
}

// --- painter -------------------------------------------------------------------------------------------------------
// A painter draws in km around the hex centre (0, 0) into context g. `px(n)` converts css px to km.

class Painter {
  constructor(g, R, sCss, dev, detail, accent) {
    this.g = g;
    this.R = R;
    this.s = sCss; // css px per km (bucketed)
    this.dev = dev; // device px per km of the target (for shadowBlur)
    this.detail = detail; // 0 mid, 1 near, 2 close
    this.accent = accent;
    this.shadows = new Path2D();
  }
  px(n) {
    return n / this.s;
  }
  /** Ground shadow of a box (cast to the lower right). */
  shadow(F, h) {
    poly(this.shadows, shadowOf(F, h));
  }
  /** A box on footprint F (from foot()), from height z0 to z0 + h. Colours: base [r,g,b]. */
  box(F, z0, h, base, { glass = false, outline = true, top = null } = {}) {
    const g = this.g;
    const [N, E, S, W] = F.map((p) => up(p, z0));
    const [Nt, Et, St, Wt] = [N, E, S, W].map((p) => up(p, h));
    const lit = base, dark = shade(base, glass ? -0.38 : -0.34), topC = top || shade(base, 0.2);
    // South-west face (half lit) and south-east face (shaded), with a gentle vertical gradient on taller boxes.
    if (h > this.px(6)) {
      const gr = g.createLinearGradient(0, Wt[1], 0, W[1]);
      gr.addColorStop(0, css(shade(lit, glass ? 0.16 : 0.06)));
      gr.addColorStop(1, css(shade(lit, -0.14)));
      fillPoly(g, [W, S, St, Wt], gr);
      const gd = g.createLinearGradient(0, Et[1], 0, E[1]);
      gd.addColorStop(0, css(shade(dark, 0.08)));
      gd.addColorStop(1, css(shade(dark, -0.18)));
      fillPoly(g, [S, E, Et, St], gd);
    } else {
      fillPoly(g, [W, S, St, Wt], css(lit));
      fillPoly(g, [S, E, Et, St], css(dark));
    }
    fillPoly(g, [Nt, Et, St, Wt], css(topC));
    if (outline && this.detail >= 1) {
      g.lineJoin = "round";
      // crisp lit edges: the front vertical edge and the top's front edges
      g.beginPath();
      g.moveTo(Wt[0], Wt[1]);
      g.lineTo(St[0], St[1]);
      g.lineTo(Et[0], Et[1]);
      g.moveTo(St[0], St[1]);
      g.lineTo(S[0], S[1]);
      g.strokeStyle = "rgba(255,250,235,.35)";
      g.lineWidth = this.px(0.6);
      g.stroke();
      g.beginPath();
      poly(g, [W, Wt, Nt, Et, E, S]);
      g.strokeStyle = "rgba(28,22,16,.45)";
      g.lineWidth = this.px(0.6);
      g.stroke();
    }
    return { N: Nt, E: Et, S: St, W: Wt, base: [N, E, S, W] };
  }
  /** Rows of windows on both visible faces of a box placed with box(). */
  windows(F, z0, h, glass) {
    if (this.detail < 2) return;
    const g = this.g;
    const floor = Math.max(this.px(3.2), this.R * 0.022);
    const nf = Math.floor((h - floor * 0.6) / floor);
    if (nf < 1) return;
    const [, E, S, W] = F.map((p) => up(p, z0));
    const faces = [
      [W, S, glass ? "rgba(225,240,250,.42)" : "rgba(70,78,92,.55)"],
      [S, E, glass ? "rgba(160,200,230,.22)" : "rgba(30,34,44,.5)"],
    ];
    for (const [a, b, style] of faces) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nCol = Math.max(1, Math.floor(len / this.px(3)));
      const path = new Path2D();
      for (let f = 0; f < nf; f++) {
        const z = floor * (f + 0.45), zh = floor * 0.45;
        for (let c = 0; c < nCol; c++) {
          const t0 = (c + 0.22) / nCol, t1 = (c + 0.78) / nCol;
          const p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0 - z];
          const p1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1 - z];
          poly(path, [p0, p1, [p1[0], p1[1] - zh], [p0[0], p0[1] - zh]]);
        }
      }
      g.fillStyle = style;
      g.fill(path);
    }
  }
  /** A small house with a gable roof; `along` = 0 ridge along A, 1 along B. */
  house(x, y, a, b, wall, roof, along) {
    const hw = Math.max(this.R * 0.03, this.px(2)), hr = Math.max(this.R * 0.026, this.px(1.6));
    const F = foot(x, y, a, b);
    gable(this.g, F, hw, hr, wall, roof, along, this.detail >= 1 ? this.px(0.5) : 0);
    this.shadow(F, hw + hr * 0.6);
  }
  tree(x, y, r, conifer = false) {
    treeShape(this.g, x, y, r, conifer);
  }
  /** Feathered fill: a soft dark halo of `blur` km around path P, then P itself. */
  feather(P, style, blur, haloStyle) {
    const g = this.g;
    g.save();
    g.shadowColor = haloStyle;
    g.shadowBlur = Math.max(1, blur * this.dev);
    g.fillStyle = style;
    g.fill(P);
    g.restore();
  }
}

// --- landmarks -----------------------------------------------------------------------------------------------------

/** The two ends of the ridge of a gable() roof along A (along = 0) on footprint F with walls hw and rise hr. */
function ridgeA(F, hw, hr) {
  const [Nt, Et, St, Wt] = F.map((q) => up(q, hw));
  return [up([(Nt[0] + Wt[0]) / 2, (Nt[1] + Wt[1]) / 2], hr), up([(Et[0] + St[0]) / 2, (Et[1] + St[1]) / 2], hr)];
}
/** Curled ridge ends (the upswept "horns" of a đình or chùa roof) at the two ends of a ridge. */
function horns(g, r0, r1, sz, roof) {
  const c = css(shade(roof, -0.1));
  fillPoly(g, [[r0[0] - sz * 0.02, r0[1] + sz * 0.04], [r0[0] - sz * 0.2, r0[1] - sz * 0.2], [r0[0] + sz * 0.1, r0[1] + sz * 0.02]], c);
  fillPoly(g, [[r1[0] + sz * 0.02, r1[1] + sz * 0.04], [r1[0] + sz * 0.2, r1[1] - sz * 0.2], [r1[0] - sz * 0.1, r1[1] + sz * 0.02]], c);
}

/** A đình (one tier) or a chùa hall (two tiers): low walls on red columns under a big tiled roof with curled ends. */
function drawTemple(p, x, y, sz, tiers = 1) {
  const g = p.g, lw = p.detail >= 1 ? p.px(0.5) : 0;
  const F = foot(x, y, sz, sz * 0.62);
  const hw = sz * 0.34, hr = sz * 0.5;
  p.shadow(F, hw + hr * 0.6);
  gable(g, F, hw, hr, P.templeWall, P.templeRoof, 0, lw);
  if (p.detail >= 1) {
    // red columns across the front (south-west) face
    const [, , S, W] = F;
    const cols = new Path2D();
    for (let k = 1; k < 6; k++) {
      const t = k / 6, cx = W[0] + (S[0] - W[0]) * t, cy = W[1] + (S[1] - W[1]) * t;
      cols.moveTo(cx, cy);
      cols.lineTo(cx, cy - hw);
    }
    g.strokeStyle = css(P.templeCol);
    g.lineWidth = Math.max(p.px(0.6), sz * 0.05);
    g.stroke(cols);
  }
  let [r0, r1] = ridgeA(F, hw, hr);
  if (tiers === 2) {
    const z = hw + hr * 0.55, F2 = foot(x, y - z, sz * 0.55, sz * 0.34);
    gable(g, F2, sz * 0.16, hr * 0.62, P.templeWall, shade(P.templeRoof, 0.06), 0, lw);
    [r0, r1] = ridgeA(F2, sz * 0.16, hr * 0.62);
  }
  horns(g, r0, r1, sz, P.templeRoof);
  if (p.detail >= 1) {
    g.beginPath();
    g.arc((r0[0] + r1[0]) / 2, (r0[1] + r1[1]) / 2 - sz * 0.06, Math.max(p.px(0.6), sz * 0.06), 0, Math.PI * 2);
    g.fillStyle = "#f0d27a";
    g.fill();
  }
}

/** One tube house (nhà ống) on footprint half sizes a × b; old = a low shophouse under a dark tiled roof. */
function tubeHouse(p, x, y, a, b, h, wall, old, r) {
  const g = p.g, F = foot(x, y, a, b);
  if (old) {
    const hr = Math.max(p.px(1), b * 0.45);
    p.shadow(F, h + hr * 0.6);
    gable(g, F, h, hr, wall, pick(P.oldRoofs, r(1)), 0, p.detail >= 1 ? p.px(0.4) : 0);
    return;
  }
  p.shadow(F, h);
  p.box(F, 0, h, wall, { outline: p.detail >= 2 });
  const [, , S, W] = F;
  if (p.detail >= 1) {
    // the open shop front on the ground floor of the street (south-west) face
    const fh = Math.min(h * 0.4, p.R * 0.014);
    const q = (t, z) => [W[0] + (S[0] - W[0]) * t, W[1] + (S[1] - W[1]) * t - z];
    fillPoly(g, [q(0.15, 0), q(0.85, 0), q(0.85, fh * 0.8), q(0.15, fh * 0.8)], "rgba(44,38,34,.6)");
    if (p.detail >= 2) {
      // balcony rails, one per floor, and now and then laundry on the top one
      const rails = new Path2D();
      for (let z = fh * 1.9; z < h - fh * 0.3; z += fh) {
        const [ax, ay] = q(0.05, z), [bx, by] = q(0.95, z);
        rails.moveTo(ax, ay);
        rails.lineTo(bx, by);
      }
      g.strokeStyle = "rgba(60,56,52,.55)";
      g.lineWidth = p.px(0.5);
      g.stroke(rails);
      if (r(4) < 0.3 && h > fh * 2.5) {
        for (let k = 0; k < 3; k++) {
          const [lx, ly] = q(0.25 + k * 0.22, h - fh * 0.55);
          g.fillStyle = css(pick(P.awnings, r(5 + k)));
          g.fillRect(lx - p.px(0.35), ly, p.px(0.7), p.px(0.9));
        }
      }
    }
  }
  // the roof: a small tiled roof on some, a stainless water tank on most (near+)
  if (r(2) < 0.18) {
    const [bx, by] = iso(0, -b * 0.4);
    gable(g, foot(x + bx, y - h + by, a * 0.92, b * 0.42), p.px(0.4), Math.max(p.px(0.8), a * 0.5), wall, pick(P.roofs, r(3)), 0, 0);
  } else if (p.detail >= 1 && r(3) < 0.75) {
    const [bx, by] = iso(-a * 0.3, -b * 0.4), tx = x + bx, ty = y - h + by;
    const tr = Math.max(p.px(0.7), Math.min(a, b) * 0.38), th = tr * 1.2;
    g.fillStyle = css(shade(P.tank, -0.25));
    g.fillRect(tx - tr, ty - th, tr * 2, th);
    g.fillStyle = css(P.tank);
    g.fillRect(tx - tr, ty - th, tr, th);
    g.beginPath();
    g.ellipse(tx, ty - th, tr, tr * 0.5, 0, 0, Math.PI * 2);
    g.fillStyle = css(shade(P.tank, 0.12));
    g.fill();
  }
}

/** A row of tube houses along A on a parcel (half sizes a, b): items for the depth sort. */
function tubeRow(p, x, y, a, b, floors, r, salt, old) {
  const items = [];
  const fh = Math.max(p.px(1.5), p.R * 0.014);
  const n = Math.max(1, Math.round((2 * a) / Math.max(p.px(old ? 3.4 : 2.6), p.R * (old ? 0.05 : 0.036))));
  const w = (2 * a) / n;
  for (let i = 0; i < n; i++) {
    const [ox, oy] = iso(-a + w * (i + 0.5), 0);
    const hx = x + ox, hy = y + oy;
    const fl = old ? 1 + (r(salt + i) < 0.5 ? 1 : 0) : Math.max(2, Math.round(floors * (0.7 + 0.6 * r(salt + i))));
    const wall = pick(old ? P.oldWalls : P.facades, r(salt + 40 + i));
    const bb = b * (old ? 1 : 0.84 + 0.16 * r(salt + 80 + i));
    const hr = (s2) => r(salt + 120 + i * 7 + s2);
    items.push({ y: hy, draw: () => tubeHouse(p, hx, hy, (w / 2) * 0.97, bb, fl * fh, wall, old, hr) });
  }
  return items;
}

/** A market (chợ): a paved yard, a long hall under a corrugated roof, coloured stall awnings along its front. */
function drawMarket(p, x, y, bh) {
  const g = p.g;
  const Y = foot(x, y, bh * 0.9, bh * 0.9);
  fillPoly(g, Y, css(P.plaza));
  const F = foot(x, y, bh * 0.62, bh * 0.42);
  const hw = Math.max(p.px(1.6), p.R * 0.018), hr = Math.max(p.px(1.2), bh * 0.18);
  p.shadow(F, hw + hr * 0.6);
  gable(g, F, hw, hr, [222, 210, 182], [92, 124, 140], 0, p.detail >= 1 ? p.px(0.5) : 0);
  // awnings on the yard's two front edges (near+): short slanted flaps in market colours
  if (p.detail >= 1) {
    const [, E, S, W] = Y;
    const n = Math.max(3, Math.round((bh * p.s) / 4));
    const ah = Math.max(p.px(1.4), bh * 0.12), d = Math.max(p.px(1.2), bh * 0.1);
    for (const [A, B, dx, dy] of [[W, S, ...iso(0, -1)], [S, E, ...iso(-1, 0)]]) {
      for (let k = 0; k < n; k++) {
        const t0 = (k + 0.1) / n, t1 = (k + 0.9) / n;
        const p0 = [A[0] + (B[0] - A[0]) * t0, A[1] + (B[1] - A[1]) * t0], p1 = [A[0] + (B[0] - A[0]) * t1, A[1] + (B[1] - A[1]) * t1];
        const back = (q) => [q[0] + dx * d, q[1] + dy * d - ah];
        fillPoly(g, [[p0[0], p0[1] - ah * 0.7], [p1[0], p1[1] - ah * 0.7], back(p1), back(p0)], css(pick(P.awnings, hash01(k * 31 + Math.round(x * 97), 3))));
      }
    }
  }
}

// --- village -------------------------------------------------------------------------------------------------------

/** A village: one or two country roads, 6-10 tiled-roof houses along them, a đình or a chùa, garden trees and fields. */
function paintVillage(p, seed, Rpx) {
  const g = p.g, R = p.R;
  const r = rng(seed * 7919 + 101);
  const roadW = Math.max(R * 0.05, p.px(2.6)), roadIn = Math.max(R * 0.03, p.px(1.4));
  const hs = Math.max(R * 0.048, p.px(2.6)); // house half size
  const S = hs * 2.35; // spacing along a road
  const side = roadW / 2 + hs * 0.9 + Math.max(R * 0.012, p.px(0.8));
  const v0 = (r() - 0.5) * 0.08 * R; // main road along A at v = v0
  const cross = r() < 0.7 ? { u: (r() - 0.5) * 0.2 * R, v1: (0.26 + r() * 0.12) * R } : null; // road along B at u
  const nHouses = Rpx < 34 ? 6 : Rpx < 56 ? 8 : 10;

  // House spots along the roads, nearest the crossroads first (a compact cluster).
  const spots = [];
  const cu = cross ? cross.u : 0;
  for (let u = -0.44 * R; u <= 0.44 * R; u += S) {
    if (cross && Math.abs(u - cross.u) < S * 0.8) continue;
    for (const sg of [-1, 1]) spots.push({ u, v: v0 + sg * side, along: 0 });
  }
  if (cross) {
    for (let v = -cross.v1; v <= cross.v1; v += S) {
      if (Math.abs(v - v0) < S * 0.8) continue;
      for (const sg of [-1, 1]) spots.push({ u: cross.u + sg * side, v, along: 1 });
    }
  }
  for (const sp of spots) sp.d = Math.hypot(sp.u - cu, sp.v - v0) * (0.8 + r() * 0.4);
  spots.sort((a, b) => a.d - b.d);

  // The landmark sits behind the main road near the crossroads; spots too close to it are dropped.
  const pagoda = r() < 0.4; // a chùa (two-tier roof), else a đình
  const lm = { u: cu + S * 1.1, v: v0 - side - hs * 0.5 };
  const free = spots.filter((sp) => Math.hypot(sp.u - lm.u, sp.v - lm.v) > hs * 3.2);
  const houses = free.slice(0, nHouses);

  const items = [];
  for (const sp of houses) {
    const [x, y] = iso(sp.u, sp.v);
    const wall = pick(P.walls, r()), roof = pick(P.roofs, r());
    const a = hs * (sp.along === 0 ? 1.05 : 0.75) * (0.9 + r() * 0.2), b = hs * (sp.along === 0 ? 0.75 : 1.05) * (0.9 + r() * 0.2);
    items.push({ y, draw: () => p.house(x, y, a, b, wall, roof, sp.along) });
  }
  {
    const [x, y] = iso(lm.u, lm.v);
    items.push({ y, draw: () => drawTemple(p, x, y, hs * 1.35, pagoda ? 2 : 1) });
  }
  // Garden trees between and behind the houses, away from the roads and the buildings.
  const roadDist = (u, v) => Math.min(Math.abs(v - v0), cross && Math.abs(v) <= cross.v1 + S ? Math.abs(u - cross.u) : Infinity);
  const nTrees = 7 + Math.floor(r() * 4);
  const treeR = Math.max(R * 0.042, p.px(2.2));
  const placed = houses.map((sp) => [sp.u, sp.v]).concat([[lm.u, lm.v]]);
  for (let k = 0, tries = 0; k < nTrees && tries < 140; tries++) {
    const ang = r() * Math.PI * 2, rad = (0.12 + r() * 0.46) * R;
    const u = cu + Math.cos(ang) * rad, v = v0 + Math.sin(ang) * rad * 0.8;
    const [x, y] = iso(u, v);
    if (hexRho(x, y, R) > 0.7) continue;
    if (roadDist(u, v) < roadW + treeR) continue;
    if (placed.some(([pu, pv]) => Math.hypot(pu - u, pv - v) < hs * 1.7)) continue;
    placed.push([u, v]);
    const tr = treeR * (0.85 + r() * 0.3);
    items.push({ y, draw: () => p.tree(x, y, tr) });
    k++;
  }

  // Fields (near+): a few striped patches in the outer ring, away from the main road.
  if (p.detail >= 1) {
    const nF = 3 + Math.floor(r() * 2);
    for (let k = 0, tries = 0; k < nF && tries < 30; tries++) {
      const ang = r() * Math.PI * 2, rad = (0.52 + r() * 0.16) * R;
      const u = Math.cos(ang) * rad, v = Math.sin(ang) * rad;
      const fa = (0.1 + r() * 0.07) * R, fb = (0.07 + r() * 0.05) * R;
      const F = foot(...iso(u, v), fa, fb);
      if (F.some(([fx, fy]) => hexRho(fx, fy, R) > 0.84)) continue;
      if (Math.abs(v - v0) < fb + roadW * 2 || (cross && Math.abs(u - cross.u) < fa + roadW * 2 && Math.abs(v) < cross.v1)) continue;
      if (placed.some(([pu, pv]) => Math.abs(pu - u) < fa + hs * 1.5 && Math.abs(pv - v) < fb + hs * 1.5)) continue;
      placed.push([u, v]);
      const col = pick(P.field, r());
      fillPoly(g, F, css(col, 0.9));
      // furrows along the long side
      g.beginPath();
      const [N, E, S2, W] = F;
      const nS = Math.max(3, Math.round((fb * 2 * p.s) / 2.4));
      for (let q = 1; q < nS; q++) {
        const t = q / nS;
        g.moveTo(N[0] + (W[0] - N[0]) * t, N[1] + (W[1] - N[1]) * t);
        g.lineTo(E[0] + (S2[0] - E[0]) * t, E[1] + (S2[1] - E[1]) * t);
      }
      g.strokeStyle = css(shade(col, -0.25), 0.5);
      g.lineWidth = p.px(0.6);
      g.stroke();
      g.beginPath();
      poly(g, F);
      g.strokeStyle = "rgba(70,60,30,.35)";
      g.lineWidth = p.px(0.6);
      g.stroke();
    }
  }

  // A warm, light patch of trodden ground under the houses (lighter, not a dark vignette).
  const [gx, gy] = iso(cu, v0);
  const gr = g.createRadialGradient(gx, gy, 0, gx, gy, R * 0.5);
  gr.addColorStop(0, "rgba(236,226,186,.2)");
  gr.addColorStop(1, "rgba(236,226,186,0)");
  g.fillStyle = gr;
  g.fillRect(gx - R * 0.5, gy - R * 0.5, R, R);

  // Roads: the main road runs on to the hex edge (fading), the cross road stops in the village.
  const road = new Path2D();
  const [m0x, m0y] = iso(-0.6 * R, v0), [m1x, m1y] = iso(0.6 * R, v0);
  road.moveTo(m0x, m0y);
  road.lineTo(m1x, m1y);
  if (cross) {
    const [c0x, c0y] = iso(cross.u, -cross.v1), [c1x, c1y] = iso(cross.u, cross.v1);
    road.moveTo(c0x, c0y);
    road.lineTo(c1x, c1y);
  }
  const tail = new Path2D();
  for (const sg of [-1, 1]) {
    const [ax, ay] = iso(sg * 0.6 * R, v0), [bx, by] = iso(sg * 0.8 * R, v0);
    tail.moveTo(ax, ay);
    tail.lineTo(bx, by);
  }
  g.lineCap = "round";
  for (const [P2, a] of [[road, 1], [tail, 0.5]]) {
    g.strokeStyle = css(P.roadEdge, 0.5 * a);
    g.lineWidth = roadW;
    g.stroke(P2);
    g.strokeStyle = css(P.road, 0.95 * a);
    g.lineWidth = roadIn;
    g.stroke(P2);
  }
  return items;
}

// --- street-grid layout ----------------------------------------------------------------------------------------------

/** Blocks of the tile: {L (pitch), sw (street width), bh (block half size), lots: [{x, y, u, v, c, id, type}],
 *  fringe: [{x, y, id}]} (km). */
function gridLayout(cls, seed, R, Rpx, capital, old) {
  const L = Math.max(cls.lot * R, (LOT_MIN_PX / Rpx) * R);
  const sw = Math.max(L * 0.19, (1.3 / Rpx) * R);
  const half = L / 2, bh = half - sw / 2;
  const n = Math.ceil((R * 1.2) / L) + 1;
  const lots = [], fringe = [];
  const H = (id, salt) => hash01(seed * 7919 + id, salt);
  const capR = capital ? squareExtent(R, Rpx) : null;
  for (let u = -n; u <= n; u++) {
    for (let v = -n; v <= n; v++) {
      const [x, y] = iso(u * L, v * L);
      const id = (u + 64) * 131 + (v + 64);
      const rho = Math.max(...foot(x, y, half, half).map((q) => hexRho(q[0], q[1], R)));
      const rc = hexRho(x, y, R);
      const reserved = capR && reservedBySquare(u * L, v * L, L, capR);
      const cut = !reserved && rc > cls.extent * 0.68 && H(id, 10) < cls.ragged;
      if (rho <= cls.extent && !cut) {
        const c = Math.max(0, Math.min(1, 1 - rc / cls.extent + (H(id, 11) - 0.5) * 0.16));
        lots.push({ x, y, u, v, c, id, type: reserved ? "reserved" : null });
      } else if (cls.fringe && rho <= 0.86) {
        fringe.push({ x, y, id });
      }
    }
  }
  // Types: towers in the core, mid-rise around it, houses at the edge; a park, a market, a pagoda or đình.
  // An old quarter takes the inner lots of one quadrant (chosen by the seed) before anything else.
  if (old) {
    const su = hash01(seed, 70) < 0.5 ? -1 : 1, sv = hash01(seed, 71) < 0.5 ? -1 : 1;
    for (const l of lots) if (!l.type && l.c > 0.35 && l.u * su > 0 && l.v * sv >= 0) l.type = "old";
  }
  const free = lots.filter((l) => !l.type);
  const best = (ok, salt) => {
    let b = null, bv = -1;
    for (const l of free) {
      if (l.type || !ok(l)) continue;
      const h = H(l.id, salt);
      if (h > bv) { b = l; bv = h; }
    }
    return b;
  };
  if (free.length >= 4) {
    const park = best((l) => l.c > 0.2 && l.c < 0.7, 12);
    if (park) park.type = "park";
  }
  if (free.length > 6) {
    const market = best((l) => l.c > 0.45 && l.c < 0.82, 14);
    if (market) market.type = "market";
  }
  if (cls.civic && free.length >= 8 && !capital) {
    const civ = best((l) => l.c > 0.3 && l.c < 0.75, 16);
    if (civ) civ.type = "civic";
  }
  for (const l of free) {
    if (l.type) continue;
    if (H(l.id, 13) < cls.park) l.type = "park";
    else if (l.c > cls.core && H(l.id, 15) < 0.9) l.type = "core";
    else if (l.c > cls.mid) l.type = "mid";
    else l.type = "res";
  }
  return { L, sw, half, bh, lots, fringe };
}

// --- the Ba Đình complex --------------------------------------------------------------------------------------

function squareExtent(R, Rpx) {
  const q = R * 0.1 * Math.max(1, Math.min(1.5, 26 / Rpx)); // grows a bit when zoomed out, to stay legible
  return { q, half: q * 2.9, mallFrom: q * 2.9, mallTo: Math.min(R * 0.78, q * 8.5), mallHalf: q * 1.05 };
}
function reservedBySquare(u, v, L, C) {
  const h = L * 0.5;
  const inSq = Math.abs(u) - h < C.half && Math.abs(v) - h < C.half;
  const inMall = u + h > C.mallFrom && u - h < C.mallTo && Math.abs(v) - h < C.mallHalf;
  return inSq || inMall;
}

/** Ba Đình square: a stone forecourt round the hall, then a long square of lawn plots between paved walks. */
function paintSquareGround(p, C) {
  const g = p.g;
  fillPoly(g, foot(0, 0, C.half, C.half), css(P.plaza));
  fillPoly(g, foot(0, 0, C.half * 0.82, C.half * 0.82), css(P.plazaInner));
  const mu = (C.mallFrom + C.mallTo) / 2, mh = (C.mallTo - C.mallFrom) / 2;
  fillPoly(g, foot(...iso(mu, 0), mh, C.mallHalf), css(P.plazaInner));
  // lawn plots in a grid (the square's grass squares), 2 across and as many along as fit
  const nu = Math.max(3, Math.round(mh / (C.mallHalf * 0.55))), du = (2 * mh) / nu, dv = C.mallHalf;
  const plots = new Path2D();
  for (let i = 0; i < nu; i++) {
    for (const sv of [-0.5, 0.5]) poly(plots, foot(...iso(C.mallFrom + du * (i + 0.5), sv * dv), du * 0.4, dv * 0.4));
  }
  g.fillStyle = css(P.lawn);
  g.fill(plots);
}

/** Items to draw in depth order for the Ba Đình complex: [{y, draw()}]. */
function squareItems(p, C) {
  const items = [];
  const q = C.q;
  // tree rows along the square
  if (p.detail >= 1) {
    const nT = Math.max(2, Math.floor((C.mallTo - C.mallFrom - q) / Math.max(q * 0.9, p.px(5))));
    for (let k = 0; k <= nT; k++) {
      const u = C.mallFrom + q * 0.5 + ((C.mallTo - C.mallFrom - q * 1.6) * k) / nT;
      for (const sv of [-1.08, 1.08]) {
        const [tx, ty] = iso(u, sv * C.mallHalf);
        items.push({ y: ty, draw: () => p.tree(tx, ty, Math.max(q * 0.22, p.px(1.6))) });
      }
    }
  }
  // the flagpole in the middle of the square
  const [fx, fy] = iso(C.mallFrom + (C.mallTo - C.mallFrom) * 0.42, 0);
  items.push({ y: fy, draw: () => flagpole(p, fx, fy, q * 2.4, q) });
  // the hall: a long pale-stone block (long axis along B) on a stepped base, a colonnade of square pillars facing the
  // square (the south-east face), a stepped flat roof and the flag
  items.push({
    y: 0,
    draw: () => {
      const g = p.g, stone = [206, 204, 196];
      const base = q * 0.14, wallH = q * 0.6;
      const F0 = foot(0, 0, q * 1.1, q * 2.65), F = foot(0, 0, q * 0.95, q * 2.5);
      p.shadow(F0, base + wallH + q * 0.3);
      p.box(F0, 0, base, shade(stone, -0.12));
      p.box(F, base, wallH, stone);
      // the colonnade: a dark loggia behind square pillars on the face toward the square
      const [, E, S] = F.map((v) => up(v, base));
      const pt = (t, z) => [S[0] + (E[0] - S[0]) * t, S[1] + (E[1] - S[1]) * t - z];
      fillPoly(g, [pt(0.04, wallH * 0.08), pt(0.96, wallH * 0.08), pt(0.96, wallH * 0.82), pt(0.04, wallH * 0.82)], "rgba(52,52,50,.85)");
      const n = p.detail >= 1 ? 14 : 8, pw = 0.42 / n;
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        fillPoly(g, [pt(t - pw, wallH * 0.04), pt(t + pw, wallH * 0.04), pt(t + pw, wallH * 0.86), pt(t - pw, wallH * 0.86)], css(shade(stone, 0.06)));
      }
      // stepped flat roof
      p.box(foot(0, -(base + wallH), q * 0.8, q * 2.3), 0, q * 0.14, shade(stone, -0.04));
      p.box(foot(0, -(base + wallH + q * 0.14), q * 0.55, q * 1.6), 0, q * 0.12, shade(stone, 0.02));
      flagpole(p, 0, -(base + wallH + q * 0.26), q * 0.9, q * 0.6);
    },
  });
  return items;
}

/** A flagpole at (x, y) of height h with the national flag (red, gold star) of width ~fw. */
function flagpole(p, x, y, h, fw) {
  const g = p.g;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x, y - h);
  g.strokeStyle = "rgba(230,230,226,.95)";
  g.lineWidth = Math.max(p.px(0.7), fw * 0.05);
  g.stroke();
  const w = Math.max(p.px(4), fw * 0.7), fh = w * 0.66, y0 = y - h;
  g.beginPath();
  g.moveTo(x, y0);
  g.quadraticCurveTo(x + w * 0.5, y0 - fh * 0.12, x + w, y0 + fh * 0.05);
  g.lineTo(x + w, y0 + fh * 1.05);
  g.quadraticCurveTo(x + w * 0.5, y0 + fh * 0.88, x, y0 + fh);
  g.closePath();
  g.fillStyle = "#da251d";
  g.fill();
  g.beginPath();
  star(g, x + w * 0.5, y0 + fh * 0.52, fh * 0.3);
  g.fillStyle = "#ffcd00";
  g.fill();
}

// --- painting a whole tile ---------------------------------------------------------------------------------------

function paintTile(g, city, R, Rpx, dev, detail, col, seed, capital, old) {
  const cls = cityClass(city.population);
  const sCss = Rpx / R;
  const p = new Painter(g, R, sCss, dev, detail, col);
  const items = cls.village ? paintVillage(p, seed, Rpx) : paintGrid(p, cls, seed, Rpx, capital, old);
  items.sort((a, b) => a.y - b.y);

  // All cast shadows first, as one fill so overlapping shadows don't darken twice, then the buildings. The
  // shadow geometry comes from a dry run of the same draw calls against a context that paints nothing.
  prepassShadows(p, items);
  g.fillStyle = "rgba(22,18,12,.3)";
  g.fill(p.shadows);
  p.shadows = new Path2D(); // the real pass adds the same shapes again; they are dropped
  for (const it of items) it.draw();

  // No hex rim: the built-up area fades into the land around it, and the state shows only through accents (crowns
  // on the towers). Up close a faint hairline keeps the city hex findable.
  if (detail >= 2 && !cls.village) {
    hexPath(g, 0, 0, R, 0.95);
    g.lineJoin = "round";
    g.strokeStyle = css(shade(col, 0.1), 0.25);
    g.lineWidth = p.px(1);
    g.stroke();
  }
}

/** Town and bigger: pale base, paved street grid, block fills; returns the standing items. */
function paintGrid(p, cls, seed, Rpx, capital, old) {
  const g = p.g, R = p.R;
  const lay = gridLayout(cls, seed, R, Rpx, capital, old);
  const { L, half, bh, lots, fringe } = lay;
  const ci = CITY_CLASSES.indexOf(cls);
  const r0 = (id, salt) => hash01(seed * 7919 + id, salt);

  // 1. A pale base (worn grass and bare ground), opaque in the middle and feathered out to nothing near the hex
  //    edge, so the built-up land blends into the fields, forest or suburbs around it (no pad, no rim).
  g.save();
  hexPath(g, 0, 0, R, 0.97);
  g.clip();
  const lawn = mix(mix(P.lawn, [150, 142, 100], 0.4), P.concrete, 0.2 + cls.grey * 0.7);
  const lg = g.createRadialGradient(-R * 0.08, -R * 0.1, 0, 0, 0, R * 0.97);
  lg.addColorStop(0, css(shade(lawn, 0.04)));
  lg.addColorStop(0.5, css(lawn, 0.96));
  lg.addColorStop(0.7, css(shade(lawn, -0.06), 0.5));
  lg.addColorStop(0.88, css(shade(lawn, -0.08), 0));
  g.fillStyle = lg;
  g.fillRect(-R, -R, 2 * R, 2 * R);
  // a little mottling so the base isn't flat (kept inside the opaque middle)
  for (let k = 0; k < 6; k++) {
    const mx = (hash01(seed, 40 + k) - 0.5) * 0.9 * R, my = (hash01(seed, 50 + k) - 0.5) * 0.9 * R, mr = R * (0.16 + hash01(seed, 60 + k) * 0.2);
    const mg = g.createRadialGradient(mx, my, 0, mx, my, mr);
    const c = k % 2 ? "40,60,20" : "230,236,190";
    mg.addColorStop(0, `rgba(${c},.12)`);
    mg.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = mg;
    g.fillRect(mx - mr, my - mr, 2 * mr, 2 * mr);
  }
  g.restore();

  // 2. The pad: kerb (with a soft feather) and asphalt, the union of the blocks' street cells.
  const kw = Math.max(p.px(0.9), L * 0.05);
  const pad = new Path2D(), kerb = new Path2D();
  for (const l of lots) {
    poly(pad, foot(l.x, l.y, half, half));
    poly(kerb, foot(l.x, l.y, half + kw, half + kw));
  }
  g.save();
  hexPath(g, 0, 0, R, 0.95); // keep the feather off the neighbouring hexes
  g.clip();
  p.feather(kerb, css(P.kerb), R * 0.05, "rgba(40,36,28,.55)");
  g.fillStyle = css(shade(P.asphalt, ci * 0.03));
  g.fill(pad);
  g.restore();

  // 3. Blocks: a sidewalk, then the block's own surface.
  const swk = Math.max(p.px(0.55), L * 0.035);
  const paths = { walk: new Path2D(), paved: new Path2D(), park: new Path2D(), plaza: new Path2D() };
  const parkWalks = new Path2D();
  for (const l of lots) {
    if (l.type === "reserved") continue;
    poly(paths.walk, foot(l.x, l.y, bh, bh));
    const kind = l.type === "park" ? "park" : l.type === "civic" ? "plaza" : "paved";
    const F = foot(l.x, l.y, bh - swk, bh - swk);
    poly(paths[kind], F);
    if (l.type === "park" && p.detail >= 1) {
      const [N, E, S, W] = F;
      parkWalks.moveTo(N[0], N[1]);
      parkWalks.lineTo(S[0], S[1]);
      parkWalks.moveTo(W[0], W[1]);
      parkWalks.lineTo(E[0], E[1]);
    }
  }
  g.fillStyle = css(P.walk);
  g.fill(paths.walk);
  g.fillStyle = css(P.concrete);
  g.fill(paths.paved);
  g.fillStyle = css(P.park);
  g.fill(paths.park);
  g.fillStyle = css(P.plazaInner);
  g.fill(paths.plaza);
  if (p.detail >= 1) {
    g.strokeStyle = css(P.path, 0.9);
    g.lineWidth = Math.max(p.px(0.8), L * 0.04);
    g.stroke(parkWalks);
  }
  // 4. Lane markings on the two main avenues (close).
  if (p.detail >= 2 && ci >= 2) {
    const avenue = new Path2D();
    const reach = R * 1.2;
    for (const off of [0.5, -0.5]) {
      const [ax, ay] = iso(-reach, off * L), [bx, by] = iso(reach, off * L);
      avenue.moveTo(ax, ay);
      avenue.lineTo(bx, by);
      const [cx, cy] = iso(off * L, -reach), [dx, dy] = iso(off * L, reach);
      avenue.moveTo(cx, cy);
      avenue.lineTo(dx, dy);
    }
    g.save();
    g.clip(pad);
    g.setLineDash([p.px(2.2), p.px(2.2)]);
    g.strokeStyle = "rgba(240,214,130,.6)";
    g.lineWidth = p.px(0.7);
    g.stroke(avenue);
    g.setLineDash([]);
    g.restore();
  }
  // 5. Motorbikes parked along the kerbs (close): a few specks in four colours on the street side of each block.
  if (p.detail >= 2) {
    const bikes = P.bikes.map(() => new Path2D());
    const br = Math.max(p.px(0.55), L * 0.02);
    for (const l of lots) {
      if (l.type === "reserved" || l.type === "park") continue;
      for (let k = 0; k < 5; k++) {
        const t = (r0(l.id, 300 + k) - 0.5) * 1.7 * bh, side = k % 2 ? iso(t, bh + br * 1.4) : iso(bh + br * 1.4, t);
        const bx = l.x + side[0], by = l.y + side[1];
        const P2 = bikes[Math.floor(r0(l.id, 310 + k) * bikes.length)];
        P2.moveTo(bx + br, by);
        P2.ellipse(bx, by, br, br * 0.6, 0, 0, Math.PI * 2);
      }
    }
    P.bikes.forEach((c, k) => {
      g.fillStyle = c;
      g.fill(bikes[k]);
    });
  }
  const C = capital ? squareExtent(R, Rpx) : null;
  if (C) paintSquareGround(p, C);

  // 6. Everything that stands up.
  const items = [];
  const hMax = R * (capital ? Math.min(cls.height, 0.24) : cls.height);
  const big = bh * p.s >= 6; // blocks big enough to subdivide (css px)
  let tallest = null;
  for (const l of lots) {
    const r = (salt) => r0(l.id, salt);
    const { x, y } = l;
    if (l.type === "core") {
      const h = Math.max(p.px(7), hMax * (0.3 + 0.7 * l.c ** 1.4 * (0.55 + 0.45 * r(21))));
      const it = { y, h, draw: () => drawCore(p, x, y, bh, h, r, it === tallest) };
      if (!tallest || h > tallest.h) tallest = it;
      items.push(it);
    } else if (l.type === "mid") {
      // taller tube-house rows (two back to back), or now and then a modern mid-rise block (an office or a hotel)
      const h = Math.max(p.px(3.5), R * (0.045 + 0.06 * r(24)) * (0.8 + ci * 0.12) * (0.6 + 0.6 * l.c));
      if (r(25) < 0.3) {
        const split = !big ? 1 : r(27) < 0.5 ? 1 : 2;
        for (const pc of parcels(split, bh)) {
          const [ox, oy] = iso(pc.u, pc.v);
          const gap = Math.max(p.px(0.45), L * 0.018);
          items.push({ y: y + oy, draw: () => drawBlock(p, x + ox, y + oy, pc.a - gap, pc.b - gap, h * (0.7 + 0.55 * r(26 + pc.k)), r, pc.k) });
        }
      } else {
        const floors = 3 + ci * 0.6 + 2 * l.c;
        for (const pc of parcels(big ? 3 : 1, bh)) items.push(...tubeRow(p, x + iso(pc.u, pc.v)[0], y + iso(pc.u, pc.v)[1], pc.a, pc.b * 0.92, floors, r, 400 + pc.k * 50, false));
      }
    } else if (l.type === "res" || l.type === "old") {
      // rows of tube houses (or an old quarter's shophouses) back to back across the block, a yard tree now and then
      const o = l.type === "old";
      for (const pc of parcels(big ? 3 : 1, bh)) items.push(...tubeRow(p, x + iso(pc.u, pc.v)[0], y + iso(pc.u, pc.v)[1], pc.a, pc.b * 0.92, 2 + ci * 0.4, r, 400 + pc.k * 50, o));
      if (!o && big && p.detail >= 1 && r(105) < 0.25) {
        const [tx, ty] = iso(-bh * 0.6, 0);
        items.push({ y: y + ty + 0.001, draw: () => p.tree(x + tx, y + ty, Math.max(bh * 0.18, p.px(1.6))) });
      }
    } else if (l.type === "park") {
      const nT = p.detail === 0 ? 2 : big ? 6 : 3;
      if (p.detail >= 2 && big) {
        const [px2, py2] = iso(bh * 0.3, -bh * 0.25);
        g.beginPath();
        g.ellipse(x + px2, y + py2, bh * 0.32, bh * 0.17, 0, 0, Math.PI * 2);
        g.fillStyle = css(P.pond);
        g.fill();
        g.strokeStyle = "rgba(240,250,255,.6)";
        g.lineWidth = p.px(0.6);
        g.stroke();
      }
      for (let k = 0; k < nT; k++) {
        const [tx, ty] = iso((r(110 + k) - 0.5) * bh * 1.5, (r(120 + k) - 0.5) * bh * 1.5);
        items.push({ y: y + ty, draw: () => p.tree(x + tx, y + ty, Math.max(bh * 0.2, p.px(1.6))) });
      }
    } else if (l.type === "market") {
      items.push({ y, draw: () => drawMarket(p, x, y, bh) });
    } else if (l.type === "civic") {
      // a pagoda (two-tier roof) or a đình in its paved courtyard, an old tree behind it
      const [tx, ty] = iso(-bh * 0.55, -bh * 0.55);
      items.push({ y: y + ty, draw: () => p.tree(x + tx, y + ty, Math.max(bh * 0.28, p.px(1.8))) });
      items.push({ y, draw: () => drawTemple(p, x, y, bh * 0.6, r(17) < 0.5 ? 2 : 1) });
    }
  }
  // Fringe: houses and trees on the lawn outside the pad.
  for (const f of fringe) {
    const r = (salt) => r0(f.id, salt);
    const n = 1 + (r(200) < 0.6 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const [ox, oy] = iso((r(201 + k) - 0.5) * L * 0.6, (r(211 + k) - 0.5) * L * 0.6);
      const hx = f.x + ox, hy = f.y + oy;
      if (r(221 + k) < 0.45) {
        items.push({ y: hy, draw: () => p.tree(hx, hy, Math.max(L * 0.1, p.px(1.6))) });
      } else if (r(271 + k) < 0.5) {
        // a single-storey house under a tiled or corrugated roof
        const a = Math.max(L * 0.14, p.px(2)), b = a * 0.75;
        const wall = pick(P.walls, r(241 + k)), roof = pick(P.roofs, r(251 + k));
        items.push({ y: hy, draw: () => p.house(hx, hy, a, b, wall, roof, r(261 + k) < 0.5 ? 0 : 1) });
      } else {
        // a lone tube house
        const a = Math.max(L * 0.07, p.px(1.4)), b = a * 1.6, h = Math.max(p.px(3), R * 0.014 * (2 + Math.floor(r(281 + k) * 3)));
        const wall = pick(P.facades, r(241 + k)), hr = (s2) => r(291 + k * 7 + s2);
        items.push({ y: hy, draw: () => tubeHouse(p, hx, hy, a, b, h, wall, false, hr) });
      }
    }
  }
  if (C) items.push(...squareItems(p, C));
  return items;
}

/** Parcels of a block (half size bh): 1 whole, 2 split along A, 3 split along B, 4 a 2x2 grid. */
function parcels(split, bh) {
  if (split === 1) return [{ u: 0, v: 0, a: bh, b: bh, k: 0 }];
  if (split === 2) return [-1, 1].map((sg, k) => ({ u: (sg * bh) / 2, v: 0, a: bh / 2, b: bh, k }));
  if (split === 3) return [-1, 1].map((sg, k) => ({ u: 0, v: (sg * bh) / 2, a: bh, b: bh / 2, k }));
  const out = [];
  for (const su of [-1, 1]) for (const sv of [-1, 1]) out.push({ u: (su * bh) / 2, v: (sv * bh) / 2, a: bh / 2, b: bh / 2, k: out.length });
  return out;
}

/** Run each item's draw with a context that swallows paint, so only the shadow geometry is collected. */
function prepassShadows(p, items) {
  const real = p.g;
  p.g = NULL_CTX;
  for (const it of items) it.draw();
  p.g = real;
}
const NULL_CTX = new Proxy(
  {},
  {
    get(_, key) {
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop() {} });
      return () => {};
    },
    set() {
      return true;
    },
  },
);

/** A downtown block: a podium filling the block, then one tower or two (side by side along A). */
function drawCore(p, x, y, bh, h, r, tallest) {
  const podH = Math.max(p.px(2.2), p.R * 0.028);
  const F = foot(x, y, bh * 0.95, bh * 0.95);
  const podC = pick(P.stone, r(230));
  p.shadow(F, podH);
  p.box(F, 0, podH, podC);
  if (p.detail >= 1) {
    // shop fronts: a dark band along the two visible faces
    const [, E, S, W] = F;
    const bandH = podH * 0.45;
    fillPoly(p.g, [W, S, up(S, bandH), up(W, bandH)], "rgba(40,48,60,.45)");
    fillPoly(p.g, [S, E, up(E, bandH), up(S, bandH)], "rgba(20,24,32,.45)");
  }
  const twin = bh * p.s >= 7 && r(231) < 0.35 && !tallest;
  if (twin) {
    for (const [sg, k] of [[-1, 0], [1, 1]]) {
      const [ox, oy] = iso(sg * bh * 0.46, 0);
      drawTower(p, x + ox, y + oy, bh * 0.4, bh * 0.66, h * (k ? 0.72 : 1), (salt) => r(salt + k * 50), false, podH);
    }
  } else {
    const a = bh * (0.6 + r(22) * 0.2), b = bh * (0.6 + r(23) * 0.2);
    drawTower(p, x, y, a, b, h, r, tallest, podH);
  }
}

function drawTower(p, x, y, a, b, h, r, tallest, z0 = 0) {
  const glass = r(201) < 0.65;
  const base = glass ? pick(P.glass, r(202)) : pick(P.stone, r(203));
  const F = foot(x, y, a, b);
  p.shadow(F, z0 + h);
  const setback = h > p.R * 0.3 && r(204) < 0.45;
  const h1 = setback ? h * (0.55 + r(205) * 0.15) : h;
  p.box(F, z0, h1, base, { glass });
  p.windows(F, z0, h1, glass);
  let top = { F, z: z0 + h1, a, b };
  if (setback) {
    const F2 = foot(x, y, a * 0.68, b * 0.68);
    p.box(F2, z0 + h1, h - h1, shade(base, 0.04), { glass });
    p.windows(F2, z0 + h1, h - h1, glass);
    top = { F: F2, z: z0 + h, a: a * 0.68, b: b * 0.68 };
  }
  const g = p.g;
  // roof: parapet inset, a crown band in the state colour on some, a rooftop box or a spire on the tallest
  const [, E, S, W] = top.F.map((q) => up(q, top.z));
  const ins = foot(x, y - top.z, top.a * 0.72, top.b * 0.72);
  if (p.detail >= 1) fillPoly(g, ins, css(shade(base, -0.05)));
  if (r(206) < 0.4 || tallest) {
    const band = Math.max(p.px(1), h * 0.035);
    fillPoly(g, [W, S, up(S, -band), up(W, -band)], css(p.accent));
    fillPoly(g, [S, E, up(E, -band), up(S, -band)], css(shade(p.accent, -0.3)));
  }
  if (tallest && h > p.R * 0.3) {
    const sh = h * 0.22;
    g.beginPath();
    g.moveTo(x, y - top.z);
    g.lineTo(x, y - top.z - sh);
    g.strokeStyle = "rgba(235,235,230,.95)";
    g.lineWidth = Math.max(p.px(0.9), top.a * 0.12);
    g.stroke();
    g.beginPath();
    g.arc(x, y - top.z - sh, Math.max(p.px(0.9), top.a * 0.1), 0, Math.PI * 2);
    g.fillStyle = "#ffe08a";
    g.fill();
  } else if (p.detail >= 1 && r(207) < 0.6) {
    const Fb = foot(x + (r(208) - 0.5) * top.a * 0.6, y - top.z + (r(209) - 0.5) * top.b * 0.3, top.a * 0.28, top.b * 0.28);
    p.box(Fb, 0, Math.max(p.px(1.2), h * 0.04), [150, 148, 140], { outline: false });
  }
}

function drawBlock(p, x, y, a, b, h, r, k) {
  const base = pick(P.stone, r(220 + k));
  const F = foot(x, y, a, b);
  p.shadow(F, h);
  p.box(F, 0, h, base);
  p.windows(F, 0, h, false);
  if (p.detail >= 1) {
    // parapet + a green roof on some, a roof hatch at close
    const ins = foot(x, y - h, a * 0.8, b * 0.8);
    fillPoly(p.g, ins, r(224 + k) < 0.2 ? css(mix(P.park, P.concrete, 0.3)) : css(shade(base, 0.08)));
    if (p.detail >= 2 && r(228 + k) < 0.5) p.box(foot(x - a * 0.2, y - h - b * 0.05, a * 0.22, b * 0.22), 0, p.px(1.4), [150, 146, 138], { outline: false });
  }
}

// --- urban fringe art (for terrain.js urban cells) -----------------------------------------------------------------
// Drawn in R units (1 = hex radius) around the cell centre; upx = device px per unit; v = variant; kind "small" is the
// compact version used on hills. The plan (streets, houses, slabs, sheds, trees) is shared by the ground and build
// sprites. Streets run straight along the iso axes (A, and one across along B); (u, v) are ground coordinates.

const SUB_WALLS = [[240, 226, 196], [232, 236, 228], [240, 210, 140], [204, 226, 200], [238, 196, 180], [206, 220, 238], [246, 236, 170]];
const SUB_ROOFS = [[170, 76, 52], [150, 66, 48], [96, 104, 116], [182, 100, 62]];
const SLAB_WALLS = [[236, 234, 226], [226, 222, 210], [214, 224, 230], [238, 228, 206]];
const SHED_ROOFS = [[72, 112, 152], [176, 180, 182], [210, 212, 208], [74, 128, 120]];
const suburbPlans = new Map();

function suburbPlan(v, kind) {
  const key = `${v}|${kind}`, small = kind === "small", estate = kind === "factory";
  let plan = suburbPlans.get(key);
  if (plan) return plan;
  const r = rng(v * 7349 + (small ? 5 : estate ? 17 : 11));
  const type = estate ? "factory" : small || v % 8 < 5 ? "rows" : "kdt";
  const lim = small ? 0.5 : estate ? 0.62 : 0.84;
  const fits = (F, m = 0) => F.every(([x, y]) => hexRho(x, y, 1) <= lim - m);
  const sw = 0.05; // street width
  const P2 = 0.3 + r() * 0.06, v0 = (r() - 0.5) * 0.12, u0 = small ? 9 : (r() - 0.5) * 0.3;
  const vs = small || estate ? [v0] : [v0 - P2, v0, v0 + P2];
  const streets = vs.map((sv) => [iso(-1.3, sv), iso(1.3, sv)]);
  if (!small) streets.push([iso(u0, -1.3), iso(u0, 1.3)]);
  const nearStreet = (u, vv, m) => vs.some((sv) => Math.abs(vv - sv) < sw / 2 + m) || Math.abs(u - u0) < sw / 2 + m;
  // Blocks between the streets that hold something else than houses: a khu đô thị's slabs and park, a factory's sheds.
  const zones = []; // {u0, u1, v0, v1, what}
  if (type === "kdt") {
    const side = r() < 0.5 ? -1 : 1;
    zones.push({ u0: side < 0 ? -1 : u0, u1: side < 0 ? u0 : 1, v0: v0, v1: v0 + P2, what: "slabs" });
    zones.push({ u0: side < 0 ? u0 : -1, u1: side < 0 ? 1 : u0, v0: v0, v1: v0 + P2, what: "park" });
  } else if (type === "factory") {
    for (const [a0, a1] of [[v0 - P2, v0], [v0, v0 + P2]]) {
      zones.push({ u0: -1, u1: u0, v0: a0, v1: a1, what: "sheds" });
      zones.push({ u0, u1: 1, v0: a0, v1: a1, what: "sheds" });
    }
  }
  const inZone = (u, vv) => zones.some((z) => u > z.u0 && u < z.u1 && vv > z.v0 && vv < z.v1);
  const houses = [], boxes = [], trees = [], yards = [], parks = [];
  // Townhouse rows (nhà phố liền kề) on both sides of every street: runs of 4-9 houses of one design, a gap now and then.
  const w = 0.052, hb = 0.05;
  for (const sv of vs) {
    for (const side of [-1, 1]) {
      const rv = sv + side * (sw / 2 + 0.006 + hb);
      let run = 0, wall = null, floors = 3, cap = null;
      for (let u = -1.1; u < 1.1; u += w) {
        if (!small && Math.abs(u - u0) < sw / 2 + w * 0.6) { run = 0; continue; }
        if (inZone(u, rv)) continue;
        if (run <= 0) {
          run = 4 + Math.floor(r() * 6);
          wall = pick(SUB_WALLS, r());
          floors = 2 + Math.floor(r() * 3);
          cap = r() < 0.4 ? pick(SUB_ROOFS, r()) : null;
          if (r() < 0.22) { u += w * (1 + Math.floor(r() * 2)); continue; } // a vacant lot
        }
        run--;
        const [x, y] = iso(u, rv), F = foot(x, y, w * 0.48, hb);
        if (!fits(F, 0.02)) continue;
        // one design per run, but owners repaint and add a floor: half the houses get their own colour, some a floor more
        const own = r() < 0.5, fl = floors + (r() < 0.3 ? 1 : 0);
        houses.push({ x, y, F, h: fl * 0.026, wall: own ? pick(SUB_WALLS, r()) : wall, cap: cap || (r() < 0.2 ? pick(SUB_ROOFS, r()) : null), tank: r() < 0.6 });
      }
    }
  }
  for (const z of zones) {
    const zu0 = Math.max(z.u0, -0.9) + (z.u0 === u0 ? sw : 0.02), zu1 = Math.min(z.u1, 0.9) - (z.u1 === u0 ? sw : 0.02);
    const zv0 = z.v0 + sw * 0.6, zv1 = z.v1 - sw * 0.6;
    if (zu1 - zu0 < 0.12) continue;
    const cu = (zu0 + zu1) / 2, cv = (zv0 + zv1) / 2, hu = (zu1 - zu0) / 2, hv = (zv1 - zv0) / 2;
    if (z.what === "park") {
      const F = foot(...iso(cu, cv), hu * 0.9, hv * 0.85);
      if (fits(F, -0.04)) parks.push(F);
      for (let k = 0; k < 6; k++) {
        const tu = cu + (r() - 0.5) * hu * 1.6, tv = cv + (r() - 0.5) * hv * 1.5, [x, y] = iso(tu, tv);
        if (hexRho(x, y, 1) <= lim - 0.04) trees.push({ x, y, h: 0.06 + r() * 0.025 });
      }
    } else if (z.what === "slabs") {
      // apartment slabs, 12-20 floors, along A in two lines
      const n = Math.max(1, Math.min(3, Math.floor((2 * hu) / 0.2)));
      for (let k = 0; k < n; k++) {
        for (const dv of [-0.5, 0.5]) {
          const su = cu - hu + ((k + 0.5) * 2 * hu) / n, [x, y] = iso(su, cv + dv * hv), F = foot(x, y, Math.min(0.09, hu / n - 0.02), 0.04);
          if (fits(F, 0.02)) boxes.push({ x, y, F, h: 0.26 + r() * 0.18, wall: pick(SLAB_WALLS, r()), slab: true });
        }
      }
    } else {
      // a factory: a concrete yard, one or two big sheds, an office block by the gate
      const [x, y] = iso(cu, cv), Y = foot(x, y, hu * 0.96, hv * 0.96);
      if (!fits(Y, -0.06)) continue;
      yards.push(Y);
      const two = hu > 0.3 && r() < 0.6;
      for (const k of two ? [-1, 1] : [0]) {
        const sa = two ? hu * 0.42 : hu * 0.7, [sx, sy] = iso(cu + k * hu * 0.5, cv - hv * 0.1), F = foot(sx, sy, sa, hv * 0.62);
        if (fits(F, 0.01)) boxes.push({ x: sx, y: sy, F, h: 0.045 + r() * 0.02, wall: [214, 210, 200], roof: pick(SHED_ROOFS, r()), shed: true });
      }
      const [ox, oy] = iso(cu - hu * 0.75, cv + hv * 0.72), Fo = foot(ox, oy, 0.035, 0.03);
      if (fits(Fo, 0.01)) boxes.push({ x: ox, y: oy, F: Fo, h: 0.08, wall: pick(SLAB_WALLS, r()) });
    }
  }
  // Trees along the streets' edges and in the gaps (round canopy trees; no conifers in the lowlands).
  const taken = (x, y) => houses.some((h) => Math.abs(h.x - x) < 0.05 && Math.abs(h.y - y) < 0.05) || boxes.some((b) => Math.abs(b.x - x) < 0.14 && Math.abs(b.y - y) < 0.1);
  for (let k = 0, tries = 0; k < (small ? 3 : 9) && tries < 60; tries++) {
    const tu = (r() - 0.5) * 2 * lim, tv = (r() - 0.5) * 2 * lim, [x, y] = iso(tu, tv);
    if (hexRho(x, y, 1) > lim - 0.04 || nearStreet(tu, tv, 0.01) || inZone(tu, tv) || taken(x, y)) continue;
    trees.push({ x, y, h: 0.06 + r() * 0.025 });
    k++;
  }
  // Ground tone: dusty, a little greener on some variants.
  const ground = shade(mix([186, 182, 164], [140, 154, 102], 0.2 + r() * 0.3), (r() - 0.5) * 0.08);
  plan = { lim, type, streets, houses, boxes, trees, yards, parks, ground };
  suburbPlans.set(key, plan);
  return plan;
}

function paintSuburbGround(g, upx, v, kind) {
  const plan = suburbPlan(v, kind);
  const px = 1 / upx;
  const small = kind !== ""; // a patch (hill houses, a factory estate) on the cell's own land, not the whole cell
  g.save();
  hexPath(g, 0, 0, 1, small ? plan.lim + 0.1 : 1.01);
  g.clip();
  // Ground over the cell (edge to edge, so neighbouring cells merge instead of showing a hex mosaic) with a
  // feathered edge, then soft tone variation.
  g.save();
  g.shadowColor = css(plan.ground, 0.85);
  g.shadowBlur = Math.max(1, 0.07 * upx);
  hexPath(g, 0, 0, 1, small ? plan.lim + 0.05 : 0.97);
  g.fillStyle = css(plan.ground, 0.9);
  g.fill();
  g.restore();
  const rr = rng(v * 131 + 7);
  for (let k = 0; k < 5; k++) {
    const mx = (rr() - 0.5) * 1.3 * plan.lim, my = (rr() - 0.5) * 1.3 * plan.lim, mr = 0.18 + rr() * 0.2;
    const mg = g.createRadialGradient(mx, my, 0, mx, my, mr);
    const c = k % 2 ? "70,96,40" : "236,228,196";
    mg.addColorStop(0, `rgba(${c},.14)`);
    mg.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = mg;
    g.fillRect(mx - mr, my - mr, 2 * mr, 2 * mr);
  }
  for (const Y of plan.yards) fillPoly(g, Y, "rgba(178,174,164,.95)");
  for (const F of plan.parks) fillPoly(g, F, "rgba(112,152,78,.95)");
  suburbRoads(g, plan, px);
  g.restore();
}

/** The plan's streets: a dark casing, then the light surface. */
function suburbRoads(g, plan, px) {
  g.lineCap = "butt";
  const roadP = new Path2D();
  for (const [a, b] of plan.streets) {
    roadP.moveTo(a[0], a[1]);
    roadP.lineTo(b[0], b[1]);
  }
  g.strokeStyle = "rgba(70,66,58,.55)";
  g.lineWidth = Math.max(0.05, px * 2.4);
  g.stroke(roadP);
  g.strokeStyle = "#b4b0a4";
  g.lineWidth = Math.max(0.034, px * 1.4);
  g.stroke(roadP);
}

/** A box on footprint F of height h (lit south-west face, shaded south-east face, lit top); returns the top corners. */
function boxR(g, F, h, base, lw) {
  const [N, E, S, W] = F, [Nt, Et, St, Wt] = F.map((q) => up(q, h));
  fillPoly(g, [W, S, St, Wt], css(base));
  fillPoly(g, [S, E, Et, St], css(shade(base, -0.34)));
  fillPoly(g, [Nt, Et, St, Wt], css(shade(base, 0.12)));
  if (lw) {
    g.beginPath();
    poly(g, [W, Wt, Nt, Et, E, S]);
    g.strokeStyle = "rgba(40,28,18,.35)";
    g.lineWidth = lw;
    g.stroke();
  }
  return [Nt, Et, St, Wt];
}

function paintSuburbBuild(g, upx, v, kind) {
  const plan = suburbPlan(v, kind);
  const px = 1 / upx;
  if (kind === "small") {
    // the small (hill) version has no ground sprite under it: its own street, kept to its little patch
    g.save();
    hexPath(g, 0, 0, 1, plan.lim + 0.08);
    g.clip();
    suburbRoads(g, plan, px);
    g.restore();
  }
  const items = [];
  const shadows = new Path2D();
  const lw = upx > 60 ? px * 0.8 : 0;
  for (const h of plan.houses) {
    poly(shadows, shadowOf(h.F, h.h));
    items.push({
      y: h.y,
      draw: () => {
        const top = boxR(g, h.F, h.h, h.wall, lw);
        if (h.cap) gable(g, top, 0, 0.022, h.wall, h.cap, 1, 0);
        else if (h.tank && upx > 40) {
          const tx = (top[0][0] + top[3][0]) / 2, ty = (top[0][1] + top[3][1]) / 2 + 0.006;
          g.fillStyle = "#d8dee4";
          g.fillRect(tx - 0.008, ty - 0.014, 0.016, 0.014);
        }
      },
    });
  }
  for (const b of plan.boxes) {
    poly(shadows, shadowOf(b.F, b.h));
    items.push({
      y: b.y,
      draw: () => {
        if (b.shed) {
          gable(g, b.F, b.h, 0.03, b.wall, b.roof, 0, lw);
          return;
        }
        boxR(g, b.F, b.h, b.wall, lw);
        if (b.slab && upx > 30) {
          // floor bands on both faces
          const [, E, S, W] = b.F, bands = new Path2D();
          for (let z = 0.02; z < b.h - 0.01; z += 0.02) {
            bands.moveTo(W[0], W[1] - z); bands.lineTo(S[0], S[1] - z); bands.lineTo(E[0], E[1] - z);
          }
          g.strokeStyle = "rgba(70,80,96,.35)";
          g.lineWidth = Math.max(px * 0.7, 0.004);
          g.stroke(bands);
        }
      },
    });
  }
  for (const t of plan.trees) {
    const rad = Math.max(t.h * 0.6, px * 2);
    items.push({ y: t.y, draw: () => treeShape(g, t.x, t.y, rad, false, true) });
  }
  g.fillStyle = "rgba(22,24,12,.24)";
  g.fill(shadows);
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw();
}

/** Urban fringe sprites for terrain.js (same shape as its SPRITES entries; boxes in R units). */
export const SUBURB_ART = Object.freeze({
  ground: { box: { x0: -0.92, y0: -1.02, x1: 0.92, y1: 1.02 }, paint: paintSuburbGround },
  build: { box: { x0: -0.92, y0: -1.1, x1: 0.92, y1: 1.0 }, paint: paintSuburbBuild },
});

// --- sprite cache --------------------------------------------------------------------------------------------------
// Sprites cover x ∈ [-SX·R, SX·R] and y ∈ [-SY0·R, SY1·R] around the hex centre (towers rise above the hex).
const SX = 1.0, SY0 = 1.55, SY1 = 1.0;
const MAX_SPRITE_RPX = 220; // device px; tiles up to this size share the main sprite cache
// Bigger tiles (close zoom on a dpr-2/3 screen) get their own small cache, so panning there blits instead of
// repainting every building, without pushing the zoomed-out sprites out. Past MAX_BIG_RPX, or when the big cache
// is full of sprites used in the last BIG_KEEP_MS (a huge window), the tile is painted directly as before.
const MAX_BIG_RPX = 480;
const BUDGET_PX = 14e6; // total sprite pixels kept (~56 MB)
const BIG_BUDGET_PX = 12e6; // ~48 MB, 10-25 close-zoom tiles
const BIG_KEEP_MS = 500;
const makeCache = (budget) => ({ map: new Map(), px: 0, budget }); // map: key -> {cv, k, t}; insertion order = LRU
const spriteCache = makeCache(BUDGET_PX), bigSpriteCache = makeCache(BIG_BUDGET_PX);

const newCanvas = (wd, ht) => {
  if (typeof document !== "undefined") {
    const cv = document.createElement("canvas");
    cv.width = wd;
    cv.height = ht;
    return cv;
  }
  return new OffscreenCanvas(wd, ht);
};

/** Drop every cached city sprite (e.g. after changing the art at runtime). */
export function clearCitySprites() {
  for (const c of [spriteCache, bigSpriteCache]) {
    c.map.clear();
    c.px = 0;
  }
  suburbPlans.clear();
}

const spriteSize = (k, R) => [Math.ceil(2 * SX * R * k), Math.ceil((SY0 + SY1) * R * k)];

/** The cached sprite for key, or a newly painted one; null when the cache is too full of fresh sprites (only for a
 *  cache with keepMs: then nothing used in the last keepMs is evicted and the caller paints directly). */
function getSprite(cache, key, k, R, paint, keepMs = 0) {
  const now = keepMs ? performance.now() : 0;
  let sp = cache.map.get(key);
  if (sp) {
    cache.map.delete(key);
    cache.map.set(key, sp);
    sp.t = now;
    return sp;
  }
  const [wd, ht] = spriteSize(k, R);
  for (const [kk, old] of cache.map) {
    if (cache.px + wd * ht <= cache.budget) break;
    if (keepMs && old.t > now - keepMs) return null;
    cache.map.delete(kk);
    cache.px -= old.cv.width * old.cv.height;
  }
  if (keepMs && cache.px + wd * ht > cache.budget) return null;
  const cv = newCanvas(wd, ht);
  const g = cv.getContext("2d");
  g.setTransform(k, 0, 0, k, SX * R * k, SY0 * R * k);
  paint(g, k);
  sp = { cv, k, t: now };
  cache.map.set(key, sp);
  cache.px += wd * ht;
  return sp;
}

const bucket = (v, steps) => 2 ** (Math.ceil(Math.log2(v) * steps - 1e-9) / steps);

// --- public drawing --------------------------------------------------------------------------------------------------

export function drawCityTile(ctx, city, x, y, R, opts = {}) {
  const { Rpx = R, s = 1, stateColor = [200, 200, 200] } = opts;
  const seed = opts.seed ?? city.cell ?? 0;
  const col = stateColor;
  if (cityIsDot(city, Rpx)) {
    drawCityDot(ctx, x, y, R, { Rpx, s, stateColor: col, capital: isCapital(city), population: city.population });
    return;
  }
  const lod = opts.lod ?? lodFor(Rpx);
  const detail = lod === "close" ? 2 : lod === "near" ? 1 : 0;
  const capital = isCapital(city), old = OLD_QUARTER.has(city.id);
  const RpxB = bucket(Rpx, 4); // layout zoom bucket (css px)
  const m = ctx.getTransform ? ctx.getTransform() : null;
  const kDev = m && m.a > 0 ? m.a : s; // device px per km
  const kB = bucket(kDev, 6); // ≤ 12% downscale when blitted
  const flat = m && !m.b && !m.c;
  const isBig = !flat || R * kB > MAX_SPRITE_RPX;
  if (isBig && ctx.canvas && flat) {
    // Big tiles are painted directly or into the small big-sprite cache: skip one that lands wholly off the canvas
    // (the caller's margin around the viewport, and warmSprites' tiny scratch canvas, where every stamp is
    // off-canvas), so it neither costs a paint nor pushes the visible tiles out of the cache.
    const cvs = ctx.canvas;
    const ax = m.a * (x - SX * R) + m.e, bx = m.a * (x + SX * R) + m.e;
    const ay = m.d * (y - SY0 * R) + m.f, by = m.d * (y + SY1 * R) + m.f;
    if (Math.max(ax, bx) < 0 || Math.min(ax, bx) > cvs.width || Math.max(ay, by) < 0 || Math.min(ay, by) > cvs.height) return;
  }
  // Big sprites are painted at the exact device scale (no bucket, so they match a direct paint); they are only
  // reused while panning at one zoom, which is when the static layer re-renders the most.
  const kS = isBig ? kDev : kB;
  let sp = null;
  if (flat && R * kS <= MAX_BIG_RPX) {
    const key = `${seed}|${cityClass(city.population).id}|${col.join(",")}|${capital ? 1 : 0}|${RpxB.toFixed(3)}|${detail}|${kS.toFixed(4)}|${R}`;
    const paint = (g, k) => paintTile(g, city, R, RpxB, k, detail, col, seed, capital, old);
    sp = isBig ? getSprite(bigSpriteCache, key, kS, R, paint, BIG_KEEP_MS) : getSprite(spriteCache, key, kS, R, paint);
  }
  if (!sp) {
    ctx.save();
    ctx.translate(x, y);
    paintTile(ctx, city, R, RpxB, kDev, detail, col, seed, capital, old);
    ctx.restore();
    return;
  }
  // Snap the sprite's corner to a device pixel; it is drawn at its own resolution or a hair smaller.
  const x0 = x - SX * R, y0 = y - SY0 * R;
  const dx = (Math.round(m.a * x0 + m.e) - m.e) / m.a, dy = (Math.round(m.d * y0 + m.f) - m.f) / m.d;
  ctx.drawImage(sp.cv, dx, dy, sp.cv.width / sp.k, sp.cv.height / sp.k);
}

/** The marker used for a city at small zoom: a neutral cream-and-bronze disc on a dark rim (so dots never read as
 *  state-coloured confetti or as resources), ringed for big cities; a gold star for the capital. */
export function drawCityDot(ctx, x, y, R, { Rpx, s, capital = false, population = 0 }) {
  const big = population >= 1.5e6;
  const r = Math.max((big ? 2.8 : 2.1) / s, R * (Rpx < 9 ? (big ? 0.34 : 0.27) : 0.19));
  ctx.beginPath();
  ctx.arc(x + 0.6 / s, y + 0.9 / s, r * 1.1, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,.38)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  const gr = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  gr.addColorStop(0, "#fff6dc");
  gr.addColorStop(0.6, "#e6d2a2");
  gr.addColorStop(1, "#a9844a");
  ctx.fillStyle = gr;
  ctx.fill();
  ctx.strokeStyle = "rgba(28,20,10,.9)";
  ctx.lineWidth = 1 / s;
  ctx.stroke();
  if (big) {
    ctx.beginPath();
    ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(70,50,22,.75)";
    ctx.fill();
  }
  if (capital) drawCapitalLandmark(ctx, x, y - r * 0.05, r * 4.2, { s });
}

/** The capital marker used with dots: a small gold star (the full tile has the Ba Đình hall and square instead). */
export function drawCapitalLandmark(ctx, x, y, R, { s = 1 } = {}) {
  ctx.beginPath();
  star(ctx, x, y, Math.max(R * 0.2, 3.2 / s));
  ctx.fillStyle = "#ffe08a";
  ctx.fill();
  ctx.strokeStyle = "rgba(60,40,0,.85)";
  ctx.lineWidth = 1 / s;
  ctx.stroke();
}

function star(ctx, x, y, r) {
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? r * 0.45 : r;
    k ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}
