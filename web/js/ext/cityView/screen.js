// The city screen: a docked dashboard (a bottom sheet on phones) with the header (and its city-type badge),
// Citizens (figure rows from citizens.json), Districts (districts.json + military.json, air routes from trade.json),
// Economy, Workforce, Resources and Compare. Plain HTML strings + inline SVG charts; render(el, model, handlers) fills `el`. The
// citizens and districts files load on demand (h.loadData) and fill their sections when they arrive.
import { esc, fixed, int, kindOf, pct, siteDetail, siteDetailHtml } from "../../format.js";
import { compact, money, popShort, yieldValue } from "./fmt.js";
import { icon, glyph } from "../../ui/icon.js";
import { css } from "../../color.js";
import { t } from "../../i18n.js";
const tr = t; // resources() names its resource type `t`
import { isCapital } from "../../world.js";
import { fullName } from "../../ui/infoPanel.js";
import { sparkline, meter, bar } from "./charts.js";
import { jobIndustries, popSeries, rankCount, resourceValue, LAND } from "./model.js";
import { citizensHtml, mountCitizens } from "./citizens.js";
import { badgeHtml, cityDistricts, districtsHtml } from "./districts.js";
import { yearOf, yearText, plainYear, vnRef, vnLabel, popIn } from "../advisors/core/years.js";
// yearText() returns HTML (escaped); labels, tooltips and titles here are plain text escaped once where they are written.
const UNESC = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };
const yearPlain = (y, o) => yearText(y, o).replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => UNESC[e]);

const TABS = [
  ["citizens", "Citizens", "pop"],
  ["districts", "Districts", "l-developed"],
  ["economy", "Economy", "y-gold"],
  ["workforce", "Workforce", "y-production"],
  ["resources", "Resources", "resources"],
  ["compare", "Compare", "layers"],
];

const signed = (g, d = 1) => (g == null ? "–" : `${g >= 0 ? "+" : "−"}${fixed(Math.abs(g * 100), d)}%`);
const rankCache = new WeakMap();
function countOf(cities, key) {
  let m = rankCache.get(cities);
  if (!m) rankCache.set(cities, (m = new Map()));
  if (!m.has(key)) m.set(key, rankCount(cities, key));
  return m.get(key);
}

function rankBadge(rank, of, label, tip, year) {
  if (rank == null) return "";
  if (year) { label = `${label} ${year}`; tip = tip || t("{label}: #{r} of {n} former provinces (1 = highest)", { label, r: rank, n: of }); }
  const tier = rank <= 5 ? "gold" : rank <= 20 ? "silver" : "bronze";
  return `<div class="cv-rank ${tier}" title="${esc(tip || t("{label}: #{r} of {n} former provinces (1 = highest)", { label, r: rank, n: of }))}">
    <span class="cv-medal">#${rank}</span><span class="cv-rank-l">${esc(label)}</span></div>`;
}

function lqBadge(lq) {
  if (lq == null) return "";
  const tip = t("Location quotient: this share is {n}× Vietnam's share", { n: fixed(lq, 2) });
  const cls = lq >= 1.25 ? "hi" : lq <= 0.75 ? "lo" : "mid";
  return `<span class="cv-lq ${cls}" title="${esc(tip)}">×${fixed(lq, 1)}</span>`;
}

function medallion(id, fallback, bg, size = 18) {
  return `<span class="cv-med" style="--bg:${esc(bg)}">${icon(id, fallback, { size })}</span>`;
}

// --- header --------------------------------------------------------------------------------------------------------
function header(m) {
  const c = m.city, n = m.nation.nation;
  const cities = m.cityList;
  const col = css(m.stateRGB);
  const chips = m.states.map((s) => (s.index >= 0
    ? `<button class="chip" data-state="${s.index}" title="${esc(t("Open the province of {name} (2025)", { name: s.name }))}">${esc(s.name)}</button>`
    : `<span class="chip">${esc(s.abbr)}</span>`)).join("");
  const g = Number.isFinite(c.growth) ? c.growth : null;
  const yrs = Array.isArray(c.growth_years) ? c.growth_years : null;
  const growth = g == null ? "" : `<span class="cv-growth ${g >= 0 ? "good" : "bad"}" title="${esc(t("Population change {period}, NSO average population. Vietnam: {v}", { period: yrs ? `${yrs[0]}–${yrs[1]}` : "", v: signed(n.growth) }))}">${g >= 0 ? "▲" : "▼"} ${fixed(Math.abs(g * 100), 1)}%${yrs ? ` <small>${t("since {y}", { y: esc(yrs[0]) })}</small>` : ""}</span>`;
  const perCap = c.gdp != null && c.population ? c.gdp / c.population : null;
  const r = c.ranks || {};
  const N = (k) => countOf(cities, k);
  return `
  <div class="sheet-grip cv-grip" aria-hidden="true"></div>
  <header class="cv-head" style="--sc:${col}">
    <div class="cv-ribbon" aria-hidden="true"></div>
    <button class="icon-btn cv-close" data-close aria-label="${t("Close the City View (Esc)")}" title="${t("Back to the map (Esc)")}">${icon("close", "✕", { size: 13 })}</button>
    <div class="cv-kind">${t("City View")} · ${c.province_old && c.province_old !== c.name ? t("Former province of {name}", { name: esc(c.province_old) }) : t("Former province")}</div>
    <div class="cv-title">
      <div class="cv-crest" aria-hidden="true"><span>${esc(popShort(c.population))}</span></div>
      <div class="cv-tt">
        <h2 class="cv-name" tabindex="-1">${isCapital(c) ? `<span class="cv-cap" title="${t("National capital")}">★</span> ` : ""}${esc(c.name)}</h2>
        ${c.full && c.full !== c.name ? `<div class="cv-full">${esc(fullName(c))}</div>` : ""}
        <div class="cv-typeslot" data-ctype></div>
        ${chips ? `<div class="chips">${chips}</div>` : ""}
      </div>
    </div>
    <div class="cv-headline">
      <div class="cv-big"><span class="lbl">${icon("pop", "👥", { size: 13 })} ${t("Population")}</span><b>${int(c.population)}</b>${growth}</div>
      <div class="cv-big"><span class="lbl">${icon("y-gold", "💰", { size: 13 })} GRDP${c.gdp_year ? ` ${esc(c.gdp_year)}` : ""}</span><b>${money(c.gdp)}</b>${
        perCap != null ? `<span class="cv-sub">${t("{v} per person", { v: money(perCap) })}</span>` : ""}</div>
    </div>
    <div class="cv-ranks" aria-label="${t("Ranks among {n} former provinces", { n: cities.length })}">
      ${rankBadge(r.population, N("population"), t("Population"), "", yearPlain(yearOf(c, "population")))}
      ${rankBadge(r.gdp, N("gdp"), "GRDP", "", yearPlain(yearOf(c, "gdp")))}
      ${rankBadge(r.gdp_per_capita, N("gdp_per_capita"), t("GRDP / person"), "", yearPlain(yearOf(c, "gdp_pc")))}
      ${rankBadge(r.growth, N("growth"), t("Growth"), r.growth != null ? t("Growth {y}: #{r} of {n} (1 = fastest growing)", { y: yearPlain(yearOf(c, "growth")), r: r.growth, n: N("growth") }) : "", yearPlain(yearOf(c, "growth")))}
    </div>
  </header>
  <nav class="cv-tabs" aria-label="${t("City View sections")}">
    ${TABS.map(([id, label, ic]) => `<button type="button" data-tab="${id}">${icon(ic, "•", { size: 14 })}<span>${t(label)}</span></button>`).join("")}
  </nav>`;
}

