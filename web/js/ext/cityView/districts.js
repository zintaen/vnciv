// City View "Districts": what the former province stands out for (districts.json v2) as strategy-game districts.
// A measured district: a figure per resident at least 1.25× Vietnam's (LQ); a site district: a mapped site (a port,
// a World Heritage site, a big airport, 1,000+ MW of power plants, the capital). Plus the Encampment from
// military.json (a garrison or fortress city) and the city's domestic air routes from trade.json (OpenFlights 2014).
//
//   cityDistricts(ddata, id, mil) → [district]   the city's districts, strongest first, each with what the dock and the
//                                           map plaques need ({id, name, short, color, icon, lq, via, text, …})
//   badgeOf(ddata, id) → {label, text, color, icon, district} | null | undefined   the city-type badge
//   districtsHtml(m, ddata, mil, trade) → HTML   the section body
//   badgeHtml(m, ddata) → HTML              the header badge
import { dec, esc, fixed, int } from "../../format.js";
import { compact, money } from "./fmt.js";
import { icon } from "../../ui/icon.js";
import { hasIcon } from "../../icons.js";
import { t } from "../../i18n.js";

// Icons the district catalog names (d-*) stand in for when missing: a near icon from the set, else an emoji.
const FALLBACK = {
  campus: ["y-science", "🎓"], commercial_hub: ["i-finance", "💰"], industrial_zone: ["i-manufacturing", "🏭"],
  harbor: ["i-transportation", "⚓"], theater_square: ["i-arts", "🏯"], entertainment_complex: ["i-accommodation", "🎡"],
  aerodrome: ["i-transportation", "✈️"], government_plaza: ["i-public_admin", "🏛"], aqueduct: ["i-utilities", "⚡"],
  encampment: [null, "⛺"],
};
// Map plaque labels.
const SHORT = {
  campus: "Campus", commercial_hub: "Commerce", industrial_zone: "Industry", harbor: "Harbor", theater_square: "Heritage",
  entertainment_complex: "Tourism", aerodrome: "Aerodrome", government_plaza: "Gov. plaza", aqueduct: "Power",
};
const TIER = { garrison: "Garrison", fortress: "Fortress" };
const ENCAMPMENT = { name: "Encampment", color: "#8a4a3a", description: "Military installations mapped in OpenStreetMap." };
// The measured figures: how a total and a per-resident value read.
const MEASURE = {
  students: { label: "University students", year: 2023, total: compact, per: (v) => t("{n} per 1,000", { n: fixed((v * 1000), 1) }) },
  retail: { label: "Retail sales", total: money, per: (v) => t("{v} each", { v: money(v) }) },
  fdi: { label: "FDI registered", total: money, per: (v) => t("{v} each", { v: money(v) }) },
  tourism: { label: "Tour turnover", total: money, per: (v) => t("{v} each", { v: money(v) }) },
};

// districts.json `text` is written in English per city ("5.6× Vietnam's university students per resident", an
// airport with its passengers, a power total); the known patterns are rebuilt here so they translate. Anything else
// is place names (ports, heritage sites), shown as they are.
const airport = (s) => s.split(" / ").map((p) => {
  const m = /^(.+?) (International Airport|Air Base|Airport)$/.exec(p);
  return m ? t(`{name} ${m[2]}`, { name: m[1] }) : p;
}).join(" / ");
export function districtText(s) {
  if (!s) return "";
  let m = /^([\d.]+)× Vietnam's (.+?) per resident(?: \((.+)\))?$/.exec(s);
  if (m) return t("{n}× Vietnam's {what} per resident", { n: dec(m[1]), what: t(m[2]) }) + (m[3] ? ` (${t(m[3])})` : "");
  if ((m = /^([\d,]+) MW of mapped power plants$/.exec(s))) return t("{n} MW of mapped power plants", { n: int(+m[1].replace(/,/g, "")) });
  if ((m = /^(.+) \(([\d.]+M) passengers\)$/.exec(s))) return t("{name} ({n} passengers)", { name: airport(m[1]), n: dec(m[2]) });
  if (s === "Seat of the National Assembly and the Government") return t(s);
  return s;
}

const catCache = new WeakMap();
function catalog(ddata) {
  let m = catCache.get(ddata);
  if (!m) catCache.set(ddata, (m = new Map((ddata?.catalog || []).map((c) => [c.id, c]))));
  return m;
}

export function iconFor(id, cat) {
  if (cat?.icon && hasIcon(cat.icon)) return cat.icon;
  const f = FALLBACK[id]?.[0];
  return f && hasIcon(f) ? f : null;
}

const instCache = new WeakMap();
function installationsById(mil) {
  let m = instCache.get(mil);
  if (!m) instCache.set(mil, (m = new Map((mil?.installations || []).map((i) => [i.id, i]))));
  return m;
}

