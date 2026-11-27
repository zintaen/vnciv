// People advisor: population, growth, density and town versus country.
import { esc, fin, colorScale, robustDomain, RAMPS } from "../core/util.js";
import { pct, int, signedPct, count3, fmtShort, fmtValue, fixed } from "../core/fmt.js";
import { barList, histogram, rampLegend } from "../core/charts.js";
import { createScatter } from "../core/scatter.js";
import { section, tiles, segmented, mapPicker, frameBtn, sourcesHtml, topBy } from "../core/view.js";
import { rowsHighlight, extendData } from "../core/data.js";
import { yearOf, yearText } from "../core/years.js";
import { growthLens } from "../core/lenses.js";
import { t as tr } from "../../../i18n.js";

export async function mount(ctx) {
  const { app, data, el, link } = ctx;
  const n = data.nat;
  const { states, metros, counties } = data.levels;
  const yrs = n.growth_years || [];
  await extendData(data, ["citizens"]); // net migration per former province (citizens.json)

  el.insertAdjacentHTML("beforeend", tiles([
    { label: tr("Residents"), value: count3(n.population), sub: tr("NSO average population {y}", { y: yearText(yearOf(n, "population")) }) },
    { label: tr("Growth {yrs}", { yrs: yrs.map(Number).join("–") }), value: signedPct(n.growth, 2), sub: tr("NSO average population") },
    ...(fin(n.life_exp) ? [{ label: tr("Life expectancy"), value: tr("{v} yrs", { v: fixed(n.life_exp, 1) }), sub: tr("at birth, {y}", { y: yearText(yearOf(n, "life_exp")) }) }] : []),
    { label: tr("Urban"), value: pct(n.urban), sub: tr("{p} provinces · {c} cities", { p: int(states.rows.length), c: int(metros.rows.length) }) },
  ]));

  // --- the map: growth by default, so the map tells the same story as the first chart ---------------------------
  let gLevel = "metros";
  const mapRow = document.createElement("div");
  mapRow.className = "adv-sec adv-mapsec";
  el.appendChild(mapRow);
  const lensOpt = (value, label, id) => ({ value, label, lens: () => id });
  const picker = mapPicker(ctx, mapRow, {
    value: "growth",
    options: [
      { value: "growth", label: tr("Growth"), lens: () => growthLens(data, gLevel) },
      ...(counties ? [lensOpt("density", tr("Density"), "density"), lensOpt("urban", tr("Urban"), "urban")] : []),
      { value: "terrain", label: tr("Terrain"), lens: () => null },
    ],
  });

  // --- growth ---------------------------------------------------------------------------------------------------
  const gBody = section(el, { title: tr("Who is growing, who is shrinking"), note: tr("Population change {yrs} in NSO average population. Former provinces are shown by the city that stands for each; provinces are the 34 of 2025.", { yrs: yrs.join("–") }) });
  const gHost = document.createElement("div");
  segmented(gBody, { label: tr("Areas"), value: gLevel, options: [{ value: "metros", label: tr("Former provinces") }, { value: "states", label: tr("Provinces") }], onChange: (v) => { gLevel = v; drawGrowth(); if (picker.value === "growth") picker.refresh(); } });
  gBody.appendChild(gHost);
  function drawGrowth() {
    gHost.innerHTML = "";
    const lv = gLevel === "metros" ? metros : states;
    const fast = topBy(lv.rows, (r) => r.v.growth, { n: 8 });
    const slow = topBy(lv.rows, (r) => r.v.growth, { n: 8, asc: true });
    const max = Math.max(...[...fast, ...slow].map((x) => Math.abs(x.v)));
    const mk = (list) => list.map((x) => ({ key: x.r.key, label: gLevel === "metros" ? x.r.v.former || x.r.name : x.r.name, sub: gLevel === "metros" ? x.r.sub : "", value: x.v, text: signedPct(x.v), tone: x.v >= 0 ? "good" : "bad", row: x.r }));
    const opts = {
      diverging: true, max,
      onHover: (r) => link.hover(r ? rowsHighlight(lv, [r.row]) : null),
      onClick: (r) => lv.focus(r.row),
    };
    gHost.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${tr("Fastest growing")}</h4>`);
    barList(gHost, { ...opts, rows: mk(fast), ariaLabel: tr("Fastest growing") });
    gHost.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${slow.every((x) => x.v < 0) ? tr("Shrinking") : tr("Slowest growing")}</h4>`);
    barList(gHost, { ...opts, rows: mk(slow), ariaLabel: tr("Slowest growing") });
  }
  drawGrowth();

  // --- migration ------------------------------------------------------------------------------------------------
  const migRows = metros.rows.filter((r) => fin(r.v.cz_net_migration));
  if (migRows.length) {
    const my = yearText(yearOf(metros.rows[0].ref, "migration"));
    const mBody = section(el, { title: tr("Who moves"), note: tr("Net migration in {y}: people who moved in minus people who moved out, per 1,000 residents, by former province (NSO).", { y: esc(my) }) });
    const sg = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fixed(Math.abs(v), 1)}`;
    const inn = topBy(migRows, (r) => r.v.cz_net_migration, { n: 8 });
    const out = topBy(migRows, (r) => r.v.cz_net_migration, { n: 8, asc: true });
    const max = Math.max(...[...inn, ...out].map((x) => Math.abs(x.v)));
    const mk = (list) => list.map((x) => ({ key: x.r.key, label: x.r.v.former || x.r.name, sub: x.r.sub, value: x.v, text: sg(x.v), tone: x.v >= 0 ? "good" : "bad", row: x.r }));
    const o = { diverging: true, max, onHover: (r) => link.hover(r ? rowsHighlight(metros, [r.row]) : null), onClick: (r) => metros.focus(r.row) };
    mBody.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${tr("Most moving in")}</h4>`);
    barList(mBody, { ...o, rows: mk(inn), ariaLabel: tr("Most moving in") });
    mBody.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${tr("Most moving out")}</h4>`);
    barList(mBody, { ...o, rows: mk(out), ariaLabel: tr("Most moving out") });
  }

  if (!counties) {
    el.insertAdjacentHTML("beforeend", `<p class="adv-empty pad">${tr("counties.json is not built, so the former-province charts are missing.")}</p>`);
    el.insertAdjacentHTML("beforeend", sourcesHtml(data, ["nso_yearbook"], []));
    return {};
  }

  // --- density --------------------------------------------------------------------------------------------------
  const dBody = section(el, { title: tr("How crowded"), note: tr("Former provinces by residents per km² (log scale). Switch to <i>people</i> to weight each one by its population: a third of Vietnamese live in the dense tail around Hà Nội, TP. Hồ Chí Minh and the Red River Delta. Hover a bar to see those provinces; click to keep them outlined.") });
  const dCtl = document.createElement("div");
  dCtl.className = "adv-row";
  dBody.appendChild(dCtl);
  let weighted = false, pinnedBin = null;
  segmented(dCtl, { label: tr("Count"), value: "counties", options: [{ value: "counties", label: tr("Former provinces") }, { value: "people", label: tr("People") }], onChange: (v) => { weighted = v === "people"; drawHist(); } });
  const dLens = document.createElement("button");
  dLens.type = "button";
  dLens.className = "adv-mini";
  dLens.textContent = tr("Colour the map by density");
  dLens.addEventListener("click", () => picker.set("density"));
  dCtl.appendChild(dLens);
  const histHost = document.createElement("div");
  dBody.appendChild(histHost);
  const binInfo = document.createElement("div");
  binInfo.className = "adv-brushinfo";
  dBody.appendChild(binInfo);
  let hist = null;
  const vnDensity = fin(n.density) ? n.density : counties.rows.reduce((a, r) => a + (r.v.population || 0), 0) / counties.rows.reduce((a, r) => a + (r.v.land_km2 || 0), 0);
  const cByKey = counties.byKey;
  const densRamp = RAMPS.heat;
  function drawHist() {
    histHost.innerHTML = "";
    const vals = counties.rows.map((r) => ({ key: r.key, v: r.v.density, w: r.v.population }));
    const dom = [20, 8000];
    hist = histogram(histHost, {
      values: vals, log: true, bins: 20, domain: dom, weighted, height: 130,
      fmt: (v) => fmtShort("float", v), unitLabel: tr("former provinces"), weightFmt: (w) => tr("{n} people", { n: count3(w) }),
      label: tr("Histogram of former-province population density"),
      colorOf: (_, t) => colorScale({ type: "seq", domain: [0, 1], ramp: densRamp })(t),
      markers: [{ v: vnDensity, label: tr("Vietnam average") }],
      onHover: (bin) => link.hover(bin ? rowsHighlight(counties, bin.keys.map((k) => cByKey.get(k)), { dim: true }) : null),
      onClick: (bin) => {
        pinnedBin = pinnedBin === bin.i ? null : bin.i;
        const rows = pinnedBin != null ? bin.keys.map((k) => cByKey.get(k)) : [];
        link.base(rows.length ? rowsHighlight(counties, rows, { dim: true }) : null, { frame: rows.length > 1 });
        binInfo.innerHTML = rows.length ? `${tr("<b>{n}</b> former provinces of {lo}–{hi} people/km² · {pop} people", { n: int(rows.length), lo: fmtShort("float", bin.x0), hi: fmtShort("float", bin.x1), pop: count3(rows.reduce((a, r) => a + (r.v.population || 0), 0)) })} ${frameBtn()}<button type="button" class="adv-mini" data-clear>${tr("Clear")}</button>` : "";
      },
    });
  }
  binInfo.addEventListener("click", (e) => { if (e.target.closest("[data-clear]")) { pinnedBin = null; link.base(null); binInfo.innerHTML = ""; } });
  drawHist();

  // --- town and country -----------------------------------------------------------------------------------------
  const aBody = section(el, { title: tr("Town and country"), note: tr("Each dot is a former province: urban share across, population growth up, size = population, colour = density. Drag a rectangle to select provinces; they light up on the map. Hover the map to find one here.") });
  const aCtl = document.createElement("div");
  aCtl.className = "adv-row";
  aBody.appendChild(aCtl);
  aCtl.innerHTML = `<span class="adv-note">${tr("Colour the map by")}</span><button type="button" class="adv-mini" data-map="urban">${tr("urban share")}</button><button type="button" class="adv-mini" data-map="growth">${tr("growth")}</button>`;
  aCtl.addEventListener("click", (e) => { const v = e.target.closest("[data-map]")?.dataset.map; if (v) picker.set(v); });
  const dDom = robustDomain(counties.rows.map((r) => r.v.density), 0.02, true) || [50, 4000];
  const dColor = colorScale({ type: "seq", domain: dDom, log: true, ramp: RAMPS.heat });
  const big = topBy(counties.rows, (r) => r.v.population, { n: 6 }).map((x) => x.r.key);
  const scatter = createScatter(aBody, {
    height: 310,
    points: counties.rows.map((r) => ({ key: r.key, x: r.v.urban, y: r.v.growth, s: r.v.population, c: r.v.density, label: r.name, sub: r.sub, row: r })),
    x: { label: tr("Urban share"), fmt: (v) => fmtShort("pct", v) },
    y: { label: tr("Growth {yrs}", { yrs: yrs.map(Number).join("–") }), fmt: (v) => fmtShort("signed", v) },
    size: { label: tr("Population"), fmt: count3, max: 16, min: 3 },
    color: (c) => dColor(c), colorLabel: tr("Density"), colorFmt: (v) => `${fmtValue("float", v)} /km²`,
    labels: big,
    refX: fin(n.urban) ? [{ v: n.urban, label: tr("Vietnam") }] : [],
    onHover: (p) => link.hover(p ? rowsHighlight(counties, [p.row]) : null),
    onClick: (p) => counties.focus(p.row),
    onBrush: (set) => {
      const sel = set ? counties.rows.filter((r) => set.has(r.key)) : [];
      link.base(sel.length ? rowsHighlight(counties, sel, { dim: true }) : null, { frame: sel.length > 1 });
      selInfo.innerHTML = sel.length ? selSummary(sel) : "";
    },
  });
  aBody.insertAdjacentHTML("beforeend", rampLegend({ ramp: RAMPS.heat, domain: dDom, log: true, fmt: (v) => fmtShort("float", v), label: tr("People per km²") }));
  const selInfo = document.createElement("div");
  selInfo.className = "adv-brushinfo";
  aBody.appendChild(selInfo);
  function selSummary(sel) {
    const pop = sel.reduce((a, r) => a + (r.v.population || 0), 0);
    const top = [...sel].sort((a, b) => (b.v.population || 0) - (a.v.population || 0)).slice(0, 5);
    return `${tr("<b>{n}</b> former provinces · {pop} people ({share} of Vietnam)", { n: int(sel.length), pop: count3(pop), share: pct(pop / n.population) })}<br><span class="sub">${tr("Largest: {list}", { list: top.map((r) => `${esc(r.name)}, ${esc(r.sub)}`).join(" · ") })}</span> ${frameBtn()}<button type="button" class="adv-mini" data-clear>${tr("Clear")}</button>`;
  }
  selInfo.addEventListener("click", (e) => { if (e.target.closest("[data-clear]")) { scatter.setSelected(null); link.base(null); selInfo.innerHTML = ""; } });

  el.insertAdjacentHTML("beforeend", sourcesHtml(data, ["nso_yearbook", "worldpop"], [
    "Since 1 July 2025 Vietnam has 34 provinces; the NSO figures here are for the 63 former provinces, summed or averaged into the new ones.",
    "The growth map colours each former province by its own change; switch the chart to Provinces to colour every hex by its 2025 province.",
    "Density is residents ÷ natural area, so provinces with large mountains or forest reserves look emptier than their towns feel.",
    "The urban share follows NSO's administrative definition (wards and towns), not built-up land.",
  ].map((c) => tr(c))));

  return {
    onMapHover(h) {
      const r = h.cell >= 0 ? counties.rowAtCell(h.cell) : null;
      scatter.setHot(r ? r.key : null);
      hist?.setHot(r ? hist.binOf(r.v.density)?.i ?? null : null);
    },
    onEscape() {
      if (scatter.selected || pinnedBin != null) {
        scatter.setSelected(null); pinnedBin = null; link.base(null); selInfo.innerHTML = ""; binInfo.innerHTML = "";
        return true;
      }
      return false;
    },
  };
}
