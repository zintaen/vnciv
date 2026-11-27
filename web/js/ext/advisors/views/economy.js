// Economy advisor: national jobs by industry, city GRDP on the map, leading provinces and cities, growth vs output.
// Vietnam publishes no GRDP or jobs by industry per province, so industries are national only.
import { esc, fin, ratio, colorScale, robustDomain, RAMPS } from "../core/util.js";
import { money, dollars, pct, signedPct, count3, fmtShort, fixed } from "../core/fmt.js";
import { barList, rampLegend, sizeLegend } from "../core/charts.js";
import { createTable } from "../core/table.js";
import { createScatter } from "../core/scatter.js";
import { section, tiles, segmented, selectBox, lensButton, sourcesHtml, frameBtn } from "../core/view.js";
import { yearOf, yearText, yearPlain } from "../core/years.js";
import { rowsHighlight } from "../core/data.js";
import { icon } from "../../../ui/icon.js";
import { hasIcon } from "../../../icons.js";
import { t as tr } from "../../../i18n.js";

const short = (s) => String(s || "").replace(/\s*\(.*\)\s*$/, "");
const indIcon = (k) => (hasIcon(`i-${k}`) ? icon(`i-${k}`, "•", { size: 14 }) : "");
const perPerson = (r, k) => ratio(r.v[k], r.v.population);

