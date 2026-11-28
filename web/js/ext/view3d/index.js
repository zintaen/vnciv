// "Nhìn 3D / 3D view": an optional tilted 2.5D view of the same hexes. A WebGL canvas covers the 2D map while it is
// on; every cell is an extruded hex prism, drawn with two instanced draw calls
// (water tops, then land prisms; WebGL2, or WebGL1 +
// ANGLE_instanced_arrays). Height = elevation (terrain view) or the shown lens's value on its colour scale; colours
// are w.rgb, i.e. exactly the 2D map's. Water is flat, with a slow shimmer while Effects are on. Hover picks by a ray
// march over the grid (no GPU read-back) and shows the same cell tooltip as 2D. Esc or the button leaves; hash `view3d=1`.
// No WebGL → no button. Buffers are rebuilt only when w.rgb changes (lens, band, year view).
import { t } from "../../i18n.js";
import { showCellTooltip, hideTooltip } from "../../ui/tooltip.js";
import { lensScale } from "../../world.js";
import { OCEAN_BG } from "../../render/map.js";
import { esc } from "../../format.js";

const FOV = Math.PI / 4;
const TILT = 0.92; // pitch of the tilted view (rad above the horizon; π/2 = straight down like 2D)
const FLAT = Math.PI / 2 - 1e-3;
const ELEV_X = 40; // vertical exaggeration of elevation (m → map units: / 200 m per unit)
const LENS_H = 520; // map units (104 km) at the top of a lens's colour scale
const LENS_MIN = 6; // a hex at the bottom of the scale (or without data) still reads as land
const ENTER_MS = 1000, EXIT_MS = 650, GROW_MS = 450;

const VS = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aInst; attribute float aH; attribute vec4 aCol;
uniform mat4 uVP; uniform float uK; uniform float uT;
varying vec3 vCol;
void main() {
  vec3 p = vec3(aInst.x + aPos.x, aPos.z * aH * uK, aInst.y + aPos.y);
  gl_Position = uVP * vec4(p, 1.0);
  vec3 L = normalize(vec3(-0.45, 0.85, -0.35));
  float d = 0.6 + 0.4 * max(dot(aNrm, L), 0.0);
  if (aNrm.y < 0.5 && aPos.z < 0.5) d *= 0.72; // darker foot of every wall: cheap ambient occlusion
  vec3 c = aCol.rgb;
  if (aCol.a > 0.5) c *= 1.0 + 0.07 * sin(uT * 0.9 + aInst.x * 0.011 + aInst.y * 0.007) * sin(uT * 0.6 - aInst.x * 0.005 + aInst.y * 0.013);
  vCol = c * d;
}`;
const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vCol;
void main() { gl_FragColor = vec4(vCol, 1.0); }`;

// --- tiny column-major mat4 helpers --------------------------------------------------------------------------------
function perspective(o, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  o.fill(0);
  o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = 2 * far * near * nf;
  return o;
}
function lookAt(o, e, c, u) {
  let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
  let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
  let xx = u[1] * zz - u[2] * zy, xy = u[2] * zx - u[0] * zz, xz = u[0] * zy - u[1] * zx;
  l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
  o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
  o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
  o[12] = -(xx * e[0] + xy * e[1] + xz * e[2]); o[13] = -(yx * e[0] + yy * e[1] + yz * e[2]); o[14] = -(zx * e[0] + zy * e[1] + zz * e[2]); o[15] = 1;
  return o;
}
function mul(o, a, b) {
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    o[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
  }
  return o;
}
const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const lerp = (a, b, p) => a + (b - a) * p;

