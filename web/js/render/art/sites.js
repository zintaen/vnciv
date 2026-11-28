// Sites on hexes: military installations as forts, restricted ground (the big training and test ranges), wonder
// tiles (national parks, research universities, landmarks), protected land around big parks, and wonder plaques.
// All original art drawn in code; painted once per (kind, size bucket) into sprites (render/art/sprites.js) and
// stamped into the CACHED static map by ext/layers/ (never per frame).
//
//   FORT_KINDS, fortKind(component) → "army" | "navy" | "air" | "other"
//   drawFort(ctx, kind, x, y, size, {tier, joint, muted, coastal})   size = glyph width in ctx user units
//   drawRestricted(ctx, hatch, vp, o)                            hatched hexes + dashed boundary (see prepareCellSet)
//   prepareCellSet(w, cells) → {path: Path2D, edges: Path2D, bbox}   hex area and its outer boundary, world km
//   drawProtected(ctx, set, vp, o)                               protected land: soft green wash + dotted boundary
//   WONDER_KINDS, WONDER_MOTIFS, MOTIF_LABELS, drawWonder(ctx, kind, x, y, size, {rank, motif, variant})
//   drawPlaque(ctx, text, x, y, {kind, sub, scale})              screen-space name plate (css px)
import { bucketPx, deviceScale, getSprite, drawSprite, makePattern } from "./sprites.js";

const TAU = Math.PI * 2;

function stamp(ctx, key, x, y, size, box, paint) {
  const k = size / 2;
  const upx = bucketPx(deviceScale(ctx) * k, { min: 3, max: 220 });
  const spr = getSprite(key, upx, box, paint);
  drawSprite(ctx, spr, x, y, k);
}

function ink(g, upx, wPx = 1.1, col = "rgba(28,20,10,.92)") {
  g.lineWidth = wPx / upx;
  g.strokeStyle = col;
  g.stroke();
}

function groundShadow(g, y = 0.72, rx = 0.95, ry = 0.24, a = 0.3) {
  g.fillStyle = `rgba(18,12,4,${a})`;
  g.beginPath();
  g.ellipse(0, y, rx, ry, 0, 0, TAU);
  g.fill();
}

function star(g, x, y, r, n = 5, inner = 0.45, rot = -Math.PI / 2) {
  for (let k = 0; k < n * 2; k++) {
    const a = rot + (k * Math.PI) / n;
    const rr = k % 2 ? r * inner : r;
    k ? g.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)) : g.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
  }
  g.closePath();
}

function flag(g, upx, x, y, h, col) {
  g.strokeStyle = "#3a2c1c";
  g.lineWidth = Math.max(1 / upx, 0.05);
  g.beginPath();
  g.moveTo(x, y); g.lineTo(x, y - h);
  g.stroke();
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(x, y - h); g.quadraticCurveTo(x + 0.22, y - h - 0.05, x + 0.4, y - h + 0.05);
  g.lineTo(x + 0.4, y - h + 0.25); g.quadraticCurveTo(x + 0.22, y - h + 0.18, x, y - h + 0.22);
  g.closePath();
  g.fill();
  ink(g, upx, 0.8);
}

// --- forts ----------------------------------------------------------------------------------------------------------

/** Component palettes (military.json components): walls, roof / accent, flag; `name` is only a fallback label. */
export const FORT_KINDS = {
  army: { name: "Ground forces", wall: "#a8966a", accent: "#5f6b3a", flag: "#e0b44a", pad: "rgba(96,108,58,.72)" },
  navy: { name: "Navy", wall: "#98a4b2", accent: "#22406a", flag: "#e8e2d0", pad: "rgba(34,64,106,.62)" },
  air: { name: "Air Defence – Air Force", wall: "#b2bac4", accent: "#3a6aa8", flag: "#9cc4ec", pad: "rgba(58,106,168,.55)" },
  other: { name: "Border guard, coast guard & other", wall: "#a2a2a2", accent: "#4a4a5a", flag: "#d0d0d0", pad: "rgba(74,74,90,.5)" },
};

/** military.json component id → a fort kind above. */
export function fortKind(component) {
  return component === "army" ? "army" : component === "navy" ? "navy" : component === "air_force" ? "air" : "other";
}

/**
 * A fort glyph by component: ground forces and border guard = a star fort with bastions; Navy = a sea wall and quay
 * with an anchor; Air Defence – Air Force = a hangar and airstrip with a winged roundel (red disc, gold star). tier
 * "major" adds a keep and a flag, "site" is a small outpost. joint = a gold ring at the base.
 */
export function drawFort(ctx, kind, x, y, size, { tier = "base", joint = false, muted = false, coastal = true, airfield = false } = {}) {
  // a naval air station is an airfield with the anchor roundel, not a quay
  const air = airfield && kind === "navy" ? 1 : 0;
  const sea = kind === "navy" && coastal && !air ? 1 : 0;
  const key = `site:fort:${kind}:${tier}:${joint ? 1 : 0}:${muted ? 1 : 0}:${sea}:${air}`;
  stamp(ctx, key, x, y, size, { x0: -1.25, y0: -1.35, x1: 1.25, y1: 1.15 }, (g, upx) => paintFort(g, upx, kind, tier, joint, muted, !!sea, !!air));
}

/** True when a military.json installation name is an air station or airfield (NAS, MCAS, outlying field …). */
export function isAirfieldName(name) {
  return /^Sân bay|\bAirfield\b|\bAir Base\b/i.test(name || "");
}

function paintFort(g, upx, kind, tier, joint, muted, sea, air = false) {
  const pal = FORT_KINDS[kind] || FORT_KINDS.other;
  const small = tier === "site";
  const k = small ? 0.72 : 1;
  if (muted) g.globalAlpha = 0.85;
  groundShadow(g, 0.62, 1.0 * k, 0.26 * k);
  // a component-tinted ground pad, so the fort reads on any terrain (like a district plate)
  g.beginPath();
  g.ellipse(0, 0.42, 1.04 * k, 0.4 * k, 0, 0, TAU);
  g.fillStyle = pal.pad;
  g.fill();
  ink(g, upx, 0.9, "rgba(30,20,10,.55)");
  if (joint) {
    g.beginPath();
    g.ellipse(0, 0.45, 1.08 * k, 0.42 * k, 0, 0, TAU);
    g.lineWidth = Math.max(1.6 / upx, 0.1);
    g.strokeStyle = "#e6c46a";
    g.stroke();
    ink(g, upx, 0.7, "rgba(80,56,10,.8)");
  }
  g.save();
  g.scale(k, k);
  if (air) paintAirBase(g, upx / k, pal, tier, "anchor");
  else if (kind === "army" || kind === "other") paintStarFort(g, upx / k, pal, tier);
  else if (kind === "navy") paintNavalFort(g, upx / k, pal, tier, sea);
  else paintAirBase(g, upx / k, pal, tier);
  g.restore();
  g.globalAlpha = 1;
}

function paintStarFort(g, upx, pal, tier) {
  // a five-bastion star fort seen at an angle (squashed vertically)
  g.save();
  g.translate(0, 0.25);
  g.scale(1, 0.62);
  g.beginPath();
  star(g, 0, 0, 1.0, 5, 0.62, -Math.PI / 2);
  g.fillStyle = "#6f6248";
  g.fill();
  g.restore();
  g.save();
  g.translate(0, 0.12);
  g.scale(1, 0.62);
  g.beginPath();
  star(g, 0, 0, 1.0, 5, 0.62, -Math.PI / 2);
  g.fillStyle = pal.wall;
  g.fill();
  ink(g, upx / 0.62 * 0.8, 1.1);
  // inner parade ground
  g.beginPath();
  star(g, 0, 0, 0.6, 5, 0.7, -Math.PI / 2);
  g.fillStyle = "#b9a878";
  g.fill();
  g.restore();
  // barracks blocks
  g.fillStyle = pal.accent;
  for (const [bx, by] of [[-0.3, 0.02], [0.08, 0.18]]) {
    g.beginPath();
    g.rect(bx, by - 0.14, 0.26, 0.14);
    g.fill();
    ink(g, upx, 0.8);
  }
  if (tier === "major") {
    // keep
    g.fillStyle = pal.wall;
    g.beginPath();
    g.rect(-0.18, -0.42, 0.36, 0.42);
    g.fill();
    ink(g, upx, 1);
    g.fillStyle = "#3a3020";
    for (let c = 0; c < 3; c++) g.fillRect(-0.18 + c * 0.14, -0.5, 0.08, 0.08);
    flag(g, upx, 0, -0.5, 0.7, pal.flag);
  } else {
    flag(g, upx, 0.05, 0.0, 0.62, pal.flag);
  }
}

