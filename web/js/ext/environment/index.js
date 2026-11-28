// Sea-level-rise exposure: a Layers-menu switch that tints land hexes by the share of their ETOPO1 samples at or
// below a chosen level (sealevel.json, precomputed for 0.5/1/2/3 m), with a slider and a live readout of affected
// land, WorldPop residents and the most affected provinces. Lazy: sealevel.json loads the first time it is switched on.
import { t } from "../../i18n.js";
import { esc, int, compact, dec } from "../../format.js";

const COLOR = "#2a7fc1";
const BUCKETS = 10; // alpha steps: one path per step keeps the draw cheap

export function install(app) {
  let on = false, data = null, level = 1; // index into data.levels (1 m)
  let byAlpha = []; // per bucket: [cell, ...] for the current level
  let panel = null;

  function recompute() {
    byAlpha = Array.from({ length: BUCKETS }, () => []);
    const sh = data.share[level];
    for (let k = 0; k < data.cells.length; k++) {
      if (sh[k] > 0) byAlpha[Math.min(BUCKETS - 1, Math.floor((sh[k] / 100) * BUCKETS))].push(data.cells[k]);
    }
  }

  function readout() {
    const dens = app.lensById.get("density")?.values || [];
    const owner = app.w.raw.owner, states = app.w.raw.states, A = data.hex_area_km2;
    const sh = data.share[level];
    let hexes = 0, km2 = 0, people = 0;
    const prov = new Map();
    for (let k = 0; k < data.cells.length; k++) {
      if (!sh[k]) continue;
      const c = data.cells[k], f = sh[k] / 100;
      const a = f * (data.land_pct[k] / 100) * A, p = f * (dens[c] || 0) * A;
      hexes++; km2 += a; people += p;
      const s = prov.get(owner[c]) || { a: 0, p: 0 };
      s.a += a; s.p += p;
      prov.set(owner[c], s);
    }
    const top = [...prov].sort((x, y) => y[1].p - x[1].p).slice(0, 4);
    const h = data.levels[level];
    return `<div class="slr-stats"><b>${int(hexes)}</b> ${t("hexes")} · ≈ <b>${int(km2)}</b> ${t("km² of land")} · ≈ <b>${compact(people)}</b> ${t("residents")}</div>
      <div class="slr-top">${top.map(([o, s]) => `<span>${esc(states[o]?.name || "")} <b>${compact(s.p)}</b></span>`).join("")}</div>
      <div class="slr-note">${esc(t("Land at or below {h} m. Coarse elevation (ETOPO1, ~1.8 km), no defences/tides: an exposure indicator, not a forecast. Residents are WorldPop 2025 in every timeline year, spread evenly over each hex's land.", { h: dec(h) }))}</div>`;
  }

  function render() {
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "panel slr-panel";
      panel.setAttribute("role", "group");
      panel.setAttribute("aria-label", t("Sea level rise"));
      const area = document.getElementById("lens-area") || document.body;
      area.insertBefore(panel, area.firstChild);
      panel.addEventListener("input", (e) => {
        if (!e.target.matches("input[type=range]")) return;
        level = +e.target.value;
        recompute();
        render();
        app.requestDraw();
      });
    }
    panel.hidden = !on;
    if (!on) return;
    if (!data) { panel.innerHTML = `<div class="slr-head">${esc(t("Sea level rise"))}</div><div class="slr-note">${esc(t("Loading…"))}</div>`; return; }
    const lv = data.levels;
    const head = `<div class="slr-head">🌊 ${esc(t("Sea level rise"))} <b class="slr-val">+${dec(lv[level])} m</b></div>`;
    const slider = panel.querySelector("input[type=range]");
    if (slider) { // keep the slider (and its focus) while dragging: only the text changes
      panel.querySelector(".slr-head").outerHTML = head;
      panel.querySelector(".slr-body").innerHTML = readout();
      return;
    }
    panel.innerHTML = `${head}
      <input type="range" min="0" max="${lv.length - 1}" step="1" value="${level}" aria-label="${esc(t("Sea level (m)"))}"
        list="slr-ticks"><datalist id="slr-ticks">${lv.map((_, k) => `<option value="${k}"></option>`).join("")}</datalist>
      <div class="slr-ticks">${lv.map((v) => `<span>${dec(v)}</span>`).join("")}</div>
      <div class="slr-body">${readout()}</div>`;
  }

  app.registerStaticLayer({
    id: "sealevel", z: 45, // above terrain glyphs (40), under rivers and borders (50)
    visible: () => on && !!data,
    sig: () => `${level}`,
    draw(ctx, vp, w, o) {
      const g = w.grid, rg = o.range;
      ctx.fillStyle = COLOR;
      for (let b = 0; b < BUCKETS; b++) {
        if (!byAlpha[b].length) continue;
        ctx.globalAlpha = 0.4 + 0.5 * ((b + 1) / BUCKETS);
        ctx.beginPath(); // render/map.js hexPath, inlined so each alpha step is one fill
        for (const c of byAlpha[b]) {
          if (rg) { const r = (c / g.cols) | 0, cc = c % g.cols; if (r < rg.r0 || r > rg.r1 || cc < rg.c0 || cc > rg.c1) continue; }
          const x = g.cx(c), y = g.cy(c);
          ctx.moveTo(x + g.corners[0][0], y + g.corners[0][1]);
          for (let k = 1; k < 6; k++) ctx.lineTo(x + g.corners[k][0], y + g.corners[k][1]);
          ctx.closePath();
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  });

  const style = document.createElement("style");
  style.textContent = `.slr-panel{padding:8px 10px;width:300px;max-width:100%;font-size:11px;line-height:1.4}
.slr-head{font-family:var(--serif);color:var(--gold-bright);font-size:14px;display:flex;justify-content:space-between}
.slr-panel input[type=range]{width:100%;margin:6px 0 0;accent-color:${COLOR}}
.slr-ticks{display:flex;justify-content:space-between;color:var(--ink-dim);margin-bottom:4px}
.slr-stats{margin:2px 0}.slr-top{display:flex;flex-wrap:wrap;gap:2px 10px;color:var(--ink-dim)}
.slr-top b,.slr-stats b{color:var(--ink)}.slr-note{color:var(--ink-dim);margin-top:4px;font-size:10px}
@media (max-width:640px){.slr-panel{width:auto;margin:0 8px}}`;
  document.head.appendChild(style);

  app.ui.addMapToggle({
    id: "sealevel", label: t("Sea level rise"), icon: "l-wave", group: "Environment", default: false,
    title: t("Land hexes at or below a chosen sea level (ETOPO1): an exposure indicator, not a forecast"),
    get: () => on,
    set(v) {
      on = !!v;
      if (on && !data) {
        app.loadData("sealevel").then((d) => {
          if (!d) return;
          data = d;
          level = Math.min(level, d.levels.length - 1);
          recompute();
          render();
          app.requestDraw();
        });
      }
      render();
      app.requestDraw();
    },
  });
}