// --- citizens ------------------------------------------------------------------------------------------------------
// One "value · VN value" row with a meter. sub: the small line beside the value; by default Vietnam's value.
function statRow(ic, fb, label, v, vn, fmt, better, max, sub = vn != null ? `VN ${fmt(vn)}` : "", tick = vn, tip = "") {
  return `
    <div class="cv-stat"${tip ? ` title="${esc(t(tip))}"` : ""}>
      <div class="cv-stat-top"><span class="sl">${icon(ic, fb, { size: 14 })}${esc(label?.text ?? t(label))}</span>
        <span class="sv"><b>${v == null ? "–" : fmt(v)}</b>${sub ? `<small>${sub}</small>` : ""}</span></div>
      ${meter(v, tick, max ?? Math.max(v || 0, vn || 0) * 1.35, better)}
    </div>`;
}
const share = (x) => pct(x);

// A stat row for `key` of a record (the city, or its 2025 province). The label shows the figure's year when it is not
// the main year; the comparison is Vietnam's figure for the same year (NSO's national row, or nation.cities_basis for
// the cities' 2024 HDI and FDI), and there is none when NSO publishes no national figure for that year.
// o: {value, vn(ref) → number, sub, noVn}
function fieldStat(m, rec, key, ic, fb, label, fmt, better, max, tip = "", o = {}) {
  const y = yearOf(rec, key);
  const ref = o.noVn ? null : vnRef(m.nation, rec, key);
  const v = o.value !== undefined ? o.value : rec?.[key] ?? null;
  const vn = ref ? (o.vn ? o.vn(ref) : ref.v) : null;
  const text = o.label ? t(label, o.label) : y && !o.noTag && plainYear(y) !== String(m.nation.year) ? `${t(label)} (${yearPlain(y)})` : t(label);
  const sub = o.sub !== undefined ? o.sub : vn != null ? `${vnLabel(ref)} ${fmt(vn)}` : "";
  return statRow(ic, fb, { text }, Number.isFinite(v) ? v : null, vn, fmt, better, max, sub, vn, tip);
}
const fx = (m) => m.nation.currency?.fx_year || "";
// The largest value of a field among the 34 provinces (a meter's full scale).
const topIn = (list, key) => Math.max(1e-9, ...list.map((s) => (Number.isFinite(s[key]) ? Math.abs(s[key]) : 0)));
const topState = (m, key) => topIn(m.stateList, key);

// The city's 2025 province: indicators NSO publishes only for the 34 provinces (since 2025).
function provinceBlock(m, rows, note) {
  const p = m.province;
  if (!p) return "";
  const body = rows.filter(Boolean).join("");
  if (!body) return "";
  return `<div class="cv-prov">
    <h4 class="cv-h4">${t("Province (2025)")}: ${esc(p.name)} <span class="muted">${t("34 provinces only")}</span></h4>
    <div class="cv-stats">${body}</div>
    <p class="cv-note">${note}</p>
  </div>`;
}
const provNote = (m) => {
  const p = m.province, c = m.city;
  const whole = (p?.former || []).length > 1 ? t("Figures for the whole of {name} (merged from {list}), not only {old}.", { name: esc(p.name), list: esc(p.former.join(", ")), old: esc(c.province_old || c.name) }) : "";
  return `${t("NSO publishes these only for the 34 provinces since 2025.")} ${whole}`;
};
// The largest value of a field among the former provinces (a meter's full scale when Vietnam's total is no guide).
const topOf = (m, key) => Math.max(1, ...m.cityList.map((c) => (Number.isFinite(c[key]) ? c[key] : 0)));
const usd = (x) => (x == null ? "–" : "$" + int(x));