function paintNavalFort(g, upx, pal, tier, sea) {
  // water in front (inland sites: a paved yard), a stone quay wall, a slipway shed and an anchor emblem
  g.fillStyle = sea ? "#3f7fa6" : "#8a8a86";
  g.beginPath();
  g.moveTo(-1.1, 0.5); g.lineTo(1.1, 0.5); g.lineTo(1.0, 0.95); g.lineTo(-1.0, 0.95); g.closePath();
  g.fill();
  g.fillStyle = pal.wall;
  g.beginPath();
  g.moveTo(-1.0, 0.52); g.lineTo(-0.9, 0.12); g.lineTo(0.9, 0.12); g.lineTo(1.0, 0.52); g.closePath();
  g.fill();
  ink(g, upx, 1);
  g.strokeStyle = "rgba(40,40,50,.45)";
  g.lineWidth = 0.8 / upx;
  g.beginPath();
  g.moveTo(-0.95, 0.32); g.lineTo(0.95, 0.32);
  for (let x = -0.7; x < 0.9; x += 0.3) { g.moveTo(x, 0.12); g.lineTo(x, 0.32); g.moveTo(x + 0.15, 0.32); g.lineTo(x + 0.15, 0.52); }
  g.stroke();
  // shed with a pitched roof
  g.fillStyle = "#d8d2c4";
  g.beginPath();
  g.rect(-0.8, -0.28, 0.7, 0.4);
  g.fill();
  ink(g, upx, 1);
  g.fillStyle = pal.accent;
  g.beginPath();
  g.moveTo(-0.86, -0.26); g.lineTo(-0.45, -0.56); g.lineTo(-0.04, -0.26); g.closePath();
  g.fill();
  ink(g, upx, 1);
  // anchor medallion
  g.beginPath();
  g.arc(0.42, -0.18, 0.34, 0, TAU);
  g.fillStyle = pal.accent;
  g.fill();
  ink(g, upx, 1);
  g.strokeStyle = "#f2ead6";
  g.lineWidth = Math.max(1.2 / upx, 0.06);
  g.beginPath();
  g.moveTo(0.42, -0.4); g.lineTo(0.42, 0.04);
  g.moveTo(0.3, -0.3); g.lineTo(0.54, -0.3);
  g.moveTo(0.24, -0.08); g.quadraticCurveTo(0.42, 0.12, 0.6, -0.08);
  g.stroke();
  g.beginPath();
  g.arc(0.42, -0.44, 0.05, 0, TAU);
  g.stroke();
  if (tier === "major" && sea) {
    // a grey warship at the quay
    g.fillStyle = "#6a7480";
    g.beginPath();
    g.moveTo(-0.95, 0.6); g.lineTo(0.75, 0.6); g.lineTo(0.95, 0.56); g.lineTo(0.7, 0.8); g.lineTo(-0.85, 0.8); g.closePath();
    g.fill();
    ink(g, upx, 0.9);
    g.fillStyle = "#8a949e";
    g.beginPath();
    g.rect(-0.35, 0.46, 0.4, 0.14); g.rect(-0.2, 0.36, 0.14, 0.1);
    g.fill();
    ink(g, upx, 0.8);
    flag(g, upx, 0.86, 0.12, 0.6, pal.flag);
  }
}

function paintAirBase(g, upx, pal, tier, emblem = "star") {
  // airstrip, an arched hangar and a winged roundel
  g.save();
  g.translate(0, 0.42);
  g.rotate(-0.12);
  g.fillStyle = "#55585c";
  g.beginPath();
  g.rect(-1.05, -0.11, 2.1, 0.22);
  g.fill();
  ink(g, upx, 0.9);
  g.strokeStyle = "#f2efe4";
  g.lineWidth = 0.9 / upx;
  g.setLineDash([0.14, 0.1]);
  g.beginPath();
  g.moveTo(-0.85, 0); g.lineTo(0.85, 0);
  g.stroke();
  g.setLineDash([]);
  g.restore();
  // hangar
  g.fillStyle = pal.wall;
  g.beginPath();
  g.moveTo(-0.95, 0.2); g.lineTo(-0.95, -0.05); g.bezierCurveTo(-0.9, -0.52, -0.1, -0.52, -0.05, -0.05); g.lineTo(-0.05, 0.2);
  g.closePath();
  g.fill();
  ink(g, upx, 1);
  g.fillStyle = "#3a3c40";
  g.beginPath();
  g.rect(-0.72, -0.04, 0.44, 0.24);
  g.fill();
  // winged roundel
  g.fillStyle = pal.accent;
  g.beginPath();
  g.moveTo(0.05, -0.3); g.lineTo(0.98, -0.42); g.lineTo(0.9, -0.28); g.lineTo(0.55, -0.16); g.lineTo(0.05, -0.16); g.closePath();
  g.fill();
  ink(g, upx, 0.9);
  g.beginPath();
  g.arc(0.42, -0.24, 0.24, 0, TAU);
  g.fillStyle = emblem === "anchor" ? "#f2ead6" : "#da251d";
  g.fill();
  ink(g, upx, 0.9);
  if (emblem === "anchor") {
    // a small anchor in the roundel (naval aviation)
    g.strokeStyle = pal.accent;
    g.lineWidth = Math.max(1.2 / upx, 0.045);
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(0.42, -0.38); g.lineTo(0.42, -0.1);
    g.moveTo(0.34, -0.31); g.lineTo(0.5, -0.31);
    g.moveTo(0.3, -0.18); g.quadraticCurveTo(0.42, -0.04, 0.54, -0.18);
    g.stroke();
    g.lineCap = "butt";
  } else {
    g.beginPath();
    star(g, 0.42, -0.24, 0.17, 5, 0.42);
    g.fillStyle = "#ffcd00";
    g.fill();
  }
  if (tier === "major") {
    // a parked jet
    g.save();
    g.translate(0.55, 0.18);
    g.rotate(-0.2);
    g.fillStyle = "#c8ccd2";
    g.beginPath();
    g.moveTo(0.38, 0); g.lineTo(-0.3, -0.05); g.lineTo(-0.1, -0.3); g.lineTo(-0.2, -0.3); g.lineTo(-0.42, -0.05);
    g.lineTo(-0.5, -0.14); g.lineTo(-0.56, -0.14); g.lineTo(-0.5, 0); g.lineTo(-0.56, 0.14); g.lineTo(-0.5, 0.14);
    g.lineTo(-0.42, 0.05); g.lineTo(-0.2, 0.3); g.lineTo(-0.1, 0.3); g.lineTo(-0.3, 0.05); g.closePath();
    g.fill();
    ink(g, upx, 0.8);
    g.restore();
  }
}

// --- restricted ground and protected land ------------------------------------------------------------------------

/** A set of hexes as a fill path and its outer boundary (edges whose neighbour is outside the set), world km. */
export function prepareCellSet(w, cells) {
  const { grid } = w;
  const set = new Set(cells);
  const path = new Path2D(), edges = new Path2D();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const C = grid.corners;
  for (const i of set) {
    const x = grid.cx(i), y = grid.cy(i);
    path.moveTo(x + C[0][0], y + C[0][1]);
    for (let k = 1; k < 6; k++) path.lineTo(x + C[k][0], y + C[k][1]);
    path.closePath();
    for (let d = 0; d < 6; d++) {
      const j = grid.neighbour(i, d);
      if (j >= 0 && set.has(j)) continue;
      // edge d runs from corner d to corner d+1
      edges.moveTo(x + C[d][0], y + C[d][1]);
      edges.lineTo(x + C[(d + 1) % 6][0], y + C[(d + 1) % 6][1]);
    }
    x0 = Math.min(x0, x - grid.R); y0 = Math.min(y0, y - grid.R);
    x1 = Math.max(x1, x + grid.R); y1 = Math.max(y1, y + grid.R);
  }
  return { path, edges, bbox: [x0, y0, x1, y1], cells: set };
}

