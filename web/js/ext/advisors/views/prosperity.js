// Prosperity advisor: income vs poverty, inequality, worker pay and unemployment.
import { esc, fin, colorScale, RAMPS } from "../core/util.js";
import { money, dollars, pct, int, count3, fmtShort, fixed } from "../core/fmt.js";
import { barList, histogram, rampLegend } from "../core/charts.js";
import { createTable } from "../core/table.js";
import { createScatter } from "../core/scatter.js";
import { section, tiles, segmented, lensButton, sourcesHtml, topBy, frameBtn } from "../core/view.js";
import { rowsHighlight } from "../core/data.js";
import { yearOf, yearText, vnLabel } from "../core/years.js";
import { t as tr } from "../../../i18n.js";

export function mount(ctx) {
  const { app, data, el, link } = ctx;
  const n = data.nat;
  const { states, metros, counties } = data.levels;

  el.insertAdjacentHTML("beforeend", tiles([
    { label: tr("Income"), value: dollars(n.median_income), sub: tr("per person per year") },
    { label: tr("Worker income"), value: dollars(n.income_worker), sub: tr("per worker per year") },
    { label: tr("Poverty"), value: pct(n.poverty), sub: tr("of households · Gini {g}", { g: fin(n.gini) ? fixed(n.gini, 2) : "–" }) },
    ...(fin(n.hdi) ? [{ label: `HDI ${yearText(yearOf(n, "hdi"))}`, value: fixed(n.hdi, 3), sub: tr("Human Development Index") }] : []),
  ]));

  // --- income vs poverty ----------------------------------------------------------------------------------------
  const aBody = section(el, { title: tr("Rich and poor"), note: tr("Average income per person against the share of poor households; colour = inequality (Gini). The dashed line is Vietnam's average income. Drag a rectangle to select places; hover the map to find one here.") });
  const aCtl = document.createElement("div");
  aCtl.className = "adv-row";
  aBody.appendChild(aCtl);
  let level = counties ? "counties" : "states";
  segmented(aCtl, { label: tr("Places"), value: level, options: [...(counties ? [{ value: "counties", label: tr("Former provinces") }] : []), { value: "states", label: tr("Provinces") }], onChange: (v) => { level = v; drawAfford(); } });
  for (const [id, label] of [["income", "Income lens"], ["gini", "Inequality lens"]]) {
    const b = lensButton(app, id, tr(label));
    if (b) aCtl.appendChild(b);
  }
  const giniDomain = [0.28, 0.42];
  const giniColor = colorScale({ type: "seq", domain: giniDomain, ramp: RAMPS.heat });
  const lv = () => data.levels[level];
  const inc = (r) => (level === "counties" ? r.v.income : r.v.median_income);
  const scatter = createScatter(aBody, {
    height: 310, points: [],
    x: { label: tr("Income per person per year"), fmt: money },
    y: { label: tr("Poor households"), fmt: (v) => fmtShort("pct", v) },
    size: { label: tr("Population"), fmt: count3, max: 16, min: 3 },
    refX: fin(n.median_income) ? [{ v: n.median_income, label: tr("Vietnam") }] : [],
    color: (c) => giniColor(c), colorLabel: "Gini", colorFmt: (v) => fixed((+v), 2),
    onHover: (p) => { link.hover(p ? rowsHighlight(lv(), [p.row]) : null); affTable.setHot(p ? p.key : null, false); },
    onClick: (p) => lv().focus(p.row),
    onBrush: (set) => {
      const sel = set ? lv().rows.filter((r) => set.has(r.key)) : [];
      link.base(sel.length ? rowsHighlight(lv(), sel, { dim: true }) : null, { frame: sel.length > 1 });
      affTable.setSelected(set);
      selInfo.innerHTML = sel.length ? `${tr("<b>{n}</b> {places} selected · {pop} people", { n: int(sel.length), places: esc(lv().label.toLowerCase()), pop: count3(sel.reduce((a, r) => a + (r.v.population || 0), 0)) })} ${frameBtn()}<button type="button" class="adv-mini" data-clear>${tr("Clear")}</button>` : "";
    },
  });
  aBody.insertAdjacentHTML("beforeend", rampLegend({ ramp: RAMPS.heat, domain: giniDomain, fmt: (v) => fixed(v, 2), label: tr("Gini index (higher = more unequal)") }));
  const selInfo = document.createElement("div");
  selInfo.className = "adv-brushinfo";
  aBody.appendChild(selInfo);
  const clearSel = () => { scatter.setSelected(null); affTable.setSelected(null); link.base(null); selInfo.innerHTML = ""; };
  selInfo.addEventListener("click", (e) => { if (e.target.closest("[data-clear]")) clearSel(); });
  aBody.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${tr("Income table")}</h4>`);
  const affTable = createTable(aBody, {
    caption: tr("Income, poverty and inequality"), rank: true, maxHeight: 260, rows: [], search: tr("Search places"),
    columns: [
      { key: "name", label: tr("Place"), align: "l", value: (r) => r.name, html: (r) => `${esc(r.name)} <span class="sub">${esc(r.sub)}</span>` },
      { key: "inc", label: tr("Income"), value: inc, text: (r) => dollars(inc(r)) },
      { key: "poverty", label: tr("Poverty"), value: (r) => r.v.poverty, text: (r) => pct(r.v.poverty) },
      { key: "gini", label: "Gini", value: (r) => r.v.gini, html: (r) => fin(r.v.gini) ? `<span class="dot" style="background:${giniColor(r.v.gini)}"></span>${fixed(r.v.gini, 3)}` : "–" },
    ],
    sort: { key: "inc", dir: "desc" },
    onHover: (r) => { link.hover(r ? rowsHighlight(lv(), [r]) : null); scatter.setHot(r ? r.key : null); },
    onClick: (r) => lv().focus(r),
  });
  function drawAfford() {
    clearSel();
    const rows = lv().rows.filter((r) => fin(inc(r)) && fin(r.v.poverty));
    scatter.update({
      points: rows.map((r) => ({ key: r.key, x: inc(r), y: r.v.poverty, s: r.v.population, c: r.v.gini, label: r.name, sub: r.sub, row: r })),
      labels: topBy(rows, (r) => r.v.population, { n: 6 }).map((x) => x.r.key),
    });
    affTable.setRows(rows);
  }
  drawAfford();

  // --- poverty --------------------------------------------------------------------------------------------------
  let povHist = null;
  if (counties) {
    const pBody = section(el, { title: tr("Poverty"), note: tr("Former provinces by the share of households under the multidimensional poverty standard (income plus access to health, schooling, housing, water and information). Hover a bar to outline those provinces; the table lists them all.") });
    const pCtl = document.createElement("div");
    pCtl.className = "adv-row";
    pBody.appendChild(pCtl);
    const lb = lensButton(app, "poverty", tr("Poverty lens"));
    if (lb) pCtl.appendChild(lb);
    const pHost = document.createElement("div");
    pBody.appendChild(pHost);
    const vnPov = n.poverty;
    povHist = histogram(pHost, {
      values: counties.rows.map((r) => ({ key: r.key, v: r.v.poverty, w: r.v.population })), bins: 24, domain: [0, 0.24], height: 120,
      fmt: (v) => fmtShort("pct", v), unitLabel: tr("former provinces"), label: tr("Histogram of former-province poverty rates"),
      colorOf: (_, t) => colorScale({ type: "seq", domain: [0, 1], ramp: RAMPS.heat })(t),
      markers: fin(vnPov) ? [{ v: vnPov, label: tr("Vietnam {v}", { v: pct(vnPov) }) }] : [],
      onHover: (bin) => link.hover(bin ? rowsHighlight(counties, bin.keys.map((k) => counties.byKey.get(k)), { dim: true }) : null),
    });
    const povTable = createTable(pBody, {
      caption: tr("Former-province poverty rates"), rank: true, maxHeight: 240, rows: counties.rows.filter((r) => fin(r.v.poverty)), search: tr("Search former provinces"),
      columns: [
        { key: "name", label: tr("Former province"), align: "l", value: (r) => r.name, html: (r) => `${esc(r.name)} <span class="sub">${esc(r.sub)}</span>` },
        { key: "population", label: tr("People"), value: (r) => r.v.population, text: (r) => count3(r.v.population) },
        { key: "poverty", label: tr("Poverty"), value: (r) => r.v.poverty, text: (r) => pct(r.v.poverty), bar: { max: 0.25, color: "rgba(232,119,74,.4)" } },
        { key: "income", label: tr("Income"), value: (r) => r.v.income, text: (r) => dollars(r.v.income) },
      ],
      sort: { key: "poverty", dir: "desc" },
      onHover: (r) => link.hover(r ? rowsHighlight(counties, [r]) : null),
      onClick: (r) => counties.focus(r),
    });
    ctx.cleanup(() => povTable.destroy());
  }

  // --- worker income -------------------------------------------------------------------------------------------
  const rBody = section(el, { title: tr("What a job pays"), note: tr("Average income of an employed worker per year, by 2025 province. Factory and service jobs around the two big cities pay most; farm work in the mountains and the Mekong Delta least.") });
  const wRows = (list) => list.map((x) => ({ key: x.r.key, label: x.r.name, sub: fin(x.r.v.median_income) ? tr("{v} per person", { v: dollars(x.r.v.median_income) }) : "", value: x.v, text: dollars(x.v), tone: x.v > n.income_worker * 1.03 ? "good" : x.v < n.income_worker * 0.97 ? "bad" : null, row: x.r }));
  const rOpts = { onHover: (r) => link.hover(r ? rowsHighlight(states, [r.row]) : null), onClick: (r) => states.focus(r.row) };
  const hi = topBy(states.rows, (r) => r.v.income_worker, { n: 8 });
  const lo = topBy(states.rows, (r) => r.v.income_worker, { n: 8, asc: true });
  const rmax = Math.max(...hi.map((x) => x.v));
  rBody.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${tr("Best paid")}</h4>`);
  barList(rBody, { ...rOpts, rows: wRows(hi), max: rmax, ariaLabel: tr("Highest worker income") });
  rBody.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${tr("Least paid")}</h4>`);
  barList(rBody, { ...rOpts, rows: wRows(lo), max: rmax, ariaLabel: tr("Lowest worker income") });
  rBody.insertAdjacentHTML("beforeend", `<p class="adv-note">${tr("Vietnam: {v} per worker per year.", { v: dollars(n.income_worker) })}</p>`);

  // --- unemployment ---------------------------------------------------------------------------------------------
  const uBody = section(el, { title: tr("Unemployment"), note: tr("Unemployed ÷ labour force aged 15+ ({vintage}). Vietnam: {v}. Rates are low because most people without a formal job work informally or on the family farm.", { vintage: esc(tr(data.vintage)), v: pct(n.unemployment) }) });
  const uHost = document.createElement("div");
  let uLevel = "states";
  segmented(uBody, { label: tr("Areas"), value: uLevel, options: [{ value: "states", label: tr("Provinces") }, { value: "metros", label: tr("Former provinces") }], onChange: (v) => { uLevel = v; drawU(); } });
  uBody.appendChild(uHost);
  function drawU() {
    uHost.innerHTML = "";
    const lvU = uLevel === "states" ? states : metros;
    const high = topBy(lvU.rows, (r) => r.v.unemployment, { n: 8 });
    const low = topBy(lvU.rows, (r) => r.v.unemployment, { n: 8, asc: true });
    const max = Math.max(...high.map((x) => x.v));
    const mk = (list) => list.map((x) => ({ key: x.r.key, label: uLevel === "metros" ? x.r.v.former || x.r.name : x.r.name, sub: uLevel === "metros" ? x.r.sub : "", value: x.v, text: pct(x.v), tone: x.v > n.unemployment * 1.03 ? "bad" : x.v < n.unemployment * 0.97 ? "good" : null, row: x.r }));
    const o = { max, onHover: (r) => link.hover(r ? rowsHighlight(lvU, [r.row]) : null), onClick: (r) => lvU.focus(r.row) };
    uHost.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${tr("Highest")}</h4>`);
    barList(uHost, { ...o, rows: mk(high) });
    uHost.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${tr("Lowest")}</h4>`);
    barList(uHost, { ...o, rows: mk(low) });
  }
  drawU();

  // --- quality of life: services by former province, health and roads by province ---------------------------------
  // [field, lens id, level, format, higher is better?]
  const QOL = [
    ["internet", "internet", metros, (v) => pct(v), true],
    ["clean_water", "clean_water", metros, (v) => pct(v), true],
    ["housing", "housing", metros, (v) => pct(v), true],
    ["hdi", "hdi", states, (v) => fixed(v, 3), true],
    ["doctors_pk", "doctors", states, (v) => fixed(v, 1), true],
    ["road_deaths", "road_deaths", states, (v) => fixed(v, 1), false],
  ].filter(([k, , lv]) => lv.field(k));
  if (QOL.length) {
    const qBody = section(el, { title: tr("Quality of life"), note: tr("Internet, clean water and permanent housing by the 63 former provinces (shown by their cities); human development, doctors and road deaths by the 34 provinces, the only level NSO publishes them for. Each list says its year; Vietnam's figure is for the same year.") });
    const qCtl = document.createElement("div");
    qCtl.className = "adv-row";
    qBody.appendChild(qCtl);
    const qHost = document.createElement("div");
    let qKey = QOL[0][0];
    const lensSlot = document.createElement("span");
    segmented(qCtl, { label: tr("Indicator"), value: qKey, options: QOL.map(([k, , lv]) => ({ value: k, label: lv.field(k).label })), onChange: (v) => { qKey = v; drawQ(); } });
    qCtl.appendChild(lensSlot);
    qBody.appendChild(qHost);
    function drawQ() {
      const [k, lensId, lvQ, fmt, good] = QOL.find((x) => x[0] === qKey);
      const f = lvQ.field(k);
      lensSlot.innerHTML = "";
      const b = lensButton(app, lensId, tr("Show on map"));
      if (b) lensSlot.appendChild(b);
      qHost.innerHTML = `<p class="adv-note">${esc(f.unit || "")} · ${esc(yearText(f.year))}${lvQ === metros ? ` · ${esc(tr("63 former provinces"))}` : ` · ${esc(tr("34 provinces"))}`}</p>`;
      const ref = data.vn(lvQ.rows[0], k);
      const best = topBy(lvQ.rows, (r) => r.v[k], { n: 8, asc: !good });
      const worst = topBy(lvQ.rows, (r) => r.v[k], { n: 8, asc: good });
      const max = Math.max(...lvQ.rows.map((r) => r.v[k]).filter(fin));
      const tone = (v) => (!ref ? null : v > ref.v * 1.01 ? (good ? "good" : "bad") : v < ref.v * 0.99 ? (good ? "bad" : "good") : null);
      const mk = (list) => list.map((x) => ({ key: x.r.key, label: lvQ === metros ? x.r.v.former || x.r.name : x.r.name, sub: lvQ === metros ? x.r.sub : "", value: x.v, text: fmt(x.v), tone: tone(x.v), row: x.r }));
      const o = { max, onHover: (r) => link.hover(r ? rowsHighlight(lvQ, [r.row]) : null), onClick: (r) => lvQ.focus(r.row) };
      qHost.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${tr("Best")}</h4>`);
      barList(qHost, { ...o, rows: mk(best), ariaLabel: tr("Best") });
      qHost.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${tr("Lagging")}</h4>`);
      barList(qHost, { ...o, rows: mk(worst), ariaLabel: tr("Lagging") });
      if (ref) qHost.insertAdjacentHTML("beforeend", `<p class="adv-note">${esc(vnLabel(ref))}: ${fmt(ref.v)}</p>`);
      if (lensId === "clean_water") qHost.insertAdjacentHTML("beforeend", `<p class="adv-note">${tr("Above 95% almost everywhere; the lists show the few that lag.")}</p>`);
    }
    drawQ();
  }

  el.insertAdjacentHTML("beforeend", sourcesHtml(data, ["nso_yearbook", "worldbank_fx"], [
    tr("Figures are NSO's for {y} unless a year is shown. Income, poverty, inequality and the services above are published for the 63 former provinces (the 2025 provinces combine them); HDI {hy}, doctors and road deaths only for the 34 provinces.", { y: esc(data.mainYear), hy: esc(yearText(states.field("hdi")?.year)) }),
    ...[
    "Income per person comes from the household living standards survey; worker income from the labour force survey. They are different surveys and do not divide into each other.",
    "Poverty is the multidimensional standard for 2022–2025: a household is poor on low income or on missing basic services.",
    ].map((c) => tr(c)),
    tr("Money is converted from đồng at the World Bank {y} rate and does not adjust for living costs, which are lower in the countryside.", { y: esc(data.fxYear) }),
    tr("Doctors are those in State-sector health facilities; private doctors are not counted."),
  ]));

  return {
    onMapHover(h) {
      const l = lv();
      const r = h.cell >= 0 ? l.rowAtCell(h.cell) : null;
      scatter.setHot(r ? r.key : null);
      affTable.setHot(r ? r.key : null);
      if (povHist && counties) {
        const c = h.cell >= 0 ? counties.rowAtCell(h.cell) : null;
        povHist.setHot(c ? povHist.binOf(c.v.poverty)?.i ?? null : null);
      }
    },
    onEscape() {
      if (scatter.selected) { clearSel(); return true; }
      return false;
    },
  };
}
