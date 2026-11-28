// Fishing-boat lights at sea at night and Tết fireworks over the big cities.
// Boats are illustrative: generic positions in Vietnam's offshore fishing zones (from 6 to ~160 nautical miles off the
// mainland and islands, see living.json fishing.rule), not vessel positions. Fireworks are illustrative too (a burst
// pattern over the biggest cities while the Vietnam clock is on Tết eve), not a programme of real displays.
// Everything is computed from time and a per-item hash (no particle state, no allocation per frame).
import { hash01 } from "../../hex.js";

export function createNight(app, { phone }) {
  const w = app.w, grid = w.grid, R = grid.R, n = grid.size, water = w.water;
  // --- boats -------------------------------------------------------------------------------------------------------
  let bx = null, by = null, bp = null, nb = 0, fishing = null;
  function buildBoats(F) {
    fishing = F;
    // hex steps to the nearest land (BFS over the sea)
    const dist = new Int16Array(n).fill(-1), q = new Int32Array(n);
    let qh = 0, qt = 0;
    for (let i = 0; i < n; i++) if (!water[i] && w.raw.owner[i] !== -2 && w.raw.owner[i] >= 0) { dist[i] = 0; q[qt++] = i; }
    while (qh < qt) {
      const i = q[qh++];
      for (let d = 0; d < 6; d++) {
        const j = grid.neighbour(i, d);
        if (j >= 0 && dist[j] < 0 && (water[j] === 1 || water[j] === 2)) { dist[j] = dist[i] + 1; q[qt++] = j; }
      }
    }
    const kmStep = grid.W * (w.raw.km_per_unit || 0.2); // km between neighbouring hex centres
    const nm = 1.852;
    const d0 = Math.ceil((F.min_nm * nm) / kmStep), d1 = Math.floor((F.max_nm * nm) / kmStep);
    const xs = [], ys = [], ps = [];
    for (let i = 0; i < n; i++) {
      const d = dist[i];
      if (d < d0 || d > d1) continue;
      // fleets: a coarse noise field (~40 km patches) decides where boats gather tonight; denser nearer the coast
      const patch = hash01(Math.floor(grid.cx(i) / 200) * 7919 + Math.floor(grid.cy(i) / 200), 41);
      const p = (patch > 0.55 ? 0.5 : 0.05) * (d < d0 + 8 ? 1 : 0.45);
      if (hash01(i, 42) > p) continue;
      for (let k = 0, m = 1 + Math.floor(hash01(i, 43) * 3); k < m; k++) {
        xs.push(grid.cx(i) + (hash01(i, 44 + k) - 0.5) * grid.W);
        ys.push(grid.cy(i) + (hash01(i, 48 + k) - 0.5) * grid.H);
        ps.push(hash01(i, 52 + k) * 6.283);
      }
    }
    bx = Float32Array.from(xs); by = Float32Array.from(ys); bp = Float32Array.from(ps); nb = bx.length;
  }

  let dot = null;
  function sprite() {
    if (dot) return;
    dot = document.createElement("canvas"); dot.width = dot.height = 24;
    const g = dot.getContext("2d"), gr = g.createRadialGradient(12, 12, 0, 12, 12, 12);
    gr.addColorStop(0, "rgba(255,255,236,1)"); gr.addColorStop(0.25, "rgba(220,240,255,0.75)"); gr.addColorStop(1, "rgba(160,210,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 24, 24);
  }

  /** amount 0..1 (night), t seconds (null = still). Returns the number drawn. */
  function drawBoats(ctx, cam, v, amount, t) {
    if (!nb) return 0;
    sprite();
    const s = cam.scale;
    const r = Math.max(2.2, Math.min(7, R * s * 0.22)) / s; // a few css px whatever the zoom
    // a dense view (the whole country) thins the boats so the sea is not a carpet of dots
    const cap = phone ? 350 : 900;
    let st = 1, vis = 0;
    for (let k = 0; k < nb; k++) if (bx[k] > v.x0 && bx[k] < v.x1 && by[k] > v.y0 && by[k] < v.y1) vis++;
    while (vis / st > cap) st++;
    ctx.globalCompositeOperation = "lighter";
    let drawn = 0;
    for (let k = 0; k < nb; k += st) {
      const x = bx[k], y = by[k];
      if (x < v.x0 - r || x > v.x1 + r || y < v.y0 - r || y > v.y1 + r) continue;
      const tw = t == null ? 0.85 : 0.7 + 0.3 * Math.sin(t * 1.7 + bp[k]); // bobbing on the swell
      ctx.globalAlpha = amount * tw;
      ctx.drawImage(dot, x - r, y - r + (t == null ? 0 : Math.sin(t * 0.8 + bp[k]) * r * 0.15), 2 * r, 2 * r);
      drawn++;
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    return drawn;
  }

  // --- fireworks -----------------------------------------------------------------------------------------------------
  const COLORS = ["#ffc21a", "#ff3b30", "#25c4ff", "#b066ff", "#2bd96b", "#ff5ac8"];
  let cities = [];
  function setCities(list) { cities = list; }
  const SPARKS = 28, PERIOD = 2.4; // s between bursts per launcher
  /** Draw in screen css px (ctx at dpr). t = seconds, or null for the still state (one open star per city). */
  function drawFireworks(ctx, cam, v, t) {
    const scale = Math.max(1, Math.min(1.6, cam.scale * 3));
    for (let c = 0; c < cities.length; c++) {
      const C = cities[c];
      if (C.x < v.x0 - 400 || C.x > v.x1 + 400 || C.y < v.y0 - 400 || C.y > v.y1 + 400) continue;
      const sx = (C.x - cam.x) * cam.scale + cam.w / 2, sy = (C.y - cam.y) * cam.scale + cam.h / 2;
      for (let L = 0; L < 3; L++) { // three launchers per city, out of step
        const off = hash01(c * 3 + L, 61) * PERIOD;
        const tt = t == null ? 0.55 : ((t + off) % PERIOD) / PERIOD; // 0..1 through one burst
        const burst = t == null ? L : Math.floor((t + off) / PERIOD);
        const ox = sx + (hash01(burst * 13 + c * 3 + L, 62) - 0.5) * 70 * scale;
        const oy = sy - (40 + hash01(burst * 17 + c, 63) * 50) * scale;
        const col = COLORS[Math.floor(hash01(burst * 7 + c * 5 + L, 64) * COLORS.length)];
        if (tt < 0.22) { // the rocket climbing
          if (t == null) continue;
          const p = tt / 0.22;
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = "#fff4d0";
          ctx.fillRect(ox - 1, sy + (oy - sy) * p - 3, 2, 6);
          continue;
        }
        const p = (tt - 0.22) / 0.78, rad = (24 + 30 * hash01(burst + c, 65)) * scale * (1 - (1 - p) * (1 - p) * (1 - p));
        ctx.globalAlpha = t == null ? 0.95 : Math.max(0, 1 - p * p);
        ctx.fillStyle = col;
        for (let k = 0; k < SPARKS; k++) {
          const a = (k / SPARKS) * 6.283 + hash01(burst, 66);
          const x = ox + Math.cos(a) * rad, y = oy + Math.sin(a) * rad + p * p * 14 * scale; // a little gravity
          const sz = 2.6 * scale * (1 - p * 0.5);
          ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
          if (k % 2 === 0) ctx.fillRect((x + ox) / 2 - sz / 4, (y + oy) / 2 - sz / 4, sz / 2, sz / 2); // an inner ring
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  return {
    buildBoats, drawBoats, setCities, drawFireworks,
    get boats() { return nb; }, get fishing() { return fishing; },
  };
}