function getGL(canvas) {
  const opts = { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: "high-performance" };
  const gl2 = canvas.getContext("webgl2", opts);
  if (gl2) {
    return { gl: gl2, version: 2, divisor: (l, d) => gl2.vertexAttribDivisor(l, d), drawInst: (m, f, n, k) => gl2.drawArraysInstanced(m, f, n, k) };
  }
  const gl = canvas.getContext("webgl", opts) || canvas.getContext("experimental-webgl", opts);
  const ext = gl?.getExtension("ANGLE_instanced_arrays");
  if (!ext) return null;
  return { gl, version: 1, divisor: (l, d) => ext.vertexAttribDivisorANGLE(l, d), drawInst: (m, f, n, k) => ext.drawArraysInstancedANGLE(m, f, n, k) };
}

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    // A software renderer (SwiftShader, llvmpipe: no usable GPU) draws this at a few frames per minute (measured
    // 6.7 s per frame), so it counts as no WebGL. failIfMajorPerformanceCaveat catches some; the renderer name the rest.
    const o = { failIfMajorPerformanceCaveat: true };
    const gl2 = c.getContext("webgl2", o), gl = gl2 || c.getContext("webgl", o);
    if (!gl || (!gl2 && !gl.getExtension("ANGLE_instanced_arrays"))) return false;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return !/swiftshader|llvmpipe|software/i.test(name);
  } catch { return false; }
}

const CSS = `
#view3d { position: fixed; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
#view3d.dragging { cursor: grabbing; }
#view3d-labels { position: fixed; inset: 0; pointer-events: none; overflow: hidden; z-index: 1; }
#view3d-labels span { position: absolute; left: 0; top: 0; white-space: nowrap; font: 600 11.5px/1.2 system-ui, sans-serif; color: #fff;
  padding: 1px 5px; border-radius: 4px; background: rgba(12, 24, 38, .72); transform-origin: 50% 100%; will-change: transform; }
#view3d-labels span.cap { background: rgba(150, 30, 30, .85); }
#view3d-panel { position: fixed; top: calc(var(--topbar-h, 48px) + 8px); left: 50%; transform: translateX(-50%); z-index: 11;
  width: min(560px, calc(100vw - 32px)); padding: 8px 10px; display: flex; gap: 10px; align-items: flex-start; font-size: 12.5px; line-height: 1.35; }
#view3d-panel .v3-text { flex: 1; min-width: 0; }
#view3d-panel .v3-hint { opacity: .7; font-size: 11.5px; margin-top: 2px; }
#view3d-panel .v3-btns { display: flex; gap: 6px; flex: none; }
#btn-view3d[aria-pressed="true"] { outline: 2px solid #e2b23a; outline-offset: -2px; }
@media (max-width: 700px) { /* below the timeline bar; text full width, buttons under it */
  #view3d-panel { top: calc(var(--topbar-h, 48px) + 46px); font-size: 11.5px; padding: 6px 8px; flex-direction: column; gap: 6px; }
  #view3d-panel .v3-hint { display: none; } }
`;

