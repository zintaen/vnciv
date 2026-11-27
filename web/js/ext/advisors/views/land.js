// Land advisor: national land cover (ESA WorldCover), where each cover dominates, the provinces' make-up and the rice harvest.
import { esc, fin, ratio } from "../core/util.js";
import { pct, int, count3 } from "../core/fmt.js";
import { shareBar, barList, donut, smallMultiples } from "../core/charts.js";
import { createTable } from "../core/table.js";
import { section, tiles, segmented, lensButton, sourcesHtml, topBy, frameBtn } from "../core/view.js";
import { LAND_KEYS, LAND_LABEL, LAND_COLOR, rowsHighlight } from "../core/data.js";
import { t as tr } from "../../../i18n.js";
import { yearOf, yearText } from "../core/years.js";

const LENS_OF = { forest: "forest", crop: "farmland", wetland: "wetland", developed: "developed" };

export function mount(ctx) {
  const { app, data, el, link } = ctx;
  const w = app.w;
  const P = w.raw.pct;
  const owner = w.raw.owner;
  const { states } = data.levels;
  if (!P) {
    el.innerHTML = `<p class="adv-empty pad">${tr("world.json has no land-cover shares.")}</p>`;
    return {};
  }

  // --- national shares and dominant cover per hex ---------------------------------------------------------------
  const sums = Object.fromEntries(LAND_KEYS.map((k) => [k, 0]));
  const dominant = new Map(LAND_KEYS.map((k) => [k, []]));
  let cells = 0;
  for (let i = 0; i < w.grid.size; i++) {
    if (!(owner[i] >= 0)) continue;
    let tot = 0, best = null, bv = 0;
    for (const k of LAND_KEYS) {
      const v = P[k]?.[i] || 0;
      tot += v;
      if (v > bv) { bv = v; best = k; }
    }
    if (tot <= 0) continue; // no land-cover samples
    cells++;
    for (const k of LAND_KEYS) sums[k] += P[k]?.[i] || 0;
    dominant.get(best).push(i);
  }
  const share = Object.fromEntries(LAND_KEYS.map((k) => [k, cells ? sums[k] / (cells * 100) : 0]));
  const other = Math.max(0, 1 - LAND_KEYS.reduce((a, k) => a + share[k], 0));
  const KEYS = LAND_KEYS.filter((k) => share[k] >= 0.0005); // covers Vietnam really has (pasture and shrubland are ~0)

  el.insertAdjacentHTML("beforeend", tiles([
    { label: tr("Forest"), value: pct(share.forest, 0), sub: tr("of the land, satellite (WorldCover)"), color: LAND_COLOR.forest },
    ...(fin(data.nat.forest_cover) ? [{ label: tr("Forest cover (official)"), value: pct(data.nat.forest_cover, 0), sub: tr("NSO, {y}", { y: yearText(yearOf(data.nat, "forest_cover")) }), color: LAND_COLOR.forest }] : []),
    { label: tr("Farmland"), value: pct(share.crop + share.pasture, 0), sub: tr("cropland, rice paddies included"), color: LAND_COLOR.crop },
    { label: tr("Built-up"), value: pct(share.developed, 1), sub: tr("developed land"), color: LAND_COLOR.developed },
  ]));

  // --- composition ----------------------------------------------------------------------------------------------
  const cBody = section(el, { title: tr("What covers the country"), kicker: tr("Vietnam"), note: tr("Share of the land in each cover type (ESA WorldCover 2021, averaged over every hex). Hover a type to light up the hexes where it is the largest cover; click to keep them lit.") });
  let pinned = null;
  const parts = [...KEYS.map((k) => ({ key: k, label: LAND_LABEL[k], value: share[k], color: LAND_COLOR[k], text: pct(share[k]) })), { key: "other", label: tr("Other (bare ground, open water)"), value: other, color: "#6c6358", text: pct(other) }].sort((a, b) => (a.key === "other") - (b.key === "other") || b.value - a.value);
  const domHighlight = (k, dim = true) => (dominant.has(k) ? { cells: new Set(dominant.get(k)), dimOthers: dim, color: LAND_COLOR[k] } : null);
  const sb = shareBar(cBody, {
    parts,
    onHover: (p) => link.hover(p && p.key !== "other" ? { ...domHighlight(p.key), color: "#fff3c4" } : null),
    onClick: (p) => pin(p.key === "other" || pinned === p.key ? null : p.key),
  });
  const pinInfo = document.createElement("div");
  pinInfo.className = "adv-brushinfo";
  cBody.appendChild(pinInfo);
  const lensRow = document.createElement("div");
  lensRow.className = "adv-row";
  for (const [id, label] of [["forest", tr("Forest lens")], ["farmland", tr("Farmland lens")], ["wetland", tr("Wetland lens")], ["developed", tr("Built-up lens")]]) {
    const b = lensButton(app, id, label);
    if (b) lensRow.appendChild(b);
  }
  cBody.appendChild(lensRow);
  function pin(k) {
    pinned = k;
    sb.setSelected(k);
    link.base(k ? domHighlight(k) : null, { frame: true });
    if (!k) { pinInfo.innerHTML = ""; return; }
    const n = dominant.get(k).length;
    const lens = LENS_OF[k] && app.lensById.get(LENS_OF[k]);
    pinInfo.innerHTML = `${tr("<b>{cover}</b> is the largest cover on <b>{n}</b> hexes ({hexShare} of the land hexes) and covers {landShare} of all land.", { cover: esc(LAND_LABEL[k]), n: int(n), hexShare: pct(n / cells, 0), landShare: pct(share[k]) })}
      ${lens ? `<button type="button" class="adv-mini" data-lens="${lens.id}">${tr("Show the {lens} lens", { lens: esc(tr(lens.name)) })}</button>` : ""}${frameBtn()}<button type="button" class="adv-mini" data-clear>${tr("Clear")}</button>`;
  }
  pinInfo.addEventListener("click", (e) => {
    if (e.target.closest("[data-clear]")) pin(null);
    const l = e.target.closest("[data-lens]")?.dataset.lens;
    if (l) app.setLens(l);
  });

  // --- per province ------------------------------------------------------------------------------------------------
  const sBody = section(el, { title: tr("The provinces' make-up"), note: tr("Each 2025 province's land by cover type. Sort by any cover; hover a province to outline it, click to open it.") });
  const stRows = states.rows.filter((r) => LAND_KEYS.some((k) => fin(r.v[`land_${k}`])));
  const comp = (r) => `<span class="adv-minibar">${LAND_KEYS.map((k) => {
    const v = r.v[`land_${k}`];
    return fin(v) && v > 0 ? `<i style="width:${(v * 100).toFixed(2)}%;background:${LAND_COLOR[k]}" title="${esc(`${LAND_LABEL[k]} ${pct(v)}`)}"></i>` : "";
  }).join("")}</span>`;
  const domOf = (r) => LAND_KEYS.reduce((b, k) => ((r.v[`land_${k}`] ?? -1) > (r.v[`land_${b}`] ?? -1) ? k : b), LAND_KEYS[0]);
  let sortKey = "forest";
  const colsFor = (k) => [
    { key: "name", label: tr("Province"), align: "l", width: "minmax(0,1.1fr)", value: (r) => r.name, text: (r) => r.name },
    { key: "comp", label: tr("Land"), align: "l", width: "minmax(0,1.6fr)", value: (r) => r.v[`land_${k}`], html: comp, title: tr("Sort by {cover}", { cover: LAND_LABEL[k].toLowerCase() }) },
    { key: "share", label: LAND_LABEL[k], value: (r) => r.v[`land_${k}`], html: (r) => `<span class="dot" style="background:${LAND_COLOR[k]}"></span>${pct(r.v[`land_${k}`], 0)}` },
    { key: "dom", label: tr("Largest"), align: "l", width: "minmax(0,.9fr)", value: (r) => LAND_LABEL[domOf(r)], text: (r) => LAND_LABEL[domOf(r)] },
  ];
  const sortSeg = document.createElement("div");
  sortSeg.className = "adv-row";
  sBody.appendChild(sortSeg);
  segmented(sortSeg, {
    label: tr("Sort by"), value: sortKey,
    options: KEYS.map((k) => ({ value: k, label: k === "wetland" ? tr("Wetland") : LAND_LABEL[k] })),
    onChange: (k) => { sortKey = k; table.setColumns(colsFor(k), { key: "share", dir: "desc" }); drawShape(); },
  });
  let shape = "table";
  segmented(sortSeg, { label: tr("Show as"), value: shape, options: [{ value: "table", label: tr("Table") }, { value: "grid", label: tr("Grid") }], onChange: (v) => { shape = v; drawShape(); } });
  const tableHost = document.createElement("div");
  const gridHost = document.createElement("div");
  sBody.append(tableHost, gridHost);
  const table = createTable(tableHost, {
    caption: tr("Land cover by province"), rank: true, maxHeight: 320, rows: stRows, columns: colsFor(sortKey), sort: { key: "share", dir: "desc" },
    onHover: (r) => link.hover(r ? rowsHighlight(states, [r]) : null),
    onClick: (r) => states.focus(r),
  });
  // Small multiples: one donut per state, sorted by the chosen cover.
  let grid = null;
  function drawShape() {
    tableHost.hidden = shape !== "table";
    gridHost.hidden = shape !== "grid";
    if (shape !== "grid") return;
    gridHost.innerHTML = "";
    const sorted = [...stRows].sort((a, b) => (b.v[`land_${sortKey}`] ?? -1) - (a.v[`land_${sortKey}`] ?? -1));
    grid = smallMultiples(gridHost, {
      min: 92,
      items: sorted.map((r) => ({ key: r.key, label: r.v.abbr || r.key, sub: pct(r.v[`land_${sortKey}`], 0), row: r })),
      render: (cell, it) => donut(cell, {
        interactive: false, size: 62, thickness: 12,
        parts: LAND_KEYS.map((k) => ({ key: k, label: LAND_LABEL[k], value: it.row.v[`land_${k}`], color: LAND_COLOR[k] })),
        center: { big: pct(it.row.v[`land_${sortKey}`], 0), small: "" },
        ariaLabel: `${it.row.name}: ${LAND_KEYS.map((k) => `${LAND_LABEL[k]} ${pct(it.row.v[`land_${k}`], 0)}`).join(", ")}`,
      }),
      onHover: (it) => link.hover(it ? rowsHighlight(states, [it.row]) : null),
      onClick: (it) => states.focus(it.row),
    });
  }
  drawShape();

  // --- forest: the official rate against the satellite's tree share --------------------------------------------------
  const fcF = states.field("forest_cover");
  let fcTable = null;
  if (fcF) {
    const fy = yearText(fcF.year);
    const oBody = section(el, { title: tr("Two kinds of forest"), note: tr("The official forest cover rate ({y}, NSO from the forestry sector's monitoring) against the share of land that looks like forest from space (ESA WorldCover 2021), by the 34 provinces. Vietnam: {o} official, {w} WorldCover.", { y: esc(fy), o: pct(data.nat.forest_cover, 0), w: pct(share.forest, 0) }) });
    const oCtl = document.createElement("div");
    oCtl.className = "adv-row";
    oBody.appendChild(oCtl);
    for (const [id, label] of [["forest_cover", tr("Official forest lens")], ["forest", tr("Forest lens")]]) {
      const b = lensButton(app, id, label);
      if (b) oCtl.appendChild(b);
    }
    const diff = (r) => (fin(r.v.forest_cover) && fin(r.v.land_forest) ? r.v.forest_cover - r.v.land_forest : null);
    const pts = (v) => (fin(v) ? `${v >= 0 ? "+" : "−"}${int(Math.abs(v * 100))} ${tr("pts")}` : "–");
    fcTable = createTable(oBody, {
      caption: tr("Official forest cover and WorldCover forest by province"), rank: true, maxHeight: 300, rows: states.rows.filter((r) => fin(r.v.forest_cover)),
      columns: [
        { key: "name", label: tr("Province"), align: "l", value: (r) => r.name, text: (r) => r.name },
        { key: "official", label: fcF.label, short: esc(tr("Official {y}", { y: fy })), value: (r) => r.v.forest_cover, text: (r) => pct(r.v.forest_cover, 0), bar: { max: 1, color: "rgba(63,122,58,.45)" } },
        { key: "wc", label: tr("WorldCover forest (2021)"), short: esc(tr("Satellite 2021")), value: (r) => r.v.land_forest, text: (r) => pct(r.v.land_forest, 0) },
        { key: "diff", label: tr("Official minus satellite, percentage points"), short: esc(tr("Gap")), value: diff, text: (r) => pts(diff(r)) },
      ],
      sort: { key: "official", dir: "desc" },
      onHover: (r) => link.hover(r ? rowsHighlight(states, [r]) : null),
      onClick: (r) => states.focus(r),
    });
    ctx.cleanup(() => fcTable.destroy());
    oBody.insertAdjacentHTML("beforeend", `<p class="adv-note">${tr("Why they differ: the official rate counts the natural and planted forest the forestry sector records, over the province's whole area. WorldCover classes each 10 m patch of 2021 imagery by what it looks like, averaged over the province's hexes: tree crops such as rubber, coffee or orchards can read as forest, while young or freshly harvested plantations may not. The years differ too (2021 imagery, the official rate at {y}).", { y: esc(fy) })}</p>`);
  }

  // --- the rice harvest -----------------------------------------------------------------------------------------
  const food = app.data.nation.yields?.find((y) => y.key === "food");
  const natKg = ratio(data.nat.yields?.food, data.nat.population);
  const fBody = section(el, { title: tr("The rice bowls"), note: tr("{desc} Ranked by tonnes harvested, or by kilograms per resident (Vietnam: {kg} kg).", { desc: esc(food?.description ? tr(food.description) : tr("Paddy rice harvested in the year, in tonnes.")), kg: fin(natKg) ? int(natKg * 1000) : "–" }) });
  const fHost = document.createElement("div");
  let fLevel = "states", fMode = "total";
  const fCtl = document.createElement("div");
  fCtl.className = "adv-row";
  fBody.appendChild(fCtl);
  segmented(fCtl, { label: tr("Areas"), value: fLevel, options: [{ value: "states", label: tr("Provinces") }, { value: data.levels.counties ? "counties" : "metros", label: data.levels.counties ? tr("Former provinces") : tr("Cities") }], onChange: (v) => { fLevel = v; drawFood(); } });
  segmented(fCtl, { label: tr("Rank by"), value: fMode, options: [{ value: "total", label: tr("Tonnes") }, { value: "per", label: tr("Per resident") }], onChange: (v) => { fMode = v; drawFood(); } });
  fBody.appendChild(fHost);
  const kg = (r) => { const t = ratio(r.v.paddy, r.v.population); return fin(t) ? t * 1000 : null; };
  function drawFood() {
    fHost.innerHTML = "";
    const lv = data.levels[fLevel];
    const list = topBy(lv.rows, fMode === "total" ? (r) => r.v.paddy : kg, { n: 10 });
    barList(fHost, {
      rank: true, ariaLabel: tr("Paddy rice harvest"),
      rows: list.map((x) => ({ key: x.r.key, label: x.r.name, sub: fMode === "total" ? tr("{n} kg per resident", { n: int(kg(x.r)) }) : `${count3(x.r.v.paddy)} t`, value: x.v, text: fMode === "total" ? `${count3(x.v)} t` : `${int(x.v)} kg`, color: food?.color, row: x.r })),
      onHover: (r) => link.hover(r ? rowsHighlight(lv, [r.row]) : null),
      onClick: (r) => lv.focus(r.row),
    });
  }
  drawFood();

  const hexR = w.grid.R * (w.raw.km_per_unit || 1); // hex corner radius, km
  el.insertAdjacentHTML("beforeend", sourcesHtml(data, ["worldcover", "nso_yearbook"], [
    tr("Land cover is ESA WorldCover 2021 (10 m) averaged into hexes of about {area} km² ({d} km corner to corner), so small features (a valley's paddies, a small town) blur into their surroundings.", { area: int(hexR ** 2 * 1.5 * Math.sqrt(3)), d: Math.round(2 * hexR) }),
    tr("WorldCover maps what the ground looks like from space: plantations of acacia, rubber or coffee can read as forest, and flooded paddies can read as wetland."),
    ...(fcF ? [tr("The official forest cover rate is NSO's figure at {y}, published by the 34 provinces only.", { y: esc(yearText(fcF.year)) })] : []),
    tr("Paddy output is NSO's {y} harvest, by the 2025 provinces and by the 63 provinces before the July 2025 merger.", { y: esc(yearText(yearOf(data.nat, "paddy"))) }),
  ]));

  return {
    onMapHover(h) {
      const r = h.cell >= 0 ? states.rowAtCell(h.cell) : null;
      table.setHot(r ? r.key : null);
      fcTable?.setHot(r ? r.key : null);
      if (shape === "grid") grid?.setHot(r ? r.key : null);
      if (h.cell >= 0 && owner[h.cell] >= 0) {
        let best = null, bv = 0;
        for (const k of LAND_KEYS) { const v = P[k]?.[h.cell] || 0; if (v > bv) { bv = v; best = k; } }
        sb.setHot(best);
      } else sb.setHot(null);
    },
    onEscape() {
      if (pinned) { pin(null); return true; }
      return false;
    },
  };
}
