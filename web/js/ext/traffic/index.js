// Moving traffic: planes on the 30 air arcs, ships on the port lanes, trains on the rail lines (motion_routes.json).
// All of it is illustrative (how many, how fast, when): the toggle and every tooltip say so. Drawn through app.motion
// in world space over the cached map; sprites are painted once, positions go into preallocated arrays (no allocation
// per frame), everything is culled to the view and capped at MAX sprites. With Effects off nothing is drawn: the
// static rail, port and air-route layers already show the same routes.
import { t } from "../../i18n.js";
import { esc } from "../../format.js";

const MAX = 200;
const PLANE_PX = 13, SHIP_PX = 9, CAR_PX = 6; // css px at home zoom (scaled up a little when zoomed in)
const SHIP_SIZE = { special: 1, I: 0.85, II: 0.72, III: 0.62 };
const SHIP_COUNT = { special: 3, I: 2 };
const SPEED_SHIP = 14, SPEED_TRAIN = 60; // map units (0.2 km) per second, illustrative
const TRAIL = 5; // contrail segments

const NOTE = {
  plane: "Illustrative, not a flight schedule; air routes from Wikipedia's airport articles (2026)",
  ship: "Illustrative ship movement, not real shipping lanes or traffic",
  train: "Illustrative train frequency, not a timetable",
};

// --- sprites (painted once, pointing +x) ---------------------------------------------------------------------------
function sprite(wpx, hpx, paint) {
  const k = 4, c = document.createElement("canvas");
  c.width = wpx * k; c.height = hpx * k;
  const g = c.getContext("2d");
  g.scale(k, k);
  g.lineJoin = "round";
  paint(g, wpx, hpx);
  return c;
}
const SPR = {};
function makeSprites() {
  SPR.plane = sprite(16, 16, (g) => {
    g.beginPath();
    g.moveTo(15, 8); g.lineTo(11, 9); g.lineTo(7, 14.5); g.lineTo(5.5, 14.5); g.lineTo(7.5, 9.2); g.lineTo(3.5, 9.3);
    g.lineTo(2, 11.5); g.lineTo(1, 11.5); g.lineTo(1.8, 8); g.lineTo(1, 4.5); g.lineTo(2, 4.5); g.lineTo(3.5, 6.7);
    g.lineTo(7.5, 6.8); g.lineTo(5.5, 1.5); g.lineTo(7, 1.5); g.lineTo(11, 7); g.closePath();
    g.lineWidth = 1.4; g.strokeStyle = "#1d2a36"; g.stroke();
    g.fillStyle = "#ffffff"; g.fill();
  });
  SPR.ship = sprite(18, 8, (g) => {
    g.beginPath();
    g.moveTo(17, 4); g.lineTo(13, 1); g.lineTo(1.5, 1); g.lineTo(1.5, 7); g.lineTo(13, 7); g.closePath();
    g.lineWidth = 1.2; g.strokeStyle = "#1d2a36"; g.stroke();
    g.fillStyle = "#c8503c"; g.fill();
    g.fillStyle = "#f2f2ee"; g.fillRect(2.5, 2.3, 3.5, 3.4); // bridge
    g.fillStyle = "#3d6f9c"; g.fillRect(7, 2.3, 2.5, 3.4); g.fillRect(10, 2.3, 2.5, 3.4); // containers
  });
  SPR.barge = sprite(14, 6, (g) => {
    g.beginPath(); g.rect(1, 1, 12, 4);
    g.lineWidth = 1; g.strokeStyle = "#2a2418"; g.stroke();
    g.fillStyle = "#8a6a3c"; g.fill();
    g.fillStyle = "#c9b48a"; g.fillRect(3, 2, 7, 2);
  });
  SPR.loco = sprite(12, 6, (g) => {
    g.beginPath(); g.roundRect(1, 1, 10, 4, [1, 2.5, 2.5, 1]);
    g.lineWidth = 1; g.strokeStyle = "#1d2a36"; g.stroke();
    g.fillStyle = "#d8402e"; g.fill();
    g.fillStyle = "#f5d76e"; g.fillRect(8, 2, 1.5, 2);
  });
  SPR.car = sprite(12, 6, (g) => {
    g.beginPath(); g.roundRect(1, 1, 10, 4, 1);
    g.lineWidth = 1; g.strokeStyle = "#1d2a36"; g.stroke();
    g.fillStyle = "#2f6db5"; g.fill();
    g.fillStyle = "#dbe8f5"; g.fillRect(2.5, 2.3, 7, 1.4);
  });
}