function citizens(m) {
  const c = m.city, n = m.nation.nation;
  const series = popSeries(c);
  const ch = series.length >= 2 ? series.at(-1).value / series[0].value - 1 : null;
  const multi = m.tiles.length > 1;
  const tilesNote = multi
    ? t("On the map each hex (about {a} km²) shows <b>≈ residents</b> (WorldPop population density × hex area, an estimate) and its <b>main land use</b> (share of the hex's land, ESA WorldCover)", { a: compact(m.hexArea) })
      + (m.residentsSum > 0 ? t(". Together the {n} hexes hold about {k} people by that estimate", { n: m.tiles.length, k: compact(m.residentsSum) }) : "") + "."
    : t("This former province fits inside one map hex (about {a} km²), shown with its city.", { a: compact(m.hexArea) });
  return `
  <section class="cv-sec" id="cv-citizens" data-sec="citizens" aria-labelledby="cv-h-citizens">
    <h3 id="cv-h-citizens">${icon("pop", "👥", { size: 15 })}${t("Citizens")}</h3>
    <div class="cv-citizens" data-citizens>${citizensHtml(m, undefined)}</div>
    <h4 class="cv-h4">${t("Population")}</h4>
    <div class="cv-card">
      <div class="cv-card-h"><span>${t("Population")} ${series.length ? esc(`${series[0].year}–${series.at(-1).year}`) : ""}</span>${
        ch != null ? `<span class="${ch >= 0 ? "good" : "bad"}">${signed(ch)}</span>` : ""}</div>
      ${sparkline(series, { fmt: (v) => popShort(v), title: t("Population of {name} by year", { name: c.name }) })}
      <p class="cv-note">${t("NSO average population by year (PX-Web), on the former province's borders.")}</p>
    </div>
    <h4 class="cv-h4">${t("Living standards")}</h4>
    <div class="cv-stats">
      ${fieldStat(m, c, "median_income", "l-income", "💵", "Income per person / year", usd, "high", null, t("Average income per person (VHLSS {y} × 12), USD at the World Bank {fx} rate. Per person, not per household.", { y: yearPlain(yearOf(c, "income")), fx: fx(m) }))}
      ${fieldStat(m, c, "hdi", "l-amenities", "🌱", "Human development (HDI)", (x) => fixed(x, 3), "high", 1, t("The last HDI NSO published for the 63 former provinces; the 2025 HDI of the province is below."))}
      ${fieldStat(m, c, "poverty", "l-poverty", "🥣", "Households in poverty", share, "low", null, t("Multidimensional poverty standard 2022–2025 (NSO)"))}
      ${fieldStat(m, c, "gini", null, "⚖️", "Inequality (Gini)", (x) => fixed(x, 3), "low", 0.6)}
      ${fieldStat(m, c, "urban", "l-developed", "🏙", "Urban residents", share, null, 1)}
      ${fieldStat(m, c, "internet", "l-broadband", "🌐", "Internet users", share, "high", 1)}
      ${fieldStat(m, c, "clean_water", "l-commute", "🚰", "Clean water", share, "high", 1, t("Population using a hygienic water source (NSO)"))}
      ${fieldStat(m, c, "housing", "l-homeownership", "🏠", "Permanent housing", share, "high", 1, t("Households living in a permanent house (NSO)"))}
      ${fieldStat(m, c, "literacy", "l-degrees", "📖", "Literacy (15+)", share, "high", 1)}
      ${fieldStat(m, c, "density", "l-people", "👥", "Density", (x) => `${int(x)} /km²`, null, null, "", { vn: (ref) => ref.v, sub: `${c.area_km2 != null ? `${int(c.area_km2)} km² · ` : ""}${vnLabel(vnRef(m.nation, c, "density"))} ${int(n.density)} /km²` })}
    </div>
    ${provinceBlock(m, [
      fieldStat(m, m.province, "hdi", "l-amenities", "🌱", "Human development (HDI)", (x) => fixed(x, 3), "high", 1),
      fieldStat(m, m.province, "doctors_pk", "l-uninsured", "🩺", "Doctors per 10,000 people", (x) => fixed(x, 1), "high", topState(m, "doctors_pk"), t("Doctors in State-sector health facilities (NSO); private doctors are not counted.")),
      fieldStat(m, m.province, "road_deaths", "l-poverty", "🚦", "Road deaths per 100,000 people", (x) => fixed(x, 1), "low", topState(m, "road_deaths")),
      fieldStat(m, m.province, "pupils_per_teacher", "l-degrees", "🏫", "Pupils per teacher", (x) => fixed(x, 1), "low", topState(m, "pupils_per_teacher"), t("General education, primary to upper secondary (NSO)")),
      fieldStat(m, m.province, "forest_cover", "l-forest", "🌲", "Forest cover (official)", share, null, 1, t("Natural and planted forest ÷ area (NSO, forestry sector monitoring)")),
    ], provNote(m))}
    <div class="cv-legend-tiles">${tileLegend(m)}<p>${tilesNote}</p></div>
    <h4 class="cv-h4" data-counties-h>${kindOf(m.states[0]?.abbr || "")} (2025)</h4>
    <div class="cv-counties" data-counties><p class="muted cv-note">${t("Loading former provinces…")}</p></div>
  </section>`;
}