export function install(app) {
  if (!webglAvailable()) return; // no WebGL: no button, the 2D map is all there is
  const w = app.w, g = w.grid, n = g.size;
  const M = app.motion;
  const perf = app.perf ? (app.perf.view3d = []) : []; // ms of CPU per 3D frame (window.__app.perf.view3d)

  let on = false, canvas = null, ctxGL = null, prog = null, loc = null, labelsEl = null, panel = null, raf = 0;
  let bufGeo, bufInst, bufH, bufCol, maxH = 1, order = null, nWater = 0, bindInst = null;
  let slowAvg = 16, lastNow = 0, slow = false, heights = null, lastRgb = null, lastLens = undefined, dirty = true, hover = null;
  // camera: target on the ground (map units), distance, yaw (0 = north up), pitch; k = height factor (0 flat .. 1)
  const camS = { tx: 0, ty: 0, d: 1000, yaw: 0, pitch: FLAT, k: 0 };
  let home = null; // the tilted framing on entry (Reset goes back to it)
  let anim = null; // {from, to, t0, ms, done}
  let grow = null; // {t0}: heights re-grow after a lens change
  const P = new Float32Array(16), V = new Float32Array(16), VP = new Float32Array(16);
  const eye = [0, 0, 0], ctr = [0, 0, 0], up = [0, 1, 0];

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const btn = app.ui?.addTopButton?.({ id: "btn-view3d", icon: "🧊", label: t("3D view"), title: t("Tilted 3D view: hexes rise with elevation, or with the lens's values (Esc leaves)"), onClick: () => toggle() });
  btn?.setAttribute("aria-pressed", "false");

  // --- data → GPU -------------------------------------------------------------------------------------------------
  function heightsFor(lens) {
    const h = new Float32Array(n), own = w.raw.owner, elev = w.raw.elev;
    const numeric = lens && lens.format !== "category";
    const sc = numeric ? lensScale(lens) : null;
    for (let i = 0; i < n; i++) {
      if (w.water[i]) continue; // water: flat
      if (!lens || own[i] < 0 && !numeric) h[i] = Math.max(1, (elev[i] / 200) * ELEV_X); // terrain view (neighbours too)
      else if (own[i] < 0) h[i] = 1; // neighbouring countries carry no lens value: flat
      else if (!numeric) h[i] = LENS_MIN;
      else {
        const v = lens.values[i];
        const tv = v == null ? 0 : Math.min(1, Math.max(0, sc(v)));
        h[i] = LENS_MIN + tv * LENS_H;
      }
    }
    return h;
  }
  function upload() {
    const { gl } = ctxGL, lens = app.shownLens?.() || null;
    const col = new Uint8Array(n * 4), hs = new Float32Array(n);
    heights = heightsFor(lens);
    for (let k = 0; k < n; k++) {
      const i = order[k], c = w.rgb[i];
      col[k * 4] = c[0]; col[k * 4 + 1] = c[1]; col[k * 4 + 2] = c[2]; col[k * 4 + 3] = w.water[i] ? 255 : 0;
      hs[k] = heights[i];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, bufCol); gl.bufferData(gl.ARRAY_BUFFER, col, gl.STATIC_DRAW);
    maxH = heights.reduce((m, v) => (v > m ? v : m), 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufH); gl.bufferData(gl.ARRAY_BUFFER, hs, gl.STATIC_DRAW);
    if (lastLens !== undefined && lens?.id !== lastLens?.id) grow = { t0: performance.now() };
    lastRgb = w.rgb; lastLens = lens;
    renderPanel();
  }

  function initGL() {
    canvas = document.createElement("canvas");
    canvas.id = "view3d";
    canvas.style.background = OCEAN_BG;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", t("3D view of the hex map"));
    ctxGL = getGL(canvas);
    if (!ctxGL) { btn?.remove(); return false; }
    const { gl } = ctxGL;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    loc = {};
    for (const a of ["aPos", "aNrm", "aInst", "aH", "aCol"]) loc[a] = gl.getAttribLocation(prog, a);
    for (const u of ["uVP", "uK", "uT"]) loc[u] = gl.getUniformLocation(prog, u);

    // One prism: the top as 4 triangles + 6 walls (2 triangles each) = 48 vertices of [x, y, up01, nx, ny, nz].
    const cs = g.corners, geo = [];
    const vtx = (c, z, nx, ny, nz) => geo.push(cs[c][0], cs[c][1], z, nx, ny, nz);
    for (let k = 1; k < 5; k++) { vtx(0, 1, 0, 1, 0); vtx(k + 1, 1, 0, 1, 0); vtx(k, 1, 0, 1, 0); }
    for (let k = 0; k < 6; k++) {
      const a = k, b = (k + 1) % 6, mx = (cs[a][0] + cs[b][0]) / 2, my = (cs[a][1] + cs[b][1]) / 2, l = Math.hypot(mx, my);
      const nx = mx / l, nz = my / l; // GL x = map x, GL z = map y
      vtx(a, 0, nx, 0, nz); vtx(b, 1, nx, 0, nz); vtx(b, 0, nx, 0, nz); // counter-clockwise seen from outside
      vtx(a, 0, nx, 0, nz); vtx(a, 1, nx, 0, nz); vtx(b, 1, nx, 0, nz);
    }
    // Instances in a fixed order: the nWater water hexes first (drawn as flat tops only), then the rest.
    order = new Uint32Array(n);
    let a = 0;
    for (let i = 0; i < n; i++) if (w.water[i]) order[a++] = i;
    nWater = a;
    for (let i = 0; i < n; i++) if (!w.water[i]) order[a++] = i;
    const inst = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) { inst[k * 2] = g.cx(order[k]); inst[k * 2 + 1] = g.cy(order[k]); }
    bufGeo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufGeo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geo), gl.STATIC_DRAW);
    bufInst = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufInst); gl.bufferData(gl.ARRAY_BUFFER, inst, gl.STATIC_DRAW);
    bufH = gl.createBuffer(); bufCol = gl.createBuffer();

    gl.useProgram(prog);
    const attr = (buf, l, size, type, norm, stride, off, div) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, size, type, norm, stride, off);
      ctxGL.divisor(l, div);
    };
    attr(bufGeo, loc.aPos, 3, gl.FLOAT, false, 24, 0, 0);
    attr(bufGeo, loc.aNrm, 3, gl.FLOAT, false, 24, 12, 0);
    bindInst = (k) => { // per-instance attributes starting at instance k (WebGL has no base instance)
      attr(bufInst, loc.aInst, 2, gl.FLOAT, false, 8, k * 8, 1);
      attr(bufH, loc.aH, 1, gl.FLOAT, false, 4, k * 4, 1);
      attr(bufCol, loc.aCol, 4, gl.UNSIGNED_BYTE, true, 4, k * 4, 1);
    };
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0, 0, 0, 0);

    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); exit(true); ctxGL = null; canvas.remove(); canvas = null; });
    wirePointer();
    labelsEl = document.createElement("div");
    labelsEl.id = "view3d-labels";
    labelsEl.setAttribute("aria-hidden", "true");
    const seats = [...(app.data.cities || [])].filter((c) => c.cell != null)
      .sort((a, b) => (b.capital - a.capital) || (b.population || 0) - (a.population || 0));
    for (const c of seats) {
      const s = document.createElement("span");
      s.textContent = c.name;
      if (c.capital) s.className = "cap";
      s._c = c; s._wpx = c.name.length * 6.6 + 12;
      labelsEl.appendChild(s);
    }
    panel = document.createElement("div");
    panel.id = "view3d-panel";
    panel.className = "panel";
    panel.setAttribute("role", "note");
    return true;
  }

  // --- legend: what the height encodes ----------------------------------------------------------------------------
  function renderPanel() {
    if (!panel) return;
    const lens = app.shownLens?.() || null;
    let what;
    if (!lens) what = t("Height: the mean elevation of each hex (ETOPO1), exaggerated ×{n}. Colours: terrain, as in 2D. Water is flat.", { n: ELEV_X });
    else {
      const name = t(lens.name) + (lens.year ? ` (${lens.year})` : "");
      what = lens.format === "category"
        ? t("Height: none, {lens} is a category lens. Colours as in 2D.", { lens: name })
        : t(lens.scale === "log"
          ? "Height: {lens}, on the legend's colour scale (logarithmic): flat at its low end, tallest at its high end. Hexes without data and neighbouring countries are flat."
          : "Height: {lens}, on the legend's colour scale (linear): flat at its low end, tallest at its high end. Hexes without data and neighbouring countries are flat.", { lens: name });
    }
    panel.innerHTML = `<div class="v3-text"><div>${esc(what)}</div><div class="v3-hint">${esc(t("Drag to orbit and tilt, Shift-drag or right-drag (two fingers) to pan, wheel or pinch to zoom, double-click to centre."))}</div></div>
      <div class="v3-btns"><button type="button" class="btn v3-reset">${esc(t("Reset view"))}</button><button type="button" class="btn v3-exit">${esc(t("2D map"))}</button></div>`;
    panel.querySelector(".v3-reset").onclick = () => animateTo(home, 600);
    panel.querySelector(".v3-exit").onclick = () => exit();
  }

  // --- camera -----------------------------------------------------------------------------------------------------
  const distForScale = (scale) => (app.cam.h / scale) / 2 / Math.tan(FOV / 2);
  function matrices() {
    const { tx, ty, d, yaw, pitch } = camS;
    const cp = Math.cos(pitch), sp = Math.sin(pitch), sy = Math.sin(yaw), cy = Math.cos(yaw);
    eye[0] = tx + d * cp * sy; eye[1] = d * sp; eye[2] = ty + d * cp * cy;
    ctr[0] = tx; ctr[1] = 0; ctr[2] = ty;
    up[0] = -sp * sy; up[1] = cp; up[2] = -sp * cy; // the camera's own up: never parallel to the view direction
    const cw = canvas.width, ch = canvas.height;
    perspective(P, FOV, cw / ch, Math.max(5, d * 0.05), d * 6 + 15000);
    lookAt(V, eye, ctr, up);
    return mul(VP, P, V);
  }
  function animateTo(to, ms, done) {
    if (!M?.enabled) ms = 0; // reduced motion / Effects off: jump
    anim = { from: { ...camS }, to: { ...camS, ...to }, t0: performance.now(), ms, done };
    dirty = true;
    kick();
  }
  function stepAnim(now) {
    if (!anim) return;
    const p = anim.ms ? Math.min(1, (now - anim.t0) / anim.ms) : 1, e = ease(p);
    for (const k of ["tx", "ty", "d", "pitch", "k"]) camS[k] = lerp(anim.from[k], anim.to[k], e);
    let dy = anim.to.yaw - anim.from.yaw; // the short way round
    dy = ((dy + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    camS.yaw = anim.from.yaw + dy * e;
    dirty = true;
    if (p >= 1) { const d = anim.done; anim = null; d?.(); }
  }

  // --- frame ------------------------------------------------------------------------------------------------------
  function kick() { if (on && !raf) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    if (!on || !ctxGL) return;
    const t0 = performance.now();
    if (w.rgb !== lastRgb || (app.shownLens?.() || null) !== lastLens) { upload(); dirty = true; }
    stepAnim(now);
    // A slow device (back-to-back frames over ~45 ms on average) stops the water shimmer: it then draws only when something moves.
    // ponytail: one-way switch per session; a recovery check if devices that start slow get fast later.
    if (lastNow) slowAvg = slowAvg * 0.9 + Math.min(100, now - lastNow) * 0.1; // one hitch (a lens upload) cannot trip it
    lastNow = now;
    if (slowAvg > 45) slow = true;
    const live = M?.enabled && !slow; // water shimmer + growth only while motion is on
    let gk = 1;
    if (grow) { const p = live ? (now - grow.t0) / GROW_MS : 1; if (p >= 1) grow = null; else gk = ease(p); dirty = true; }
    if (dirty || live) draw(live ? now / 1000 : 0, gk); // still water when motion is off
    dirty = false;
    if (perf.push(performance.now() - t0) > 120) perf.shift();
    if (anim || grow || live) kick();
    else lastNow = 0; // idle: the next interval is not a frame time
  }
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const cw = Math.round(innerWidth * dpr), ch = Math.round(innerHeight * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; dirty = true; }
  }
  function draw(time, gk) {
    const { gl } = ctxGL;
    resize();
    matrices();
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.uVP, false, VP);
    gl.uniform1f(loc.uK, camS.k * gk);
    gl.uniform1f(loc.uT, time);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    bindInst(0);
    ctxGL.drawInst(gl.TRIANGLES, 0, 12, nWater); // water: the top only (4 triangles)
    bindInst(nWater);
    ctxGL.drawInst(gl.TRIANGLES, 0, 48, n - nWater); // land: top + 6 walls
    placeLabels(camS.k * gk);
  }

  // Picking by ray march: from the eye through the pixel, step ~R/4 across the ground; the first hex whose prism
  // top is above the ray there is the one under the pointer (walls of tall towers included, to within a step).
  function cellUnder(x, y) {
    if (!heights) return -1;
    const fx = ctr[0] - eye[0], fy = ctr[1] - eye[1], fz = ctr[2] - eye[2], fl = Math.hypot(fx, fy, fz);
    const f0 = fx / fl, f1 = fy / fl, f2 = fz / fl;
    const r0 = f1 * up[2] - f2 * up[1], r1 = f2 * up[0] - f0 * up[2], r2 = f0 * up[1] - f1 * up[0]; // right = f × up
    const th = Math.tan(FOV / 2), nx = (2 * x / innerWidth - 1) * th * innerWidth / innerHeight, ny = (1 - 2 * y / innerHeight) * th;
    const dx = f0 + r0 * nx + up[0] * ny, dy = f1 + r1 * nx + up[1] * ny, dz = f2 + r2 * nx + up[2] * ny;
    if (dy >= -1e-6) return -1; // at or above the horizon
    const top = maxH * camS.k, t1 = eye[1] / -dy;
    const dt = g.R / 4 / Math.max(1e-6, Math.hypot(dx, dz));
    for (let t = Math.max(0, (eye[1] - top) / -dy), k = 0; t < t1 && k < 40000; t += dt, k++) {
      const c = g.cellAt(eye[0] + dx * t, eye[2] + dz * t);
      if (c >= 0 && heights[c] * camS.k >= eye[1] + dy * t) return c;
    }
    return g.cellAt(eye[0] + dx * t1, eye[2] + dz * t1);
  }
  function hoverAt(x, y) {
    const cell = cellUnder(x, y);
    hover = cell >= 0 ? cell : null;
    if (cell >= 0) showCellTooltip(x, y, w, cell, app.shownLens?.() || null, app.state.showResources);
    else hideTooltip();
  }

  // Seat labels in screen space, biggest first; a label that would overlap a placed one is hidden.
  const placed = [];
  function placeLabels(H) {
    if (!labelsEl) return;
    const cssW = innerWidth, cssH = innerHeight, hs = heights;
    placed.length = 0;
    for (const s of labelsEl.children) {
      const c = s._c, x = g.cx(c.cell), z = g.cy(c.cell), y = (hs ? hs[c.cell] : 0) * H + 4;
      const cw4 = VP[3] * x + VP[7] * y + VP[11] * z + VP[15];
      let show = cw4 > 1;
      let sx = 0, sy = 0;
      if (show) {
        sx = ((VP[0] * x + VP[4] * y + VP[8] * z + VP[12]) / cw4 * 0.5 + 0.5) * cssW;
        sy = (0.5 - (VP[1] * x + VP[5] * y + VP[9] * z + VP[13]) / cw4 * 0.5) * cssH;
        const hw = s._wpx / 2;
        show = sx > -hw && sx < cssW + hw && sy > 0 && sy < cssH + 20;
        if (show) {
          for (let k = 0; k < placed.length; k += 4) {
            if (sx - hw < placed[k + 2] && sx + hw > placed[k] && sy - 18 < placed[k + 3] && sy > placed[k + 1]) { show = false; break; }
          }
        }
        if (show) placed.push(sx - hw, sy - 18, sx + hw, sy);
      }
      s.style.display = show ? "" : "none";
      if (show) s.style.transform = `translate(${(sx - s._wpx / 2) | 0}px, ${(sy - 18) | 0}px)`;
    }
  }

  // --- input ------------------------------------------------------------------------------------------------------
  function wirePointer() {
    const pts = new Map();
    let mode = null, lx = 0, ly = 0, pinch0 = null, downAt = null;
    const mid = () => { const a = [...pts.values()]; return [(a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2, Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y)]; };
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => {
      try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      anim = null;
      hideTooltip();
      if (pts.size === 2) { mode = "pinch"; pinch0 = mid(); }
      else { mode = e.shiftKey || e.button === 2 || e.button === 1 ? "pan" : "orbit"; lx = e.clientX; ly = e.clientY; downAt = [lx, ly]; }
      canvas.classList.add("dragging");
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) { hoverAt(e.clientX, e.clientY); return; }
      pts.get(e.pointerId).x = e.clientX; pts.get(e.pointerId).y = e.clientY;
      if (mode === "pinch" && pts.size === 2) {
        const [mx, my, dist] = mid();
        camS.d = clampD(camS.d * pinch0[2] / Math.max(1, dist));
        panBy(mx - pinch0[0], my - pinch0[1]);
        pinch0 = [mx, my, dist];
      } else if (mode === "orbit") {
        camS.yaw -= (e.clientX - lx) * 0.006;
        camS.pitch = Math.min(FLAT, Math.max(0.28, camS.pitch + (e.clientY - ly) * 0.005));
      } else if (mode === "pan") panBy(e.clientX - lx, e.clientY - ly);
      lx = e.clientX; ly = e.clientY;
      dirty = true; kick();
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      if (pts.size === 1) { const p = [...pts.values()][0]; mode = "orbit"; lx = p.x; ly = p.y; downAt = null; }
      if (!pts.size) {
        mode = null; canvas.classList.remove("dragging");
        // a click / tap without a drag opens the city or province under it, as in 2D (the tooltip says so)
        if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 6) {
          hoverAt(e.clientX, e.clientY);
          const city = hover != null ? w.cityByCell.get(hover) : null, o = hover != null ? w.raw.owner[hover] : -1;
          if (city) app.selectCity(city, { fly: false });
          else if (o >= 0) app.selectState(o, { fly: false });
        }
      }
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", () => { if (!pts.size) { hover = null; hideTooltip(); } });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      camS.d = clampD(camS.d * Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * 0.004));
      anim = null; dirty = true; kick();
    }, { passive: false });
    canvas.addEventListener("dblclick", (e) => {
      e.preventDefault();
      const cell = cellUnder(e.clientX, e.clientY);
      if (cell >= 0) animateTo({ tx: g.cx(cell), ty: g.cy(cell), d: camS.d * 0.6 }, 500);
    });
  }
  const clampD = (d) => Math.min(25000, Math.max(250, d));
  function panBy(dx, dy) {
    const k = (2 * camS.d * Math.tan(FOV / 2)) / innerHeight; // map units per css px at the target
    const s = Math.sin(camS.yaw), c = Math.cos(camS.yaw), f = 1 / Math.max(0.35, Math.sin(camS.pitch));
    camS.tx += -c * dx * k + -s * dy * k * f;
    camS.ty += s * dx * k + -c * dy * k * f;
  }

  // --- on / off ---------------------------------------------------------------------------------------------------
  // While 3D covers the map, the hidden 2D map's ambient motion (sea shimmer etc.) would keep drawing frames nobody
  // sees: pause app.motion's frame requests (app.motion.pause).


  function enter() {
    if (on) return;
    if (!canvas && !initGL()) return;
    on = true; M?.pause?.(true);
    const map = document.getElementById("map");
    map.insertAdjacentElement("afterend", canvas);
    canvas.insertAdjacentElement("afterend", labelsEl);
    document.body.appendChild(panel);
    hideTooltip();
    resize();
    const c = app.cam;
    Object.assign(camS, { tx: c.x, ty: c.y, d: distForScale(c.scale), yaw: 0, pitch: FLAT, k: 0 });
    home = { tx: c.x, ty: c.y + distForScale(c.scale) * 0.12, d: distForScale(c.scale) * 1.02, yaw: 0, pitch: TILT, k: 1 };
    lastLens = undefined; lastRgb = null; // force an upload (no grow animation on entry)
    btn?.setAttribute("aria-pressed", "true");
    document.body.classList.add("view3d-on");
    animateTo(home, ENTER_MS);
    (app.hash?.flush || app.hash?.update)?.();
  }
  function exit(now = false) {
    if (!on) return;
    // the 2D map takes over where the 3D camera points, at the matching zoom
    const c = app.cam;
    const scale = c.clampScale(c.h / (2 * camS.d * Math.tan(FOV / 2)));
    c.scale = scale; c.centerOn(camS.tx, camS.ty);
    app.requestDraw();
    hideTooltip();
    const finish = () => {
      on = false; M?.pause?.(false); anim = null;
      cancelAnimationFrame(raf); raf = 0;
      canvas?.remove(); labelsEl?.remove(); panel?.remove();
      btn?.setAttribute("aria-pressed", "false");
      document.body.classList.remove("view3d-on");
      app.requestDraw(); // resume the 2D loop (motion frames were paused)
      (app.hash?.flush || app.hash?.update)?.();
    };
    if (now === true || !ctxGL) finish();
    else animateTo({ pitch: FLAT, yaw: 0, k: 0 }, EXIT_MS, finish);
  }
  const toggle = () => (on ? exit() : enter());

  addEventListener("resize", () => { if (on) { dirty = true; kick(); } });
  app.on?.("escape", () => { if (on) { exit(); return true; } return false; });
  app.on?.("lens", () => { if (on) { dirty = true; kick(); } });
  M?.on?.("change", () => { if (on) { dirty = true; kick(); } });
  app.hash?.register?.("view3d", { get: () => (on ? "1" : null), set: (v) => (v === "1" ? enter() : exit(true)) });

  app.view3d = { enter, exit, get on() { return on; }, get camera() { return { ...camS }; }, get hover() { return hover; }, get gl() { return ctxGL?.version || 0; } };
}
