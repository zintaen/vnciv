// The newer "Kể chuyện" chapters (after Đổi Mới, the Mekong, Yagi and the 34 provinces in chapters.js). The same rules:
// every number is read from web/data at runtime or quoted from a page in sources.js (ARTICLES: verbatim quotes, checked
// against the cached revision by tests/test_story2.py); events come from history.json, picked by their `story` ids, so
// a chapter grows when the History list does. A fact whose data is missing is left out; a chapter with fewer than four
// steps is dropped. Pure (no DOM).
import { t, lang } from "../../i18n.js";
import { int, fixed, pct, money, yieldValue } from "../../format.js";
import { ARTICLES as A } from "./sources.js";

const NSO = "https://www.nso.gov.vn/";
const IBTRACS = "https://www.ncei.noaa.gov/products/international-best-track-archive";
const GHSL = "https://human-settlement.emergency.copernicus.eu/ghs_buS2023.php";
const GFC = "https://glad.earthengine.app/view/global-forest-change";
const OSM = "https://www.openstreetmap.org/";
const CENSUS = "https://www.nso.gov.vn/du-lieu-va-so-lieu-thong-ke/2020/11/ket-qua-toan-bo-tong-dieu-tra-dan-so-va-nha-o-nam-2019/";
// The central coast for the floods chapter (the story's choice): the 2025 provinces from Hà Tĩnh to Quảng Ngãi.
const CENTRAL = ["HTI", "QTR", "HUE", "DNA", "QNG"];
// The five Central Highlands provinces before the 2025 merger (former-province ids in ethnic.json / cities.json):
// Kon Tum, Gia Lai, Đắk Lắk, Đắk Nông, Lâm Đồng.
const HIGHLAND_FORMER = ["28", "30", "33", "72", "35"];

const cite = (label, url) => ({ label, url });
const num1 = (x) => fixed(x, 1);
const facts = (...a) => a.filter(Boolean);
export const evTitle = (e) => (lang === "vi" && e.title_vi ? e.title_vi : t(e.title));
export const evText = (e) => (lang === "vi" && e.text_vi ? e.text_vi : t(e.text));
/** A history event's citation: "Wikipedia: <article>" or the page's host. */
export function evCite(e) {
  const u = String(e.cite || "");
  const m = /^https:\/\/\w+\.wikipedia\.org\/wiki\/(.+)$/.exec(u);
  return cite(m ? `Wikipedia: ${decodeURIComponent(m[1]).replace(/_/g, " ")}` : u.replace(/^https?:\/\/(www\.)?([^/]+).*$/, "$2"), u);
}