function tileLegend(m) {
  const counts = new Map();
  for (const t of m.tiles) if (t.land) counts.set(t.land.key, (counts.get(t.land.key) || 0) + 1);
  return `<div class="cv-tl">${LAND.filter((g) => counts.has(g.key)).map((g) =>
    `<span class="cv-tl-i"><i style="background:${esc(m.landColor(g.key))}"></i>${esc(t(g.label))} <small>${counts.get(g.key)}</small></span>`).join("")}</div>`;
}

// The former provinces merged into the city's 2025 province (counties.json rows), this one highlighted.
export function countiesTable(m, data) {
  const c = m.city;
  if (!data || !Array.isArray(data.rows)) return `<p class="muted cv-note">${t("The former-province table is not available.")}</p>`;
  const col = Object.fromEntries(data.columns.map((k, j) => [k, j]));
  const own = new Set(c.counties || []);
  const prov = new Set(c.states || []);
  const rows = data.rows.filter((r) => own.has(r[col.geoid]) || prov.has(r[col.state]))
    .sort((a, b) => (b[col.population] || 0) - (a[col.population] || 0));
  if (!rows.length) return `<p class="muted cv-note">${t("No former-province rows for this city.")}</p>`;
  const maxPop = rows[0][col.population] || 1;
  const name = m.states[0]?.name || c.province_new || "";
  const lead = rows.length > 1
    ? t(rows.length === 2 ? "Since July 2025 {old} is part of <b>{name}</b>, with 1 other former province." : "Since July 2025 {old} is part of <b>{name}</b>, with {n} other former provinces.", { old: esc(c.province_old || c.name), name: esc(name), n: rows.length - 1 })
    : name && name !== (c.province_old || c.name)
      ? t("{old} kept its borders in the July 2025 merger, as <b>{name}</b>.", { old: esc(c.province_old || c.name), name: esc(name) })
      : t("{old} kept its borders in the July 2025 merger.", { old: esc(c.province_old || c.name) });
  return `<p class="cv-lead">${lead}</p><div class="cv-ctable" role="table" aria-label="${esc(t("Former provinces of {name}", { name }))}">
    <div class="cv-cr cv-cr-h" role="row"><span role="columnheader">${t("Former province")}</span><span role="columnheader">${t("People")}</span><span role="columnheader">/km²</span><span role="columnheader">${t("Income")}</span></div>
    ${rows.map((r) => `<div class="cv-cr${own.has(r[col.geoid]) ? " me" : ""}" role="row">
      <span role="cell" class="cv-cn">${own.has(r[col.geoid]) ? `<b>${esc(r[col.name])}</b>` : esc(r[col.name])}${bar(r[col.population] / maxPop, "var(--sc, #c9a45c)")}</span>
      <span role="cell">${compact(r[col.population])}</span><span role="cell">${r[col.density] != null ? int(r[col.density]) : "–"}</span>
      <span role="cell">${money(r[col.income])}</span></div>`).join("")}
    <p class="cv-note">${esc(t(data.vintage || "NSO Statistical Yearbook 2024"))}; ${t("income per person per year, USD.")}</p>
  </div>`;
}

// --- districts -----------------------------------------------------------------------------------------------------
function districts(m) {
  return `
  <section class="cv-sec" id="cv-districts" data-sec="districts" aria-labelledby="cv-h-districts">
    <h3 id="cv-h-districts">${icon("l-developed", "🏙", { size: 15 })}${t("Districts")}</h3>
    <div data-districts>${districtsHtml(m, undefined)}</div>
  </section>`;
}

// FDI of a record (a city: 2024, its province: 2025), with projects and per resident of the same year, against Vietnam's.
function fdiRow(m, rec, max) {
  const y = yearOf(rec, "fdi");
  const ref = vnRef(m.nation, rec, "fdi");
  const per = (v, r) => { const p = popIn(r, y); return Number.isFinite(v) && p > 0 ? v / p : null; };
  const pr = per(rec.fdi, rec), vpr = ref ? per(ref.v, m.nation.nation) : null;
  const sub = `${rec.fdi < 0 ? `${t("net reduction of registered capital")} · ` : ""}${rec.fdi_projects != null ? `${t("{n} projects", { n: int(rec.fdi_projects) })} · ` : ""}${pr != null ? t("{v} per resident", { v: money(pr) }) : ""}${vpr != null ? ` · ${vnLabel(ref)} ${money(vpr)}` : ""}`;
  return fieldStat(m, rec, "fdi", "l-income", "🏗️", "FDI registered", money, null, max, t("Newly registered plus added foreign direct investment capital in {y} (NSO). Registered, not disbursed.", { y: yearPlain(y) }), { noVn: true, sub });
}