const inView = (b, vp, pad) => !(b[2] < vp.x0 - pad || b[0] > vp.x1 + pad || b[3] < vp.y0 - pad || b[1] > vp.y1 + pad);

function hatchPattern(ctx, dpr, s) {
  const p = makePattern(ctx, "site:hatch", 10, dpr, (g, n) => {
    g.strokeStyle = "rgba(120,30,20,.55)";
    g.lineWidth = 1.6;
    g.lineCap = "butt";
    for (const o of [-n, 0, n]) {
      g.beginPath();
      g.moveTo(o, n); g.lineTo(o + n, 0);
      g.stroke();
    }
  });
  // the tile is in css px; the context is in km: scale the pattern so the hatching stays 10 css px apart
  try { p.setTransform(new DOMMatrix().scale(1 / s)); } catch { /* old browsers: hatching scales with the map */ }
  return p;
}

/**
 * Restricted ground: diagonal red-brown hatching over the hexes of each range, a faint wash and a dashed boundary
 * (world transform). sets: from prepareCellSet.
 */
export function drawRestricted(ctx, sets, vp, o) {
  const s = vp.s;
  const pad = 2 * (o.Rpx / s);
  const vis = sets.filter((st) => inView(st.bbox, vp, pad));
  if (!vis.length) return;
  ctx.fillStyle = "rgba(150,60,40,.12)";
  for (const st of vis) ctx.fill(st.path);
  if (o.Rpx >= 5) {
    ctx.fillStyle = hatchPattern(ctx, vp.dpr, s);
    for (const st of vis) ctx.fill(st.path);
  }
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(40,10,6,.45)";
  ctx.lineWidth = Math.max(1.6, Math.min(3.4, o.Rpx * 0.1)) / s;
  for (const st of vis) ctx.stroke(st.edges);
  ctx.strokeStyle = "rgba(214,92,62,.9)";
  ctx.lineWidth = Math.max(1, Math.min(2.2, o.Rpx * 0.06)) / s;
  ctx.setLineDash([5 / s, 3.5 / s]);
  for (const st of vis) ctx.stroke(st.edges);
  ctx.setLineDash([]);
}

/** Protected land (big national parks): a soft green wash and a dotted pale-green boundary. */
export function drawProtected(ctx, sets, vp, o) {
  const s = vp.s;
  const pad = 2 * (o.Rpx / s);
  const vis = sets.filter((st) => inView(st.bbox, vp, pad));
  if (!vis.length) return;
  ctx.fillStyle = "rgba(90,170,90,.14)";
  for (const st of vis) ctx.fill(st.path);
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(10,40,10,.35)";
  ctx.lineWidth = Math.max(1.4, Math.min(3, o.Rpx * 0.09)) / s;
  for (const st of vis) ctx.stroke(st.edges);
  ctx.strokeStyle = "rgba(170,230,150,.9)";
  ctx.lineWidth = Math.max(1, Math.min(2.2, o.Rpx * 0.06)) / s;
  ctx.setLineDash([0.1 / s, 4 / s]);
  ctx.lineWidth = Math.max(1.8, Math.min(3.2, o.Rpx * 0.08)) / s;
  for (const st of vis) ctx.stroke(st.edges);
  ctx.setLineDash([]);
}

// --- wonders --------------------------------------------------------------------------------------------------------

export const WONDER_KINDS = {
  natural: { name: "Natural wonder", ring: "#8fd07a", base: "#3f6a34", icon: "w-park" },
  university: { name: "Great university", ring: "#8fb8ec", base: "#2c4a78", icon: "w-university" },
  landmark: { name: "Landmark", ring: "#ecc46a", base: "#6a4a1c", icon: "w-landmark" },
};

/**
 * Wonder motifs: what stands on the plinth. Each wonder gets the motif that says what the site is (ext/layers/model.js
 * maps wonder ids to motifs); `variant` only picks a fallback for an id it does not know.
 */
export const WONDER_MOTIFS = {
  natural: ["peak", "forest", "coast", "karst", "cave"],
  university: ["campus", "gate"],
  landmark: ["citadel", "pagoda", "onepillar", "temple", "gate", "quarter", "chamtower", "mausoleum", "palace", "flagtower", "skyscraper", "goldbridge", "truss", "tunnel"],
};
export const MOTIF_LABELS = {
  peak: "Misty peak", forest: "Forest", coast: "Coast & lighthouse", karst: "Karst towers", cave: "Karst cave",
  campus: "University campus", gate: "Temple of Literature gate", citadel: "Citadel gate", pagoda: "Pagoda",
  onepillar: "One-pillar shrine", temple: "Temple (đền)", quarter: "Old quarter (Hội An)", chamtower: "Cham towers",
  mausoleum: "Mausoleum", palace: "Modernist palace", flagtower: "Flag tower", skyscraper: "Skyscraper",
  goldbridge: "Bridge held by stone hands", truss: "Steel truss bridge", tunnel: "Tunnel hatch",
};
const FALLBACK = { natural: ["forest", "karst", "peak"], university: ["campus", "campus", "campus"], landmark: ["temple", "pagoda", "gate"] };

/**
 * A wonder tile: a raised round plinth with a gold rim (the wonder "seal"), and the wonder itself on top, drawn from
 * its `motif` (see WONDER_MOTIFS). Without a motif, `variant` picks one of three generic ones for the kind.
 */
export function drawWonder(ctx, kind, x, y, size, { variant = 0, rank = null, motif = null } = {}) {
  const fb = FALLBACK[kind] || FALLBACK.landmark;
  const mo = motif && MOTIF_LABELS[motif] ? motif : fb[((variant % 3) + 3) % 3];
  const top = rank != null && rank <= 3 ? 1 : 0;
  stamp(ctx, `site:wonder:${kind}:${mo}:${top}`, x, y, size, { x0: -1.2, y0: -1.45, x1: 1.2, y1: 1.1 }, (g, upx) => paintWonder(g, upx, kind, mo, top));
}

function plinth(g, upx, pal, top) {
  groundShadow(g, 0.66, 1.05, 0.3, 0.35);
  // drum
  g.fillStyle = "#5a4a32";
  g.beginPath();
  g.ellipse(0, 0.5, 0.98, 0.34, 0, 0, Math.PI);
  g.lineTo(-0.98, 0.36);
  g.ellipse(0, 0.36, 0.98, 0.34, 0, Math.PI, 0, true);
  g.closePath();
  g.fill();
  ink(g, upx, 1);
  g.beginPath();
  g.ellipse(0, 0.36, 0.98, 0.34, 0, 0, TAU);
  g.fillStyle = pal.base;
  g.fill();
  g.lineWidth = Math.max(1.6 / upx, top ? 0.09 : 0.06);
  g.strokeStyle = top ? "#f2d27a" : "#c9a45c";
  g.stroke();
  ink(g, upx, 0.7, "rgba(40,26,6,.8)");
}

function paintWonder(g, upx, kind, motif, top) {
  const pal = WONDER_KINDS[kind] || WONDER_KINDS.landmark;
  plinth(g, upx, pal, top);
  (MOTIF_PAINT[motif] || MOTIF_PAINT.temple)(g, upx);
  if (top) {
    // a small gold star for the top three of a rule
    g.beginPath();
    star(g, 0.82, -1.18, 0.2, 5, 0.45);
    g.fillStyle = "#f2d27a";
    g.fill();
    ink(g, upx, 0.8, "rgba(60,40,6,.9)");
  }
}

function pine(g, upx, x, y, h, col = "#2f5a32") {
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(x, y - h); g.lineTo(x + h * 0.32, y - h * 0.35); g.lineTo(x + h * 0.18, y - h * 0.35); g.lineTo(x + h * 0.38, y);
  g.lineTo(x - h * 0.38, y); g.lineTo(x - h * 0.18, y - h * 0.35); g.lineTo(x - h * 0.32, y - h * 0.35); g.closePath();
  g.fill();
  ink(g, upx, 0.8);
}

