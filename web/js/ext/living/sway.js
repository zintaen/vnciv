// Trees swaying in the wind, kitchen smoke and lit windows: per-frame art above the cached static map, which is
// never redrawn for it.
//
// How the trees move without redrawing the map: once the camera settles, the visible stamps of a few "calm" forest
// hexes are collected by running render/art/terrain.js drawTerrainGlyphs into a 1×1 recording context (it plans
// and stamps exactly what the cache drew; STAMP_KIND tells the trees from the rest). Each frame those stamps are
// drawn again over their own static copies, the trees sheared a little about their base (a wind wave runs across
// the map). A calm hex is one where nothing else is drawn over the trees in the cache: forest on flat or hilly
// ground (no mountains next to it), away from province borders, rivers, roads, rail, city tiles, resource icons
// and other map layers. Zoom-gated (hexes ≥ 22 css px), capped in count, culled to the view.
// Houses (villages, stilt houses and suburbs) are found the same way: smoke rises from them at cooking time (05:00–07:00 and
// 16:30–19:00 Vietnam time) and their windows glow while the sun is down (with the Day–night shading on). Both are
// illustrative: no data on real smoke or lights.
import { hash01 } from "../../hex.js";
import { drawTerrainGlyphs, STAMP_KIND } from "../../render/art/terrain.js";
import { lodFor } from "../../render/art/lod.js";
import { COVER } from "../../terrain.js";
import { mapToLonLat, sunState, elevationAt } from "../daynight/sun.js";

export const SWAY_MIN_RPX = 22;
const MAX_STAMPS = { desk: 1400, phone: 500 };
const MAX_HOUSES = 220;
const KIND = { tree: 1, clump: 1, palm: 1, hill: 2, village: 3, stilt: 3, suburbBuild: 4 };