// --- economy -------------------------------------------------------------------------------------------------------
function economy(m) {
  const c = m.city, nat = m.nation, n = nat.nation;
  const r = c.ranks || {};
  const cities = m.cityList;
  const perCap = c.gdp != null && c.population ? c.gdp / c.population : null;
  const vnPerCap = n.gdp && n.population ? n.gdp / n.population : null;
  const yields = nat.yields.map((y) => {
    const v = c.yields?.[y.key];
    const rk = r[y.key];
    return `<div class="cv-yield" style="--yc:${esc(y.color)}" title="${esc(t(y.label))}: ${esc(t(y.description || ""))}">
      <div class="ico">${glyph(y, 20)}</div><div class="val">${yieldValue(y, v)}</div>
      <div class="lbl">${esc(y.key === "gold" ? "GRDP" : t(y.label))}</div>
      ${rk != null ? `<div class="rk">#${rk} <small>${t("of {n}", { n: countOf(cities, y.key) })}</small></div>` : ""}</div>`;
  }).join("");
  const gi = m.gdpInds;
  const maxShare = gi.length ? Math.max(...gi.map((d) => Math.max(d.share, d.natShare))) : 1;
  const gdpRow = (d) => `<div class="cv-ind" title="${esc(t("{label}: {v} ({p} of GRDP; Vietnam {vn})", { label: d.label, v: money(d.value), p: pct(d.share), vn: pct(d.natShare) }))}">
      <span class="cv-ind-ic" style="--bg:${esc(d.color)}">${icon(d.icon, "•", { size: 13 })}</span>
      <span class="cv-ind-n">${esc(d.short)}${lqBadge(d.lq)}</span>
      <span class="cv-ind-v">${money(d.value)} <small>${pct(d.share, 0)}</small></span>
      ${bar(d.share / maxShare, d.lq != null && d.lq >= 1.25 ? "#9fd76a" : "#c9a45c", d.natShare / maxShare)}
    </div>`;
  // Per resident of the same year as the figure.
  const perRes = (v, key) => { const p = popIn(c, yearOf(c, key)); return Number.isFinite(v) && p > 0 ? v / p : null; };
  const vnPerRes = (v, y) => { const p = popIn(n, y); return Number.isFinite(v) && p > 0 ? v / p : null; };
  const pci = Number.isFinite(c.pci) ? c.pci : null;
  return `
  <section class="cv-sec" id="cv-economy" data-sec="economy" aria-labelledby="cv-h-economy">
    <h3 id="cv-h-economy">${icon("y-gold", "💰", { size: 15 })}${t("Economy")}</h3>
    <div class="cv-gdp">
      <div><span class="lbl">GRDP${c.gdp_year ? ` (${esc(c.gdp_year)})` : ""}</span><b>${money(c.gdp)}</b>${r.gdp != null ? `<small>${t("#{r} of {n}", { r: r.gdp, n: countOf(cities, "gdp") })}</small>` : ""}</div>
      <div><span class="lbl">${t("GRDP per person")}</span><b>${money(perCap)}</b>${
        vnPerCap ? `<small class="${perCap >= vnPerCap ? "good" : "bad"}">VN ${money(vnPerCap)}</small>` : ""}</div>
      <div><span class="lbl">${t("Share of the provinces' total GRDP")}</span><b>${c.gdp != null && (n.gdp_provinces || n.gdp) ? pct(c.gdp / (n.gdp_provinces || n.gdp), 2) : "–"}</b><small>${t("{p} of people", { p: pct(c.population / n.population, 2) })}</small></div>
    </div>
    <h4 class="cv-h4">${t("Yields")} <span class="muted">${t("rank among former provinces")}</span></h4>
    <div class="cv-yields">${yields}</div>
    ${gi.length ? `<h4 class="cv-h4">${t("GRDP by industry")} <span class="muted">${t("tick = Vietnam's share")}</span></h4><div class="cv-inds">${gi.map(gdpRow).join("")}</div>` : ""}
    <h4 class="cv-h4">${t("Business &amp; investment")}</h4>
    <div class="cv-stats">
      ${fieldStat(m, c, "productivity", "l-income", "⚙️", "Productivity (GRDP per worker)", money, "high")}
      ${fieldStat(m, c, "grdp_growth", "y-gold", "📈", "GRDP growth", (x) => signed(x), "high", topIn(m.cityList, "grdp_growth"), t("Over the year before, constant prices (NSO estimate)"))}
      ${fdiRow(m, c, topOf(m, "fdi"))}
      ${fieldStat(m, c, "enterprises_pk", "l-amenities", "🏢", "Enterprises per 1,000 residents", (x) => fixed(x, 1), "high", topOf(m, "enterprises_pk"), t("Active enterprises (NSO). Vietnam's figure for the same year is not in the data, so there is no comparison."))}
      ${fieldStat(m, c, "retail", "i-retail", "🛍️", "Retail sales per resident", money, null, null, t("Retail sales of goods and services ({y}, NSO)", { y: yearPlain(yearOf(c, "retail")) }), { value: perRes(c.retail, "retail"), vn: (ref) => vnPerRes(ref.v, ref.year) })}
      ${pci != null ? fieldStat(m, c, "pci", "l-amenities", "🤝", "Business climate (PCI)", (x) => fixed(x, 1), "high", 100, t("Provincial Competitiveness Index (VCCI), 0–100"), { noVn: true, sub: Number.isFinite(c.pci_2024) ? `${yearText(yearOf(c, "pci_2024"))} ${fixed(c.pci_2024, 1)}` : "" }) : ""}
    </div>
    ${provinceBlock(m, [
      m.province ? fdiRow(m, m.province, topState(m, "fdi")) : "",
      fieldStat(m, m.province, "enterprises_pk", "l-amenities", "🏢", "Enterprises per 1,000 residents", (x) => fixed(x, 1), "high", topState(m, "enterprises_pk"), t("Active enterprises (NSO)")),
      fieldStat(m, m.province, "growth_9m2026", "y-gold", "🚀", "GRDP growth, 9 months 2026 (est.)", (x) => signed(x), "high", topState(m, "growth_9m2026"), t("January–September 2026 over the same months of 2025, constant prices (NSO estimate)"), { noTag: true }),
      fieldStat(m, m.province, "industry_jobs_2026", "y-production", "🏭", "Factory jobs at {y} vs a year earlier (est.)", (x) => signed(x), "high", topState(m, "industry_jobs_2026"), t("Workers in industrial enterprises compared with a year earlier (NSO estimate)"), { noTag: true, label: { y: yearPlain(yearOf(m.province, "industry_jobs_2026")) } }),
    ], provNote(m))}
    <p class="cv-note">${esc(t(nat.gdp_vintage || "NSO GRDP"))}${t(", current prices.")} ${esc(t(nat.currency?.note || ""))} ${t("NSO publishes no GRDP by industry for each province.")}</p>
  </section>`;
}