function paintPeak(g, upx) {
  // mountain
  g.fillStyle = "#7a8494";
  g.beginPath();
  g.moveTo(-0.92, 0.36); g.lineTo(-0.3, -0.85); g.lineTo(-0.05, -0.45); g.lineTo(0.2, -1.05); g.lineTo(0.92, 0.36); g.closePath();
  g.fill();
  ink(g, upx, 1.1);
  // shaded flank
  g.fillStyle = "rgba(0,0,0,.18)";
  g.beginPath();
  g.moveTo(0.2, -1.05); g.lineTo(0.92, 0.36); g.lineTo(0.3, 0.36); g.lineTo(0.35, -0.4); g.closePath();
  g.fill();
  // a band of mist round the summits (no permanent snow in Vietnam)
  g.fillStyle = "rgba(242,246,250,.72)";
  g.beginPath(); g.ellipse(-0.08, -0.6, 0.62, 0.09, 0, 0, TAU); g.ellipse(0.32, -0.78, 0.3, 0.06, 0, 0, TAU); g.fill();
  // waterfall
  g.fillStyle = "#cfe8f6";
  g.beginPath();
  g.moveTo(-0.08, -0.35); g.lineTo(0.06, -0.35); g.lineTo(0.12, 0.3); g.lineTo(-0.12, 0.3); g.closePath();
  g.fill();
  g.fillStyle = "#5fa8d8";
  g.beginPath();
  g.ellipse(0, 0.36, 0.32, 0.1, 0, 0, TAU);
  g.fill();
  // pines
  pine(g, upx, -0.62, 0.42, 0.52);
  pine(g, upx, -0.38, 0.48, 0.4, "#3a6a3a");
  pine(g, upx, 0.6, 0.44, 0.5);
}

// --- wonder motifs (all in plinth units: ground at y ≈ 0.36, the top of the box at y = -1.45) -----------------------

function poly(g, pts) {
  g.beginPath();
  for (let k = 0; k < pts.length; k += 2) (k ? g.lineTo : g.moveTo).call(g, pts[k], pts[k + 1]);
  g.closePath();
}
function fillInk(g, upx, fill, w = 1) {
  g.fillStyle = fill;
  g.fill();
  ink(g, upx, w);
}
function roundTree(g, upx, x, y, r, col = "#4f7a3a") {
  g.fillStyle = "#5a3e24";
  g.fillRect(x - r * 0.12, y - r * 0.9, r * 0.24, r * 0.9);
  g.beginPath();
  g.arc(x, y - r * 1.2, r * 0.7, 0, TAU);
  fillInk(g, upx, col, 0.8);
}
function water(g, upx, y0 = 0.2) {
  g.beginPath();
  g.ellipse(0, 0.36, 0.96, 0.33, 0, 0, TAU);
  g.save();
  g.clip();
  g.fillStyle = "#4f9ccc";
  g.fillRect(-1, y0, 2, 1);
  g.strokeStyle = "rgba(230,245,255,.75)";
  g.lineWidth = 0.9 / upx;
  g.beginPath();
  for (const [x, y] of [[-0.6, y0 + 0.14], [0.1, y0 + 0.24], [0.5, y0 + 0.12], [-0.25, y0 + 0.32]]) {
    g.moveTo(x - 0.14, y); g.quadraticCurveTo(x - 0.07, y - 0.05, x, y); g.quadraticCurveTo(x + 0.07, y + 0.05, x + 0.14, y);
  }
  g.stroke();
  g.restore();
}

function paintForest(g, upx) {
  // a blue-green ridge in the haze, then a valley of pines and broadleaf trees
  g.beginPath();
  g.moveTo(-0.95, 0.3); g.bezierCurveTo(-0.7, -0.6, -0.35, -0.75, -0.05, -0.45); g.bezierCurveTo(0.2, -0.85, 0.65, -0.7, 0.95, 0.1);
  g.lineTo(0.95, 0.36); g.lineTo(-0.95, 0.36); g.closePath();
  fillInk(g, upx, "#5d7f86", 1);
  g.fillStyle = "rgba(236,242,246,.55)";
  g.beginPath(); g.ellipse(0, -0.12, 0.92, 0.13, 0, 0, TAU); g.fill();
  g.beginPath();
  g.moveTo(-0.95, 0.36); g.bezierCurveTo(-0.6, -0.05, -0.2, 0.0, 0.1, 0.08); g.bezierCurveTo(0.45, -0.08, 0.75, -0.02, 0.95, 0.2); g.lineTo(0.95, 0.4); g.lineTo(-0.95, 0.4);
  g.closePath();
  fillInk(g, upx, "#4d7a3c", 0.9);
  roundTree(g, upx, -0.2, 0.36, 0.34, "#c8742e");
  pine(g, upx, -0.66, 0.44, 0.62);
  pine(g, upx, -0.44, 0.48, 0.5, "#3a6a3a");
  roundTree(g, upx, 0.3, 0.42, 0.3, "#5f8f3e");
  pine(g, upx, 0.64, 0.42, 0.66);
  pine(g, upx, 0.06, 0.5, 0.42, "#2a5230");
}

function paintCoast(g, upx) {
  water(g, upx, 0.24);
  // dune with sea grass
  g.beginPath();
  g.moveTo(-0.95, 0.32); g.bezierCurveTo(-0.6, 0.02, 0.1, 0.0, 0.55, 0.3); g.closePath();
  fillInk(g, upx, "#e2cc96", 0.9);
  g.strokeStyle = "#7a8a3a";
  g.lineWidth = Math.max(0.9 / upx, 0.04);
  g.beginPath();
  for (const x of [-0.7, -0.62, 0.26, 0.34]) { g.moveTo(x, 0.22); g.lineTo(x - 0.05, 0.06); g.moveTo(x, 0.22); g.lineTo(x + 0.05, 0.08); }
  g.stroke();
  // lighthouse
  poly(g, [-0.36, 0.14, -0.28, -0.82, -0.04, -0.82, 0.04, 0.14]);
  g.fillStyle = "#f4f1ea";
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = "#b8402e";
  g.fillRect(-0.4, -0.58, 0.5, 0.16);
  g.fillRect(-0.4, -0.22, 0.5, 0.16);
  g.restore();
  poly(g, [-0.36, 0.14, -0.28, -0.82, -0.04, -0.82, 0.04, 0.14]);
  ink(g, upx, 1);
  g.beginPath(); g.rect(-0.3, -1.02, 0.28, 0.2);
  fillInk(g, upx, "#f2d27a", 0.9);
  poly(g, [-0.36, -1.02, -0.16, -1.22, 0.04, -1.02]);
  fillInk(g, upx, "#3a3430", 0.9);
  // light beams
  g.fillStyle = "rgba(255,236,160,.45)";
  poly(g, [-0.02, -0.96, 0.7, -1.18, 0.7, -0.82]);
  g.fill();
}

function paintKarst(g, upx) {
  // limestone towers rising from green water, a junk with a brown sail (Hạ Long Bay, Tràng An)
  water(g, upx, 0.24);
  const towers = [[-0.62, 0.3, 0.3, -0.62], [-0.22, 0.32, 0.36, -1.02], [0.28, 0.3, 0.3, -0.78], [0.68, 0.28, 0.22, -0.42]];
  for (const [x, base, w, top] of towers) {
    g.beginPath();
    g.moveTo(x - w, base);
    g.bezierCurveTo(x - w * 1.05, base - 0.3, x - w * 0.9, top + 0.12, x - w * 0.35, top);
    g.bezierCurveTo(x - w * 0.1, top - 0.08, x + w * 0.4, top - 0.04, x + w * 0.6, top + 0.1);
    g.bezierCurveTo(x + w * 1.05, top + 0.3, x + w * 1.1, base - 0.25, x + w, base);
    g.closePath();
    fillInk(g, upx, "#8a9a86", 0.9);
    // jungle cap
    g.beginPath();
    g.ellipse(x - w * 0.05, top + 0.06, w * 0.62, 0.12, 0, 0, TAU);
    fillInk(g, upx, "#4f7a3a", 0.7);
    g.strokeStyle = "rgba(60,70,60,.55)";
    g.lineWidth = Math.max(0.8 / upx, 0.03);
    g.beginPath();
    g.moveTo(x - w * 0.3, top + 0.25); g.lineTo(x - w * 0.4, base - 0.05);
    g.moveTo(x + w * 0.25, top + 0.3); g.lineTo(x + w * 0.35, base - 0.1);
    g.stroke();
  }
  // junk
  g.beginPath(); g.moveTo(0.02, 0.2); g.lineTo(0.46, 0.2); g.lineTo(0.38, 0.3); g.lineTo(0.08, 0.3); g.closePath();
  fillInk(g, upx, "#6a4a2a", 0.8);
  poly(g, [0.2, 0.18, 0.2, -0.22, 0.4, -0.12, 0.38, 0.16]);
  fillInk(g, upx, "#b05a2a", 0.8);
}

