// Close-zoom life on the map (illustrative, deterministic per hex): where it goes, and its small sprites.
//   buffalo (trâu)          6% of wet-rice field hexes
//   farmer in a nón lá      5% of wet-rice and terraced field hexes (not those with a buffalo)
//   boat (thuyền)           6% of the land hexes a river crosses, on the river line, along its course
//   ducks (vịt)             a quarter of the delta hexes that have a fish pond (render/art/terrain.js pondSpot)
// Positions are in map units; sprites are painted in R units (1 = the hex radius) like render/art/terrain.js.
import { hash01 } from "../../hex.js";
import { COVER } from "../../terrain.js";
import { fieldArt, isFieldCell, pondSpot } from "../../render/art/terrain.js";

/** The life item of hex i or null: {kind: "buffalo"|"farmer"|"boat"|"ducks", x, y, ang?}. `river` = Map(cell →
 *  [x, y, ang]) from riverSpots(). Rpx: hex radius in css px (field tiles depend on the city tiles drawn). */
export function lifeAt(w, i, river, Rpx = 60) {
  if (w.water[i] || w.raw.owner[i] < 0) return null;
  const g = w.grid, R = g.R, x = g.cx(i), y = g.cy(i);
  const rv = river.get(i);
  if (rv && hash01(i, 803) < 0.06) return { kind: "boat", x: rv[0], y: rv[1], ang: rv[2] };
  if (isFieldCell(w, i, Rpx)) {
    const art = fieldArt(w, i);
    if (art === "paddy" && hash01(i, 801) < 0.06) return { kind: "buffalo", x: x + (hash01(i, 811) - 0.5) * 0.8 * R, y: y + (hash01(i, 812) - 0.3) * 0.6 * R };
    if (art !== "rows" && hash01(i, 802) < 0.05) return { kind: "farmer", x: x + (hash01(i, 813) - 0.5) * 0.8 * R, y: y + (hash01(i, 814) - 0.3) * 0.6 * R };
  }
  const cv = w.cover[i];
  if ((cv === COVER.CROP || cv === COVER.PASTURE) && w.relief[i] === 0 && !w.cityByCell.has(i) && hash01(i, 804) < 0.25) {
    const p = pondSpot(w, i);
    if (p && !p.shrimp) return { kind: "ducks", x: x + p.x * R, y: y + p.y * R };
  }
  return null;
}

/** One spot per land hex a river crosses: the middle of the first river segment in it ([x, y, angle]). */
export function riverSpots(w) {
  const g = w.grid, out = new Map();
  for (const rv of w.raw.rivers || []) {
    const p = rv.pts || [];
    for (let k = 0; k + 3 < p.length; k += 2) {
      const mx = (p[k] + p[k + 2]) / 2, my = (p[k + 1] + p[k + 3]) / 2, c = g.cellAt(mx, my);
      if (c >= 0 && !w.water[c] && !out.has(c)) out.set(c, [mx, my, Math.atan2(p[k + 3] - p[k + 1], p[k + 2] - p[k])]);
    }
  }
  return out;
}

// --- sprites (R units; px = one device pixel) ---------------------------------------------------------------------

export const LIFE_SPRITES = {
  buffalo: { box: { x0: -0.16, y0: -0.13, x1: 0.16, y1: 0.05 }, paint: paintBuffalo },
  farmer: { box: { x0: -0.06, y0: -0.13, x1: 0.07, y1: 0.03 }, paint: paintFarmer },
  boat: { box: { x0: -0.18, y0: -0.1, x1: 0.18, y1: 0.06 }, paint: paintBoat },
  duck: { box: { x0: -0.035, y0: -0.035, x1: 0.04, y1: 0.02 }, paint: paintDuck },
};

const TAU = Math.PI * 2;
const ell = (g, x, y, rx, ry, a = 0) => { g.beginPath(); g.ellipse(x, y, rx, ry, a, 0, TAU); };