export function mount(ctx) {
  const { app, data, el, link } = ctx;
  const nation = app.data.nation;
  const n = nation.nation || {};
  const metros = data.levels.metros;
  const rows = metros.rows;

  // --- headline -------------------------------------------------------------------------------------------------
  el.insertAdjacentHTML("beforeend", tiles([
    { label: `GRDP ${n.gdp_year || ""}`, value: money(n.gdp), sub: tr("US dollars, current prices") },
    { label: tr("Per person"), value: money(ratio(n.gdp, n.population)), sub: tr("GRDP ÷ residents") },
    ...(fin(n.grdp_growth) ? [{ label: tr("GRDP growth {y}", { y: yearPlain(yearOf(n, "grdp_growth")) }), value: signedPct(n.grdp_growth), sub: tr("constant prices, NSO estimate") }] : []),
    { label: `FDI ${yearPlain(yearOf(n, "fdi"))}`, value: money(n.fdi), sub: (n.fdi < 0 ? tr("net reduction of registered capital") + " · " : "") + tr("{n} new projects", { n: count3(n.fdi_projects) }) },
    ...(fin(n.enterprises_pk) ? [{ label: tr("Enterprises"), value: fixed(n.enterprises_pk, 1), sub: tr("active per 1,000 residents, {y}", { y: yearPlain(yearOf(n, "enterprises_pk")) }) }] : []),
  ]));

  // --- jobs by industry (national) ------------------------------------------------------------------------------
  const indBody = section(el, { title: tr("Jobs by industry"), kicker: tr("Vietnam"), note: tr("Employed workers aged 15+ by the industry they work in, for the whole country. NSO does not publish workers or GRDP by industry for each province, so this one has no map.") });
  const jobs = n.jobs || {};
  barList(indBody, {
    ariaLabel: tr("Employed workers by industry"),
    rows: Object.entries(jobs).filter(([, v]) => fin(v)).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({
      key: k, label: short(tr(nation.industries?.[k] || k)), full: tr(nation.industries?.[k]), value: v, text: count3(v), sub: pct(ratio(v, n.employed)), icon: indIcon(k),
    })),
  });

  // --- map: city GRDP circles -----------------------------------------------------------------------------------
  const mapBody = section(el, { title: tr("The economy on the map"), note: tr("Each circle is a former province, drawn at its city: its area is GRDP, its colour GRDP per person. Hover a circle for numbers; click to open the city.") });
  const ppDomain = robustDomain(rows.map((r) => r.v.gdp_pc), 0.03, true) || [2000, 10000];
  const ppColor = colorScale({ type: "seq", domain: ppDomain, ramp: RAMPS.gold });
  const gMax = Math.max(...rows.map((r) => r.v.gdp || 0));
  const bubbles = ctx.bubbles("gdp", {
    rMax: 30, minR: 1.5, alpha: 0.6,
    tip: (b) => `<b>${esc(b.row.name)}</b> <span class="sub">${esc(b.row.sub)}</span><br>${tr("GRDP <b>{gdp}</b> · per person <b>{pc}</b>", { gdp: money(b.row.v.gdp), pc: money(b.row.v.gdp_pc) })}<br>${tr("{n} people", { n: count3(b.row.v.population) })}`,
    onHover: (b) => { table.setHot(b ? b.key : null); scatter.setHot(b ? b.key : null); link.hover(b ? rowsHighlight(metros, [b.row]) : null); },
    onClick: (b) => app.selectCity(b.row.ref),
  });
  const bubbleItems = rows.filter((r) => fin(r.v.gdp)).map((r) => ({ key: r.key, x: app.w.grid.cx(r.ref.cell), y: app.w.grid.cy(r.ref.cell), value: r.v.gdp, color: ppColor(r.v.gdp_pc), row: r }));
  bubbles.set(bubbleItems, { vMax: gMax });
  const showBubbles = document.createElement("label");
  showBubbles.className = "adv-check";
  showBubbles.innerHTML = `<input type="checkbox" checked> ${tr("Show GRDP circles")}`;
  showBubbles.querySelector("input").addEventListener("change", (e) => bubbles.set(e.target.checked ? bubbleItems : [], { vMax: gMax }));
  mapBody.appendChild(showBubbles);
  mapBody.insertAdjacentHTML("beforeend", rampLegend({ ramp: RAMPS.gold, domain: ppDomain, fmt: money, label: tr("GRDP per person") })
    + sizeLegend([1e9, 1e10, 5e10].filter((v) => v <= gMax), (v) => 30 * Math.sqrt(v / gMax), money, tr("Circle area = GRDP (at the home zoom)")));

  // --- leaders --------------------------------------------------------------------------------------------------
  const lBody = section(el, { title: tr("Who leads"), note: tr("Rank the 2025 provinces or the 63 former provinces (by their cities). GRDP per person swings high where one oil field or industrial park sits in a small population. FDI and enterprises are {sy} for the provinces but {cy} for the former provinces, the last year NSO published them for those.", { sy: yearText(data.levels.states.field("fdi")?.year), cy: yearText(metros.field("fdi")?.year) }) });
  let lvl = data.levels.states, rankBy = "gdp";
  const ctl = document.createElement("div");
  ctl.className = "adv-row";
  lBody.appendChild(ctl);
  segmented(ctl, {
    label: tr("Level"), value: "states",
    options: [{ value: "states", label: data.levels.states.label }, { value: "metros", label: metros.label }],
    onChange: (v) => { lvl = data.levels[v]; if (!lvl.field(rankBy)) rankBy = "gdp"; rankSelect(); table.setColumns(cols(), { key: rankBy, dir: "desc" }); table.setRows(lvl.rows); },
  });
  // Rank options from the level's fields, so each label carries that level's year (FDI 2025 by province, 2024 by city).
  const RANK = ["gdp", "gdp_pc", "grdp_growth", "growth", "fdi", "enterprises_pk", "productivity", "growth_9m2026", "industry_jobs_2026"];
  const rankLabel = { gdp: tr("Largest GRDP") };
  const rankHost = document.createElement("span");
  ctl.appendChild(rankHost);
  const rankSelect = () => {
    rankHost.innerHTML = "";
    selectBox(rankHost, {
      label: tr("Rank by"), value: rankBy,
      options: RANK.filter((k) => lvl.field(k)).map((k) => ({ value: k, label: rankLabel[k] || lvl.field(k).label })),
      onChange: (v) => { rankBy = v; table.setColumns(cols(), { key: v, dir: "desc" }); },
    });
  };
  rankSelect();
  const sMax = Math.max(...data.levels.states.rows.map((r) => r.v.gdp || 0));
  const FMT = { fdi: money, productivity: money, enterprises_pk: (v) => (fin(v) ? fixed(v, 1) : "–") };
  const SHORT = { fdi: "FDI", productivity: tr("Per worker"), enterprises_pk: tr("Firms /1,000"), grdp_growth: tr("GRDP growth"), growth_9m2026: tr("9M 2026"), industry_jobs_2026: tr("Factory jobs") };
  const cols = () => [
    { key: "name", label: tr("Place"), align: "l", value: (r) => r.name, html: (r) => `${esc(r.name)}${r.level === "metros" ? ` <span class="sub">${esc(r.sub)}</span>` : ""}` },
    { key: "gdp", label: "GRDP", value: (r) => r.v.gdp, text: (r) => money(r.v.gdp), bar: { max: sMax, color: "rgba(224,181,76,.35)" } },
    { key: "gdp_pc", label: tr("Per person"), value: (r) => r.v.gdp_pc, text: (r) => money(r.v.gdp_pc) },
    rankBy !== "gdp" && rankBy !== "gdp_pc" && rankBy !== "growth"
      ? { key: rankBy, label: lvl.field(rankBy)?.label || rankBy, short: esc(SHORT[rankBy] || lvl.field(rankBy)?.label || rankBy), value: (r) => r.v[rankBy], text: (r) => (FMT[rankBy] || signedPct)(r.v[rankBy]) }
      : { key: "growth", label: lvl.field("growth")?.label || tr("Growth"), short: esc(tr("Growth")), value: (r) => r.v.growth, text: (r) => signedPct(r.v.growth) },
  ];
  const table = createTable(lBody, {
    caption: tr("Provinces by GRDP"), columns: cols(), rows: lvl.rows, sort: { key: "gdp", dir: "desc" }, rank: true, maxHeight: 280,
    search: tr("Search provinces and cities"),
    onHover: (r) => { link.hover(r ? rowsHighlight(data.levels[r.level], [r]) : null); bubbles.setHot(r?.level === "metros" ? r.key : null); scatter.setHot(r?.level === "metros" ? r.key : null); },
    onClick: (r) => data.levels[r.level].focus(r),
  });

  // --- the latest: 2026 estimates by the 34 provinces ------------------------------------------------------------
  const st = data.levels.states;
  if (st.field("growth_9m2026") || st.field("industry_jobs_2026")) {
    const gy = st.field("growth_9m2026")?.year, jy = st.field("industry_jobs_2026")?.year;
    const nBody = section(el, { title: tr("The latest"), kicker: tr("34 provinces"), note: tr("NSO's monthly estimates for 2026, published only for the 34 provinces: GRDP growth in {gy} over the same months of 2025, and the change in factory jobs (workers in industrial enterprises) at {jy} over a year earlier. Estimates, revised with the full-year figures.", { gy: yearText(gy), jy: yearText(jy) }) });
    const nCtl = document.createElement("div");
    nCtl.className = "adv-row";
    nBody.appendChild(nCtl);
    for (const [id, label] of [["growth_2026", "Growth 2026 lens"], ["industry_jobs_2026", "Factory jobs lens"], ["fdi", "FDI lens"], ["enterprises", "Enterprises lens"]]) {
      const b = lensButton(app, id, tr(label));
      if (b) nCtl.appendChild(b);
    }
    const lat = createTable(nBody, {
      caption: tr("Latest estimates by province"), rank: true, maxHeight: 280, rows: st.rows, sort: { key: "growth_9m2026", dir: "desc" }, search: tr("Search provinces"),
      columns: [
        { key: "name", label: tr("Province"), align: "l", value: (r) => r.name, text: (r) => r.name },
        { key: "growth_9m2026", label: st.field("growth_9m2026")?.label || "", short: esc(tr("9M 2026")), value: (r) => r.v.growth_9m2026, text: (r) => signedPct(r.v.growth_9m2026) },
        { key: "grdp_growth", label: st.field("grdp_growth")?.label || "", short: tr("Year {y}", { y: yearText(st.field("grdp_growth")?.year) }), value: (r) => r.v.grdp_growth, text: (r) => signedPct(r.v.grdp_growth) },
        { key: "industry_jobs_2026", label: st.field("industry_jobs_2026")?.label || "", short: esc(tr("Factory jobs")), value: (r) => r.v.industry_jobs_2026, text: (r) => signedPct(r.v.industry_jobs_2026) },
        { key: "fdi", label: st.field("fdi")?.label || "FDI", short: `FDI ${yearText(st.field("fdi")?.year)}`, value: (r) => r.v.fdi, text: (r) => money(r.v.fdi) },
      ],
      onHover: (r) => link.hover(r ? rowsHighlight(st, [r]) : null),
      onClick: (r) => st.focus(r),
    });
    ctx.cleanup(() => lat.destroy());
    if (fin(n.grdp_growth)) nBody.insertAdjacentHTML("beforeend", `<p class="adv-note">${tr("Vietnam: GRDP growth {v} in {y}; NSO publishes no national figure for the 9-month estimate or factory jobs here.", { v: signedPct(n.grdp_growth), y: yearText(yearOf(n, "grdp_growth")) })}</p>`);
  }

  // --- scatter --------------------------------------------------------------------------------------------------
  const scBody = section(el, { title: tr("Growth vs output"), note: tr("Each dot is a former province (its city): GRDP per person across, population growth up, size = population. Drag a rectangle to select some and outline them on the map.") });
  const scCtl = document.createElement("div");
  scCtl.className = "adv-row";
  scBody.appendChild(scCtl);
  let colorBy = "fdi_pc";
  const COLOR = {
    fdi_pc: { label: tr("FDI per person ({y})", { y: yearPlain(metros.field("fdi")?.year) }), v: (r) => perPerson(r, "fdi"), fmt: money, ramp: RAMPS.seq, log: true },
    unemployment: { label: tr("Unemployment"), v: (r) => r.v.unemployment, fmt: pct, ramp: RAMPS.heat },
    median_income: { label: tr("Income per person"), v: (r) => r.v.median_income, fmt: dollars, ramp: RAMPS.gold },
    pci: { label: metros.field("pci")?.label || "PCI", v: (r) => r.v.pci, fmt: (v) => fixed((+v), 1), ramp: RAMPS.seq },
  };
  selectBox(scCtl, {
    label: tr("Colour"), value: colorBy,
    options: [...Object.entries(COLOR).map(([k, c]) => ({ value: k, label: c.label })), { value: "none", label: tr("None") }],
    onChange: (v) => { colorBy = v; drawScatter(); },
  });
  const legendEl = document.createElement("div");
  const scatter = createScatter(scBody, {
    points: [], height: 300,
    x: { label: tr("GRDP per person"), fmt: (v) => money(v), log: true },
    y: { label: tr("Population growth"), fmt: (v) => fmtShort("signed", v) },
    size: { label: tr("Population"), fmt: count3, max: 15, min: 2 },
    refY: [{ v: n.growth ?? 0, label: tr("Vietnam {v}", { v: signedPct(n.growth) }) }],
    onHover: (p) => { link.hover(p ? rowsHighlight(metros, [p.row]) : null); bubbles.setHot(p ? p.key : null); table.setHot(p ? p.key : null, false); },
    onClick: (p) => app.selectCity(p.row.ref),
    onBrush: (set) => {
      const sel = set ? rows.filter((r) => set.has(r.key)) : [];
      link.base(sel.length ? rowsHighlight(metros, sel, { dim: true }) : null, { frame: sel.length > 1 });
      bubbles.setSelected(set);
      brushInfo.innerHTML = sel.length ? brushSummary(sel) : "";
    },
  });
  scBody.appendChild(legendEl);
  const brushInfo = document.createElement("div");
  brushInfo.className = "adv-brushinfo";
  scBody.appendChild(brushInfo);
  function brushSummary(sel) {
    const pop = sel.reduce((a, r) => a + (r.v.population || 0), 0);
    const gdp = sel.reduce((a, r) => a + (r.v.gdp || 0), 0);
    return `${tr("<b>{n}</b> former provinces selected · {pop} people · {gdp} GRDP ({share} of Vietnam)", { n: sel.length, pop: count3(pop), gdp: money(gdp), share: pct(gdp / n.gdp) })} ${frameBtn()}<button type="button" class="adv-mini" data-clear>${tr("Clear")}</button>`;
  }
  const clearBrush = () => { scatter.setSelected(null); link.base(null); bubbles.setSelected(null); brushInfo.innerHTML = ""; };
  brushInfo.addEventListener("click", (e) => { if (e.target.closest("[data-clear]")) clearBrush(); });

  function drawScatter() {
    const c = COLOR[colorBy];
    let color = null, legend = "";
    if (c) {
      const dom = robustDomain(rows.map(c.v), 0.03, !!c.log) || [0, 1];
      if (c.log) dom[0] = Math.max(dom[0], 1);
      const cs = colorScale({ type: "seq", domain: dom, log: c.log, ramp: c.ramp });
      color = (v) => cs(v);
      legend = rampLegend({ ramp: c.ramp, domain: dom, fmt: c.fmt, log: c.log, label: c.label });
      const off = c.log ? rows.filter((r) => fin(c.v(r)) && c.v(r) <= 0) : [];
      const negs = off.filter((r) => c.v(r) < 0), zeros = off.length - negs.length;
      if (off.length) legend += `<p class="adv-note">${[
        negs.length ? tr("Grey, off the log scale: {list} (a net reduction of registered capital).", { list: negs.map((r) => `${esc(r.name)} ${c.fmt(c.v(r))}`).join(", ") }) : "",
        zeros ? tr("{n} with no FDI in {y} are grey too.", { n: zeros, y: yearText(metros.field("fdi")?.year) }) : "",
      ].filter(Boolean).join(" ")}</p>`;
    }
    const labels = [...rows].sort((a, b) => (b.v.population || 0) - (a.v.population || 0)).slice(0, 8).map((r) => r.key);
    scatter.update({
      points: rows.filter((r) => fin(r.v.gdp_pc) && fin(r.v.growth)).map((r) => ({ key: r.key, x: r.v.gdp_pc, y: r.v.growth, s: r.v.population, c: c ? c.v(r) : null, label: r.name, sub: r.sub, row: r })),
      color, labels, colorLabel: c ? c.label : null, colorFmt: c ? c.fmt : null,
    });
    legendEl.innerHTML = legend;
  }
  drawScatter();

  el.insertAdjacentHTML("beforeend", sourcesHtml(data, ["nso_yearbook", "nso_monthly_2026", "worldbank_fx"], [
    tr("GRDP is {v}. The Vietnam figure here is the sum of the provinces' GRDP; NSO's official national GDP is compiled separately and differs slightly.", { v: esc(tr(nation.gdp_vintage || "NSO GRDP")) }),
    tr("Dong are converted to US dollars at the World Bank official rate for {year} ({fx} ₫ per $): no adjustment for prices, which are lower than in richer countries.", { year: esc(nation.currency?.fx_year || ""), fx: esc(count3(nation.currency?.fx)) }),
    tr("Jobs by industry are national only; workers are counted where they live."),
    tr("FDI is capital newly registered in the year ({sy} for the 34 provinces, {cy} for the 63 former provinces), not money actually disbursed, and it lands where the investor's project is licensed.", { sy: yearText(data.levels.states.field("fdi")?.year), cy: yearText(metros.field("fdi")?.year) }),
    tr("Enterprises per 1,000 residents: {sy} for the provinces, {cy} for the former provinces (no national figure for {cy} is published here, so cities are not compared with Vietnam).", { sy: yearText(data.levels.states.field("enterprises_pk")?.year), cy: yearText(metros.field("enterprises_pk")?.year) }),
  ]));

  return {
    onMapHover(h) {
      const r = h.cell >= 0 ? metros.rowAtCell(h.cell) : null;
      scatter.setHot(r ? r.key : null);
    },
    onEscape() {
      if (scatter.selected) { clearBrush(); return true; }
      return false;
    },
  };
}
