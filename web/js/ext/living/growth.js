// Cities grow with the year: GHSL built-up hexes by epoch (living_built.json, observed epochs 1975–2020 only) and
// expressways by opening year (living_roads.json). An overlay with cached paths (one fill per epoch group), so a
// year step or the ▶ replay never re-renders the static map.
import { hexAt } from "../../render/art/lod.js";
import { roadWidths, ROAD_MIN_RPX } from "../../render/art/improvements.js";

// oldest core (dark brick) → newest edge (pale amber)
const EPOCH_RAMP = ["#6e1f17", "#83291b", "#982f1d", "#ad3a1f", "#bf4a22", "#cf5d28", "#dc7431", "#e68a3d", "#eea24e", "#f4bb66"];

export function createGrowth(app) {
  const grid = app.w.grid, R = grid.R;
  let B = null, RD = null;
  let pathKey = "", built = [], notYet = null, roadsLater = null;

  const epochFor = (year) => {
    if (!B) return null;
    const E = B.epochs;
    if (year == null) return E.length - 1;
    let k = -1;
    for (let j = 0; j < E.length; j++) if (E[j] <= year) k = j;
    return k; // -1: before the first epoch (1975)
  };

  function paths(year) {
    const e = epochFor(year), key = `${e}|${year}`;
    if (key === pathKey) return;
    pathKey = key;
    built = B.epochs.map(() => new Path2D());
    notYet = new Path2D();
    let any = false;
    for (let k = 0; k < B.cells.length; k++) {
      const i = B.cells[k], f = B.first[k];
      if (f < 0) continue;
      if (f <= e) hexPath(built[f], i);
      else { hexPath(notYet, i); any = true; }
    }
    if (!any) notYet = null;
    roadsLater = null;
    if (RD && year != null) {
      const p = new Path2D();
      let n = 0;
      for (const [a, b, y] of RD.links) {
        if (y == null || y <= year) continue;
        p.moveTo(grid.cx(a), grid.cy(a));
        p.lineTo(grid.cx(b), grid.cy(b));
        n++;
      }
      if (n) roadsLater = p;
    }
  }
  const hexPath = (p, i) => hexAt(p, grid.cx(i), grid.cy(i), R, 1.0);

  /** Draw for a year (null = now: the latest observed epoch). roadsOn: the roads layer is shown. */
  function draw(ctx, cam, year, roadsOn) {
    if (!B) return;
    paths(year);
    const s = cam.scale;
    // hexes built up only after the year shown: washed back to fields
    if (notYet) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "#8fa25a";
      ctx.fill(notYet);
    }
    for (let k = 0; k < built.length; k++) {
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = EPOCH_RAMP[k % EPOCH_RAMP.length];
      ctx.fill(built[k]);
    }
    ctx.globalAlpha = 1;
    if (roadsLater && roadsOn && R * s >= ROAD_MIN_RPX) {
      const { inter } = roadWidths(R * s);
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(116,128,84,0.9)"; // over the paved road: not open yet (back to country)
      ctx.lineWidth = (inter + 2.6) / s;
      ctx.stroke(roadsLater);
      ctx.strokeStyle = "#e0782f";
      ctx.lineWidth = Math.max(1.4, inter * 0.5) / s;
      ctx.setLineDash([5 / s, 4 / s]);
      ctx.stroke(roadsLater);
      ctx.setLineDash([]);
    }
  }

  return {
    set built(v) { B = v; pathKey = ""; }, get built() { return B; },
    set roads(v) { RD = v; pathKey = ""; }, get roads() { return RD; },
    draw, epochFor, EPOCH_RAMP,
  };
}
