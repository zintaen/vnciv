// Ambient map motion, drawn every frame in world space over the cached static map (which is never redrawn for it):
//   sea glints   a capped lattice of sea hexes (power-of-two stride, so zooming keeps most glints in place)
//   surf         the land/water hex edges (w.coastLines), lapping seaward in four phase groups
//   rivers       dashes flowing source → mouth along world.json rivers, width and speed by rank
//   clouds       a few faint soft shadows drifting east (illustrative; off on phones)
// Everything is culled to the view and drawn with reused paths (no allocation per frame).
import { hash01 } from "../../hex.js";

const GLINTS = 260; // most glints drawn in a frame (halved in lowPower)
const CLOUDS = 10;

export function createAmbient(app) {
  const w = app.w, grid = w.grid, water = w.water, R = grid.R;
  const W = w.raw.width, H = w.raw.height;

  // Coast edges with their seaward unit normal (edges run clockwise around the land hex: normal = (dy, -dx)).
  const cl = w.coastLines || [];
  const nSeg = cl.length / 4;
  const seg = new Float32Array(nSeg * 6), segGroup = new Uint8Array(nSeg);
  for (let k = 0; k < nSeg; k++) {
    const x0 = cl[4 * k], y0 = cl[4 * k + 1], x1 = cl[4 * k + 2], y1 = cl[4 * k + 3];
    const L = Math.hypot(x1 - x0, y1 - y0) || 1;
    seg.set([x0, y0, x1, y1, (y1 - y0) / L, -(x1 - x0) / L], 6 * k);
    // Neighbouring edges share a phase over ~3 hexes so the surf reads as waves along the shore, not noise.
    segGroup[k] = (Math.floor(x0 / (R * 5)) + Math.floor(y0 / (R * 5)) * 7 + (hash01(k, 3) < 0.2 ? 1 : 0)) & 3;
  }

  // Rivers, oriented source → mouth (the lower end is the mouth), as in render/art/water.js.
  const height = (x, y) => {
    const c = grid.cellAt(x, y);
    return c < 0 ? null : water[c] ? -1e4 : w.raw.elev[c];
  };
  const rivers = [];
  for (const rv of w.raw.rivers || []) {
    let p = rv.pts;
    if (!p || p.length < 4) continue;
    const n = p.length, h0 = height(p[0], p[1]), h1 = height(p[n - 2], p[n - 1]);
    if (h0 != null && h1 != null && h0 < h1) {
      const q = [];
      for (let k = n - 2; k >= 0; k -= 2) q.push(p[k], p[k + 1]);
      p = q;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < n; k += 2) {
      x0 = Math.min(x0, p[k]); x1 = Math.max(x1, p[k]); y0 = Math.min(y0, p[k + 1]); y1 = Math.max(y1, p[k + 1]);
    }
    rivers.push({ pts: p, bbox: [x0, y0, x1, y1], rank: rv.rank ?? 9 });
  }
  const ranks = [...new Set(rivers.map((r) => r.rank))].sort((a, b) => a - b);

  // One soft cloud-shadow sprite (a few overlapping blobs), stretched per cloud.
  let sprite = null;
  const clouds = Array.from({ length: CLOUDS }, (_, k) => ({
    x: hash01(k, 11) * W, y: hash01(k, 12) * H,
    size: (120 + hash01(k, 13) * 140) * 5, // 120-260 km across
    vx: 2.2 + hash01(k, 14) * 1.6, vy: 0.5 + hash01(k, 15) * 0.6, // map units per second (illustrative)
    a: 0.07 + hash01(k, 16) * 0.05,
  }));
  function makeSprite() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    for (let k = 0; k < 6; k++) {
      const x = 34 + hash01(k, 21) * 60, y = 44 + hash01(k, 22) * 40, r = 22 + hash01(k, 23) * 24;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, "rgba(10,20,30,0.55)");
      rg.addColorStop(1, "rgba(10,20,30,0)");
      g.fillStyle = rg;
      g.fillRect(0, 0, 128, 128);
    }
    return c;
  }

  const visible = (b, v, pad) => !(b[2] < v.x0 - pad || b[0] > v.x1 + pad || b[3] < v.y0 - pad || b[1] > v.y1 + pad);

  function drawGlints(ctx, v, s, f) {
    const g = grid.range(v.x0, v.y0, v.x1, v.y1);
    const cells = (g.r1 - g.r0 + 1) * (g.c1 - g.c0 + 1);
    const cap = f.lowPower ? GLINTS / 2 : GLINTS;
    let st = 1;
    while ((cells * 0.55) / (st * st) > cap) st *= 2; // ~55% of the map's hexes are sea
    const len = 9 / s, th = 1.3 / s, t = f.t;
    ctx.fillStyle = "#eaf7ff";
    let n = 0;
    for (let r = g.r0 - (g.r0 % st); r <= g.r1 && n < cap; r += st) {
      for (let c = g.c0 - (g.c0 % st); c <= g.c1; c += st) {
        const i = r * grid.cols + c;
        const ph = hash01(i, 1) * 6.283, sp = 1.4 + hash01(i, 2) * 1.2;
        const k = Math.sin(t * sp + ph);
        if (k <= 0.25) continue; // dark most of the time: a glint, not a grid
        // Scattered over the stride's block (not the hex centre), so a sparse zoom shows no lattice.
        const x = grid.cx(i) + (hash01(i, 4) - 0.5) * grid.W * st + Math.sin(t * 0.35 + ph) * R * 0.3;
        const y = grid.cy(i) + (hash01(i, 5) - 0.5) * grid.H * st;
        const j = st > 1 ? grid.cellAt(x, y) : i;
        if (j < 0 || water[j] !== 1 && water[j] !== 2) continue;
        const a = (k - 0.25) / 0.75;
        ctx.globalAlpha = 0.32 * a * a;
        const l = len * (0.6 + 0.4 * a);
        ctx.fillRect(x - l / 2, y, l, th);
        if (++n >= cap) break;
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawSurf(ctx, v, s, f) {
    const pad = R;
    ctx.strokeStyle = "#f4fbff";
    ctx.lineWidth = 1.2 / s;
    ctx.lineCap = "round";
    for (let gph = 0; gph < 4; gph++) {
      const p = (Math.sin(f.t * 0.9 + gph * 1.571) + 1) / 2; // 0 → 1 → 0, ~7 s a cycle
      const d = R * (0.06 + 0.22 * p);
      ctx.globalAlpha = 0.28 * (1 - p) + 0.04;
      ctx.beginPath();
      for (let k = 0; k < nSeg; k++) {
        if (segGroup[k] !== gph) continue;
        const o = 6 * k, x0 = seg[o], y0 = seg[o + 1];
        if (x0 < v.x0 - pad || x0 > v.x1 + pad || y0 < v.y0 - pad || y0 > v.y1 + pad) continue;
        const nx = seg[o + 4] * d, ny = seg[o + 5] * d;
        // Shortened a little so neighbouring edges read as separate crests.
        const ex = (seg[o + 2] - x0) * 0.15, ey = (seg[o + 3] - y0) * 0.15;
        ctx.moveTo(x0 + nx + ex, y0 + ny + ey);
        ctx.lineTo(seg[o + 2] + nx - ex, seg[o + 3] + ny - ey);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawRivers(ctx, v, s, f) {
    const Rpx = R * s;
    const mouthPx = (rank) => Math.min(Math.max(0.8, (10 - rank) * 0.24 * Math.sqrt(s / 0.25)), Rpx * 0.3); // water.js
    const minStep = 2.5 / s; // drop points closer than 2.5 css px
    ctx.strokeStyle = "#d4efff";
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    for (const rank of ranks) {
      const Wm = mouthPx(rank);
      if (Wm < 1.6) continue; // too thin to carry a visible dash
      const dash = (4 + Wm * 1.5) / s, gap = (10 + Wm * 3) / s;
      ctx.setLineDash([dash, gap]);
      // Bigger rivers (rank 1 = largest) run calmer; small ones a little quicker. css px per second.
      const speed = (7 + rank * 1.6) / s;
      ctx.lineDashOffset = -((f.t * speed) % (dash + gap));
      ctx.lineWidth = Math.max(0.6, Wm * 0.32) / s;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      for (const rv of rivers) {
        if (rv.rank !== rank || !visible(rv.bbox, v, Wm / s)) continue;
        const p = rv.pts;
        let lx = p[0], ly = p[1];
        ctx.moveTo(lx, ly);
        for (let k = 2; k < p.length; k += 2) {
          const x = p[k], y = p[k + 1];
          if (k < p.length - 2 && Math.abs(x - lx) + Math.abs(y - ly) < minStep) continue;
          ctx.lineTo(x, y);
          lx = x; ly = y;
        }
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  function drawClouds(ctx, v, f) {
    sprite ||= makeSprite();
    for (const c of clouds) {
      const span = W + 2 * c.size, spanY = H + 2 * c.size;
      const x = ((((c.x + c.vx * f.t) % span) + span) % span) - c.size;
      const y = ((((c.y + c.vy * f.t) % spanY) + spanY) % spanY) - c.size;
      const hw = c.size / 2, hh = c.size * 0.32;
      if (x + hw < v.x0 || x - hw > v.x1 || y + hh < v.y0 || y - hh > v.y1) continue;
      ctx.globalAlpha = c.a;
      ctx.drawImage(sprite, x - hw, y - hh, c.size, hh * 2);
    }
    ctx.globalAlpha = 1;
  }

  return {
    clouds: !app.isMobile?.(), // phones: off (they cost frames on a small GPU and read as smudges on a small map)
    draw(ctx, cam, f) {
      const v = cam.view(), s = cam.scale;
      drawGlints(ctx, v, s, f);
      if (f.lowPower && f.moving) return; // over budget on this device: only the glints while a pan or zoom runs
      if (R * s >= 6) drawSurf(ctx, v, s, f);
      drawRivers(ctx, v, s, f);
      if (this.clouds) drawClouds(ctx, v, f);
    },
  };
}
