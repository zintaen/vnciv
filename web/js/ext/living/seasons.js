// Seasons on the cached static map (static layers: re-rendered only when the month changes, never per frame):
//   rice paddies take the colour of the month's crop stage by region (living.json rice + crop_calendar)
//   the Mekong flood season (mùa nước nổi) spreads water over the delta's low-lying hexes (living.json flood):
//   illustrative of the season, not a forecast or a flood map.
import { hexAt } from "../../render/art/lod.js";
import { riceStage } from "./calendar.js";

export const STAGE_COLOR = { plant: "#86c2b4", grow: "#47a838", ripe: "#b9c23a", harvest: "#e7b532", fallow: "#a4855a" };

export function createSeasons(app, L, getMonth) {
  const grid = app.w.grid, R = grid.R;
  const rice = L.rice, regions = L.crop_calendar.regions;
  const regionIds = Object.keys(regions);
  const riceIdx = new Map(rice.cells.map((c, k) => [c, k]));
  const flood = L.flood, floodIdx = new Map(flood.cells.map((c, k) => [c, k]));

  const stageOf = (m) => regionIds.map((id) => riceStage(regions[id].seasons, m));
  const floodLevel = (m) => flood.months?.[String(m)] ?? 0;

  const inView = (o) => o.cells; // visible cells (the map's own culling)
  function drawRice(ctx, vp, w, o) {
    const st = stageOf(getMonth());
    ctx.globalCompositeOperation = "color";
    for (const stage of Object.keys(STAGE_COLOR)) {
      // two alpha bands (share of the hex in cropland) keep it to a few fills
      for (const band of [0, 1]) {
        ctx.beginPath();
        let any = false;
        for (const i of inView(o)) {
          const k = riceIdx.get(i);
          if (k == null || st[rice.region[k]] !== stage || (rice.share[k] >= 60 ? 1 : 0) !== band) continue;
          hexAt(ctx, grid.cx(i), grid.cy(i), R, 1.01);
          any = true;
        }
        if (!any) continue;
        ctx.globalAlpha = band ? 0.62 : 0.4;
        ctx.fillStyle = STAGE_COLOR[stage];
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  function drawFlood(ctx, vp, w, o) {
    const lv = floodLevel(getMonth());
    if (!lv) return;
    for (const band of [0, 1, 2]) {
      ctx.beginPath();
      let any = false;
      for (const i of inView(o)) {
        const k = floodIdx.get(i);
        if (k == null) continue;
        const d = flood.share[k];
        if ((d >= 60 ? 2 : d >= 30 ? 1 : 0) !== band) continue;
        hexAt(ctx, grid.cx(i), grid.cy(i), R, 1.01);
        any = true;
      }
      if (!any) continue;
      ctx.globalAlpha = lv * [0.22, 0.36, 0.5][band];
      ctx.fillStyle = "#5f95ad";
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  return { drawRice, drawFlood, stageOf, floodLevel, regionIds, riceCells: rice.cells.length, floodCells: flood.cells.length };
}