/** A water buffalo standing in the paddy, facing left: a ring of water at its legs, dark body, swept-back horns. */
function paintBuffalo(g, upx) {
  const px = 1 / upx;
  ell(g, 0.01, 0.015, 0.14, 0.03);
  g.fillStyle = "rgba(225,240,240,.35)";
  g.fill();
  g.fillStyle = "#3b3836";
  for (const lx of [-0.07, -0.035, 0.05, 0.085]) g.fillRect(lx, -0.03, 0.02, 0.045);
  ell(g, 0.01, -0.05, 0.1, 0.045);
  g.fillStyle = "#4a4643";
  g.fill();
  ell(g, -0.01, -0.07, 0.07, 0.018);
  g.fillStyle = "rgba(160,160,165,.35)"; // the lit back
  g.fill();
  ell(g, -0.105, -0.06, 0.035, 0.026, -0.3);
  g.fillStyle = "#43403d";
  g.fill();
  g.strokeStyle = "#d9d2bf";
  g.lineWidth = Math.max(px, 0.012);
  g.beginPath();
  g.moveTo(-0.12, -0.08); g.quadraticCurveTo(-0.07, -0.13, -0.04, -0.1);
  g.moveTo(-0.1, -0.08); g.quadraticCurveTo(-0.13, -0.125, -0.15, -0.1);
  g.stroke();
  g.strokeStyle = "#2b2826";
  g.lineWidth = Math.max(px, 0.008);
  g.beginPath();
  g.moveTo(0.11, -0.06); g.quadraticCurveTo(0.13, -0.03, 0.12, 0.0);
  g.stroke();
}

/** A farmer bent over the rice, under a conical nón lá. */
function paintFarmer(g, upx) {
  const px = 1 / upx;
  ell(g, 0, 0.012, 0.045, 0.012);
  g.fillStyle = "rgba(225,240,240,.35)";
  g.fill();
  g.strokeStyle = "#3d2c22";
  g.lineWidth = Math.max(px, 0.012);
  g.beginPath();
  g.moveTo(-0.01, 0.01); g.lineTo(-0.005, -0.03);
  g.moveTo(0.02, 0.01); g.lineTo(0.015, -0.03);
  g.stroke();
  g.fillStyle = "#3e5a7a"; // indigo shirt, bent forward
  g.beginPath();
  g.moveTo(-0.012, -0.03); g.lineTo(0.03, -0.035); g.lineTo(0.0, -0.075); g.lineTo(-0.03, -0.065);
  g.closePath();
  g.fill();
  g.fillStyle = "#e7d29a"; // the hat
  g.beginPath();
  g.moveTo(-0.055, -0.07); g.lineTo(-0.005, -0.115); g.lineTo(0.035, -0.06);
  g.closePath();
  g.fill();
  g.strokeStyle = "rgba(120,90,40,.7)";
  g.lineWidth = px;
  g.stroke();
}

/** A small wooden sampan with a bamboo-arched cabin, seen from the side, bow to the right. */
function paintBoat(g, upx) {
  const px = 1 / upx;
  ell(g, 0, 0.02, 0.17, 0.03);
  g.fillStyle = "rgba(230,245,250,.4)";
  g.fill();
  g.fillStyle = "#5a3a22";
  g.beginPath();
  g.moveTo(-0.17, -0.04); g.quadraticCurveTo(-0.1, 0.02, 0, 0.02); g.quadraticCurveTo(0.1, 0.02, 0.17, -0.045);
  g.lineTo(0.12, -0.02); g.lineTo(-0.12, -0.02);
  g.closePath();
  g.fill();
  g.strokeStyle = "#2c1b0f";
  g.lineWidth = Math.max(px, 0.006);
  g.stroke();
  g.fillStyle = "#b08a50"; // the mui (cabin roof)
  g.beginPath();
  g.moveTo(-0.06, -0.02); g.quadraticCurveTo(-0.01, -0.085, 0.05, -0.02);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = "#e7d29a"; // the boatman's hat
  g.beginPath();
  g.moveTo(0.075, -0.035); g.lineTo(0.095, -0.065); g.lineTo(0.115, -0.035);
  g.closePath();
  g.fill();
}

/** A white duck seen from the side, beak to the left. */
function paintDuck(g, upx) {
  const px = 1 / upx;
  ell(g, 0.005, 0, 0.022, 0.011);
  g.fillStyle = "#f3efe4";
  g.fill();
  g.strokeStyle = "rgba(60,60,50,.6)";
  g.lineWidth = px * 0.8;
  g.stroke();
  ell(g, -0.018, -0.012, 0.009, 0.008);
  g.fillStyle = "#f6f3ea";
  g.fill();
  g.fillStyle = "#e08a2c";
  g.fillRect(-0.033, -0.013, 0.008, 0.004);
}
