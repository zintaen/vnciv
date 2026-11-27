// Shared building blocks for the city and province panels (both render into #city-panel).
import { compact, dollars, esc, fixed, int, money, pct, yieldValue } from "../format.js";
import { icon, glyph } from "./icon.js";
import { t, lang } from "../i18n.js";

// Industry → a "district" glyph: SVG icons i-<key> from icons.js; these emoji are only the fallback.
export const DISTRICT_ICON = {
  agriculture: "🌾", mining: "⛏️", construction: "🏗️", manufacturing: "🏭", wholesale: "📦", retail: "🛍️",
  transportation: "🚢", utilities: "⚡", information: "📡", finance: "🏦", real_estate: "🏘️", professional: "🔬",
  management: "🏢", admin: "🗂️", education: "🎓", health: "🏥", arts: "🎭", accommodation: "🍽️", other: "🔧",
  public_admin: "🏛️",
};

// cities.json `full` ends in " (former province)" for seats that are not their province's namesake.
export const fullName = (c) => (c?.full || c?.name || "").replace(/ \(former province\)$/, () => ` ${t("(former province)")}`);

const panelEl = () => document.getElementById("city-panel");

// Yield tiles; `ranks` (optional) adds "#3 of 49" under each.
export function yieldGrid(nation, yields, ranks = null, rankOf = 0) {
  return nation.yields
    .map((y) => {
      const v = yields?.[y.key];
      const r = ranks?.[y.key];
      const label = y.key === "gold" ? "GRDP" : t(y.label);
      const val = yieldValue(y, v);
      return `<div class="yield-tile" title="${esc(t(y.label))}${y.key === "gold" ? " (GRDP)" : ""}: ${esc(t(y.description || ""))}">
        <div class="ico" style="color:${esc(y.color)}">${glyph(y, 20)}</div>
        <div class="val" style="color:${esc(y.color)}">${val}</div>
        <div class="lbl">${esc(label)}</div>
        ${r ? `<div class="rank" title="${t("Rank among the {n} provinces (1 = largest)", { n: rankOf })}">${t("#{r} of {n}", { r, n: rankOf })}</div>` : ""}</div>`;
    })
    .join("");
}

// Field → its key in a record's `years` where the names differ.
const YEAR_KEY = { median_income: "income", gdp_per_capita: "gdp_pc" };
/** The year label of field f on a record ("2025", "2025 (prel.)", "2025-12-31", "9M2026"), or null. */
export const yearOf = (o, f) => o?.years?.[YEAR_KEY[f] || f] ?? o?.years?.[f] ?? (f === "gdp" && o?.gdp_year != null ? String(o.gdp_year) : null);
// "2025 (prel.)" → "2025": the label without its status, for "same year?" checks.
const yearBase = (y) => String(y ?? "").replace(/\s*\(.*\)\s*$/, "");
// The 4-digit year of a label ("VN 2025").
export const yearNum = (y) => String(y ?? "").match(/\d{4}/)?.[0] ?? "";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A year label for display: "31/12/2025" (vi) / "31 Dec 2025" (en), "Jan–Sep 2026", "2025 (prel.)" translated. */
export function fmtYear(y) {
  if (y == null || y === "") return "";
  const s = String(y);
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return lang === "vi" ? `${+m[3]}/${+m[2]}/${m[1]}` : `${+m[3]} ${MON[+m[2] - 1]} ${m[1]}`;
  m = /^(\d{1,2})M(\d{4})$/.exec(s);
  if (m) return t("Jan–{mon} {y}", { mon: MON[+m[1] - 1], y: m[2], n: m[1] });
  return s.replace("(prel.)", t("(prel.)")).replace("(est.)", t("(est.)"));
}

/**
 * Vietnam's value of field f for the same year as record o's, as {v, y}, or null when NSO publishes none for that
 * year: 2025 fields compare with the national 2025 rows, a former province's 2024 HDI/FDI with nation.cities_basis.
 */
export function nationalFor(o, n, f) {
  const yo = yearOf(o, f);
  if (yo == null) return null;
  const yn = yearOf(n, f);
  if (yn != null && yearBase(yn) === yearBase(yo) && n[f] != null) return { v: n[f], y: yn };
  const b = n.cities_basis;
  if (b && f in b && b[f] != null && String(b.year) === yearBase(yo)) return { v: b[f], y: String(b.year) };
  return null;
}