/** The city's districts from districts.json, strongest first (the file's order), then military.json's Encampment. */
export function cityDistricts(ddata, id, mil) {
  const cat = catalog(ddata);
  const out = (ddata?.cities?.[id]?.districts || []).map((d) => {
    const c = cat.get(d.id) || {};
    return {
      ...d, name: t(c.name || d.id), color: c.color || "#5a6a7a", icon: iconFor(d.id, c), emoji: FALLBACK[d.id]?.[1] || "◆",
      cat: c, short: t(SHORT[d.id] || c.name || d.id), mapLq: d.lq ?? null,
    };
  });
  const mc = mil?.cities?.[id];
  if (mc) {
    const tier = t(TIER[mc.tier] || "Encampment");
    out.push({
      id: "encampment", name: t(ENCAMPMENT.name), color: ENCAMPMENT.color, icon: null, emoji: "⛺", cat: ENCAMPMENT,
      lq: null, via: "site", short: tier, tierLabel: tier, mapLq: null, military: mc,
    });
  }
  return out;
}

/** The city-type badge; undefined while districts.json is loading, null when there is none. */
export function badgeOf(ddata, id) {
  if (!ddata) return ddata; // undefined (loading) or null (missing)
  const row = ddata.cities?.[id];
  if (!row) return null;
  if (!row.badge) return { label: "Diversified", text: t("No district passes the rule: nothing stands out against Vietnam's figures."), color: "#6a7484", icon: null, district: null };
  const d = row.badge.district || row.badge.id;
  const c = catalog(ddata).get(d) || {};
  return { ...row.badge, district: d, color: c.color || "#6a7484", icon: iconFor(d, c), emoji: FALLBACK[d]?.[1] };
}

export function badgeHtml(m, ddata) {
  const b = badgeOf(ddata, m.city.id);
  if (!b) return "";
  return `<span class="cv-type${b.district ? "" : " plain"}" style="--tc:${esc(b.color)}" title="${esc(t("City type: {text} ({src})", { text: b.text ? districtText(b.text) : t(b.label), src: t(ddata.vintage || "") }))}">
    <span class="cv-type-ic">${icon(b.icon, b.emoji || "◆", { size: 13 })}</span>${esc(t(b.label))}</span>`;
}

function lqTag(lq) {
  if (lq == null) return "";
  const cls = lq >= 1.25 ? "hi" : lq <= 0.75 ? "lo" : "mid";
  return `<span class="cv-lq ${cls}" title="${esc(t("Location quotient: the figure per resident is {n}× Vietnam's", { n: fixed(lq, 2) }))}">×${fixed(lq, 1)}</span>`;
}

function encampmentCard(d, mil) {
  const mc = d.military;
  const inst = installationsById(mil);
  const names = (mc.installations || []).map((i) => inst.get(i)?.name).filter(Boolean);
  const more = (mc.installation_count || names.length) - Math.min(5, names.length);
  return `<div class="cv-dc" style="--dc:${esc(d.color)}" title="${esc(t(mil?.rule || ""))}">
    <div class="cv-dc-h"><span class="cv-dc-hex">${icon(null, d.emoji, { size: 18 })}</span>
      <div class="cv-dc-t"><b>${esc(d.name)} · ${esc(d.tierLabel)}</b><small>${esc(t(d.cat.description))}</small></div>
      <span class="cv-lq mid" title="${t("A site district")}">${t("Mapped site")}</span></div>
    <div class="cv-dc-mil">
      <p><b>${esc(d.tierLabel)}</b>${mc.naval ? ` (${t("naval")})` : ""}: ${t((mc.installation_count ?? names.length) === 1 ? "{n} qualifying installation in the former province." : "{n} qualifying installations in the former province.", { n: int(mc.installation_count ?? names.length) })} ${t("Vietnam publishes no troop numbers by place.")}</p>
      ${names.length ? `<p class="cv-dc-inst">${names.slice(0, 5).map((n) => `<span>${esc(n)}</span>`).join("")}${more > 0 ? `<small>${t("+{n} more", { n: more })}</small>` : ""}</p>` : ""}
    </div>
  </div>`;
}

