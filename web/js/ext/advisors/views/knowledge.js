// Knowledge advisor: university students (the Science yield), trained workers, literacy and HDI.
import { esc, fin, ratio, colorScale, robustDomain, RAMPS } from "../core/util.js";
import { money, pct, int, count3, fmtShort, fixed } from "../core/fmt.js";
import { barList, histogram, rampLegend } from "../core/charts.js";
import { createTable } from "../core/table.js";
import { createScatter } from "../core/scatter.js";
import { section, tiles, segmented, mapPicker, frameBtn, sourcesHtml, topBy } from "../core/view.js";
import { rowsHighlight } from "../core/data.js";
import { scienceLens } from "../core/lenses.js";
import { t as tr } from "../../../i18n.js";

export function mount(ctx) {
  const { app, data, el, link } = ctx;
  const n = data.nat;
  const nation = app.data.nation;
  const { metros, counties } = data.levels;
  const sci = nation.yields?.find((y) => y.key === "science");
  const vnSci = n.yields?.science;
  const vnShare = ratio(vnSci, n.population);

  el.insertAdjacentHTML("beforeend", tiles([
    { label: tr("University students"), value: count3(vnSci), sub: tr("{n} per 1,000 residents", { n: fin(vnShare) ? fixed((vnShare * 1000), 1) : "–" }), color: sci?.color },
    { label: tr("Trained workers"), value: pct(n.trained), sub: tr("of the labour force") },
    { label: tr("Literacy"), value: pct(n.literacy), sub: tr("people 15+ · HDI {hdi}", { hdi: fin(n.hdi) ? fixed(n.hdi, 3) : "–" }) },
  ]));

  // --- the map: trained workers by default (the scatter's x axis), or students, literacy, HDI -----------------------
  const mapRow = document.createElement("div");
  mapRow.className = "adv-sec adv-mapsec";
  el.appendChild(mapRow);
  const picker = mapPicker(ctx, mapRow, {
    value: "trained",
    options: [
      { value: "trained", label: tr("Trained"), lens: () => "trained" },
      { value: "science", label: tr("Students"), lens: () => scienceLens(data) },
      { value: "literacy", label: tr("Literacy"), lens: () => "literacy" },
      { value: "hdi", label: tr("HDI"), lens: () => "hdi" },
      { value: "terrain", label: tr("Terrain"), lens: () => null },
    ],
  });

  // --- science yield: university students -----------------------------------------------------------------------
  const sBody = section(el, { title: tr("The Science yield"), note: tr("{desc} Each city stands for its whole former province.", { desc: esc(sci?.description ? tr(sci.description) : tr("University students enrolled in the area's universities.")) }) });
  const sHost = document.createElement("div");
  let mode = "share";
  segmented(sBody, { label: tr("Rank by"), value: mode, options: [{ value: "share", label: tr("Per resident") }, { value: "abs", label: tr("Most students") }], onChange: (v) => { mode = v; drawSci(); } });
  const sMap = document.createElement("button");
  sMap.type = "button";
  sMap.className = "adv-mini";
  sMap.textContent = tr("Colour the map by students");
  sMap.addEventListener("click", () => picker.set("science"));
  sBody.querySelector(".adv-seg")?.after(sMap);
  sBody.appendChild(sHost);
  const share = (r) => ratio(r.v.students, r.v.population);
  function drawSci() {
    sHost.innerHTML = "";
    const list = mode === "abs" ? topBy(metros.rows, (r) => r.v.students, { n: 12 }) : topBy(metros.rows, share, { n: 12 });
    barList(sHost, {
      rank: true, ariaLabel: tr("University cities"),
      rows: list.map((x) => ({ key: x.r.key, label: x.r.name, sub: mode === "abs" ? tr("{n} per 1,000", { n: fixed((share(x.r) * 1000), 0) }) : `×${fixed((share(x.r) / vnShare), 1)} VN`, value: x.v, text: mode === "abs" ? count3(x.v) : `${fixed((x.v * 1000), 0)} / 1,000`, color: sci?.color, row: x.r })),
      onHover: (r) => link.hover(r ? rowsHighlight(metros, [r.row]) : null),
      onClick: (r) => metros.focus(r.row),
    });
    const none = metros.rows.filter((r) => r.v.students === 0).length;
    if (none) sHost.insertAdjacentHTML("beforeend", `<p class="adv-note">${tr("{n} of {total} former provinces have no university of their own.", { n: int(none), total: int(metros.rows.length) })}</p>`);
  }
  drawSci();

  if (!counties) {
    el.insertAdjacentHTML("beforeend", `<p class="adv-empty pad">${tr("counties.json is not built, so the former-province charts are missing.")}</p>`);
    el.insertAdjacentHTML("beforeend", sourcesHtml(data, ["nso_yearbook"], []));
    return {};
  }

  // --- training vs income ----------------------------------------------------------------------------------------
  const dBody = section(el, { title: tr("Skills and income"), note: tr("Share of the labour force with vocational or higher training against average income per person; colour = HDI. Drag to select; hover the map to find a place.") });
  const dCtl = document.createElement("div");
  dCtl.className = "adv-row";
  dBody.appendChild(dCtl);
  let level = "counties";
  segmented(dCtl, { label: tr("Places"), value: level, options: [{ value: "counties", label: tr("Former provinces") }, { value: "states", label: tr("Provinces") }], onChange: (v) => { level = v; drawDeg(); } });
  const lv = () => data.levels[level];
  const inc = (r) => (level === "counties" ? r.v.income : r.v.median_income);
  const hdiDom = robustDomain(counties.rows.map((r) => r.v.hdi), 0.02) || [0.62, 0.82];
  const hdiColor = colorScale({ type: "seq", domain: hdiDom, ramp: RAMPS.seq });
  const scatter = createScatter(dBody, {
    height: 300, points: [],
    x: { label: tr("Trained workers"), fmt: (v) => fmtShort("pct", v) },
    y: { label: tr("Income per person per year"), fmt: money, log: true },
    size: { label: tr("Population"), fmt: count3, max: 14, min: 2 },
    color: (c) => hdiColor(c), colorLabel: tr("HDI"), colorFmt: (v) => fixed(v, 3),
    onHover: (p) => link.hover(p ? rowsHighlight(lv(), [p.row]) : null),
    onClick: (p) => lv().focus(p.row),
    onBrush: (set) => {
      const sel = set ? lv().rows.filter((r) => set.has(r.key)) : [];
      link.base(sel.length ? rowsHighlight(lv(), sel, { dim: true }) : null, { frame: sel.length > 1 });
      selInfo.innerHTML = sel.length ? `${tr("<b>{n}</b> {places} · {people} people", { n: int(sel.length), places: esc(lv().label.toLowerCase()), people: count3(sel.reduce((a, r) => a + (r.v.population || 0), 0)) })} ${frameBtn()}<button type="button" class="adv-mini" data-clear>${tr("Clear")}</button>` : "";
    },
  });
  dBody.insertAdjacentHTML("beforeend", rampLegend({ ramp: RAMPS.seq, domain: hdiDom, fmt: (v) => fixed(v, 2), label: tr("Human Development Index") }));
  const selInfo = document.createElement("div");
  selInfo.className = "adv-brushinfo";
  dBody.appendChild(selInfo);
  const clearSel = () => { scatter.setSelected(null); link.base(null); selInfo.innerHTML = ""; };
  selInfo.addEventListener("click", (e) => { if (e.target.closest("[data-clear]")) clearSel(); });
  function drawDeg() {
    clearSel();
    const rows = lv().rows;
    scatter.update({
      points: rows.map((r) => ({ key: r.key, x: r.v.trained, y: inc(r), s: r.v.population, c: r.v.hdi, label: r.name, sub: r.sub, row: r })),
      labels: topBy(rows, (r) => r.v.population, { n: 6 }).map((x) => x.r.key),
    });
  }
  drawDeg();

  // --- literacy -------------------------------------------------------------------------------------------------
  const bBody = section(el, { title: tr("Reading and writing"), note: tr("Former provinces by the literacy rate of people aged 15+ (Vietnam: {pct}). The lowest rates are in the northern and central highlands. Hover a bar to outline those provinces.", { pct: pct(n.literacy) }) });
  const bHost = document.createElement("div");
  bBody.appendChild(bHost);
  const bbHist = histogram(bHost, {
    values: counties.rows.map((r) => ({ key: r.key, v: r.v.literacy })), bins: 24, domain: [0.7, 1], height: 120,
    fmt: (v) => fmtShort("pct", v), unitLabel: tr("former provinces"), label: tr("Histogram of literacy rates by former province"),
    colorOf: (_, t) => colorScale({ type: "seq", domain: [0, 1], ramp: RAMPS.seq })(t),
    onHover: (bin) => link.hover(bin ? rowsHighlight(counties, bin.keys.map((k) => counties.byKey.get(k)), { dim: true }) : null),
  });
  createTable(bBody, {
    caption: tr("Literacy by former province"), rank: true, maxHeight: 240, search: tr("Search former provinces"),
    rows: counties.rows.filter((r) => fin(r.v.literacy)),
    columns: [
      { key: "name", label: tr("Former province"), align: "l", value: (r) => r.name, html: (r) => `${esc(r.name)} <span class="sub">${esc(r.sub)}</span>` },
      { key: "population", label: tr("People"), value: (r) => r.v.population, text: (r) => count3(r.v.population) },
      { key: "literacy", label: tr("Literacy"), value: (r) => r.v.literacy, text: (r) => pct(r.v.literacy), bar: { max: 1, color: "rgba(74,134,214,.4)" } },
      { key: "trained", label: tr("Trained"), value: (r) => r.v.trained, text: (r) => pct(r.v.trained) },
      { key: "hdi", label: tr("HDI"), value: (r) => r.v.hdi, text: (r) => (fin(r.v.hdi) ? fixed(r.v.hdi, 3) : "–") },
    ],
    sort: { key: "literacy", dir: "asc" },
    onHover: (r) => link.hover(r ? rowsHighlight(counties, [r]) : null),
    onClick: (r) => counties.focus(r),
  });

  el.insertAdjacentHTML("beforeend", sourcesHtml(data, ["nso_yearbook"], [
    tr("Students are counted where their university is, not where they come from: a province without a university counts zero even if many of its young people study in Hà Nội or TP. Hồ Chí Minh."),
    tr("Student counts are for the 2023 school year; training, literacy and HDI are NSO 2024 figures."),
    tr("\"Trained\" means a vocational certificate, college or university degree recognised by NSO; on-the-job skills do not count."),
    tr("Province figures for 2025 are NSO's recompiled totals for the merged provinces; former-province figures are {vintage}.", { vintage: esc(tr(data.countyVintage)) }),
  ]));

  return {
    onMapHover(h) {
      const r = h.cell >= 0 ? lv().rowAtCell(h.cell) : null;
      scatter.setHot(r ? r.key : null);
      const c = h.cell >= 0 ? counties.rowAtCell(h.cell) : null;
      bbHist.setHot(c ? bbHist.binOf(c.v.literacy)?.i ?? null : null);
    },
    onEscape() {
      if (scatter.selected) { clearSel(); return true; }
      return false;
    },
  };
}