// --- workforce -----------------------------------------------------------------------------------------------------
function workforce(m) {
  const c = m.city, nat = m.nation, n = nat.nation;
  const empShare = c.employed != null && c.population > 0 ? c.employed / c.population : null;
  const vnEmpShare = n.employed != null && n.population > 0 ? n.employed / n.population : null;
  // Local workers by industry, when the data has them; otherwise Vietnam's, labelled as national.
  const local = m.inds.length > 0;
  const inds = local ? m.inds : jobIndustries(n, nat);
  const cards = inds.map((d) => {
    const spec = local && d.lq != null && d.lq >= 1.25;
    return `<div class="cv-bld${spec ? " spec" : ""}" title="${esc(t("{label}: {n} workers ({p})", { label: d.label, n: int(d.jobs), p: pct(d.share) }))}">
      ${medallion(d.icon, "•", d.color, 17)}
      <div class="cv-bld-t"><span class="cv-bld-n">${esc(d.short)}</span>
        <span class="cv-bld-v">${compact(d.jobs)} <small>${pct(d.share, 1)}</small></span></div>
      ${local ? lqBadge(d.lq) : ""}
    </div>`;
  }).join("");
  return `
  <section class="cv-sec" id="cv-workforce" data-sec="workforce" aria-labelledby="cv-h-workforce">
    <h3 id="cv-h-workforce">${icon("y-production", "⚙️", { size: 15 })}${t("Workforce")}</h3>
    <div class="cv-stats">
      ${statRow("pop", "👥", "Labour force (15+)", c.labour_force, null, int, null, c.population, c.population > 0 && c.labour_force != null ? t("{p} of residents", { p: pct(c.labour_force / c.population) }) : "")}
      ${statRow("pop", "👥", "Employed", c.employed, null, int, null, c.population, empShare == null ? "" : `${t("{p} of residents", { p: pct(empShare) })}${vnEmpShare != null ? ` · VN ${pct(vnEmpShare)}` : ""}`, vnEmpShare != null ? vnEmpShare * c.population : null)}
      ${fieldStat(m, c, "unemployment", "unemployment", "😐", "Unemployment", share, "low")}
      ${fieldStat(m, c, "trained", "l-degrees", "🎓", "Trained workers", share, "high", 1, t("Labour force with a vocational certificate, college or university degree (NSO Labour Force Survey {y})", { y: yearPlain(yearOf(c, "trained")) }))}
      ${fieldStat(m, c, "it_skills", "l-broadband", "💻", "IT skills", share, "high", 1, t("People with at least one information-technology skill (NSO)"))}
      ${fieldStat(m, c, "income_worker", "l-income", "💵", "Income per worker / year", usd, "high")}
      ${fieldStat(m, c, "lecturers", "y-science", "🔬", "University lecturers", int, null, topOf(m, "lecturers"), "", { noVn: true, sub: c.students != null ? t("{n} students", { n: compact(c.students) }) : "" })}
    </div>
    <h4 class="cv-h4">${local ? t("Workers by industry") : t("Vietnam's workers by industry")} ${local ? `<span class="muted">${t("×N vs Vietnam's share")}</span>` : `<span class="muted">${t("national only")}</span>`}</h4>
    ${local ? "" : `<p class="cv-lead">${t("NSO does not publish workers by industry for each province; this is the whole country's mix.")} ${esc(t("Source: {src}", { src: t(nat.jobs_source || "NSO") }))}.</p>`}
    <div class="cv-blds">${cards || `<p class="muted cv-note">${t("No industry data.")}</p>`}</div>
    <p class="cv-note">${esc(t(nat.vintage))}${t(", Labour Force Survey: workers 15+ counted where they live.")}</p>
  </section>`;
}

// --- resources -----------------------------------------------------------------------------------------------------
function resources(m) {
  const list = m.sites.map((s, k) => {
    const t = s.type;
    const val = resourceValue(s.item, t, compact);
    return `<button type="button" class="cv-site" data-site="${k}" title="${esc(tr("Fly to {name}", { name: s.item.name }))}">
      <span class="cv-med" style="--bg:${esc(t?.color || "#3a4a5e")}">${glyph(t, 16)}</span>
      <span class="cv-site-t"><b>${esc(s.item.name)}</b><small>${esc(t?.name ? tr(t.name) : s.item.type)}</small>
        ${siteDetail(s.item) ? `<small class="cv-site-d">${siteDetailHtml(s.item)}</small>` : ""}</span>
      <span class="cv-site-v">${esc(val)}<i aria-hidden="true">›</i></span>
    </button>`;
  }).join("");
  const cats = {};
  for (const s of m.sites) cats[s.type?.category || "other"] = (cats[s.type?.category || "other"] || 0) + 1;
  const mw = m.sites.filter((s) => s.type?.unit === "MW").reduce((a, s) => a + (s.item.value || 0), 0);
  const summary = m.sites.length
    ? `<p class="cv-lead">${m.sites.length === 1 ? tr("1 mapped site") : tr("{n} mapped sites", { n: m.sites.length })}${
      mw ? ` · ${tr("{v} of mapped generating capacity", { v: mw >= 1000 ? `${fixed((mw / 1000), 1)} GW` : `${Math.round(mw)} MW` })}` : ""}. ${tr("Click one to fly there.")}</p>`
    : `<p class="muted cv-note">${tr("No mapped resource sites in this former province. Only large sites are mapped (each type has a size threshold).")}</p>`;
  return `
  <section class="cv-sec" id="cv-resources" data-sec="resources" aria-labelledby="cv-h-resources">
    <h3 id="cv-h-resources">${icon("resources", "⛏️", { size: 15 })}${tr("Resources")}</h3>
    ${summary}
    <div class="cv-sites">${list}</div>
    ${m.sites.length ? `<p class="cv-note">${tr("Sites whose hex centre lies in the former province. Mapped sites only (power plants: OpenStreetMap, capacity from WRI's database where OSM has none), not its full capacity.")}</p>` : ""}
  </section>`;
}