function paintPagoda(g, upx) {
  // a tiered pagoda with upturned eaves beside a frangipani
  const tiers = [[0.3, 0.62, 0.3], [0.0, 0.5, 0.27], [-0.28, 0.4, 0.25], [-0.53, 0.3, 0.22]];
  for (const [y, w, h] of tiers) {
    g.beginPath(); g.rect(-w * 0.62, y - h, w * 1.24, h);
    fillInk(g, upx, "#e8d6b0", 0.8); // plastered storey
    g.fillStyle = "#7a2a1c";
    g.fillRect(-0.06, y - h * 0.8, 0.12, h * 0.6); // door / window
    // roof with upturned corners
    g.beginPath();
    g.moveTo(-w - 0.1, y - h - 0.08);
    g.quadraticCurveTo(-w * 0.6, y - h + 0.02, -w * 0.5, y - h - 0.02);
    g.lineTo(w * 0.5, y - h - 0.02);
    g.quadraticCurveTo(w * 0.6, y - h + 0.02, w + 0.1, y - h - 0.08);
    g.lineTo(w * 0.62, y - h - 0.16);
    g.lineTo(-w * 0.62, y - h - 0.16);
    g.closePath();
    fillInk(g, upx, "#9a3a24", 0.9);
  }
  // finial
  g.beginPath(); g.moveTo(0, -0.94); g.lineTo(0.05, -0.76); g.lineTo(-0.05, -0.76); g.closePath();
  fillInk(g, upx, "#f2d27a", 0.8);
  // tree
  g.beginPath(); g.ellipse(0.78, -0.02, 0.2, 0.16, 0, 0, TAU);
  fillInk(g, upx, "#4f7a3a", 0.7);
  g.fillStyle = "#f4e8f0";
  for (const [dx, dy] of [[-0.06, -0.04], [0.07, 0.02], [0.0, 0.07]]) { g.beginPath(); g.arc(0.78 + dx, -0.02 + dy, 0.035, 0, TAU); g.fill(); }
}

function paintCitadel(g, upx) {
  // a citadel gate: brick base with three arches, a two-tier wooden pavilion on top, flags (Huế, Thăng Long)
  g.beginPath(); g.rect(-0.92, -0.32, 1.84, 0.66);
  fillInk(g, upx, "#b4805a", 1); // brick base
  g.fillStyle = "#3a2a20";
  for (const [x, w] of [[-0.62, 0.2], [-0.13, 0.26], [0.42, 0.2]]) {
    g.beginPath(); g.moveTo(x, 0.34); g.lineTo(x, 0.0); g.arc(x + w / 2, 0.0, w / 2, Math.PI, 0); g.lineTo(x + w, 0.34); g.closePath(); g.fill();
  }
  g.strokeStyle = "rgba(60,30,20,.5)";
  g.lineWidth = Math.max(0.7 / upx, 0.02);
  g.beginPath();
  for (const y of [-0.16, 0.0, 0.16]) { g.moveTo(-0.92, y); g.lineTo(-0.66, y); g.moveTo(0.66, y); g.lineTo(0.92, y); }
  g.stroke();
  // pavilion: two tiers of yellow-tiled roof on red columns
  g.beginPath(); g.rect(-0.62, -0.62, 1.24, 0.3);
  fillInk(g, upx, "#a8321e", 0.9);
  for (const [y, w] of [[-0.62, 0.86], [-0.88, 0.56]]) {
    g.beginPath();
    g.moveTo(-w - 0.08, y + 0.02); g.quadraticCurveTo(-w * 0.7, y - 0.02, -w * 0.6, y - 0.14);
    g.lineTo(w * 0.6, y - 0.14); g.quadraticCurveTo(w * 0.7, y - 0.02, w + 0.08, y + 0.02); g.closePath();
    fillInk(g, upx, "#e0b23a", 0.9);
    if (w < 0.8) continue;
    g.beginPath(); g.rect(-0.4, y - 0.26, 0.8, 0.12);
    fillInk(g, upx, "#a8321e", 0.8);
  }
  // flags
  for (const x of [-0.82, 0.82]) {
    g.strokeStyle = "#2a2622";
    g.lineWidth = Math.max(1 / upx, 0.03);
    g.beginPath(); g.moveTo(x, -0.32); g.lineTo(x, -0.9); g.stroke();
    poly(g, [x, -0.9, x + (x < 0 ? -0.26 : 0.26), -0.82, x, -0.74]);
    fillInk(g, upx, "#d8402e", 0.7);
  }
}

/** A tiled roof with upturned eaves and curled ridge ends (đình, chùa, gate pavilions): eave line at y, half width w. */
function curvedRoof(g, upx, cx, y, w, h, col) {
  g.beginPath();
  g.moveTo(cx - w - 0.08, y - 0.04); g.quadraticCurveTo(cx - w * 0.72, y + 0.01, cx - w * 0.6, y - h);
  g.lineTo(cx + w * 0.6, y - h); g.quadraticCurveTo(cx + w * 0.72, y + 0.01, cx + w + 0.08, y - 0.04); g.closePath();
  fillInk(g, upx, col, 0.9);
  for (const sg of [-1, 1]) { // the curled ends of the ridge
    poly(g, [cx + sg * w * 0.6, y - h, cx + sg * (w * 0.6 + 0.09), y - h - 0.1, cx + sg * (w * 0.6 - 0.06), y - h]);
    fillInk(g, upx, col, 0.7);
  }
}

/** The national flag on a pole: red with a gold star; foot of the pole at (x, y), pole height h, flag width fw. */
function flagVN(g, upx, x, y, h, fw = 0.36) {
  g.strokeStyle = "#3a2c1c";
  g.lineWidth = Math.max(1 / upx, 0.035);
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - h); g.stroke();
  const fh = fw * 0.66, y0 = y - h;
  g.beginPath();
  g.moveTo(x, y0); g.quadraticCurveTo(x + fw * 0.5, y0 - 0.04, x + fw, y0 + 0.02);
  g.lineTo(x + fw, y0 + fh + 0.02); g.quadraticCurveTo(x + fw * 0.5, y0 + fh - 0.04, x, y0 + fh); g.closePath();
  fillInk(g, upx, "#da251d", 0.7);
  g.beginPath(); star(g, x + fw * 0.5, y0 + fh * 0.5, fh * 0.32, 5, 0.42);
  g.fillStyle = "#ffcd00"; g.fill();
}

function windowGrid(g, x0, y0, cols, rows, dx, dy, w, h, col, skip = null) {
  g.fillStyle = col;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (!skip || !skip(c, r)) g.fillRect(x0 + c * dx, y0 + r * dy, w, h);
}

function paintCampus(g, upx) {
  // a four-storey lecture block with window rows, a central stair tower under a tiled roof, the flag and campus trees
  roundTree(g, upx, -0.8, 0.4, 0.24, "#4f7a3a");
  g.beginPath(); g.rect(-0.86, -0.4, 1.72, 0.76);
  fillInk(g, upx, "#f0dfa8", 1);
  g.fillStyle = "rgba(0,0,0,.12)"; g.fillRect(0.2, -0.4, 0.66, 0.76); // the shaded wing
  windowGrid(g, -0.79, -0.31, 10, 4, 0.165, 0.17, 0.09, 0.08, "#4a6676", (c) => c === 4 || c === 5);
  g.beginPath(); g.rect(-0.2, -0.74, 0.4, 1.1);
  fillInk(g, upx, "#f8efcf", 1);
  windowGrid(g, -0.07, -0.6, 1, 4, 0, 0.17, 0.14, 0.09, "#4a6676");
  g.fillStyle = "#5a3a24"; g.fillRect(-0.09, 0.14, 0.18, 0.22);
  curvedRoof(g, upx, 0, -0.72, 0.3, 0.2, "#b0452c");
  flagVN(g, upx, 0.62, -0.4, 0.58, 0.3);
  roundTree(g, upx, 0.84, 0.42, 0.2, "#5f8f3e");
}

