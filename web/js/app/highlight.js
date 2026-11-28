// The search marker: after a search pick the place is marked on the map until the next pick, Esc or a click on the
// map. A pin with a pulsing ring and a floating name; a province's outline glows; a river (a polyline) glows along
// its course. Drawn as an app.motion item above the city banners (z 150): the ring pulses at a capped frame rate
// (30 fps) and holds still after a minute without input, when Effects are off or with reduced motion
// (a still ring, the same information). Public as app.highlight(spec) / app.highlight(null) (main.js).
import { stateOutline } from "../world.js";

const PERIOD_S = 1.8;
const LABEL_FONT = '600 14px "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';

/**
 * deps: {motion (app.motion), cam, w (prepared world), isMobile(), requestDraw(), bannerShown(city) → bool}
 * set(spec) → bool: spec = {x, y} | {line: [[x, y], …]} | {state: index} | {city: {cell, name}}, plus label?
 * clear() → bool (true if something was shown). marks: a counter that changes on every set / clear.
 */
export function createSearchHighlight({ motion, cam, w, isMobile, requestDraw, bannerShown }) {
  const grid = w.grid;
  let h = null, marks = 0, lastPhase = 0;
  const cap = motion.frameCap(1000 / 30);

  // A province's marker: the owned (mainland) cell nearest the middle of its cells, so it always lands inside.
  function stateAnchor(idx) {
    const own = w.raw.owner, remote = new Set(w.raw.remote || []);
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < grid.size; i++) if (own[i] === idx && !remote.has(i)) { sx += grid.cx(i); sy += grid.cy(i); n++; }
    if (!n) return null;
    const mx = sx / n, my = sy / n;
    let best = -1, bd = Infinity;
    for (let i = 0; i < grid.size; i++) {
      if (own[i] !== idx || remote.has(i)) continue;
      const d = (grid.cx(i) - mx) ** 2 + (grid.cy(i) - my) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return [grid.cx(best), grid.cy(best)];
  }

  function set(spec) {
    if (!spec) return clear();
    const o = { label: String(spec.label ?? ""), t0: performance.now() };
    const fin = (v) => Number.isFinite(+v);
    if (spec.city && spec.city.cell != null) {
      o.city = spec.city;
      o.x = grid.cx(spec.city.cell);
      o.y = grid.cy(spec.city.cell);
      o.label ||= spec.city.name || "";
    } else if (Number.isInteger(spec.state) && w.raw.states[spec.state]) {
      const a = stateAnchor(spec.state);
      if (!a) return false;
      o.state = spec.state;
      [o.x, o.y] = a;
    } else if (Array.isArray(spec.line)) {
      const pts = spec.line.filter((p) => Array.isArray(p) && fin(p[0]) && fin(p[1]));
      if (pts.length < 2) return false;
      o.path = new Path2D();
      pts.forEach(([x, y], k) => (k ? o.path.lineTo(+x, +y) : o.path.moveTo(+x, +y)));
      [o.x, o.y] = pts[pts.length >> 1].map(Number); // the name sits on the middle of the course
    } else if (fin(spec.x) && fin(spec.y)) {
      o.x = +spec.x;
      o.y = +spec.y;
    } else return false;
    h = o;
    marks++;
    requestDraw();
    return true;
  }

  function clear() {
    if (!h) return false;
    h = null;
    marks++;
    requestDraw();
    return true;
  }

  const onScreen = () => {
    if (!h) return false;
    if (h.state != null || h.path) return true; // an outline can be on screen while its marker is not
    const v = cam.view(), m = 60 / cam.scale;
    return h.x > v.x0 - m && h.x < v.x1 + m && h.y > v.y0 - m && h.y < v.y1 + m;
  };

  motion.register({
    id: "search-highlight", z: 150,
    active: () => !!h && !motion.idle && onScreen() && cap.due(),
    draw(ctx, camera, app, f) {
      if (!h) return;
      let p = -1; // pulse phase 0..1, or -1 for the still frame
      if (f.active) {
        cap.drew();
        p = lastPhase = (((performance.now() - h.t0) / 1000) / PERIOD_S) % 1;
      } else if (!f.still && !motion.idle) p = lastPhase; // a frame drawn by something else between capped frames
      const glow = p < 0 ? 0.7 : 0.55 + 0.45 * Math.sin(p * Math.PI * 2);
      const s = camera.scale;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      const outline = h.state != null ? stateOutline(w, h.state).path : h.path;
      if (outline) {
        // A wide soft glow under a crisp bright line (in world km; widths in screen px / scale).
        ctx.strokeStyle = `rgba(255,190,70,${0.22 * glow})`;
        ctx.lineWidth = 16 / s;
        ctx.stroke(outline);
        ctx.strokeStyle = `rgba(255,214,120,${0.45 * glow + 0.1})`;
        ctx.lineWidth = 7 / s;
        ctx.stroke(outline);
        ctx.strokeStyle = h.path ? "#bfe8ff" : "#fff1c4";
        ctx.lineWidth = (h.path ? 3 : 2.4) / s;
        ctx.stroke(outline);
      }
      // Screen space for the ring, pin and name.
      const [sx, sy] = camera.toScreen(h.x, h.y);
      if (sx < -80 || sy < -80 || sx > f.cssW + 80 || sy > f.cssH + 80) return;
      ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
      const ring = (r, a, lw = 2.5) => {
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(20,12,4,${0.55 * a})`;
        ctx.lineWidth = lw + 2;
        ctx.stroke();
        ctx.strokeStyle = `rgba(255,226,140,${a})`;
        ctx.lineWidth = lw;
        ctx.stroke();
      };
      if (p < 0) { ring(17, 0.95); ring(27, 0.4, 1.5); } else for (const q of [p, (p + 0.5) % 1]) ring(9 + 26 * q, 0.95 * (1 - q) ** 1.3);
      const banner = h.city && bannerShown?.(h.city); // the city's banner already names it and stands where a pin would
      if (!banner) drawPin(ctx, sx, sy);
      if (h.label && !banner) drawLabel(ctx, h.label, sx, sy, f.cssW);
    },
  });

  return { set, clear, get current() { return h; }, get marks() { return marks; } };
}

function drawPin(ctx, x, y) {
  ctx.beginPath(); // the shadow on the ground
  ctx.ellipse(x, y, 6, 2.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.fill();
  const top = y - 22;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x - 2.5, y - 7, x - 9, y - 13, x - 9, top);
  ctx.arc(x, top, 9, Math.PI, 0);
  ctx.bezierCurveTo(x + 9, y - 13, x + 2.5, y - 7, x, y);
  ctx.fillStyle = "#d8402f";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#2a1406";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, top, 3.6, 0, Math.PI * 2);
  ctx.fillStyle = "#ffe9a8";
  ctx.fill();
}

function drawLabel(ctx, text, x, y, cssW) {
  ctx.font = LABEL_FONT;
  const tw = ctx.measureText(text).width, pw = tw + 18, ph = 24;
  let ly = y - 38 - ph; // above the pin; below the place when that would run under the top bar
  if (ly < 46) ly = y + 12;
  const lx = Math.max(6, Math.min(cssW - pw - 6, x - pw / 2));
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(lx, ly, pw, ph, 12) : ctx.rect(lx, ly, pw, ph);
  ctx.fillStyle = "rgba(16,25,35,.94)";
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = "#ecd08e";
  ctx.stroke();
  ctx.fillStyle = "#ffe9a8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, lx + pw / 2, ly + ph / 2 + 0.5);
}