// A stable 0..1 hash of a string and a number (load time only).
function hash(str, k) {
  let h = 2166136261 ^ k;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// --- polyline helpers (load time only) --------------------------------------------------------------------------
function chaikin(pts, n = 2) {
  let p = pts;
  for (let it = 0; it < n; it++) {
    const q = [p[0]];
    for (let k = 0; k < p.length - 1; k++) {
      const [x0, y0] = p[k], [x1, y1] = p[k + 1];
      q.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1], [0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}
function polyline(pts) {
  const n = pts.length, xy = new Float64Array(2 * n), cum = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    xy[2 * k] = pts[k][0]; xy[2 * k + 1] = pts[k][1];
    if (k) cum[k] = cum[k - 1] + Math.hypot(xy[2 * k] - xy[2 * k - 2], xy[2 * k + 1] - xy[2 * k - 1]);
  }
  return { xy, cum, len: cum[n - 1] || 1, n };
}

// Scratch output of the samplers (no arrays returned per frame).
let PX = 0, PY = 0, DX = 1, DY = 0, SEG = 0;
function atLen(pl, d) {
  const { xy, cum, n } = pl;
  d = Math.max(0, Math.min(pl.len, d));
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
  const L = cum[hi] - cum[lo] || 1, u = (d - cum[lo]) / L;
  const x0 = xy[2 * lo], y0 = xy[2 * lo + 1], x1 = xy[2 * hi], y1 = xy[2 * hi + 1];
  PX = x0 + (x1 - x0) * u; PY = y0 + (y1 - y0) * u; DX = (x1 - x0) / L; DY = (y1 - y0) / L; SEG = lo;
}
function bez(r, u) {
  const a = 1 - u;
  PX = a * a * r.p0[0] + 2 * a * u * r.c[0] + u * u * r.p1[0];
  PY = a * a * r.p0[1] + 2 * a * u * r.c[1] + u * u * r.p1[1];
  DX = 2 * (a * (r.c[0] - r.p0[0]) + u * (r.p1[0] - r.c[0]));
  DY = 2 * (a * (r.c[1] - r.p0[1]) + u * (r.p1[1] - r.c[1]));
}

export function install(app) {
  const M = app.motion;
  if (!M?.register) return;
  let on = true; // on by default everywhere (Anh, 2026-11-28: no battery saving); a switch in the Map panel
  let model = null, loading = false;

  // Live positions of the sprites drawn last frame, for hover: x, y, radius (world), kind index into `who`.
  const hx = new Float32Array(MAX), hy = new Float32Array(MAX), hr = new Float32Array(MAX);
  const who = new Array(MAX).fill(null);
  let nHit = 0;
  // Planes that drew this frame (for the batched contrails).
  const tp = new Int16Array(MAX), tu = new Float32Array(MAX), ta = new Float32Array(MAX);

  function build(d) {
    const w = app.w, grid = w.grid;
    const land = (x, y) => { const c = grid.cellAt(x, y); return c >= 0 && w.water[c] === 0; };
    const sprites = [];
    for (const r of d.air || []) {
      const n = r.international ? Math.min(2, r.airlines || 1) : Math.min(4, (r.airlines || 1) + (r.rank <= 3 ? 1 : 0)); // fewer on the international arcs
      const T = 10 + (r.dist_km || 500) / 45; // seconds per flight, illustrative
      const len = Math.hypot(r.p1[0] - r.p0[0], r.p1[1] - r.p0[1]) * 1.05;
      for (let j = 0; j < n; j++) {
        const back = j % 2 === 1;
        sprites.push({ kind: "plane", r, T, len, phase: (j / n + r.rank * 0.137) % 1, back,
          label: back ? `${r.airport_b} → ${r.airport_a}` : `${r.airport_a} → ${r.airport_b}` });
      }
    }
    for (const s of d.sea || []) {
      const pl = polyline(chaikin(s.pts));
      const landSeg = new Uint8Array(pl.n);
      if (s.land_hexes > 0) for (let k = 0; k < pl.n - 1; k++) landSeg[k] = land((pl.xy[2 * k] + pl.xy[2 * k + 2]) / 2, (pl.xy[2 * k + 1] + pl.xy[2 * k + 3]) / 2) ? 1 : 0;
      let seaFrom = 0; // arc length where the last river (land) stretch ends
      for (let k = 0; k < pl.n - 1; k++) if (landSeg[k]) seaFrom = pl.cum[k + 1];
      const n = SHIP_COUNT[s.class] || 1;
      for (let j = 0; j < n; j++) {
        // Lanes of one port area share their seaward stretch: vary speed, phase and a sideways offset per ship so
        // they do not sail in a single file.
        const h = hash(s.port, j), T = pl.len / (SPEED_SHIP * (0.75 + 0.5 * h));
        sprites.push({ kind: "ship", s, pl, landSeg, seaFrom, T, phase: (j / n + hash(s.port, j + 9)) * 2.3, side: (hash(s.port, j + 5) - 0.5) * 1.6 * w.grid.R, size: SHIP_SIZE[s.class] || 0.62,
          label: s.seaport && s.seaport !== s.name ? `${s.seaport} · ${s.name}` : s.name });
      }
    }
    for (const r of d.rail || []) {
      const pl = polyline(chaikin(r.pts));
      const n = r.kind === "main" ? 6 : 2, T = pl.len / SPEED_TRAIN;
      for (let j = 0; j < n; j++) {
        sprites.push({ kind: "train", r, pl, T, phase: (j / n) * 2, main: r.kind === "main",
          label: r.id === "north_south" ? t("North–South railway") : t("Railway {a} – {b}", { a: r.from, b: r.to }) });
      }
    }
    sprites.length = Math.min(sprites.length, MAX);
    // One bounding box per route (a Bézier stays inside its control points' hull), for active().
    const boxes = [];
    const box = (xs, ys) => boxes.push(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    for (const r of d.air || []) box([r.p0[0], r.c[0], r.p1[0]], [r.p0[1], r.c[1], r.p1[1]]);
    for (const r of [...(d.sea || []), ...(d.rail || [])]) box(r.pts.map((p) => p[0]), r.pts.map((p) => p[1]));
    makeSprites();
    return { sprites, boxes: new Float64Array(boxes) };
  }
  function ensure() {
    if (model || loading) return;
    loading = true;
    app.loadData("motion_routes").then((d) => {
      if (d?.air) { model = build(d); app.requestDraw(); }
    }).catch((e) => console.error("traffic: motion_routes", e));
  }

  // Draw one sprite centred at world (x, y), heading (dx, dy), css width wpx; ctx in screen device px for this call.
  function stamp(ctx, img, x, y, dx, dy, wpx, cam, dpr, alpha) {
    const s = cam.scale, L = Math.hypot(dx, dy) || 1, c = dx / L, si = dy / L;
    const sx = dpr * (cam.w / 2 + (x - cam.x) * s), sy = dpr * (cam.h / 2 + (y - cam.y) * s);
    const h = (wpx * img.height) / img.width;
    ctx.globalAlpha = alpha;
    ctx.setTransform(dpr * c, dpr * si, -dpr * si, dpr * c, sx, sy);
    ctx.drawImage(img, -wpx / 2, -h / 2, wpx, h);
  }
  function remember(x, y, r, sp) {
    if (nHit >= MAX) return;
    hx[nHit] = x; hy[nHit] = y; hr[nHit] = r; who[nHit] = sp; nHit++;
  }

  function draw(ctx, cam, f, tm) {
    nHit = 0;
    if (f.still || !model) return;
    const s = cam.scale, Rpx = app.w.grid.R * s, dpr = f.dpr;
    const zoom = Math.min(2.2, Math.max(1, Math.sqrt(Rpx / 2.3)));
    const v = cam.view(), pad = 40 / s;
    const inView = (x, y) => x > v.x0 - pad && x < v.x1 + pad && y > v.y0 - pad && y < v.y1 + pad;
    const detail = Rpx >= 3; // zoom gate: contrails, full trains
    const sp = model.sprites;
    let nT = 0, drawn = 0;
    ctx.imageSmoothingEnabled = true;
    for (let i = 0; i < sp.length; i++) {
      if (f.lowPower && (i & 1)) continue; // over budget on this device: half the sprites
      const o = sp[i];
      if (o.kind === "plane") {
        let u = ((tm / o.T + o.phase) % 1) * 1.12; // 12% of the cycle on the ground
        if (u > 1) continue;
        const a = Math.min(1, u / 0.04, (1 - u) / 0.04);
        if (o.back) u = 1 - u;
        bez(o.r, u);
        if (!inView(PX, PY)) continue;
        const wpx = PLANE_PX * zoom;
        stamp(ctx, SPR.plane, PX, PY, o.back ? -DX : DX, o.back ? -DY : DY, wpx, cam, dpr, a);
        remember(PX, PY, (wpx * 0.6) / s, o);
        if (detail && !f.moving && nT < MAX) { tp[nT] = i; tu[nT] = u; ta[nT] = a; nT++; }
      } else if (o.kind === "ship") {
        // out to sea and back: 0..1 out, 1..1.1 turn at sea, 1.1..2.1 back, 2.1..2.3 in port
        const T = o.T, c = ((tm / T + o.phase) % 2.3 + 2.3) % 2.3;
        if (c > 2.1) continue;
        const out = c <= 1.05, u = out ? Math.min(1, c) : Math.max(0, 2.1 - c);
        const dist = u * o.pl.len;
        atLen(o.pl, dist);
        // leave the berth (or the river) in line, spread out at sea
        const side = o.side * Math.max(0, Math.min(1, (dist - o.seaFrom) / (3 * app.w.grid.R)));
        PX -= DY * side; PY += DX * side;
        if (!inView(PX, PY)) continue;
        const river = o.landSeg[SEG] === 1;
        const a = Math.min(1, c / 0.05, (2.1 - c) / 0.05) * (river ? 0.6 : 1); // river stretches fade (barges)
        const wpx = (river ? SHIP_PX * 0.8 : SHIP_PX * o.size) * zoom;
        stamp(ctx, river ? SPR.barge : SPR.ship, PX, PY, out ? DX : -DX, out ? DY : -DY, wpx, cam, dpr, a);
        remember(PX, PY, (wpx * 0.7) / s, o);
      } else {
        const c = (tm / o.T + o.phase) % 2, fwd = c < 1, u = fwd ? c : 2 - c;
        const pl = o.pl, head = u * pl.len, carW = (CAR_PX * zoom) / s, sgn = fwd ? 1 : -1;
        atLen(pl, head);
        if (!inView(PX, PY)) continue;
        const cars = detail ? (o.main ? 5 : 4) : 2;
        const a = Math.min(1, Math.min(head, pl.len - head) / (carW * cars) + 0.1); // fades in and out at the ends
        for (let k = cars - 1; k >= 0; k--) {
          atLen(pl, head - sgn * (k + 0.5) * carW * 1.05);
          stamp(ctx, k ? SPR.car : SPR.loco, PX, PY, sgn * DX, sgn * DY, CAR_PX * zoom * 1.05, cam, dpr, a);
        }
        atLen(pl, head);
        remember(PX, PY, (CAR_PX * zoom * 1.5) / s, o);
      }
      if (++drawn >= MAX) break;
    }
    // Contrails, batched by fade step: one stroke per step for all planes (no per-plane gradient).
    if (nT) {
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (cam.w / 2 - cam.x * s), dpr * (cam.h / 2 - cam.y * s));
      ctx.strokeStyle = "#ffffff";
      ctx.lineCap = "round";
      ctx.lineWidth = (1.6 * zoom) / s;
      for (let k = 0; k < TRAIL; k++) {
        ctx.globalAlpha = 0.42 * (1 - k / TRAIL);
        ctx.beginPath();
        for (let j = 0; j < nT; j++) {
          const o = sp[tp[j]], step = Math.min(0.016, (28 * zoom) / s / o.len) / TRAIL * (o.back ? -1 : 1);
          const u0 = tu[j] - step * (k + 0.6), u1 = u0 - step;
          if (u1 < 0 || u1 > 1) continue;
          bez(o.r, u0); ctx.moveTo(PX, PY);
          bez(o.r, u1); ctx.lineTo(PX, PY);
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
  // Something of ours may be on screen: a route's box meets the view (padded by a sprite).
  function anyVisible() {
    const v = app.cam.view(), b = model.boxes, pad = 40 / app.cam.scale;
    for (let k = 0; k < b.length; k += 4) {
      if (b[k] < v.x1 + pad && b[k + 2] > v.x0 - pad && b[k + 1] < v.y1 + pad && b[k + 3] > v.y0 - pad) return true;
    }
    return false;
  }

  const perf = app.perf ? (app.perf.traffic = []) : [];
  // Battery (same policy as the Living map, ext/motion/index.js): frames capped at 30 fps and paused
  // after a minute without input. Between capped frames active() is false so the loop idles; a timer asks for the
  // next frame ~8 ms early and re-checks when it fires (a frame drawn meanwhile by something else counts). Frames the
  // app draws anyway still show the traffic at its own clock, which stops while paused: glyphs hold still.
  const cap = M.frameCap(1000 / 30);
  let clock = 0, clockAt = 0;
  // Before the data arrives: true, so draw() runs and loads it; then only while a route is on screen.
  const running = () => on && (!model || anyVisible()) && !M.idle;
  M.register({
    id: "motion-traffic", z: 88,
    active: () => running() && cap.due(),
    draw(ctx, cam, a, f) {
      if (!on) { nHit = 0; return; }
      ensure();
      const now = performance.now();
      if (running()) { clock += clockAt ? Math.min(now - clockAt, 250) : 0; clockAt = now; } else clockAt = 0;
      cap.drew();
      draw(ctx, cam, f, clock / 1000);
      if (!f.still && perf.push(performance.now() - now) > 240) perf.shift();
    },
  });

  // Hover: a static layer that draws nothing and hit-tests the sprites drawn last frame.
  app.registerStaticLayer({
    id: "traffic", z: 95, snapshot: false,
    visible: () => on,
    draw() {},
    hit(x, y) {
      if (!M.enabled) return null;
      let best = null, bd = Infinity;
      for (let k = 0; k < nHit; k++) {
        const d = (x - hx[k]) ** 2 + (y - hy[k]) ** 2;
        if (d <= hr[k] * hr[k] && d < bd) { bd = d; best = who[k]; }
      }
      return best;
    },
    tooltip: (o) => `<b>${esc(o.label)}</b><br><span class="muted">${esc(t(NOTE[o.kind]))}</span>`,
  });

  // Debugging handle: the sprites drawn last frame (world km), e.g. to hover one from a test.
  app.traffic = { drawn: () => nHit, at: (k) => (k < nHit ? { x: hx[k], y: hy[k], label: who[k].label, kind: who[k].kind } : null) };

  app.ui?.addMapToggle?.({
    id: "traffic", group: "transport", icon: "✈️", default: true,
    label: t("Moving traffic"),
    title: t("Planes on the air routes, ships at the seaports and trains on the railways. Illustrative, not a flight schedule; air routes from Wikipedia's airport articles (2026). Ship and train frequency are illustrative too. Off with Effects off or reduced motion."),
    get: () => on,
    set: (v) => { on = !!v; app.requestDraw(); },
  });
}