function paintGate(g, upx) {
  // Khuê Văn Các (Văn Miếu – Quốc Tử Giám): brick piers carrying a red wooden pavilion with round "sun" windows, two
  // tiers of curved tile roofs, the temple wall either side
  g.beginPath(); g.rect(-0.96, 0.04, 1.92, 0.32);
  fillInk(g, upx, "#ddd0ac", 0.9);
  g.fillStyle = "#8a3a24"; g.fillRect(-0.98, 0.0, 1.96, 0.06);
  g.beginPath(); g.rect(-0.5, -0.3, 1.0, 0.66);
  fillInk(g, upx, "#c99a72", 1);
  g.fillStyle = "#3a2a20";
  for (const x of [-0.37, -0.07, 0.23]) g.fillRect(x, -0.16, 0.14, 0.52);
  curvedRoof(g, upx, 0, -0.28, 0.6, 0.12, "#8a3a24");
  g.beginPath(); g.rect(-0.3, -0.72, 0.6, 0.32);
  fillInk(g, upx, "#a8321e", 0.9);
  g.beginPath(); g.arc(0, -0.56, 0.11, 0, TAU);
  fillInk(g, upx, "#f2d27a", 0.8);
  g.strokeStyle = "#7a2a18"; g.lineWidth = Math.max(0.8 / upx, 0.02);
  g.beginPath();
  for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 4; g.moveTo(Math.cos(a) * 0.11, -0.56 + Math.sin(a) * 0.11); g.lineTo(-Math.cos(a) * 0.11, -0.56 - Math.sin(a) * 0.11); }
  g.stroke();
  curvedRoof(g, upx, 0, -0.7, 0.46, 0.22, "#8a3a24");
}

function paintOnePillar(g, upx) {
  // Chùa Một Cột: a small shrine under a curved roof on one stone pillar in a lotus pond
  g.beginPath(); g.ellipse(0, 0.28, 0.9, 0.2, 0, 0, TAU);
  fillInk(g, upx, "#5f9fb8", 0.8);
  for (const [x, y] of [[-0.62, 0.26], [-0.42, 0.36], [0.5, 0.3], [0.7, 0.22], [0.32, 0.4]]) {
    g.beginPath(); g.ellipse(x, y, 0.08, 0.035, 0, 0, TAU); g.fillStyle = "#5f8f3e"; g.fill();
  }
  g.fillStyle = "#f2a6c0";
  for (const [x, y] of [[-0.6, 0.22], [0.52, 0.26]]) { g.beginPath(); g.arc(x, y, 0.035, 0, TAU); g.fill(); }
  g.beginPath(); g.rect(-0.07, -0.2, 0.14, 0.5);
  fillInk(g, upx, "#bdb5a2", 0.9);
  poly(g, [-0.07, -0.16, -0.3, -0.3, 0.3, -0.3, 0.07, -0.16]);
  fillInk(g, upx, "#7a3a22", 0.8);
  g.beginPath(); g.rect(-0.28, -0.58, 0.56, 0.28);
  fillInk(g, upx, "#a8321e", 0.9);
  g.fillStyle = "#f2d27a"; g.fillRect(-0.08, -0.52, 0.16, 0.2);
  curvedRoof(g, upx, 0, -0.56, 0.42, 0.26, "#7a3420");
  g.beginPath(); g.arc(0, -0.86, 0.04, 0, TAU);
  fillInk(g, upx, "#f2d27a", 0.6);
}

function paintTemple(g, upx) {
  // a đền on a wooded hill: stone steps up to a low hall of red columns under a big tiled roof, two gate pillars
  g.beginPath(); g.moveTo(-0.96, 0.36); g.bezierCurveTo(-0.7, -0.22, 0.7, -0.22, 0.96, 0.36); g.closePath();
  fillInk(g, upx, "#5f8a44", 0.9);
  roundTree(g, upx, -0.74, 0.28, 0.26, "#3f6a34");
  roundTree(g, upx, 0.76, 0.28, 0.24, "#4f7a3a");
  g.beginPath(); g.rect(-0.56, -0.36, 1.12, 0.32);
  fillInk(g, upx, "#9a2e1c", 0.9);
  g.fillStyle = "#f2d27a"; g.fillRect(-0.12, -0.3, 0.24, 0.26);
  g.fillStyle = "#6a1e12";
  for (const x of [-0.46, -0.26, 0.2, 0.4]) g.fillRect(x, -0.32, 0.05, 0.28);
  curvedRoof(g, upx, 0, -0.34, 0.72, 0.32, "#7a3a26");
  g.beginPath(); g.arc(0, -0.7, 0.05, 0, TAU);
  fillInk(g, upx, "#f2d27a", 0.6);
  poly(g, [-0.14, 0.36, -0.08, -0.04, 0.08, -0.04, 0.14, 0.36]);
  fillInk(g, upx, "#cfc2a2", 0.8);
  for (const x of [-0.3, 0.26]) {
    g.beginPath(); g.rect(x, -0.12, 0.06, 0.46);
    fillInk(g, upx, "#e4dac0", 0.8);
    poly(g, [x - 0.03, -0.12, x + 0.03, -0.2, x + 0.09, -0.12]);
    fillInk(g, upx, "#7a3a26", 0.6);
  }
}

function paintMausoleum(g, upx) {
  // a grey granite mausoleum: a stepped base, a colonnade of square pillars, a flat stepped roof, the flag on top
  for (const [y, w, h, col] of [[0.18, 0.92, 0.18, "#8a8a86"], [0.04, 0.8, 0.14, "#9c9b95"]]) {
    g.beginPath(); g.rect(-w, y, 2 * w, h); fillInk(g, upx, col, 0.9);
  }
  g.beginPath(); g.rect(-0.6, -0.48, 1.2, 0.52);
  fillInk(g, upx, "#4e4e4c", 1);
  g.fillStyle = "#c4c2ba";
  for (let k = 0; k < 8; k++) g.fillRect(-0.58 + k * 0.158, -0.46, 0.07, 0.5);
  for (const [y, w, h, col] of [[-0.6, 0.68, 0.12, "#a6a49c"], [-0.72, 0.5, 0.12, "#b2b0a8"], [-0.8, 0.32, 0.08, "#bebcb4"]]) {
    g.beginPath(); g.rect(-w, y, 2 * w, h); fillInk(g, upx, col, 0.9);
  }
  flagVN(g, upx, 0, -0.8, 0.42, 0.3);
  for (const x of [-0.84, 0.84]) { g.beginPath(); g.ellipse(x, 0.1, 0.1, 0.07, 0, 0, TAU); fillInk(g, upx, "#4f7a3a", 0.6); }
}

function paintPalace(g, upx) {
  // a white modernist palace (Dinh Độc Lập): a podium with a long canopy, the upper floors behind a screen of
  // slender white louvres, a roof pavilion and the flag
  g.beginPath(); g.ellipse(0, 0.3, 0.92, 0.14, 0, 0, TAU);
  g.fillStyle = "#6f9a4a"; g.fill();
  g.beginPath(); g.rect(-0.9, -0.02, 1.8, 0.3);
  fillInk(g, upx, "#e8e6de", 0.9);
  windowGrid(g, -0.84, 0.06, 12, 1, 0.145, 0, 0.08, 0.14, "#5e646c");
  g.beginPath(); g.rect(-0.78, -0.5, 1.56, 0.48);
  fillInk(g, upx, "#6e747c", 1);
  g.fillStyle = "#f6f4ee";
  for (let k = 0; k < 24; k++) g.fillRect(-0.76 + k * 0.065, -0.48, 0.032, 0.44);
  g.beginPath(); g.rect(-0.88, -0.56, 1.76, 0.06);
  fillInk(g, upx, "#dcd8cc", 0.8);
  g.beginPath(); g.rect(-0.22, -0.7, 0.44, 0.14);
  fillInk(g, upx, "#ecead2", 0.8);
  g.beginPath(); g.rect(-0.34, -0.06, 0.68, 0.05);
  fillInk(g, upx, "#dcd8cc", 0.7);
  flagVN(g, upx, 0, -0.7, 0.46, 0.3);
}

