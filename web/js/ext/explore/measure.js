// Ruler ("Đo / Measure") and radius ("Vòng bán kính / Radius") tools, each an app mode (the mode owns map clicks;
// Esc leaves it). Distances are great-circle km through the map's projection (daynight/sun.js mapToLonLat, haversine).
// The radius tool counts what is inside from data already in web/data, at hex level: a hex is inside when its centre
// is within the radius (edge hexes counted by their centre), and a point (school, market, commune, …) counts when its
// hex is inside.
import { t } from "../../i18n.js";
import { esc, int, fixed } from "../../format.js";
import { mapToLonLat } from "../daynight/sun.js";
import { haversineKm, mapKm, pathKm } from "./geom.js";

const fmtKm = (km) => (km >= 100 ? int(km) : fixed(km, 1));

export function installMeasure(app) {
  const w = app.w, grid = w.grid, raw = w.raw, cam = app.cam;
  const kmPerUnit = raw.km_per_unit || app.data.world?.km_per_unit || 0.2;
  const hexKm2 = ((3 * Math.sqrt(3)) / 2) * (grid.R * kmPerUnit) ** 2; // area of one hex
  let tool = null; // "measure" | "radius" | null
  const pts = []; // measure: [[x, y]] map units
  let done = false, hoverPt = null;
  const circle = { c: null, km: 25 };

  // --- panel ---------------------------------------------------------------------------------------------------------
  const panel = document.createElement("div");
  panel.className = "panel xp-tool";
  panel.hidden = true;
  panel.setAttribute("role", "region");
  document.body.appendChild(panel);

  function renderMeasure() {
    const km = pts.length > 1 ? pathKm(pts) : 0;
    panel.setAttribute("aria-label", t("Measure distance"));
    panel.innerHTML = `<div class="xp-head"><b>📏 ${esc(t("Measure distance"))}</b>
      <button type="button" class="icon-btn xp-x" aria-label="${esc(t("Close"))}" title="${esc(t("Close (Esc)"))}">✕</button></div>
      <div class="xp-big" aria-live="polite">${pts.length > 1 ? `${esc(fmtKm(km))} km` : "—"}
        <span class="xp-sub">${esc(t("{n} points", { n: pts.length }))}${done ? ` · ${esc(t("finished"))}` : ""}</span></div>
      <p class="xp-help">${esc(done ? t("Click the map to start a new path.") : t("Click the map to add points. Double-click or Enter finishes, Backspace removes the last point, Esc closes."))}</p>
      <div class="xp-row"><button type="button" class="tl-btn xp-add">${esc(t("+ Point at map centre"))}</button>
        <button type="button" class="tl-btn xp-undo" ${pts.length ? "" : "disabled"}>${esc(t("Undo"))}</button>
        <button type="button" class="tl-btn xp-fin" ${pts.length > 1 && !done ? "" : "disabled"}>${esc(t("Finish"))}</button>
        <button type="button" class="tl-btn xp-clear" ${pts.length ? "" : "disabled"}>${esc(t("Clear path"))}</button></div>
      <p class="xp-note">${esc(t("Great-circle distance (haversine on a 6,371 km sphere) between the points, through the map's projection."))}</p>`;
  }

  let stats = null, statsTimer = 0;
  function renderRadius() {
    panel.setAttribute("aria-label", t("Radius"));
    const c = circle.c;
    const head = `<div class="xp-head"><b>◎ ${esc(t("Radius"))}</b>
      <button type="button" class="icon-btn xp-x" aria-label="${esc(t("Close"))}" title="${esc(t("Close (Esc)"))}">✕</button></div>
      <label class="xp-rl">${esc(t("Radius (km)"))} <input type="range" class="xp-range" min="1" max="200" step="1" value="${circle.km}" aria-label="${esc(t("Radius (km)"))}">
        <input type="number" class="xp-num" min="1" max="500" step="1" value="${circle.km}" aria-label="${esc(t("Radius (km)"))}"></label>
      <div class="xp-row"><button type="button" class="tl-btn xp-centre">${esc(t("Centre on map centre"))}</button></div>`;
    const help = `<p class="xp-help">${esc(c ? t("Click the map to move the centre, Shift-click to set the edge (the radius). Esc closes.") : t("Click the map to pick the centre (or use the button). Then type or slide the radius."))}</p>`;
    panel.innerHTML = head + help + `<div class="xp-res" aria-live="polite">${c ? statsHtml() : ""}</div>`;
  }
  function statsHtml() {
    const s = stats;
    if (!s) return `<p class="xp-help">${esc(t("Counting…"))}</p>`;
    const row = (k, v, n) => `<tr><th scope="row">${esc(k)}</th><td>${v}</td>${n ? `<td class="xp-n">${esc(n)}</td>` : "<td></td>"}</tr>`;
    const cnt = (v) => (v == null ? `<span class="xp-na">${esc(t("not loaded"))}</span>` : esc(int(v)));
    return `<table class="xp-tab"><tbody>
      ${row(t("Population"), s.pop == null ? cnt(null) : `≈ ${esc(int(Math.round(s.pop / 100) * 100))}`, t("WorldPop 2025, by hex"))}
      ${row(t("Area"), `${esc(int(s.areaAll))} km²`, t("{n} hexes × {a} km²", { n: int(s.hexes), a: fixed(hexKm2, 1) }))}
      ${row(t("Vietnam's land in it"), `${esc(int(s.areaLand))} km²`, t("circle πr² = {a} km²", { a: int(Math.PI * circle.km ** 2) }))}
      ${row(t("Schools"), cnt(s.schools), t("OSM, per hex"))}
      ${row(t("Hospitals"), cnt(s.hospital), "OSM")}
      ${row(t("Universities & colleges"), cnt(s.university), "OSM")}
      ${row(t("Markets"), cnt(s.market), "OSM")}
      ${row(t("Airports"), cnt(s.airports), "")}
      ${row(t("Seaports"), cnt(s.ports), "")}
      ${row(t("Communes and wards"), cnt(s.communes), t("by label point"))}
      ${row(t("Mountain peaks"), cnt(s.peaks), "OSM")}
      ${row(t("Lakes and reservoirs"), cnt(s.lakes), "OSM")}
    </tbody></table>
    <p class="xp-note">${esc(t("Hex-level approximation: a hex (about {a} km²) is inside when its centre is within the radius (edge hexes counted by their centre); a place counts when its hex is inside. Population = WorldPop 2025 residents per hex (the Population theme's density × hex area), Vietnam's land only. Schools = the Schools theme's OpenStreetMap count per hex. Hospitals, universities, markets: OpenStreetMap points (everyday places); airports and seaports: the transport layers; communes: the 2025 communes' label points; peaks and lakes: the geography layers. OpenStreetMap coverage depends on volunteer mappers.", { a: fixed(hexKm2, 1) }))}</p>`;
  }
  function render() { if (tool === "measure") renderMeasure(); else if (tool === "radius") renderRadius(); }

  panel.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.classList.contains("xp-x")) return app.setMode(null);
    if (b.classList.contains("xp-add")) { addPoint(...centre()); return focusKeep(".xp-add"); }
    if (b.classList.contains("xp-undo")) { pts.pop(); done = false; changed(); return focusKeep(".xp-undo", ".xp-add"); }
    if (b.classList.contains("xp-fin")) { finish(); return focusKeep(".xp-add"); }
    if (b.classList.contains("xp-clear")) { pts.length = 0; done = false; changed(); return focusKeep(".xp-add"); }
    if (b.classList.contains("xp-centre")) { setCentre(...centre()); return focusKeep(".xp-centre"); }
  });
  panel.addEventListener("input", (e) => {
    if (!e.target.matches(".xp-range, .xp-num")) return;
    const v = Math.max(1, Math.min(500, Math.round(+e.target.value || 1)));
    circle.km = v;
    const other = panel.querySelector(e.target.matches(".xp-range") ? ".xp-num" : ".xp-range");
    if (other) other.value = String(v);
    app.requestDraw();
    recount();
  });
  function focusKeep(...sels) {
    for (const s of sels) { const el = panel.querySelector(s); if (el && !el.disabled) { el.focus(); return; } }
  }
  const centre = () => {
    const a = app.visibleArea?.() || { x0: 0, y0: 0, x1: cam.w, y1: cam.h };
    return cam.toWorld((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2);
  };

  // --- measure ---------------------------------------------------------------------------------------------------------
  function addPoint(x, y) {
    if (done) { pts.length = 0; done = false; }
    pts.push([x, y]);
    changed();
  }
  function finish() { if (pts.length > 1) { done = true; changed(); app.hash.update?.(); } }
  function changed() { render(); app.requestDraw(); }

  // --- radius ------------------------------------------------------------------------------------------------------
  let lonlat = null; // Float32Array [lon, lat] per cell, made on first use
  function cellLL() {
    if (lonlat) return lonlat;
    lonlat = new Float32Array(grid.size * 2);
    for (let i = 0; i < grid.size; i++) { const [lo, la] = mapToLonLat(grid.cx(i), grid.cy(i)); lonlat[2 * i] = lo; lonlat[2 * i + 1] = la; }
    return lonlat;
  }
  function setCentre(x, y) {
    circle.c = [x, y];
    render();
    app.requestDraw();
    recount();
  }
  function insideCells() {
    const [cx, cy] = circle.c, [lo0, la0] = mapToLonLat(cx, cy), LL = cellLL();
    const ru = (circle.km / kmPerUnit) * 1.08 + grid.R * 2; // a box safely around the circle (projection scale ≈ 1)
    const g = grid.range(cx - ru, cy - ru, cx + ru, cy + ru), out = new Set();
    for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) {
      const i = r * grid.cols + c;
      if (i >= 0 && i < grid.size && haversineKm(lo0, la0, LL[2 * i], LL[2 * i + 1]) <= circle.km) out.add(i);
    }
    return out;
  }
  let loads = null;
  function needData() {
    loads ||= Promise.all([
      app.lensValues ? app.lensValues("density") : Promise.resolve(app.lensById?.get("density")?.values || null),
      app.lensValues ? app.lensValues("osm_schools") : Promise.resolve(app.lensById?.get("osm_schools")?.values || null),
      app.loadData("poi"), app.loadData("infrastructure"), app.loadData("communes"), app.loadData("geo"),
    ]).then(([density, schools]) => ({ density, schools }));
    return loads;
  }
  function recount() {
    clearTimeout(statsTimer);
    if (!circle.c) return;
    statsTimer = setTimeout(async () => {
      const d = await needData().catch(() => ({}));
      if (tool !== "radius" || !circle.c) return;
      stats = countInside(insideCells(), d);
      app.hash.update?.();
      const res = panel.querySelector(".xp-res");
      if (res) res.innerHTML = statsHtml();
    }, 120);
  }
  function countInside(cells, { density, schools }) {
    const D = app.data, own = raw.owner;
    let land = 0, pop = density ? 0 : null, sch = schools ? 0 : null;
    for (const i of cells) {
      if (own[i] >= 0) land++;
      if (density && own[i] >= 0 && density[i] > 0) pop += density[i] * hexKm2;
      if (schools && schools[i] > 0) sch += schools[i];
    }
    const inHex = (x, y) => cells.has(grid.cellAt(x, y));
    const countPts = (list, xy = (r) => [r[0], r[1]]) => (Array.isArray(list) ? list.reduce((n, r) => n + (inHex(...xy(r)) ? 1 : 0), 0) : null);
    const P = D.poi?.points, I = D.infrastructure, G = D.geo;
    return {
      hexes: cells.size, areaAll: cells.size * hexKm2, areaLand: land * hexKm2, pop, schools: sch,
      hospital: countPts(P?.hospital), university: countPts(P?.university), market: countPts(P?.market),
      airports: countPts(I?.airports, (r) => [r.x, r.y]), ports: countPts(I?.ports, (r) => [r.x, r.y]),
      communes: countPts(D.communes?.communes, (r) => [r.x, r.y]),
      peaks: countPts(G?.peaks, (r) => [r.x, r.y]), lakes: countPts(G?.lakes, (r) => [r.x, r.y]),
    };
  }

  // --- drawing (screen space, above the map) ---------------------------------------------------------------------
  const GOLD = "#ecd08e", INK = "#1b1408";
  function label(ctx, text, x, y) {
    ctx.font = "600 12px -apple-system, 'Segoe UI', system-ui, sans-serif";
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(16,25,35,.88)";
    ctx.fillRect(x - tw / 2 - 5, y - 9, tw + 10, 18);
    ctx.fillStyle = GOLD;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
  }
  app.registerOverlay({
    id: "explore-measure", z: 140, space: "screen",
    draw(ctx) {
      if (tool === "measure" && pts.length) {
        const s = pts.map(([x, y]) => cam.toScreen(x, y));
        const tail = !done && hoverPt ? cam.toScreen(...hoverPt) : null;
        ctx.lineJoin = ctx.lineCap = "round";
        for (const [lw, col] of [[5, "rgba(16,25,35,.7)"], [2.2, GOLD]]) {
          ctx.beginPath();
          s.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.setLineDash([]); ctx.stroke();
        }
        if (tail) {
          ctx.beginPath(); ctx.moveTo(...s[s.length - 1]); ctx.lineTo(...tail);
          ctx.setLineDash([5, 5]); ctx.lineWidth = 1.6; ctx.strokeStyle = GOLD; ctx.stroke(); ctx.setLineDash([]);
        }
        for (const [x, y] of s) { ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 7); ctx.fillStyle = GOLD; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = INK; ctx.stroke(); }
        let acc = 0;
        for (let k = 1; k < pts.length; k++) {
          acc += mapKm(...pts[k - 1], ...pts[k]);
          if (k === pts.length - 1 || pts.length <= 6) label(ctx, `${fmtKm(acc)} km`, s[k][0], s[k][1] - 16);
        }
        if (tail) label(ctx, `+${fmtKm(mapKm(...pts[pts.length - 1], ...hoverPt))} km`, tail[0], tail[1] - 16);
      }
      if (tool === "radius" && circle.c) {
        const [cx, cy] = circle.c, [sx, sy] = cam.toScreen(cx, cy);
        // radius on screen: the map point due east at that distance (projection scale is ~1 here)
        const rpx = (circle.km / kmPerUnit) * cam.scale;
        ctx.beginPath(); ctx.arc(sx, sy, rpx, 0, 7);
        ctx.fillStyle = "rgba(236,208,142,.10)"; ctx.fill();
        ctx.lineWidth = 4; ctx.strokeStyle = "rgba(16,25,35,.6)"; ctx.stroke();
        ctx.lineWidth = 2; ctx.strokeStyle = GOLD; ctx.stroke();
        ctx.beginPath(); ctx.arc(sx, sy, 4, 0, 7); ctx.fillStyle = GOLD; ctx.fill();
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + rpx, sy); ctx.setLineDash([4, 4]); ctx.lineWidth = 1.4; ctx.strokeStyle = GOLD; ctx.stroke(); ctx.setLineDash([]);
        label(ctx, `${int(circle.km)} km`, sx + rpx / 2, sy - 12);
      }
    },
  });

  // --- the modes ------------------------------------------------------------------------------------------------------
  let opener = null;
  for (const name of ["measure", "radius"]) {
    app.registerMode(name, {
      enter() {
        tool = name;
        opener = document.activeElement;
        panel.hidden = false;
        document.body.classList.add("xp-tool-on");
        render();
        panel.querySelector(name === "measure" ? ".xp-add" : ".xp-range")?.focus({ preventScroll: true });
        app.requestDraw();
      },
      exit() {
        tool = null;
        const had = panel.contains(document.activeElement);
        panel.hidden = true;
        document.body.classList.remove("xp-tool-on");
        hoverPt = null;
        app.requestDraw();
        if (had) (opener?.isConnected && opener !== document.body && opener.getClientRects().length ? opener : document.getElementById("btn-more"))?.focus?.({ preventScroll: true });
      },
      // Esc: a measure in progress is finished first, then a second Esc closes (Backspace undoes)
      onEscape() { return false; },
    });
  }
  app.on("mapclick", (ev) => {
    if (!tool) return false;
    const [x, y] = cam.toWorld(ev.x, ev.y);
    if (tool === "measure") addPoint(x, y);
    else if (circle.c && lastShift) {
      circle.km = Math.max(1, Math.min(500, Math.round(mapKm(...circle.c, x, y))));
      render(); app.requestDraw(); recount();
    } else setCentre(x, y);
    return true; // the tool owns the click: no selection
  });
  let lastShift = false;
  document.getElementById("map")?.addEventListener("pointerdown", (e) => { lastShift = e.shiftKey; }, { passive: true });
  document.getElementById("map")?.addEventListener("dblclick", () => { if (tool === "measure") finish(); });
  app.on("hover", (h) => {
    if (tool !== "measure" || done || !pts.length || !h || !Number.isFinite(h.x)) return;
    hoverPt = cam.toWorld(h.x, h.y);
    app.requestDraw();
  });
  addEventListener("keydown", (e) => {
    if (!tool || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) && !(e.key === "Enter" && tool === "measure")) return;
    if (tool === "measure" && e.key === "Enter" && !(e.target?.tagName === "BUTTON")) { e.preventDefault(); finish(); }
    else if (tool === "measure" && e.key === "Backspace" && pts.length) { e.preventDefault(); pts.pop(); done = false; changed(); }
  });

  const open = (name, p) => {
    if (app.mode === name) return app.setMode(null);
    if (name === "radius" && p?.centre) circle.c = p.centre;
    app.setMode(name);
    if (name === "radius" && circle.c) recount();
  };
  app.hash.register("measure", {
    get: () => (tool === "measure" && pts.length ? pts.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).join(";") : tool === "radius" && circle.c ? `r${circle.km}@${Math.round(circle.c[0])},${Math.round(circle.c[1])}` : tool ? tool : null),
    set: (v) => {
      if (!v) { if (tool) app.setMode(null); return; }
      const m = /^r(\d+)@(-?\d+),(-?\d+)$/.exec(v);
      if (m) { circle.km = Math.min(500, Math.max(1, +m[1])); circle.c = [+m[2], +m[3]]; if (tool !== "radius") app.setMode("radius"); else { render(); recount(); } return; }
      if (v === "radius") { if (tool !== "radius") app.setMode("radius"); return; }
      const list = v === "measure" ? [] : v.split(";").map((s) => s.split(",").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
      pts.length = 0; pts.push(...list.slice(0, 50)); done = pts.length > 1;
      if (tool !== "measure") app.setMode("measure"); else changed();
    },
  });
  return { open, get pts() { return pts; }, get circle() { return circle; }, get stats() { return stats; }, finish, setCentre, panel };
}