// One "value ▲ VN 2025 value" row. higherIsGood: true / false / null (neutral). y = the value's year label,
// ny = the national value's (the comparison is only ever made for the same year: see nationalFor).
export function statRow(ic, fallback, label, v, nv, fmt, higherIsGood, y = "", ny = "", cmpText = null) {
  let cmp = "";
  const vn = `VN${ny ? " " + yearNum(ny) : ""}`;
  if (cmpText) cmp = `<span class="cmp">${cmpText}</span>`;
  else if (v != null && nv != null && nv !== 0) {
    const ratio = v / nv;
    const cls = Math.abs(ratio - 1) < 0.03 || higherIsGood == null ? "" : (higherIsGood ? ratio >= 1 : ratio <= 1) ? "good" : "bad";
    // Within 3% of Vietnam's value reads as level: no arrow, no colour (the colour uses the same band).
    const arrow = Math.abs(ratio - 1) < 0.03 ? "≈" : ratio > 1 ? "▲" : "▼";
    cmp = `<span class="cmp ${cls}" title="${esc(t("Vietnam, {y}", { y: fmtYear(ny) }))}">${arrow} ${vn} ${fmt(nv)}</span>`;
  }
  const yr = y ? ` <span class="muted sy" style="font-size:11px">${esc(fmtYear(y))}</span>` : "";
  return `<div class="stat-row"><span class="sl">${icon(ic, fallback, { size: 14 })}<span>${esc(t(label))}${yr}</span></span><span><b>${v == null ? "–" : fmt(v)}</b>${cmp}</span></div>`;
}

/** statRow for field f of record o, with its year and Vietnam's same-year value. */
export function fieldRow(o, n, f, ic, fallback, label, fmt, higherIsGood) {
  const nat = nationalFor(o, n, f);
  return statRow(ic, fallback, label, o[f], nat?.v, fmt, higherIsGood, yearOf(o, f), nat?.y);
}

const usd = dollars;
const dec3 = (x) => fixed(x, 3);
const signed = (x) => `${x >= 0 ? "+" : "−"}${fixed(Math.abs(x * 100), 1)}%`;

// Living standards (cities and provinces share the fields; a missing one shows "–"). skip: fields shown elsewhere.
export function amenities(o, n, skip = []) {
  const rows = [
    ["median_income", "l-income", "💵", "Income per person / year", usd, true],
    ["hdi", "l-amenities", "🌱", "Human development (HDI)", dec3, true],
    ["poverty", "l-poverty", "🥣", "Households in poverty", (x) => pct(x), false],
    ["urban", "l-developed", "🏙", "Urban residents", (x) => pct(x, 0), null],
    ["trained", "l-degrees", "🎓", "Trained workers", (x) => pct(x, 0), true],
    ["unemployment", "unemployment", "😐", "Unemployment", (x) => pct(x), false],
  ];
  return rows.filter((r) => !skip.includes(r[0])).map(([f, ...a]) => fieldRow(o, n, f, ...a)).join("");
}

// FDI registered (a total): compared as a share of Vietnam's total for the same year.
export function fdiRow(o, n) {
  const nat = nationalFor(o, n, "fdi");
  const y = yearOf(o, "fdi");
  const share = o.fdi != null && nat?.v > 0
    ? t("{p} of VN {y} ({v})", { p: pct(o.fdi / nat.v), y: yearNum(nat.y), v: money(nat.v) }) : null;
  return statRow("l-income", "🏗️", "FDI registered", o.fdi, null, money, null, y, "", share);
}

// Output and investment: GRDP, growth, productivity, FDI. skip: fields shown elsewhere.
export function economyRows(o, n, skip = []) {
  return `${gdpRow(o)}
    ${fieldRow(o, n, "grdp_growth", "l-income", "📈", "GRDP growth", signed, true)}
    ${fieldRow(o, n, "productivity", "l-income", "⚙️", "GRDP per worker", money, true)}
    ${skip.includes("fdi") ? "" : fdiRow(o, n)}`;
}