function paintFlagTower(g, upx) {
  // Cột cờ Lũng Cú: a flag tower on a rocky summit flying a very large national flag
  g.beginPath(); g.moveTo(-0.96, 0.36); g.lineTo(-0.5, -0.1); g.lineTo(-0.2, -0.22); g.lineTo(0.22, -0.2); g.lineTo(0.56, -0.02); g.lineTo(0.96, 0.36); g.closePath();
  fillInk(g, upx, "#6f8a5a", 1);
  g.fillStyle = "rgba(0,0,0,.14)";
  poly(g, [0.22, -0.2, 0.56, -0.02, 0.96, 0.36, 0.3, 0.36]); g.fill();
  poly(g, [-0.16, -0.2, -0.12, -0.7, 0.12, -0.7, 0.16, -0.2]);
  fillInk(g, upx, "#d8d2c2", 1);
  g.fillStyle = "#a8a290";
  for (const y of [-0.34, -0.5]) g.fillRect(-0.15, y, 0.3, 0.03);
  g.beginPath(); g.rect(-0.19, -0.75, 0.38, 0.06);
  fillInk(g, upx, "#c8c2b0", 0.8);
  flagVN(g, upx, 0, -0.75, 0.66, 0.62);
}

function paintSkyscraper(g, upx) {
  // a slender stepped glass tower over a podium, lower towers beside it (Landmark 81)
  g.beginPath(); g.rect(-0.74, 0.08, 1.48, 0.28);
  fillInk(g, upx, "#cdc8ba", 0.9);
  for (const [x, w, top, col] of [[-0.68, 0.26, -0.36, "#9ab4c8"], [0.42, 0.24, -0.26, "#a8bccc"]]) {
    g.beginPath(); g.rect(x, top, w, 0.44 - top);
    fillInk(g, upx, col, 0.9);
  }
  for (const [w, top] of [[0.2, -0.98], [0.14, -1.16], [0.08, -1.28]]) {
    g.beginPath(); g.rect(-w, top, 2 * w, 0.46 - top);
    fillInk(g, upx, "#7fa4c4", 1);
  }
  g.fillStyle = "rgba(0,0,0,.16)"; g.fillRect(0, -1.28, 0.2, 1.36);
  g.strokeStyle = "rgba(236,246,255,.6)"; g.lineWidth = Math.max(0.6 / upx, 0.015);
  g.beginPath();
  for (let y = -0.9; y < 0.08; y += 0.1) { g.moveTo(-0.2, y); g.lineTo(0.2, y); }
  g.stroke();
  g.strokeStyle = "#dfe6ea"; g.lineWidth = Math.max(1 / upx, 0.03);
  g.beginPath(); g.moveTo(0, -1.28); g.lineTo(0, -1.42); g.stroke();
}

function paintGoldBridge(g, upx) {
  // Cầu Vàng: a gold walkway in the misty hills, held up by two giant weathered stone hands
  g.beginPath(); g.moveTo(-0.96, 0.36); g.bezierCurveTo(-0.7, -0.7, -0.2, -0.8, 0.1, -0.5); g.bezierCurveTo(0.4, -0.9, 0.8, -0.6, 0.96, 0.0); g.lineTo(0.96, 0.36); g.closePath();
  fillInk(g, upx, "#5f8466", 1);
  g.fillStyle = "rgba(240,244,246,.6)";
  g.beginPath(); g.ellipse(0, -0.42, 0.86, 0.1, 0, 0, TAU); g.fill();
  const hand = (x) => {
    poly(g, [x - 0.14, 0.36, x - 0.12, -0.02, x + 0.12, -0.02, x + 0.14, 0.36]); // forearm
    fillInk(g, upx, "#8c8a7c", 0.9);
    g.beginPath(); g.ellipse(x, -0.08, 0.24, 0.12, 0, 0, TAU); // palm
    fillInk(g, upx, "#949284", 0.9);
  };
  const fingers = (x) => {
    for (let k = 0; k < 4; k++) {
      g.beginPath(); g.rect(x - 0.21 + k * 0.11, -0.36, 0.09, 0.3);
      fillInk(g, upx, "#9a9888", 0.7);
    }
  };
  hand(-0.42); hand(0.42);
  g.beginPath(); g.moveTo(-0.98, -0.18); g.quadraticCurveTo(0, -0.4, 0.98, -0.18); g.lineTo(0.98, -0.1); g.quadraticCurveTo(0, -0.32, -0.98, -0.1); g.closePath();
  fillInk(g, upx, "#e0b23a", 0.9);
  fingers(-0.42); fingers(0.42);
}

function paintTruss(g, upx) {
  // a long steel truss bridge on stone piers over the river (Cầu Long Biên)
  water(g, upx, 0.06);
  g.fillStyle = "#b8aa90";
  for (const x of [-0.66, 0.0, 0.66]) { g.beginPath(); g.rect(x - 0.05, -0.02, 0.1, 0.32); g.fill(); ink(g, upx, 0.7); }
  g.beginPath(); g.rect(-0.98, -0.06, 1.96, 0.06);
  fillInk(g, upx, "#4a4644", 0.8);
  g.strokeStyle = "#5a4e48";
  g.lineWidth = Math.max(1 / upx, 0.03);
  g.beginPath();
  for (let k = 0; k < 3; k++) {
    const x0 = -0.98 + k * 0.653, x1 = x0 + 0.653, xm = (x0 + x1) / 2;
    g.moveTo(x0, -0.06); g.quadraticCurveTo(xm, -0.62, x1, -0.06);
    const top = (q) => [x0 + ((x1 - x0) * q) / 6, -0.06 - 1.12 * (q / 6) * (1 - q / 6)]; // on the top chord
    for (let q = 0; q <= 6; q++) {
      const [x, yt] = top(q);
      g.moveTo(x, -0.06); g.lineTo(x, yt); // verticals
      if (q < 6) { g.moveTo(x, yt); g.lineTo(top(q + 1)[0], -0.06); } // diagonals
    }
  }
  g.stroke();
}

function paintChamTower(g, upx) {
  // red-brick Cham tower temples (kalan) in the jungle (Mỹ Sơn)
  g.beginPath(); g.ellipse(0, 0.06, 0.96, 0.34, 0, Math.PI, 0); g.closePath();
  fillInk(g, upx, "#4f7a3a", 0.8);
  for (const [x, w, h] of [[-0.5, 0.3, 0.8], [0.06, 0.4, 1.2], [0.6, 0.26, 0.64]]) {
    const y0 = 0.34, yb = y0 - h * 0.5;
    g.beginPath(); g.rect(x - w / 2, yb, w, h * 0.5);
    fillInk(g, upx, "#b4603a", 0.9);
    g.fillStyle = "#3a2218";
    g.beginPath(); g.moveTo(x - w * 0.14, y0); g.lineTo(x - w * 0.14, y0 - h * 0.26); g.lineTo(x, y0 - h * 0.34); g.lineTo(x + w * 0.14, y0 - h * 0.26); g.lineTo(x + w * 0.14, y0); g.closePath(); g.fill();
    let y = yb;
    for (let t = 0; t < 3; t++) {
      const tw = w * (0.86 - t * 0.2), th = h * 0.11;
      g.beginPath(); g.rect(x - tw / 2, y - th, tw, th);
      fillInk(g, upx, t % 2 ? "#a8562e" : "#c06a40", 0.7);
      y -= th;
    }
    poly(g, [x - w * 0.2, y, x, y - h * 0.14, x + w * 0.2, y]);
    fillInk(g, upx, "#a8562e", 0.7);
    g.fillStyle = "rgba(0,0,0,.14)"; g.fillRect(x, yb, w / 2, h * 0.5);
  }
}