// --- compare -------------------------------------------------------------------------------------------------------
// [label, value, format, field key for the year shown in the header when it is not the main year]
const COMPARE = {
  size: [
    ["Population", (c) => c.population, (v) => popShort(v), "population"],
    ["GRDP / person", (c) => (c.gdp != null && c.population ? c.gdp / c.population : null), money, "gdp_pc"],
    ["Income", (c) => c.median_income, money, "median_income"],
    ["Growth", (c) => (Number.isFinite(c.growth) ? c.growth : null), (v) => signed(v), "growth"],
  ],
  living: [
    ["HDI", (c) => c.hdi, (v) => fixed(v, 3), "hdi"],
    ["Poverty", (c) => c.poverty, (v) => pct(v), "poverty"],
    ["Trained", (c) => c.trained, (v) => pct(v, 0), "trained"],
    ["Jobless", (c) => c.unemployment, (v) => pct(v), "unemployment"],
  ],
};

export function compareTable(m, set = "size") {
  const rows = [m.city, ...m.peers];
  const cols = COMPARE[set] || COMPARE.size;
  const max = cols.map(([, f]) => Math.max(...rows.map((c) => Math.abs(f(c) ?? 0))) || 1);
  return `<div class="cv-cmp" role="table" aria-label="${esc(t("{name} and its peers", { name: m.city.name }))}">
    <div class="cv-cmp-r cv-cmp-h" role="row"><span role="columnheader">${t("City")}</span>${cols.map(([l, , , k]) => { const y = yearOf(m.city, k); return `<span role="columnheader">${esc(t(l))}${y && plainYear(y) !== String(m.nation.year) ? ` <small>${yearText(y)}</small>` : ""}</span>`; }).join("")}</div>
    ${rows.map((c, k) => `<div class="cv-cmp-r${k === 0 ? " me" : ""}" role="row">
      <span role="cell">${k === 0 ? `<b class="cv-cmp-n">${esc(c.name)}</b>` : `<button type="button" class="cv-cmp-n" data-peer="${esc(c.id)}" title="${esc(t("Open {name} in the City View", { name: fullName(c) }))}">${esc(c.name)}</button>`}${c.province_old && c.province_old !== c.name ? `<small>${esc(c.province_old)}</small>` : ""}</span>
      ${cols.map(([, f, fmt], j) => {
        const v = f(c);
        const col = v != null && v < 0 ? "#f08a6a" : k === 0 ? "#ecd08e" : "#8fa6bd";
        return `<span role="cell"><em>${v == null ? "–" : esc(fmt(v))}</em>${bar(v == null ? 0 : Math.abs(v) / max[j], col)}</span>`;
      }).join("")}
    </div>`).join("")}
  </div>`;
}

function compare(m) {
  return `
  <section class="cv-sec" id="cv-compare" data-sec="compare" aria-labelledby="cv-h-compare">
    <h3 id="cv-h-compare">${icon("layers", "⚖️", { size: 15 })}${t("Compare")}</h3>
    <p class="cv-lead">${t("The {n} former provinces closest in population. Click one to open it.", { n: m.peers.length })}</p>
    <div class="cv-seg" role="group" aria-label="${t("Metrics")}">
      <button type="button" data-set="size" aria-pressed="true">${t("Size &amp; wealth")}</button>
      <button type="button" data-set="living" aria-pressed="false">${t("Living &amp; skills")}</button>
    </div>
    <div data-compare>${compareTable(m, "size")}</div>
  </section>`;
}

function footer(m) {
  const nat = m.nation;
  return `<div class="cv-foot">${t("Sources: {src} and PX-Web", { src: esc(t(nat.vintage)) })}${nat.gdp_vintage ? `; GRDP: ${esc(t(nat.gdp_vintage))}` : ""}; ${esc(t(nat.currency?.note || "World Bank exchange rate"))}
    ${t("WorldPop population; ESA WorldCover land; Wikidata sites; OpenStreetMap power plants and seaports (Decision 804/QĐ-TTg).")} ${t("Ranks are among all {n} former provinces (each shown by its seat).", { n: m.cityList.length })}
    <a href="#" data-pedia>${t("Almanac")} ›</a></div>`;
}

/**
 * Fill the dock. handlers: {onClose, onState(idx), onPeer(id), onSite(site), onSiteHover(site|null), onPedia,
 * loadCounties() → Promise<counties.json|null>, loadData(name) → Promise<data|null>, onDistricts(list)} (the
 * city's districts once districts.json is in, for the map plaques).
 */
/**
 * Scrolls the dock to a section (its tab id, e.g. "districts"). Citizens and districts arrive later and change the
 * heights above, so the section is re-aligned as they do, for up to 4 s or until the user scrolls themselves.
 */