export function createSway(app, { phone }) {
  const w = app.w, grid = w.grid, R = grid.R, raw = w.raw, n = grid.size;
  const maxStamps = phone ? MAX_STAMPS.phone : MAX_STAMPS.desk;
  // --- the recording context -------------------------------------------------------------------------------------
  const recCv = document.createElement("canvas");
  recCv.width = recCv.height = 1;
  const rec = recCv.getContext("2d");
  const fakeCanvas = { width: 1, height: 1 };
  Object.defineProperty(rec, "canvas", { value: fakeCanvas });
  // recorded stamps (reused buffers; Array of canvases + typed arrays)
  const sc = [], sx = new Float32Array(maxStamps), sy = new Float32Array(maxStamps), sw = new Float32Array(maxStamps),
    sh = new Float32Array(maxStamps), sa = new Float32Array(maxStamps), sb = new Float32Array(maxStamps), sk = new Uint8Array(maxStamps),
    sp = new Float32Array(maxStamps);
  let ns = 0;
  const hx = new Float32Array(MAX_HOUSES * 3), hy = new Float32Array(MAX_HOUSES * 3), hk = new Float32Array(MAX_HOUSES * 3),
    hp = new Float32Array(MAX_HOUSES * 3), hs = new Uint8Array(MAX_HOUSES * 3); // hs: 1 = smokes
  let nh = 0, recording = null; // "trees" | "houses"
  rec.drawImage = (img, x, y, dw, dh) => {
    const kind = KIND[STAMP_KIND.get(img)] || 0;
    if (recording === "trees") {
      if ((kind !== 1 && kind !== 2) || ns >= maxStamps) return;
      sc[ns] = img; sx[ns] = x; sy[ns] = y; sw[ns] = dw; sh[ns] = dh; sa[ns] = rec.globalAlpha; sk[ns] = kind;
      sb[ns] = y + dh * 0.82; // the base line (tree / clump boxes put the anchor ~82–86% down)
      sp[ns] = hash01(Math.round(x * 7 + y * 13), 9) * 6.283;
      ns++;
    } else if (recording === "houses" && (kind === 3 || kind === 4) && nh < MAX_HOUSES * 3) {
      // a village or a stilt house: one kitchen fire near the roof ridge; a suburb hex: three houses picked inside the sprite
      const spots = kind === 3 ? 1 : 3;
      for (let j = 0; j < spots && nh < MAX_HOUSES * 3; j++) {
        const u = kind === 3 ? 0.6 : 0.2 + hash01(Math.round(x * 3) + j, 31) * 0.6;
        const v = kind === 3 ? 0.42 : 0.3 + hash01(Math.round(y * 3) + j, 32) * 0.5;
        hx[nh] = x + dw * u; hy[nh] = y + dh * v; hk[nh] = kind === 3 ? dh : dh * 0.25;
        hp[nh] = hash01(Math.round(x + y) + j, 33);
        hs[nh] = kind === 3 || j === 0 ? 1 : 0;
        nh++;
      }
    }
  };

  // --- cells that may sway ---------------------------------------------------------------------------------------
  // busy[i] = something is drawn over cell i in the cache (rivers, roads, rail) — filled once, roads when loaded.
  const busy = new Uint8Array(n);
  const mark = (x, y) => { const c = grid.cellAt(x, y); if (c >= 0) busy[c] = 1; };
  for (const rv of raw.rivers || []) {
    const p = rv.pts || [];
    for (let k = 0; k + 3 < p.length; k += 2) {
      const L = Math.hypot(p[k + 2] - p[k], p[k + 3] - p[k + 1]), m = Math.max(1, Math.ceil(L / (R * 0.4)));
      for (let q = 0; q <= m; q++) mark(p[k] + ((p[k + 2] - p[k]) * q) / m, p[k + 1] + ((p[k + 3] - p[k + 1]) * q) / m);
    }
  }
  let roadsMarked = false;
  function markRoads() {
    const inf = app.data.infrastructure;
    if (roadsMarked || !inf) return;
    roadsMarked = true;
    for (const l of [...(inf.roads || []), ...(inf.rail || [])]) { busy[l[0]] = 1; busy[l[1]] = 1; }
  }
  const forest = (cv) => cv === COVER.DECIDUOUS || cv === COVER.EVERGREEN || cv === COVER.MIXED;
  function calm(i) {
    if (!forest(w.cover[i]) || w.relief[i] > 1 || raw.owner[i] < 0 || busy[i] || w.cityByCell.has(i)) return false;
    const o = raw.owner[i], c = raw.county[i];
    for (let d = 0; d < 6; d++) {
      const j = grid.neighbour(i, d);
      if (j < 0 || w.water[j] || raw.owner[j] !== o || raw.county[j] !== c || w.relief[j] > 1 || busy[j] || w.cityByCell.has(j)) return false;
    }
    return true;
  }
  const resCells = () => {
    if (!app.state.showResources || !w.resources) return null;
    return new Set(w.resources.byCell?.keys() || []); // world.js prepareResources: {byCell: Map(cell → items), ...}
  };

  // --- collect on settle ------------------------------------------------------------------------------------------
  let key = "";
  const cells = [], houseCells = [];
  function collect(cam, dpr) {
    const s = cam.scale, Rpx = R * s, v = cam.view();
    const k = `${s}|${Math.round(v.x0)}|${Math.round(v.y0)}|${Math.round(v.x1)}|${Math.round(v.y1)}|${app.state.showResources}|${app.staticLayers?.().length}`;
    if (k === key) return;
    key = k;
    ns = 0; nh = 0;
    if (Rpx < SWAY_MIN_RPX) return;
    markRoads();
    const res = resCells();
    const g = grid.range(v.x0, v.y0, v.x1, v.y1);
    cells.length = 0; houseCells.length = 0;
    const cx = cam.x, cy = cam.y;
    for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) {
      const i = r * grid.cols + c;
      if (i < 0 || i >= n || w.water[i] || raw.owner[i] < 0) continue;
      const cv = w.cover[i];
      if (cv === COVER.CROP || cv === COVER.URBAN || cv === COVER.PASTURE) { houseCells.push(i); continue; }
      if (!calm(i) || res?.has(i)) continue;
      // another map layer (a site, a peak, a place) drawn on this hex: leave its trees still
      const [px, py] = cam.toScreen ? cam.toScreen(grid.cx(i), grid.cy(i)) : [0, 0];
      if (app.hitLayer?.(px, py)) continue;
      cells.push(i);
    }
    // nearest the middle first, so the cap keeps the trees in view
    cells.sort((a, b) => Math.hypot(grid.cx(a) - cx, grid.cy(a) - cy) - Math.hypot(grid.cx(b) - cx, grid.cy(b) - cy));
    fakeCanvas.width = Math.ceil(cam.w * dpr); fakeCanvas.height = Math.ceil(cam.h * dpr);
    rec.setTransform(dpr * s, 0, 0, dpr * s, dpr * (cam.w / 2 - cam.x * s), dpr * (cam.h / 2 - cam.y * s));
    const lod = lodFor(Rpx);
    try {
      recording = "trees";
      if (cells.length > 1) drawTerrainGlyphs(rec, cells, w, { Rpx, s, lod });
      recording = "houses";
      if (houseCells.length > 1) drawTerrainGlyphs(rec, houseCells, w, { Rpx, s, lod });
    } finally { recording = null; }
  }

  // --- wind ------------------------------------------------------------------------------------------------------
  // Illustrative: a gentle wave from the monsoon's side (north-east October–April, south-west May–September).
  let windX = -1, windY = 0.6;
  function setMonth(m) {
    const ne = m >= 10 || m <= 4;
    windX = ne ? -1 : 1; windY = ne ? 0.55 : -0.45;
  }

  function drawTrees(ctx, cam, f, t) {
    const s = cam.scale, a = f.dpr * s, e = f.dpr * (cam.w / 2 - cam.x * s), fy = f.dpr * (cam.h / 2 - cam.y * s);
    const kx = windX * 0.004, ky = windY * 0.004; // the wave front: ~1,500 map units (300 km) a cycle
    for (let k = 0; k < ns; k++) {
      ctx.globalAlpha = sa[k];
      if (sk[k] === 1) {
        // lean with the wind and flutter: a slow gust wave across the map plus each tree's own quicker sway
        const g = Math.sin(t * 0.9 - (sx[k] * kx + sy[k] * ky) * 6.283);
        const shx = windX * (0.018 + 0.03 * (g * 0.5 + 0.5)) + Math.sin(t * 2.3 + sp[k]) * 0.018;
        ctx.setTransform(a, 0, a * -shx, a, e + a * shx * sb[k], fy);
      } else ctx.setTransform(a, 0, 0, a, e, fy);
      ctx.drawImage(sc[k], sx[k], sy[k], sw[k], sh[k]);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(a, 0, 0, a, e, fy);
  }

  // --- houses ----------------------------------------------------------------------------------------------------
  let puff = null, glow = null;
  function sprites() {
    if (puff) return;
    puff = document.createElement("canvas"); puff.width = puff.height = 32;
    let g = puff.getContext("2d"), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, "rgba(118,122,132,0.9)"); gr.addColorStop(0.55, "rgba(140,144,152,0.45)"); gr.addColorStop(1, "rgba(160,164,170,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    glow = document.createElement("canvas"); glow.width = glow.height = 32;
    g = glow.getContext("2d"); gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, "rgba(255,240,190,1)"); gr.addColorStop(0.3, "rgba(255,196,96,0.7)"); gr.addColorStop(1, "rgba(255,150,40,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  }
  function drawSmoke(ctx, cam, t, amount) {
    sprites();
    const s = cam.scale;
    for (let k = 0; k < nh; k++) {
      if (!hs[k]) continue;
      const H = hk[k];
      for (let j = 0; j < 4; j++) {
        const p = (t * 0.16 + hp[k] + j * 0.25) % 1; // each puff rises for ~6 s
        const r = H * (0.07 + p * 0.36);
        const x = hx[k] + windX * p * p * H * 0.5 + Math.sin(t * 0.7 + hp[k] * 9 + p * 4) * H * 0.03;
        const y = hy[k] - p * H * 1.3;
        ctx.globalAlpha = amount * 0.8 * (1 - p) * Math.min(1, p * 5);
        ctx.drawImage(puff, x - r, y - r, 2 * r, 2 * r);
      }
    }
    ctx.globalAlpha = 1;
    return s;
  }
  function drawLights(ctx, cam, amount) {
    sprites();
    const px = 1 / cam.scale;
    ctx.globalCompositeOperation = "lighter";
    for (let k = 0; k < nh; k++) {
      const r = Math.max(3 * px, hk[k] * 0.16);
      ctx.globalAlpha = amount * (0.55 + 0.45 * hp[k]);
      ctx.drawImage(glow, hx[k] - r, hy[k] + hk[k] * 0.25 - r, 2 * r, 2 * r);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // --- the sky at the view: one sun computation per frame (the map window spans ~30 minutes of solar time) --------
  function sunAt(cam, ms) {
    const [lon, lat] = mapToLonLat(cam.x, cam.y);
    return elevationAt(lat, lon, sunState(ms));
  }

  return {
    collect, setMonth, sunAt,
    get stamps() { return ns; }, get houses() { return nh; },
    drawTrees, drawSmoke, drawLights,
    reset() { key = ""; },
  };
}