// The 34-province-only indicators (NSO publishes them only for the provinces of 2025): HDI and FDI 2025,
// doctors, forest cover, road deaths, enterprises, pupils per teacher, and the 2026 monthly estimates.
export function latestRows(o, n) {
  const f1 = (x) => fixed(x, 1);
  return [
    fieldRow(o, n, "hdi", "l-amenities", "🌱", "Human development (HDI)", dec3, true),
    fdiRow(o, n),
    fieldRow(o, n, "doctors_pk", "l-uninsured", "🩺", "Doctors per 10,000 people (State sector)", f1, true),
    fieldRow(o, n, "forest_cover", "l-forest", "🌲", "Forest cover", (x) => pct(x), null),
    fieldRow(o, n, "road_deaths", "l-poverty", "🚦", "Road deaths per 100,000 people", f1, false),
    fieldRow(o, n, "enterprises_pk", "l-amenities", "🏢", "Active enterprises per 1,000 people", f1, true),
    fieldRow(o, n, "pupils_per_teacher", "l-degrees", "🏫", "Pupils per teacher", (x) => fixed(x, 0), false),
    fieldRow(o, n, "growth_9m2026", "l-income", "🚀", "GRDP growth, 9 months 2026 (est.)", signed, true),
    fieldRow(o, n, "industry_jobs_2026", "l-income", "🏭", "Industrial jobs vs a year earlier", signed, true),
  ].join("");
}