function paintCave(g, upx) {
  // a jungle-capped limestone mountain with a great cave mouth at river level and a boat going in (Phong Nha)
  water(g, upx, 0.2);
  g.beginPath();
  g.moveTo(-0.94, 0.24); g.bezierCurveTo(-0.96, -0.4, -0.6, -0.9, -0.1, -0.86); g.bezierCurveTo(0.4, -1.0, 0.9, -0.5, 0.94, 0.24); g.closePath();
  fillInk(g, upx, "#8e9c88", 1);
  for (const [x, y, rx] of [[-0.5, -0.66, 0.36], [0.16, -0.84, 0.4], [0.62, -0.5, 0.26]]) {
    g.beginPath(); g.ellipse(x, y, rx, 0.12, 0, 0, TAU); fillInk(g, upx, "#4f7a3a", 0.7);
  }
  g.beginPath(); g.ellipse(0, 0.24, 0.4, 0.5, 0, Math.PI, 0); g.closePath();
  fillInk(g, upx, "#1e1a18", 1);
  g.beginPath(); g.moveTo(0.3, 0.3); g.lineTo(0.62, 0.3); g.lineTo(0.56, 0.36); g.lineTo(0.34, 0.36); g.closePath();
  fillInk(g, upx, "#7a5a32", 0.7);
}

function paintTunnel(g, upx) {
  // a forest floor with a hidden tunnel hatch, its leaf-covered lid lifted, and a thatched shelter (Địa đạo Củ Chi)
  g.beginPath(); g.ellipse(0, 0.32, 0.9, 0.16, 0, 0, TAU);
  g.fillStyle = "#8a6a3e"; g.fill();
  roundTree(g, upx, -0.66, 0.3, 0.36, "#3f6a34");
  poly(g, [-0.02, -0.12, 0.3, -0.48, 0.66, -0.12]);
  fillInk(g, upx, "#c8a45a", 0.9);
  g.strokeStyle = "rgba(90,64,24,.6)"; g.lineWidth = Math.max(0.7 / upx, 0.02);
  g.beginPath(); for (let k = 1; k < 5; k++) { g.moveTo(0.3, -0.48); g.lineTo(-0.02 + k * 0.136, -0.12); } g.stroke();
  g.fillStyle = "#5a3e24";
  for (const x of [0.06, 0.56]) g.fillRect(x, -0.14, 0.04, 0.46);
  poly(g, [-0.34, 0.24, -0.06, 0.24, 0.02, 0.32, -0.26, 0.32]);
  fillInk(g, upx, "#1a120c", 0.8);
  poly(g, [-0.34, 0.24, -0.06, 0.24, -0.1, 0.02, -0.36, 0.02]);
  fillInk(g, upx, "#7a6a3a", 0.8);
  g.fillStyle = "#6a8a3a";
  for (const [x, y] of [[-0.3, 0.08], [-0.2, 0.14], [-0.14, 0.06]]) { g.beginPath(); g.ellipse(x, y, 0.04, 0.02, 0.5, 0, TAU); g.fill(); }
  roundTree(g, upx, 0.82, 0.36, 0.26, "#4f7a3a");
}

function paintQuarter(g, upx) {
  // Hội An: ochre-yellow shophouses with wooden fronts and old tiled roofs on the river, silk lanterns strung across
  g.beginPath(); g.ellipse(0, 0.32, 0.9, 0.08, 0, 0, TAU);
  g.fillStyle = "#6aa0b0"; g.fill();
  for (const [x, w, col] of [[-0.92, 0.6, "#e8c050"], [-0.3, 0.6, "#f0cc5a"], [0.32, 0.6, "#e2b84a"]]) {
    g.beginPath(); g.rect(x, -0.3, w, 0.58);
    fillInk(g, upx, col, 1);
    g.fillStyle = "#5a3a22"; g.fillRect(x + 0.08, 0.02, w - 0.16, 0.26); // wooden shop front
    g.fillStyle = "#3e6a5a"; g.fillRect(x + 0.1, -0.22, 0.14, 0.14); g.fillRect(x + w - 0.24, -0.22, 0.14, 0.14); // shutters
    poly(g, [x - 0.04, -0.28, x + 0.08, -0.52, x + w - 0.08, -0.52, x + w + 0.04, -0.28]);
    fillInk(g, upx, "#7a4a36", 0.9);
    g.strokeStyle = "rgba(60,30,20,.45)"; g.lineWidth = Math.max(0.6 / upx, 0.015);
    g.beginPath(); for (let k = 1; k < 7; k++) { const t = x + (w * k) / 7; g.moveTo(t, -0.5); g.lineTo(t + (t - x - w / 2) * 0.1, -0.3); } g.stroke();
    g.fillStyle = "rgba(90,110,60,.35)"; g.fillRect(x + 0.1, -0.5, w * 0.3, 0.05); // moss on the old tiles
  }
  g.strokeStyle = "#3a2a1c"; g.lineWidth = Math.max(0.6 / upx, 0.012);
  g.beginPath(); g.moveTo(-0.92, -0.04); g.quadraticCurveTo(0, 0.06, 0.92, -0.04); g.stroke();
  for (let k = 0; k < 7; k++) {
    const x = -0.78 + k * 0.26, y = -0.01 + 0.05 * (1 - ((x / 0.92) ** 2));
    g.beginPath(); g.ellipse(x, y + 0.05, 0.045, 0.06, 0, 0, TAU);
    fillInk(g, upx, k % 2 ? "#f2b630" : "#e23a2a", 0.6);
  }
}

const MOTIF_PAINT = {
  peak: paintPeak, forest: paintForest, coast: paintCoast, karst: paintKarst, cave: paintCave,
  campus: paintCampus, gate: paintGate,
  pagoda: paintPagoda, onepillar: paintOnePillar, temple: paintTemple, citadel: paintCitadel, quarter: paintQuarter,
  chamtower: paintChamTower, mausoleum: paintMausoleum, palace: paintPalace, flagtower: paintFlagTower,
  skyscraper: paintSkyscraper, goldbridge: paintGoldBridge, truss: paintTruss, tunnel: paintTunnel,
};

// --- plaques --------------------------------------------------------------------------------------------------------

const PLAQUE_FONT = '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';

/**
 * A name plate centred under (x, y) in screen css px (call with a screen transform): dark bronze plate, gold rim, the
 * name in small caps-ish serif and an optional second line (sub). `kind` tints the rim (wonder kinds or "fort").
 * Returns the plate's box [x0, y0, x1, y1] (css px) for decluttering.
 */
export function drawPlaque(ctx, text, x, y, { kind = "landmark", sub = "", scale = 1, measureOnly = false } = {}) {
  const fs = 10.5 * scale, fs2 = 9 * scale;
  ctx.font = `600 ${fs.toFixed(1)}px ${PLAQUE_FONT}`;
  const tw = ctx.measureText(text).width;
  let sw = 0;
  if (sub) {
    ctx.font = `${fs2.toFixed(1)}px -apple-system, system-ui, sans-serif`;
    sw = ctx.measureText(sub).width;
  }
  const w = Math.max(tw, sw) + 14 * scale, h = (sub ? 27 : 16) * scale;
  const x0 = x - w / 2, y0 = y;
  if (measureOnly) return [x0, y0, x0 + w, y0 + h];
  const rim = kind === "fort" ? "#c98a6a" : WONDER_KINDS[kind]?.ring || "#c9a45c";
  const r = 4 * scale;
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0); ctx.lineTo(x0 + w - r, y0); ctx.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  ctx.lineTo(x0 + w, y0 + h - r); ctx.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  ctx.lineTo(x0 + r, y0 + h); ctx.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  ctx.lineTo(x0, y0 + r); ctx.quadraticCurveTo(x0, y0, x0 + r, y0);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, y0, 0, y0 + h);
  grad.addColorStop(0, "rgba(46,34,20,.95)");
  grad.addColorStop(1, "rgba(22,16,8,.95)");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = rim;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${fs.toFixed(1)}px ${PLAQUE_FONT}`;
  ctx.fillStyle = "#f6e7bf";
  ctx.fillText(text, x, y0 + 8.4 * scale);
  if (sub) {
    ctx.font = `${fs2.toFixed(1)}px -apple-system, system-ui, sans-serif`;
    ctx.fillStyle = "#c9b98f";
    ctx.fillText(sub, x, y0 + 19.6 * scale);
  }
  return [x0, y0, x0 + w, y0 + h];
}