export const MEASURE_CSS = `
.xp-tool { position: fixed; left: 10px; top: calc(var(--topbar-h, 40px) + 10px); z-index: 21; width: min(330px, calc(100vw - 20px)); padding: 8px 12px 10px; font-size: 12.5px; color: var(--ink); box-sizing: border-box; max-height: calc(100vh - var(--topbar-h, 40px) - 110px); overflow: auto; }
.xp-tool[hidden] { display: none; }
.xp-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; font: 600 14px var(--serif); color: var(--gold-bright); }
.xp-big { font: 600 22px var(--serif); color: var(--gold-bright); margin: 4px 0 2px; }
.xp-sub { font: 12px var(--sans); color: var(--ink-dim); margin-left: 6px; }
.xp-help { margin: 4px 0 6px; color: var(--ink-dim); }
.xp-note { margin: 6px 0 0; color: var(--ink-dim); font-size: 10.5px; line-height: 1.4; }
.xp-row { display: flex; flex-wrap: wrap; gap: 5px; }
.xp-tool .tl-btn { background: none; border: 1px solid var(--line); border-radius: 4px; color: var(--gold-bright); cursor: pointer; min-height: 28px; padding: 0 8px; font: inherit; }
.xp-tool .tl-btn:hover:not(:disabled), .xp-tool .tl-btn:focus-visible { background: rgba(201,164,92,.15); }
.xp-tool .tl-btn:disabled { opacity: .4; cursor: default; }
.xp-rl { display: flex; align-items: center; gap: 6px; margin: 4px 0 6px; color: var(--ink-dim); }
.xp-range { flex: 1; min-width: 80px; accent-color: #c9a45c; }
.xp-num { width: 58px; background: rgba(0,0,0,.25); color: var(--ink); border: 1px solid var(--line); border-radius: 4px; padding: 2px 4px; font: inherit; }
.xp-tab { width: 100%; border-collapse: collapse; margin-top: 4px; }
.xp-tab th { text-align: left; font-weight: normal; color: var(--ink-dim); padding: 1px 6px 1px 0; }
.xp-tab td { text-align: right; padding: 1px 0; font-variant-numeric: tabular-nums; white-space: nowrap; }
.xp-tab td.xp-n { white-space: normal; }
.xp-tab td.xp-n { color: var(--ink-dim); font-size: 10.5px; padding-left: 6px; text-align: left; }
.xp-na { color: var(--ink-dim); font-style: italic; }
@media (max-width: 700px) { .xp-tool { top: auto; left: 6px; right: 6px; width: auto; bottom: 8px; max-height: 46vh; } }`;