// Workforce by industry with location quotients vs. the nation ("specialisation"). limit = max rows (0 = all).
export function industries(o, nation, limit = 0) {
  const n = nation.nation;
  const total = o.employed || 1;
  const nTotal = n.employed || 1;
  let rows = Object.entries(o.jobs || {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  if (limit) rows = rows.slice(0, limit);
  if (!rows.length) return `<p class="muted">${t("No workers by industry for this area (NSO publishes them only for the whole country).")}</p>`;
  const maxShare = rows[0][1] / total;
  return rows
    .map(([k, v]) => {
      const share = v / total;
      const nShare = (n.jobs?.[k] || 0) / nTotal;
      const lq = nShare > 0 ? share / nShare : 1;
      const tip = t("Share of jobs is {n}× the national share", { n: fixed(lq, 1) });
      const badge = lq >= 1.3 ? `<span class="lq hi" title="${tip}">×${fixed(lq, 1)}</span>`
        : lq <= 0.6 ? `<span class="lq lo" title="${tip}">×${fixed(lq, 1)}</span>` : "";
      return `<div class="ind"><span aria-hidden="true">${icon(`i-${k}`, DISTRICT_ICON[k] || "•")}</span>
        <span>${esc(t(nation.industries?.[k] || k))}${badge}</span><span class="n">${compact(v)} · ${pct(share, 0)}</span>
        <div class="bar"><i style="width:${(share / maxShare) * 100}%;background:${lq >= 1.3 ? "#9fd76a" : "#c9a45c"}"></i></div></div>`;
    })
    .join("");
}

export const gdpRow = (o) =>
  o.gdp != null
    ? `<div class="stat-row"><span class="sl">${icon("y-gold", "💰", { size: 14 })}GRDP${yearOf(o, "gdp") ? ` <span class="muted sy" style="font-size:11px">${esc(fmtYear(yearOf(o, "gdp")))}</span>` : ""}</span><span><b>${money(o.gdp)}</b>${
        o.population ? `<span class="cmp">${t("{v} per person", { v: money(o.gdp / o.population) })}</span>` : ""}</span></div>`
    : "";

// "▲ 3.4% since 2019" (its own line under the population) from growth / growth_years (cities and provinces), compared with Vietnam in the tooltip.
// Empty when growth is missing (null means "not measured", never zero).
export function growthSpan(o, n = null) {
  if (!Number.isFinite(o?.growth)) return "";
  const yrs = Array.isArray(o.growth_years) && o.growth_years.length === 2 ? o.growth_years : null;
  const p = (g) => `${g >= 0 ? "+" : "−"}${fixed(Math.abs(g * 100), 1)}%`;
  const period = yrs ? `${yrs[0]}–${yrs[1]}` : t("the last few years");
  const vn = Number.isFinite(n?.growth) ? ` (${t("Vietnam {v}", { v: p(n.growth) })})` : "";
  const tip = t("Population change {period}, NSO average population: {v}", { period, v: p(o.growth) }) + vn;
  const cls = o.growth >= 0 ? "good" : "bad";
  return `<span class="gsep"><span class="growth ${cls}" title="${esc(tip)}">${o.growth >= 0 ? "▲" : "▼"} ${fixed(Math.abs(o.growth * 100), 1)}%${
    yrs ? ` <span class="since">${t("since {y}", { y: yrs[0] })}</span>` : ""}</span></span>`;
}

export const popLine = (o, extra = "") =>
  `<div class="cp-pop">${icon("pop", "👥", { size: 16 })} ${t("<b>{pop}</b> people · {emp} employed", { pop: int(o.population), emp: int(o.employed) })}${extra}</div>`;

/**
 * Fill and show the panel.
 * spec: {kind: "city"|"state" (a province), stripe, title, sub, headExtra, sections: [{title, html}], foot, onClose, onPedia, wire(panel)}
 */
export function showPanel(spec) {
  const panel = panelEl();
  panel.dataset.kind = spec.kind;
  panel.setAttribute("aria-label", `${spec.kind === "state" ? spec.kindLabel ?? t("Province") : t("City")}: ${spec.title}`);
  panel.innerHTML = `
    <div class="sheet-grip" aria-hidden="true"></div>
    <div class="cp-head">
      <div class="stripe" style="background:${spec.stripe}"></div>
      <button class="icon-btn cp-close" aria-label="${t("Close panel (Esc)")}" title="${t("Close (Esc)")}">${icon("close", "✕", { size: 13 })}</button>
      <div class="cp-kind">${spec.kindLabel ?? (spec.kind === "state" ? t("Province") : t("City"))}</div>
      <h2 class="cp-name">${spec.titleHtml ?? esc(spec.title)}</h2>
      ${spec.sub ? `<div class="cp-full">${spec.sub}</div>` : ""}
      ${spec.headExtra || ""}
    </div>
    ${spec.sections.filter(Boolean).map((s) => `<section class="cp-section"><h3>${s.title}</h3>${s.html}</section>`).join("")}
    <div class="cp-foot">${spec.foot || ""} <a href="#" data-pedia>${t("Almanac")} ›</a></div>`;
  panel.hidden = false;
  panel.scrollTop = 0;
  panel.classList.remove("dragging-sheet");
  panel.style.transform = "";
  document.body.classList.add("panel-open");
  panel.querySelector(".cp-close").onclick = spec.onClose;
  panel.querySelector("[data-pedia]").onclick = (e) => {
    e.preventDefault();
    spec.onPedia?.();
  };
  spec.wire?.(panel);
}

export function hidePanel() {
  const panel = panelEl();
  panel.hidden = true;
  panel.innerHTML = "";
  delete panel.dataset.kind;
  document.body.classList.remove("panel-open");
}

// Bottom-sheet swipe-down to close (mobile). Installed once.
export function installSheetSwipe(onClose) {
  const panel = panelEl();
  let start = null;
  panel.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || !matchMedia("(max-width: 700px)").matches) return;
    // Only from the grip/head, or anywhere while the sheet is scrolled to the top.
    const fromHead = e.target.closest(".sheet-grip, .cp-head");
    if (!fromHead && panel.scrollTop > 0) return;
    if (e.target.closest("button, a, input")) return;
    start = { y: e.clientY, id: e.pointerId, dy: 0, head: !!fromHead };
  });
  panel.addEventListener("pointermove", (e) => {
    if (!start || e.pointerId !== start.id) return;
    start.dy = Math.max(0, e.clientY - start.y);
    if (start.dy > 6 && (start.head || panel.scrollTop <= 0)) {
      panel.classList.add("dragging-sheet");
      panel.style.transform = `translateY(${start.dy}px)`;
    }
  });
  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dy = start.dy;
    start = null;
    panel.classList.remove("dragging-sheet");
    panel.style.transform = "";
    if (dy > 80) onClose();
  };
  panel.addEventListener("pointerup", end);
  panel.addEventListener("pointercancel", end);
}