/** The city's domestic air routes (trade.json): partner cities with the airlines flying each route. */
function airRoutesHtml(id, trade) {
  const zones = new Map((trade?.zones || []).map((z) => [z.id, z]));
  const z = zones.get(id);
  const rs = (trade?.routes || []).filter((r) => r.a === id || r.b === id);
  if (!z || !rs.length) return "";
  const name = (zid) => zones.get(zid)?.short || zones.get(zid)?.name || zid;
  return `<h4 class="cv-h4">${t("Air routes")} <span class="muted">${esc(t(trade.vintage || "OpenFlights, 2014"))}</span></h4>
    <p class="cv-note">${esc((z.airports || []).join(", "))} · ${t("{n} of the {k} domestic routes flown by the most airlines:", { n: rs.length, k: (trade.routes || []).length })}</p>
    <p class="cv-dc-inst">${rs.map((r) => {
      const other = r.a === id ? r.b : r.a;
      return `<span title="#${esc(r.rank)} · ${esc((r.airports || []).join("–"))} · ${esc((r.airline_codes || []).join(", "))}${Number.isFinite(r.dist_km) ? ` · ${int(r.dist_km)} km` : ""}">✈ ${esc(name(other))} <b>${int(r.airlines)}</b></span>`;
    }).join("")}</p>
    <p class="cv-note">${t("Number = airlines flying the route in the OpenFlights database (June 2014, its last update): no passenger counts, and newer routes are missing.")}</p>`;
}

function districtCard(d, m, ddata, mil) {
  const c = d.cat || {};
  const facts = [];
  const ms = MEASURE[c.measure];
  if (d.via === "measure" && ms && Number.isFinite(d.value)) {
    const pop = m.city.population;
    const nat = ddata.national?.[c.measure];
    facts.push(`<div><span>${esc(t(ms.label))}</span><b>${ms.total(d.value)}</b><small>${ms.year || 2024}</small></div>`);
    if (pop > 0) facts.push(`<div><span>${t("Per resident")}</span><b>${ms.per(d.value / pop)}</b><small>${Number.isFinite(nat) ? `VN ${ms.per(nat)}` : ""}</small></div>`);
  }
  if (d.military) return encampmentCard(d, mil);
  const via = d.via === "site" ? t("Mapped site") : t("Measured");
  return `<div class="cv-dc" style="--dc:${esc(d.color)}" title="${esc(t(c.description || ""))}">
    <div class="cv-dc-h"><span class="cv-dc-hex">${icon(d.icon, d.emoji, { size: 18 })}</span>
      <div class="cv-dc-t"><b>${esc(d.name)}</b><small>${esc(t(c.description || ""))}</small></div>
      ${d.lq != null ? lqTag(d.lq) : `<span class="cv-lq mid" title="${t("A site district: it counts as LQ 2 in the ranking")}">${via}</span>`}</div>
    ${facts.length ? `<div class="cv-dc-f">${facts.join("")}</div>` : ""}
    ${d.text ? `<p class="cv-dc-sub">${esc(districtText(d.text))}</p>` : ""}
  </div>`;
}

/** The Districts section body. ddata: districts.json (undefined while loading, null when missing). */
export function districtsHtml(m, ddata, mil, trade) {
  if (ddata === undefined) return `<p class="muted cv-note">${t("Loading districts…")}</p>`;
  if (!ddata) return `<p class="muted cv-note">${t("District data is not available.")}</p>`;
  const id = m.city.id;
  const row = ddata.cities?.[id] || null;
  const list = cityDistricts(ddata, id, mil);
  const b = badgeOf(ddata, id);
  const lead = !row
    ? `<p class="cv-lead">${t("No district figures for {name}.", { name: esc(m.city.name) })}</p>`
    : b?.district ? `<p class="cv-lead"><b class="cv-type-l" style="--tc:${esc(b.color)}">${esc(t(b.label))}</b> · ${esc(districtText(b.text || ""))}.</p>` : "";
  const cards = list.length
    ? `<div class="cv-dcs">${list.map((d) => districtCard(d, m, ddata, mil)).join("")}</div>`
    : row ? `<p class="muted cv-note">${t("No district passes the rule here: none of its figures per resident stands out against Vietnam's, and it has no qualifying site.")}</p>` : "";
  return `${lead}
    ${cards}
    ${airRoutesHtml(id, trade)}
    <div class="cv-schematic">
      <p>${t("<b>◆ On the map</b> each district stands as a plaque on a hex near the city. The positions are schematic: they show what the former province stands out for, not where it is.")}</p>
    </div>
    <details class="cv-more cv-rule"><summary>${t("How districts are chosen")}</summary>
      <p>${esc(t(ddata.rule?.text || ""))}</p>${mil?.rule && list.some((d) => d.military) ? `<p><b>${t("Encampment")}</b> (military.json): ${esc(t(mil.rule))}</p>` : ""}
    </details>
    <p class="cv-note">${t("Sources: NSO Statistical Yearbook 2024 figures; ports, heritage sites and airports from Wikidata, OurAirports and Wikipedia; power plants from the WRI Global Power Plant Database")}${list.some((d) => d.military) ? t("; military sites from OpenStreetMap") : ""}. ${t("×N = location quotient (per resident vs Vietnam).")}</p>`;
}