/** H = helpers from chapters.js: {at, stAt, byAbbr, city, lens, nat, dated, fmtDate, T, raw, grid, states, merger}. */
export function moreChapters(D, H) {
  const { at, stAt, byAbbr, city, nat, dated, fmtDate, T, raw, grid, states } = H;
  const events = D.history?.events || [];
  const evs = (id) => events.filter((e) => (e.story || []).includes(id));
  // a chapter's own steps: these events of its story, in date order (the rest stay in its "Related events")
  const pick = (id, ids) => evs(id).filter((e) => ids.includes(e.id));
  const evAt = (e, z) => (e.x != null ? { x: e.x, y: e.y, z } : null);
  const evStep = (e, o = {}) => ({ title: evTitle(e), lens: null, year: null, cam: evAt(e, 2.4) || { x: null, y: null, z: 0 },
    facts: [dated(e)], cite: [evCite(e)], ...o });
  const st = (a) => byAbbr.get(a);
  const rank = (field, a, higher = true) => {
    const v = (s) => s[field];
    const list = states.filter((s) => Number.isFinite(v(s))).sort((x, y) => (higher ? v(y) - v(x) : v(x) - v(y)));
    return { n: list.findIndex((s) => s.abbr === a) + 1, of: list.length, top: list[0] };
  };
  const C_NSO = cite(t("NSO, Statistical Yearbooks"), NSO);
  const art = (k) => cite(`Wikipedia: ${decodeURIComponent(A[k].url.split("/wiki/")[1]).replace(/_/g, " ")}`, A[k].url);
  const out = [];

  // --- Bạch Đằng: three battles on one river --------------------------------------------------------------------------
  {
    const E = evs("bachdang");
    const years = E.map((e) => e.year);
    const mid = E.filter((e) => e.x != null);
    const c = mid.length ? { x: mid.reduce((a, e) => a + e.x, 0) / mid.length, y: mid.reduce((a, e) => a + e.y, 0) / mid.length, z: 2.2 } : null;
    out.push({ id: "bachdang", theme: "history", title: t("Bạch Đằng: three battles on one river"), blurb: t("938, 981 and 1288 on the same estuary"),
      steps: [
        ...E.map((e) => evStep(e, { layers: ["battles"] })),
        E.length >= 2 && { title: t("One river, three victories"), lens: null, year: null, layers: ["battles", "rivers"], cam: c,
          facts: facts(t("{n} battles on the Bạch Đằng, {a} to {b}: {span} years apart from first to last.", { n: E.length, a: years[0], b: years.at(-1), span: years.at(-1) - years[0] }),
            t("The Battle sites layer shows the other battles on the map.")),
          cite: E.map(evCite).slice(0, 2) },
      ].filter(Boolean) });
  }

  // --- Thăng Long – Hà Nội ----------------------------------------------------------------------------------------------
  {
    const E = pick("thanglong", ["thang_long", "van_mieu", "dong_da_1789", "ha_noi_named", "independence", "ha_tay_merged", "wh_thanglong_2010"]);
    const hn = st("HN");
    const imp = (D.wonders?.wonders || []).find((w) => w.id === "wh-1328");
    out.push({ id: "thanglong", theme: "history", title: t("Thăng Long – Hà Nội, a thousand years"), blurb: t("The capital from 1010 to today"),
      steps: [
        ...E.map((e) => evStep(e, { cam: evAt(e, 2.6) || at(city.get("HN"), 2.6) })),
        hn && { title: t("Hà Nội today"), lens: "density", year: null, fit: ["HN"], hl: ["HN"],
          facts: facts(hn.population && t("{name}: {p} people in {y}, on {a} km².", { name: hn.name, p: int(hn.population), y: hn.years?.population || "", a: int(hn.area_km2) }),
            imp && t("{name} has been a UNESCO World Heritage site since {y}.", { name: imp.short || imp.name, y: imp.metrics?.inscribed })),
          cite: [C_NSO] },
      ].filter(Boolean) });
  }

  // --- The North–South railway ------------------------------------------------------------------------------------------
  {
    const R = A.rail, V = A.rail_vinh_hue;
    out.push({ id: "railway", theme: "growth", title: t("The North–South railway"), blurb: t("1,726 km of metre-gauge track, from Hà Nội to Sài Gòn"),
      steps: [
        { title: t("Hà Nội to Sài Gòn"), lens: null, year: null, layers: ["rail"], cam: at(city.get("HN"), 1.6),
          facts: [t("A single-track metre-gauge line runs {km} km from Hà Nội to TP. Hồ Chí Minh.", { km: int(R.km) }),
            t("It was built under French rule over nearly forty years, from {a} to {b}.", { a: R.from, b: R.to })], cite: [art("rail")] },
        ...evs("railway").filter((e) => e.year < 1913).map((e) => evStep(e, { layers: ["rail"] })), // the sections before Vinh–Huế
        { title: t("Vinh to Huế"), lens: null, year: null, layers: ["rail"], cam: at(city.get("22"), 1.8),
          facts: [t("The Vinh–Huế section was built from {a} to {b}.", { a: V.from, b: V.to })], cite: [art("rail_vinh_hue")] },
        { title: t("Huế to Nha Trang: the last link"), lens: null, year: null, layers: ["rail", "passes"], cam: at(city.get("34"), 1.6),
          facts: [t("The Huế–Nha Trang section came last, from {a} to {b}.", { a: V.last_from, b: V.last_to }),
            t("The whole Hà Nội–Sài Gòn line opened on {date}.", { date: fmtDate(A.rail_1936.date) })], cite: [art("rail_1936")] },
        { title: t("Reunified, 1976"), lens: null, year: null, layers: ["rail"], cam: { x: null, y: null, z: 0 },
          facts: [t("Heavily damaged in the war, the line was restored and returned to service on {date}, as a symbol of unity.", { date: fmtDate(A.rail_1976.date) })],
          cite: [art("rail_1976")] },
        { title: t("The backbone"), lens: null, year: null, layers: ["rail", "hubs"], cam: at(city.get("SG"), 1.6),
          facts: [t("In 2007 the line carried {p}% of the railway network's passengers and {c}% of its freight.", { p: R.share2007.passengers, c: R.share2007.cargo })],
          cite: [art("rail")] },
      ].slice(0, 8) });
  }

  // --- Cao tốc Bắc – Nam: expressways by opening year (living_roads.json) -------------------------------------------------
  {
    const L = D.roads;
    const routes = Object.entries(L?.routes || {}).map(([name, r]) => ({ name, ...r })).filter((r) => Number.isFinite(r.year)).sort((a, b) => a.year - b.year);
    const kmu = raw.km_per_unit || 0.2;
    const linkKm = (l) => (grid ? Math.hypot(grid.cx(l[1]) - grid.cx(l[0]), grid.cy(l[1]) - grid.cy(l[0])) * kmu : 0);
    const kmBy = (y) => (L?.links || []).reduce((a, l) => a + (l[2] != null && l[2] <= y ? linkKm(l) : 0), 0);
    const by = (y) => routes.filter((r) => r.year <= y).length;
    const first = routes[0];
    const yStep = (y, last) => ({ title: t("Expressways open by {y}", { y }), lens: null, year: y, layers: ["growth", "roads"], cam: { x: null, y: null, z: 0 },
      facts: facts(routes.length && t("By the end of {y}, {n} of the {m} dated expressway routes on this map were open: {km} km of mapped links.", { y, n: by(y), m: routes.length, km: int(kmBy(y)) }),
        last && t("Lengths are measured along the map's 5 km hex links, not the official route lengths.")),
      cite: [cite("OpenStreetMap", OSM), ...routes.filter((r) => r.year === y).slice(0, 2).map((r) => cite(`Wikipedia: ${r.name}`, r.source))] });
    out.push({ id: "expressway", theme: "growth", title: t("The North–South expressway"), blurb: t("Expressways by their opening year, 2002 to 2026"),
      steps: !first ? [] : [
        { title: t("The first expressway"), lens: null, year: null, layers: ["roads"], cam: at(city.get("HN"), 2.2),
          facts: [t("{name}, opened in {y}, is the earliest dated expressway on this map.", { name: first.name, y: first.year })],
          cite: [cite(`Wikipedia: ${first.name}`, first.source)] },
        ...[2019, 2022, 2024, 2026].filter((y) => T.years?.includes(y)).map((y, k, a) => yStep(y, k === a.length - 1)),
        { title: t("Replay: 1975 to now"), lens: null, year: null, layers: ["growth", "roads"], replay: "growth", cam: { x: null, y: null, z: 0 },
          facts: [t("▶ plays the built-up area and the expressways year by year; a dashed orange road was not yet open that year."),
            t("A route opened in stages shows from its last stage.")],
          cite: [cite("OpenStreetMap", OSM), cite("GHSL (JRC)", GHSL)] },
      ] });
  }

  // --- Bắc Ninh: from rice villages to an electronics hub -----------------------------------------------------------------
  {
    const b = st("BNI");
    const fdi = b && rank("fdi", "BNI"), jobs = b && rank("industry_jobs_2026", "BNI");
    const G = D.geo, gi = G?.states?.indexOf("BNI") ?? -1;
    const parks = gi >= 0 ? (G.parks || []).filter((p) => p.p === gi) : [];
    const ha = parks.reduce((a, p) => a + (p.ha || 0), 0);
    const E = evs("bacninh");
    out.push({ id: "bacninh", theme: "growth", title: t("Bắc Ninh: from rice villages to an electronics hub"), blurb: t("Rice, foreign investment and factories, then a city in 2026"),
      steps: !b ? [] : [
        { title: t("Rice country"), lens: "crop_rice", year: null, fit: ["BNI"], hl: ["BNI"],
          facts: facts(b.paddy > 0 && t("{name} harvested {v} of paddy in {y}.", { name: b.name, v: yieldValue({ unit: "tonnes" }, b.paddy), y: b.years?.paddy || "" }),
            t("Since July 2025 the province also includes the former Bắc Giang.")),
          cite: [C_NSO] },
        { title: t("Foreign investment"), lens: "fdi", year: null, fit: ["BNI"], hl: ["BNI"],
          facts: facts(fdi?.n && t("{name}: {v} of foreign investment registered in {y}, number {n} of {m} provinces.", { name: b.name, v: money(b.fdi), y: b.years?.fdi || "", n: fdi.n, m: fdi.of }),
            fdi?.top && fdi.top.abbr !== "BNI" && t("Most: {name}, {v}.", { name: fdi.top.name, v: money(fdi.top.fdi) })),
          cite: [C_NSO] },
        parks.length > 0 && { title: t("Industrial parks"), lens: null, year: null, layers: ["parks"], fit: ["BNI"], hl: ["BNI"],
          facts: [t("{n} industrial parks mapped in OpenStreetMap in {name}, {ha} ha in all (outlines of 20 ha or more).", { n: parks.length, name: b.name, ha: int(ha) })],
          cite: [cite("OpenStreetMap", OSM)] },
        jobs?.n && { title: t("Factory jobs in 2026"), lens: "industry_jobs_2026", year: null, fit: ["BNI"], hl: ["BNI"],
          facts: [t("Industrial-enterprise jobs on 1 October 2026 against a year earlier: {v} in {name} (estimate), number {n} of {m}.", { v: pct(b.industry_jobs_2026), name: b.name, n: jobs.n, m: jobs.of })],
          cite: [C_NSO] },
        ...E.map((e) => evStep(e, { fit: ["BNI"], hl: ["BNI"], cam: null })),
      ].filter(Boolean).slice(0, 8) });
  }

  // --- TP.HCM grows: GHSL built-up area 1975–2020 in the former city ----------------------------------------------------
  {
    const B = D.built;
    const sg = (raw.counties || []).findIndex((c) => c.geoid === "SG");
    let km = null;
    if (B?.cells && sg >= 0) {
      km = B.epochs.map(() => 0);
      B.cells.forEach((c, j) => { if (raw.county?.[c] === sg) B.share[j].forEach((s, k) => { km[k] += (s / 100) * B.hex_area_km2; }); });
    }
    const ep = (y) => B?.epochs?.indexOf(y) ?? -1;
    const h = st("HCM"), m = (D.merger?.provinces || []).find((p) => p.abbr === "HCM");
    const E = pick("hcmc", ["gia_dinh_1698", "hcmc_named", "thu_thiem_tunnel", "metro_hcm1_2024", "long_thanh_2025"]);
    out.push({ id: "hcmc", theme: "growth", title: t("Hồ Chí Minh City grows"), blurb: t("Satellite built-up area, the metro and the 2025 merger"),
      steps: [
        ...E.filter((e) => e.year <= 1976).map((e) => evStep(e, { cam: evAt(e, 2.4) || at(city.get("SG"), 2.4) })),
        km && ep(1975) >= 0 && { title: t("Built-up land, 1975 to 2020"), lens: null, year: null, layers: ["growth"], replay: "growth", cam: at(city.get("SG"), 2),
          facts: [t("Buildings covered {a} km² of the former city in {y0}, {b} km² in {y1} and {c} km² in {y2}.", { a: int(km[ep(1975)]), y0: 1975, b: int(km[ep(2000)]), y1: 2000, c: int(km[ep(2020)]), y2: 2020 }),
            t("GHSL counts building footprints from satellite images (1 km pixels), not population.")],
          cite: [cite("GHSL (JRC)", GHSL)] },
        h && { title: t("The densest province"), lens: "density", year: null, fit: ["HCM"], hl: ["HCM"],
          facts: facts(h.population && t("{name}: {p} people in {y}.", { name: h.name, p: int(h.population), y: h.years?.population || "" }),
            h.density && t("{v} people per km².", { v: int(h.density) })),
          cite: [C_NSO] },
        ...E.filter((e) => e.year > 1976).map((e) => evStep(e, { layers: ["metro"] })),
        m && { title: t("One city from three"), lens: null, year: 2025, replay: "merger", fit: ["HCM"], hl: ["HCM"],
          facts: [t("Since {date}: {name} = {members}.", { date: fmtDate(D.merger.date), name: m.name, members: m.members.map((x) => x.name).join(", ") })],
          cite: [cite("Resolution 202/2025/QH15", events.find((e) => e.id === "res_202_2025")?.cite || NSO)] },
      ].filter(Boolean).slice(0, 8) });
  }

  // --- Forests: lost and regrown ----------------------------------------------------------------------------------------
  {
    const F = D.forest;
    const nat = F?.national, yrs = F?.years || [];
    const lost = nat ? nat.loss_ha.reduce((a, v) => a + v, 0) : 0;
    const pk = nat ? nat.loss_ha.indexOf(Math.max(...nat.loss_ha)) : -1;
    const topShare = (F?.provinces || []).filter((p) => byAbbr.has(p.abbr)).sort((a, b) => b.share - a.share)[0];
    const cov = rank("forest_cover", "HN"), low = rank("forest_cover", "HN", false);
    out.push({ id: "forest", theme: "nature", title: t("Vietnam's forests: lost and regrown"), blurb: t("Satellite tree loss since 2001 and the official forest cover"),
      steps: !nat ? [] : [
        { title: t("Forest in 2000"), lens: "forest", year: null, cam: { x: null, y: null, z: 0 },
          facts: [t("{ha} million ha had at least 30% tree canopy in 2000 (Hansen / Global Forest Watch).", { ha: num1(nat.forest2000_ha / 1e6) })], cite: [cite("Global Forest Change", GFC)] },
        { title: t("Loss since 2001"), lens: "forest_loss", year: null, cam: { x: null, y: null, z: 0 },
          facts: [t("{a} million ha of it were cleared, burned or harvested from {y0} to {y1}: {p} of the 2000 forest.", { a: num1(lost / 1e6), y0: yrs[0], y1: yrs.at(-1), p: pct(lost / nat.forest2000_ha, 0) }),
            t("Gross loss: much of it is plantation harvest (acacia, rubber) that is replanted; regrowth is not subtracted.")], cite: [cite("Global Forest Change", GFC)] },
        pk >= 0 && { title: t("The peak year"), lens: "forest_loss", year: null, replay: "forest", cam: { x: null, y: null, z: 0 },
          facts: [t("The most loss in one year: {ha} ha in {y}.", { ha: int(nat.loss_ha[pk]), y: yrs[pk] }), t("▶ adds the loss up year by year.")], cite: [cite("Global Forest Change", GFC)] },
        topShare && { title: t("Where the loss was heaviest"), lens: "forest_loss", year: null, fit: [topShare.abbr], hl: [topShare.abbr],
          facts: [t("{name} lost {p} of its 2000 forest ({ha} ha), the highest share of the 34 provinces.", { name: st(topShare.abbr).name, p: pct(topShare.share, 0), ha: int([].concat(topShare.loss_ha).reduce((a, v) => a + v, 0)) })], cite: [cite("Global Forest Change", GFC)] },
        cov.top && { title: t("Official forest cover"), lens: "forest_cover", year: null, fit: [cov.top.abbr], hl: [cov.top.abbr],
          facts: [t("Forest cover at the end of 2025 (official, counts planted forest): highest in {a}, {p}; lowest in {b}, {q}.", { a: cov.top.name, p: pct(cov.top.forest_cover, 0), b: low.top.name, q: pct(low.top.forest_cover, 1) })],
          cite: [C_NSO] },
      ].filter(Boolean) });
  }

  // --- UNESCO World Heritage (wonders.json) -----------------------------------------------------------------------------
  {
    const WH = (D.wonders?.wonders || []).filter((w) => w.rule === "world_heritage" && w.metrics?.inscribed).sort((a, b) => a.metrics.inscribed - b.metrics.inscribed);
    const byYear = new Map();
    for (const w of WH) byYear.set(w.metrics.inscribed, [...(byYear.get(w.metrics.inscribed) || []), w]);
    const hev = (w) => events.find((e) => e.wonder === w.id);
    const steps = [...byYear].map(([y, ws]) => {
      const e = hev(ws[0]);
      const c = ws.length > 1 ? { x: ws.reduce((a, w) => a + w.x, 0) / ws.length, y: ws.reduce((a, w) => a + w.y, 0) / ws.length, z: 2.4 } : { x: ws[0].x, y: ws[0].y, z: 2.8 };
      return { title: `${y}: ${ws.map((w) => w.short || w.name).join(", ")}`, lens: null, year: null, layers: ["wonders"], cam: c,
        facts: facts(e ? dated(e) : t("Inscribed on the World Heritage List in {y}.", { y })),
        cite: e ? [evCite(e)] : ws.map((w) => cite(`UNESCO ${w.metrics.whc_ref}`, `https://whc.unesco.org/en/list/${w.metrics.whc_ref}`)) };
    });
    // more years than steps: the first ones stand alone, the rest share the last step
    const S = steps.length > 7 ? [...steps.slice(0, 6), { ...steps.at(-1), title: t("{a} and {b}", { a: steps[6].title, b: steps.at(-1).title }), facts: [...steps[6].facts, ...steps.at(-1).facts].slice(0, 2) }] : steps;
    const intangible = evs("unesco").filter((e) => !e.wonder);
    out.push({ id: "unesco", theme: "history", title: t("Vietnam's UNESCO World Heritage"), blurb: t("Nine sites, from Huế in 1993 to Yên Tử in 2025"),
      steps: [
        { title: t("{n} World Heritage sites", { n: WH.length }), lens: null, year: null, layers: ["wonders"], cam: { x: null, y: null, z: 0 },
          facts: facts(WH.length && t("From {a} ({y0}) to {b} ({y1}).", { a: WH[0].short || WH[0].name, y0: WH[0].metrics.inscribed, b: WH.at(-1).short || WH.at(-1).name, y1: WH.at(-1).metrics.inscribed }),
            intangible.length && t("The History list also holds {n} other UNESCO listings: intangible and documentary heritage, geoparks.", { n: intangible.length })),
          cite: [cite("Wikidata", "https://www.wikidata.org/")] },
        ...S,
      ] });
  }

  // --- Biển đảo: the sea and the islands (places.json) --------------------------------------------------------------------
  {
    const P = D.places?.archipelagos || [];
    const hs = P.find((a) => a.id === "hoang_sa"), ts = P.find((a) => a.id === "truong_sa");
    const E = evs("sea");
    const fish = nat("fishery_production", 2025);
    const fs = T.series?.fishery_production?.levels?.["34"] || {};
    const ftop = Object.entries(fs).map(([a, v]) => ({ a, v: v["2025"] })).filter((o) => Number.isFinite(o.v)).sort((x, y) => y.v - x.v)[0];
    const arch = (a, ev) => a && { title: a.name, lens: null, year: null, layers: ["places"], cam: { x: a.x, y: a.y, z: 2.4 },
      facts: facts(t("{name} belongs to {owner}; {n} of its islands and reefs are named on this map.", { name: a.name, owner: a.owner, n: a.islands }), ev && dated(ev)),
      cite: [cite("Wikidata", "https://www.wikidata.org/"), ...(ev ? [evCite(ev)] : [])] };
    out.push({ id: "sea", theme: "nature", title: t("The sea and the islands"), blurb: t("Hoàng Sa, Trường Sa and the fishing grounds"),
      steps: [
        { title: t("Vietnam's sea"), lens: null, year: null, layers: ["places"], cam: { x: null, y: null, z: 0 },
          facts: facts(hs && ts && t("Hoàng Sa belongs to {a} and Trường Sa to {b}.", { a: hs.owner, b: ts.owner })), cite: [cite("Wikidata", "https://www.wikidata.org/")] },
        arch(hs, E.find((e) => /Hoàng Sa|Paracel/.test(e.title + e.place))),
        arch(ts, E.find((e) => /Trường Sa|Spratly|Gạc Ma|Johnson/.test(e.title + e.place))),
        fish && { title: t("Fishing grounds"), lens: "fishery_production", year: 2025, cam: { x: null, y: null, z: 0 },
          facts: facts(t("Fishery production (catch and aquaculture): {v} in {y}.", { v: yieldValue({ unit: "tonnes" }, fish), y: 2025 }),
            ftop && t("Most: {name}, {v}.", { name: st(ftop.a)?.name || ftop.a, v: yieldValue({ unit: "tonnes" }, ftop.v) })),
          cite: [C_NSO] },
      ].filter(Boolean) });
  }

  // --- Ageing and life expectancy -----------------------------------------------------------------------------------------
  {
    const s34 = (k, y) => Object.entries(T.series?.[k]?.levels?.["34"] || {}).map(([a, v]) => ({ a, v: v[String(y)] })).filter((o) => Number.isFinite(o.v)).sort((x, y2) => y2.v - x.v);
    const le = s34("life_expectancy", 2025), tf = s34("total_fertility_rate", 2025), br = s34("crude_birth_rate", 2025);
    const nm = (o) => st(o.a)?.name || o.a;
    const ag = H.provMean("ageing_index");
    out.push({ id: "ageing", theme: "people", title: t("Longer lives, fewer births"), blurb: t("Life expectancy, fertility and birth rates by province"),
      steps: [
        { title: t("Life expectancy"), lens: "life_expectancy", year: 2025, cam: { x: null, y: null, z: 0 },
          facts: facts(nat("life_expectancy", 2019) && t("Life expectancy at birth: {a} years in {y0}, {b} in {y1} (prel.).", { a: num1(nat("life_expectancy", 2019)), y0: 2019, b: num1(nat("life_expectancy", 2025)), y1: 2025 }),
            le.length && t("Highest: {a}, {v} years; lowest: {b}, {w}.", { a: nm(le[0]), v: num1(le[0].v), b: nm(le.at(-1)), w: num1(le.at(-1).v) })), cite: [C_NSO] },
        { title: t("Fertility in 2019"), lens: "total_fertility_rate", year: 2019, cam: { x: null, y: null, z: 0 },
          facts: facts(nat("total_fertility_rate", 2019) && t("{v} children per woman in {y}.", { v: fixed(nat("total_fertility_rate", 2019), 2), y: 2019 })), cite: [C_NSO] },
        { title: t("Fertility in 2025"), lens: "total_fertility_rate", year: 2025, cam: { x: null, y: null, z: 0 },
          facts: facts(nat("total_fertility_rate", 2025) && t("{v} children per woman in {y} (prel.).", { v: fixed(nat("total_fertility_rate", 2025), 2), y: 2025 }),
            tf.length && t("Highest: {a}, {v}; lowest: {b}, {w}.", { a: nm(tf[0]), v: fixed(tf[0].v, 2), b: nm(tf.at(-1)), w: fixed(tf.at(-1).v, 2) })), cite: [C_NSO] },
        { title: t("Births per 1,000 people"), lens: "crude_birth_rate", year: 2025, cam: { x: null, y: null, z: 0 },
          facts: facts(nat("crude_birth_rate", 2019) && t("Crude birth rate: {a}‰ in {y0}, {b}‰ in {y1}.", { a: num1(nat("crude_birth_rate", 2019)), y0: 2019, b: num1(nat("crude_birth_rate", 2025)), y1: 2025 }),
            br.length && t("Lowest: {a}, {v}‰.", { a: nm(br.at(-1)), v: num1(br.at(-1).v) })), cite: [C_NSO] },
        ag && { title: t("An ageing population"), lens: "ageing_index", year: null, fit: [ag.hi.a], hl: [ag.hi.a, ag.lo.a],
          facts: [t("{lens} on {date}: highest in {a}, {v}; lowest in {b}, {w}.", { lens: t(ag.l.name), date: fmtDate(ag.l.year), a: nm(ag.hi), v: num1(ag.hi.v), b: nm(ag.lo), w: num1(ag.lo.v) })],
          cite: [C_NSO] },
      ].filter(Boolean) });
  }

  // --- Central-coast storms and floods ------------------------------------------------------------------------------------
  {
    const dis = D.disasters?.typhoons;
    const cc = CENTRAL.map((a) => ({ a, ...(dis?.states?.[a] || {}) })).filter((o) => o.total != null).sort((x, y) => y.total - x.total);
    const stormIdx = (s) => (T.storms || []).findIndex((x) => x.name === s?.name && x.season === s?.season);
    const E = pick("floods", ["floods_1999", "typhoon_xangsane_2006", "typhoon_ketsana_2009", "central_floods_2020", "typhoon_kalmaegi_2025", "central_floods_2025"]);
    const dd = H.provMean("disaster_deaths"), ddc = dd?.all.find((o) => CENTRAL.includes(o.a));
    const stepOf = (e) => {
      const k = stormIdx(e.storm);
      return evStep(e, k >= 0 ? { lens: "disasters", year: e.storm.season, replay: "storm", storm: k } : { lens: "disasters", year: e.year >= 1980 ? e.year : null });
    };
    out.push({ id: "floods", theme: "nature", title: t("Storms and floods on the central coast"), blurb: t("Typhoon tracks since 1980 and the worst floods"),
      steps: [
        cc.length && { title: t("The storm coast"), lens: "disasters", year: null, fit: CENTRAL, hl: CENTRAL,
          facts: [t("Storms passing within 100 km, 1980–2026: {list}.", { list: cc.map((o) => `${st(o.a).name} ${o.total}`).join(", ") }),
            t("{name} had the most at typhoon strength: {n}.", { name: st([...cc].sort((x, y) => y.strong - x.strong)[0].a).name, n: [...cc].sort((x, y) => y.strong - x.strong)[0].strong })],
          cite: [cite("IBTrACS", IBTRACS)] },
        ddc && { title: t("Lives lost"), lens: "disaster_deaths", year: null, fit: CENTRAL, hl: [ddc.a],
          facts: [t("{lens}, {date}: highest of these provinces in {a}, {v}.", { lens: t(dd.l.name), date: dd.l.year, a: st(ddc.a)?.name || ddc.a, v: H.fmtLens(dd.l, ddc.v) }),
            dd.l.note && t(dd.l.note)].filter(Boolean), cite: [H.srcCite(dd.l.source)] },
        ...E.sort((a, b) => a.year - b.year).map(stepOf),
      ].filter(Boolean).slice(0, 8) });
  }

  // --- The Central Highlands --------------------------------------------------------------------------------------------
  {
    const HL = A.highlands_provinces.abbr.filter((a) => byAbbr.has(a));
    const fm = D.ethnic?.former || {};
    const fr = HIGHLAND_FORMER.map((id) => fm[id]).filter(Boolean);
    const tot = fr.reduce((a, p) => a + p.total, 0), min = fr.reduce((a, p) => a + p.total * p.minority_share, 0);
    const top = [...fr].sort((a, b) => b.minority_share - a.minority_share)[0];
    const G = A.highlands, E = evs("highlands");
    out.push({ id: "highlands", theme: "people", title: t("The Central Highlands"), blurb: t("Basalt plateaus, coffee and many peoples"),
      steps: [
        { title: t("The plateaus"), lens: "elevation", year: null, fit: HL, hl: HL,
          facts: [t("Today the region spans {list}.", { list: HL.map((a) => st(a).name).join(", ") })], cite: [art("highlands_provinces")] },
        { title: t("Red basalt soil"), lens: "farmland", year: null, fit: HL,
          facts: [t("Nearly {a} million ha of basalt soil, {p}% of the country's, suited to coffee, cocoa, pepper, mulberry and tea.", { a: G.basalt_mha, p: G.basalt_share })],
          cite: [art("highlands")] },
        { title: t("Coffee"), lens: null, year: null, fit: HL,
          facts: [t("Over {a} thousand ha of coffee: {p}% of Vietnam's coffee area.", { a: G.coffee_kha, p: G.coffee_share }),
            t("Vietnam is the world's second-largest coffee producer; Robusta is {p}% of its output.", { p: A.coffee.robusta })],
          cite: [art("highlands"), art("coffee")] },
        tot > 0 && { title: t("Many peoples"), lens: "ethnic_minority", year: null, fit: HL, hl: HL,
          facts: [t("In 2019, {p} of the {n} people of the five highland provinces of the time belonged to ethnic minorities.", { p: pct(min / tot, 0), n: int(tot) }),
            top && t("Highest share: {name}, {p}.", { name: top.name, p: pct(top.minority_share, 0) })].filter(Boolean),
          cite: [cite(t("NSO, 2019 census"), CENSUS)] },
        ...E.map((e) => evStep(e, { fit: e.x == null ? HL : null })),
      ].filter(Boolean).slice(0, 8) });
  }

  // --- A year of rice: the crop calendar month by month (living.json, the Rice seasons layer) -------------------------------
  {
    const L = D.living, C = L?.crop_calendar?.regions, R = L?.rice, FL = L?.flood;
    const mName = (m) => { const s = new Intl.DateTimeFormat(lang === "vi" ? "vi-VN" : "en-GB", { month: "long", timeZone: "UTC" }).format(Date.UTC(2001, m - 1, 15)); return lang === "vi" ? s.toLowerCase() : s; };
    const span = (ms) => (ms.length > 1 ? `${mName(ms[0])}–${mName(ms.at(-1))}` : mName(ms[0]));
    const reg = (r) => t(C?.[r]?.name || r);
    const sea = (r, k) => C?.[r]?.seasons?.[k];
    const sow = (r, k) => sea(r, k) && t("{region}, {season}: planted {plant}, harvested {harvest}.", { region: reg(r), season: t(sea(r, k).name), plant: span(sea(r, k).plant), harvest: span(sea(r, k).harvest) });
    const paddy = nat("paddy_production", 2025);
    const USDA = H.srcCite("usda_ipad_cropcal"), FLOOD = [H.srcCite("hcmue_flood_2016"), H.srcCite("fao_mrc_flood")];
    const DELTA = ["AGI", "DTH", "CTH", "VLO", "CMA"];
    const peak = FL?.months ? Object.entries(FL.months).filter(([, v]) => v === Math.max(...Object.values(FL.months))).map(([m]) => +m) : [];
    const mon = (m, o) => ({ lens: null, year: null, layers: ["seasons"], month: m, ...o });
    out.push({ id: "rice", theme: "nature", title: t("A year of rice"), blurb: t("Planting, harvest and the flood season, month by month"),
      steps: !C || !R ? [] : [
        mon(null, { title: t("Paddy country"), cam: { x: null, y: null, z: 0 },
          facts: facts(t("{n} lowland hexes on this map are mostly paddy: flat land under 50 m with at least 30% cropland.", { n: int(R.cells.length) }),
            paddy && t("Vietnam harvested {v} of paddy in {y}.", { v: yieldValue({ unit: "tonnes" }, paddy * 1000), y: 2025 })),
          cite: [USDA, C_NSO] }),
        mon(1, { title: t("January: winter–spring in the fields"), cam: { x: null, y: null, z: 0 }, facts: facts(sow("north", 0), sow("south", 0)), cite: [USDA] }),
        mon(5, { title: t("May: harvest in the south"), fit: DELTA, facts: facts(sow("south", 0), sow("south", 1)), cite: [USDA] }),
        mon(6, { title: t("June: harvest in the north"), cam: at(city.get("HN"), 1.6), facts: facts(sow("north", 0), sow("north", 1)), cite: [USDA] }),
        mon(9, { title: t("September: the summer–autumn crop"), cam: { x: null, y: null, z: 0 }, facts: facts(sow("south", 1), sow("south", 2)), cite: [USDA] }),
        FL?.cells && mon(peak[0] || 10, { title: t("The flood season"), fit: DELTA,
          facts: facts(t("Water spreads over {n} hexes of the upper Mekong Delta on this map from July and peaks in {m}.", { n: int(FL.cells.length), m: peak.map(mName).join(", ") }),
            t("Illustrative of the season (mùa nước nổi), not a forecast or a flood map.")),
          cite: FLOOD }),
      ].filter(Boolean) });
  }

  return out;
}