export function goToSection(el, id) {
  const sec = el?.querySelector(`[data-sec="${id}"]`);
  if (!sec) return false;
  const align = () => {
    const nav = el.querySelector(".cv-tabs");
    el.scrollTop = Math.max(0, sec.offsetTop - (nav?.offsetHeight || 0) - 4);
    el.onscroll?.(); // the tab spy (a scroll event is not always sent for a programmatic jump)
  };
  align();
  let ro = null;
  const stop = () => {
    ro?.disconnect();
    ro = null;
    for (const t of ["wheel", "touchstart", "keydown", "pointerdown"]) el.removeEventListener(t, stop);
  };
  for (const t of ["wheel", "touchstart", "keydown", "pointerdown"]) el.addEventListener(t, stop, { passive: true });
  if (typeof ResizeObserver === "function") {
    ro = new ResizeObserver(() => { if (sec.isConnected) align(); else stop(); });
    for (const c of el.children) ro.observe(c);
  }
  setTimeout(stop, 4000);
  return true;
}

export function render(el, m, h) {
  el.classList.add("cv-dock");
  el.style.setProperty("--sc", css(m.stateRGB));
  el.innerHTML = header(m) + citizens(m) + districts(m) + economy(m) + workforce(m) + resources(m) + compare(m) + footer(m);
  el.scrollTop = 0;

  el.querySelector("[data-close]").onclick = () => h.onClose();
  el.querySelectorAll("[data-state]").forEach((b) => (b.onclick = () => h.onState(+b.dataset.state)));
  el.querySelector("[data-pedia]").onclick = (e) => { e.preventDefault(); h.onPedia(); };

  // Sites: hover lights the hex on the map, click flies there.
  el.querySelectorAll("[data-site]").forEach((b) => {
    const s = m.sites[+b.dataset.site];
    b.onclick = () => h.onSite(s);
    b.onmouseenter = b.onfocus = () => h.onSiteHover(s);
    b.onmouseleave = b.onblur = () => h.onSiteHover(null);
  });

  // Compare: metric sets and peer links (delegated, the table is re-rendered).
  const cmp = el.querySelector("[data-compare]");
  el.querySelectorAll("[data-set]").forEach((b) => (b.onclick = () => {
    el.querySelectorAll("[data-set]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    cmp.innerHTML = compareTable(m, b.dataset.set);
  }));
  cmp.addEventListener("click", (e) => {
    const b = e.target.closest("[data-peer]");
    if (b) h.onPeer(b.dataset.peer);
  });

  // Tabs scroll to their section; the active tab follows the scroll position.
  const nav = el.querySelector(".cv-tabs");
  const tabs = [...el.querySelectorAll("[data-tab]")];
  const secs = tabs.map((t) => el.querySelector(`[data-sec="${t.dataset.tab}"]`));
  tabs.forEach((t, k) => (t.onclick = () => {
    const top = secs[k].offsetTop - nav.offsetHeight - 4;
    el.scrollTo({ top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }));
  const spy = () => {
    const y = el.scrollTop + nav.offsetHeight + 24;
    let k = 0;
    secs.forEach((s, j) => { if (s.offsetTop <= y) k = j; });
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) k = secs.length - 1;
    if (tabs[k]?.classList.contains("on")) return;
    tabs.forEach((t, j) => t.classList.toggle("on", j === k));
    // Keep the active tab in view when the bar overflows (horizontal only: the panel itself must not jump).
    const t = tabs[k], l = t.offsetLeft, pad = 36; // the sticky nav is the offsetParent
    if (l - pad < nav.scrollLeft) nav.scrollLeft = l - pad;
    else if (l + t.offsetWidth + pad > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = l + t.offsetWidth + pad - nav.clientWidth;
    edges();
  };
  const edges = () => {
    nav.classList.toggle("fl", nav.scrollLeft > 1);
    nav.classList.toggle("fr", nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1);
  };
  nav.addEventListener("scroll", edges, { passive: true });
  new ResizeObserver(edges).observe(nav);
  el.onscroll = spy;
  spy();
  edges();

  // Citizens and districts arrive with their files (each loaded once, on demand).
  const czHost = el.querySelector("[data-citizens]");
  Promise.resolve(h.loadData?.("citizens")).then((data) => {
    if (!czHost.isConnected) return;
    czHost.innerHTML = citizensHtml(m, data ?? null);
    mountCitizens(czHost, m, data);
  }, () => { if (czHost.isConnected) czHost.innerHTML = citizensHtml(m, null); });
  const dHost = el.querySelector("[data-districts]");
  const typeSlot = el.querySelector("[data-ctype]");
  const opt = (name) => Promise.resolve(h.loadData?.(name)).catch(() => null);
  Promise.all([h.loadData?.("districts"), opt("military"), opt("trade")]).then(([dd, mil, trade]) => {
    if (!dHost.isConnected) return;
    dHost.innerHTML = districtsHtml(m, dd ?? null, mil ?? null, trade ?? null);
    typeSlot.innerHTML = badgeHtml(m, dd ?? null);
    h.onDistricts?.(dd ? cityDistricts(dd, m.city.id, mil ?? null) : []);
  }, () => { if (dHost.isConnected) dHost.innerHTML = districtsHtml(m, null); });

  // The province's former provinces arrive with counties.json (loaded once, on demand).
  const host = el.querySelector("[data-counties]");
  Promise.resolve(h.loadCounties()).then((data) => {
    if (host.isConnected) host.innerHTML = countiesTable(m, data);
  }, () => { if (host.isConnected) host.innerHTML = `<p class="muted cv-note">${t("The former-province table is not available.")}</p>`; });
}
