// The "Kể chuyện" chapters. Every number on a card is read from web/data at runtime (timeline.json, nation.json,
// states.json, world.json, lenses.json, history.json, merger.json, disasters.json, sealevel.json) or quoted from a page
// listed in sources.js; only the choice of steps and the sentence around each number are written here. A fact whose
// data is missing is left out. Pure (no DOM): story.test.mjs builds every chapter in node against web/data.
//
// A step: {title, facts: [text], lens (id | null = terrain), year (null = now), layers: [map toggle ids on],
//   cam: {x, y, z} (z = log2 of the zoom over the home view) | null, fit: [province abbr] (frame them) | null,
//   hl: [province abbr] (outline) | null, replay: "storm" | "merger" | null, storm (timeline.json storms index),
//   cite: [{label, url}]}.
import { t, lang } from "../../i18n.js";
import { int, fixed, pct, kindOf, yieldValue } from "../../format.js";
import { WORLD_BANK as WB, WIKI } from "./sources.js";

const NSO = "https://www.nso.gov.vn/";
const IBTRACS = "https://www.ncei.noaa.gov/products/international-best-track-archive";
const ETOPO = "https://www.ncei.noaa.gov/products/etopo-global-relief-model";
const DELTA = ["AGI", "DTH", "CTH", "VLO", "CMA"]; // the 2025 provinces of the Mekong Delta's lower course (the story's choice)
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "30/4/2026" (vi) / "30 Apr 2026" (en) for an ISO date. */
export function fmtDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return String(s || "");
  return lang === "vi" ? `${+m[3]}/${+m[2]}/${m[1]}` : `${+m[3]} ${MON[+m[2] - 1]} ${m[1]}`;
}
const num1 = (x) => fixed(x, 1);
const cite = (label, url) => ({ label, url });
const C_NSO = () => cite(t("NSO, Statistical Yearbooks"), NSO);
const C_WB = (s) => cite(`${t("World Bank")} ${s.id}`, s.url);

/** D = {T timeline, N nation, states, raw (world.json), grid, lenses (lenses.json), cities, history, merger, disasters, sealevel} */
export function buildChapters(D) {
  const T = D.T || {}, N = D.N || {}, raw = D.raw || {}, grid = D.grid;
  const states = D.states || [];
  const byAbbr = new Map(states.map((s, i) => [s.abbr, { ...s, index: i }]));
  const county = new Map((raw.counties || []).map((c) => [c.geoid, c.name]));
  const city = new Map((D.cities || []).map((c) => [c.id, c]));
  const lens = new Map((D.lenses?.lenses || []).map((l) => [l.id, l]));
  const hist = new Map((D.history?.events || []).map((e) => [e.id, e]));
  const nat = (k, y) => N.series?.[k]?.values?.[String(y)];
  const natStatus = (k, y) => N.series?.[k]?.status?.[String(y)];
  const statusTxt = (s) => (s === "prel" ? ` ${t("(prel.)")}` : s === "est" ? ` ${t("(est.)")}` : "");
  const nameOf = (lvl, code) => (lvl === "34" ? byAbbr.get(code)?.name : county.get(code)) || code;
  const at = (o, z) => (o && Number.isFinite(o.x) && Number.isFinite(o.y) ? { x: o.x, y: o.y, z } : null);
  // a province's centre: the mean of its land hexes (Hoàng Sa / Trường Sa left out)
  const centres = new Map();
  if (grid && raw.owner) {
    const rem = new Set(raw.remote || []), acc = new Map();
    raw.owner.forEach((o, i) => { if (o < 0 || rem.has(i)) return; const a = acc.get(o) || [0, 0, 0]; a[0] += grid.cx(i); a[1] += grid.cy(i); a[2]++; acc.set(o, a); });
    for (const [o, [x, y, n]] of acc) centres.set(raw.states[o]?.abbr, { x: x / n, y: y / n });
  }
  const stAt = (abbr, z) => at(centres.get(abbr), z);

  // The province with the highest value of a timeline series in year y, at the level its lens is drawn at.
  function topOf(seriesId, y, lensId) {
    const s = T.series?.[seriesId];
    if (!s) return null;
    const pref = String(lens.get(lensId)?.level || "63");
    for (const lvl of [pref, pref === "63" ? "34" : "63"]) {
      let best = null;
      for (const [code, by] of Object.entries(s.levels?.[lvl] || {})) {
        const v = by?.[String(y)];
        if (Number.isFinite(v) && (!best || v > best.v)) best = { code, v, lvl };
      }
      if (best) return { ...best, name: nameOf(best.lvl, best.code) + (best.lvl === "63" ? ` ${t("(former province)")}` : "") };
    }
    return null;
  }
  const facts = (...a) => a.filter(Boolean);
  // a history.json sentence with its date in front, unless the (translated) sentence already gives it
  const dated = (e) => { const tx = t(e.text), d = fmtDate(e.date); return tx.includes(d) ? tx : t("{date}: {text}", { date: d, text: tx }); };

  // --- 1. Đổi Mới -------------------------------------------------------------------------------------------------
  const g = WB.gdp_pc_const.values, u = WB.urban.values, pv = WB.poverty_300.values;
  const pov19 = nat("poverty_rate_multidimensional", 2019), pov25 = nat("poverty_rate_multidimensional", 2025);
  const povTop = topOf("poverty_rate_multidimensional", 2025, "poverty");
  const urb = (y) => (nat("urban_population", y) && nat("population", y) ? nat("urban_population", y) / nat("population", y) : null);
  const gdpY0 = Object.keys(N.series?.grdp_per_capita?.values || {}).map(Number).sort()[0];
  const gdpTop = topOf("grdp_per_capita", 2025, "gdp_pc");
  const doimoi = {
    id: "doimoi", title: t("Đổi Mới, 1986 to today"), blurb: t("Growth, poverty and towns since the 1986 reforms"),
    steps: [
      { title: t("Đổi Mới, December 1986"), lens: null, year: null, cam: at(city.get("HN"), 2.2),
        facts: facts(t("The Đổi Mới reforms were adopted at the Communist Party's 6th National Congress, held in Ba Đình Hall, Hà Nội, on 15–18 December 1986."),
          t("GDP per person in constant 2015 dollars: ${a} in {y0}, ${b} in {y1}, {k} times as much.", { a: int(g[1986]), y0: 1986, b: int(g[2025]), y1: 2025, k: num1(g[2025] / g[1986]) })),
        cite: [cite("Wikipedia: Đổi Mới", WIKI.doimoi.url), cite("Wikipedia: 6th National Congress", WIKI.doimoi.url_en), C_WB(WB.gdp_pc_const)] },
      { title: t("Poverty in 2019"), lens: "poverty", year: 2019, cam: { x: null, y: null, z: 0 },
        facts: facts(pov19 != null && t("Households in multidimensional poverty (Vietnam's own measure): {v} in {y}.", { v: `${num1(pov19)}%`, y: 2019 }),
          t("By the World Bank's $3.00-a-day line (2021 prices), {a} of Vietnamese were poor in {y0} and {b} in {y1}.", { a: `${num1(pv[1992])}%`, y0: 1992, b: `${num1(pv[2022])}%`, y1: 2022 })),
        cite: [C_NSO(), C_WB(WB.poverty_300)] },
      { title: t("Poverty in 2025"), lens: "poverty", year: 2025, cam: { x: null, y: null, z: 0 },
        facts: facts(pov25 != null && t("Households in multidimensional poverty: {v} in {y}.", { v: `${num1(pov25)}%${statusTxt(natStatus("poverty_rate_multidimensional", 2025))}`, y: 2025 }),
          povTop && t("Highest on the map: {name}, {v}.", { name: povTop.name, v: `${num1(povTop.v)}%` })),
        cite: [C_NSO()] },
      { title: t("Towns and cities grow"), lens: "urban", year: null, cam: { x: null, y: null, z: 0 },
        facts: facts(urb(2019) != null && urb(2025) != null && t("Urban residents: {a} of the population in {y0}, {b} in {y1} (NSO average population).", { a: pct(urb(2019)), y0: 2019, b: pct(urb(2025)), y1: 2025 }),
          t("In {y} the World Bank counts {v} of Vietnamese as urban.", { v: `${num1(u[1986])}%`, y: 1986 })),
        cite: [C_NSO(), C_WB(WB.urban)] },
      { title: t("Output per person"), lens: "gdp_pc", year: 2025, cam: { x: null, y: null, z: 0 },
        facts: facts(gdpY0 && nat("grdp_per_capita", 2025) && t("GRDP per person in Vietnam: {a} million đồng in {y0}, {b} million đồng in {y1}.", { a: num1(nat("grdp_per_capita", gdpY0)), y0: gdpY0, b: num1(nat("grdp_per_capita", 2025)), y1: `2025${statusTxt(natStatus("grdp_per_capita", 2025))}` }),
          gdpTop && t("Highest on the map: {name}, {v} million đồng per person.", { name: gdpTop.name, v: num1(gdpTop.v) })),
        cite: [C_NSO()] },
    ],
  };

  // --- 2. The Mekong ----------------------------------------------------------------------------------------------
  // The Mekong's channels on the map (world.json rivers named Mê Kông / Hậu): where they enter Vietnam (the
  // northernmost point inside the country) and how long they run inside it.
  const MEKONG = /^(Sông )?(Mê Kông|Hậu)$/;
  const owner = raw.owner || [];
  const inVN = (x, y) => { const c = grid?.cellAt(x, y) ?? -1; return c >= 0 && owner[c] >= 0 ? c : -1; };
  let entry = null, lenUnits = 0;
  for (const r of raw.rivers || []) {
    if (!MEKONG.test(r.name || "")) continue;
    const p = r.pts || [];
    for (let i = 0; i + 1 < p.length; i += 2) {
      const c = inVN(p[i], p[i + 1]);
      if (c < 0) continue;
      if (!entry || p[i + 1] < entry.y) entry = { x: p[i], y: p[i + 1], cell: c };
      if (i + 3 < p.length && inVN(p[i + 2], p[i + 3]) >= 0) lenUnits += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    }
  }
  const entryProv = entry ? raw.states?.[owner[entry.cell]]?.name : null;
  const km = lenUnits * (raw.km_per_unit || 0.2);
  const paddyTop = states.filter((s) => s.paddy > 0).sort((a, b) => b.paddy - a.paddy)[0];
  const deltaStates = DELTA.map((a) => byAbbr.get(a)).filter(Boolean);
  const deltaPaddy = deltaStates.reduce((a, s) => a + (s.paddy || 0), 0), natPaddy = N.nation?.paddy;
  // Low-lying lens: mean value over each province's hexes that have one
  const low = lens.get("low_lying");
  let lowTop = null;
  if (low?.values) {
    const sum = new Map();
    low.values.forEach((v, i) => { if (v == null || owner[i] < 0) return; const k = owner[i], o = sum.get(k) || [0, 0]; o[0] += v; o[1]++; sum.set(k, o); });
    for (const [k, [s, n]] of sum) if (n >= 5 && (!lowTop || s / n > lowTop.v)) lowTop = { name: raw.states?.[k]?.name, v: s / n };
  }
  // sealevel.json: land at or below 1 m, in km² (share × hex area), nationwide and in the delta provinces
  const SL = D.sealevel, k1 = SL?.levels?.indexOf(1) ?? -1;
  let sl1 = null;
  if (SL && k1 >= 0) {
    const delta = new Set(deltaStates.map((s) => s.index));
    sl1 = { all: 0, delta: 0 };
    SL.cells.forEach((c, j) => { const a = (SL.share[k1][j] || 0) / 100 * SL.hex_area_km2; sl1.all += a; if (delta.has(owner[c])) sl1.delta += a; });
  }
  const mg = new Map((D.merger?.provinces || []).map((p) => [p.abbr, p]));
  const deltaMerge = DELTA.map((a) => mg.get(a)).filter(Boolean)
    .map((p) => t("{name}: {members}", { name: p.name, members: p.members.map((m) => m.name).join(", ") }));
  const mekong = {
    id: "mekong", title: t("Down the Mekong"), blurb: t("From the border to the delta: rice, low land and the 2025 merger"),
    steps: [
      { title: t("The Mekong enters Vietnam"), lens: null, year: null, cam: entry ? { x: entry.x, y: entry.y, z: 2.4 } : stAt("AGI", 2),
        facts: facts(entryProv && t("The Mekong crosses into Vietnam in {name}.", { name: entryProv }),
          km > 0 && t("On this map its channels named Mê Kông and Hậu run {km} km inside Vietnam.", { km: int(km) })),
        cite: [cite("OpenStreetMap / Natural Earth", "https://www.naturalearthdata.com/")] },
      { title: t("A rice bowl"), lens: "crop_rice", year: null, cam: at(city.get("CT"), 1.4),
        facts: facts(paddyTop && t("{name} harvested {v} of paddy in {y}, the most of the 34 provinces.", { name: paddyTop.name, v: yieldValue({ unit: "tonnes" }, paddyTop.paddy), y: String(paddyTop.years?.paddy || "") }),
          natPaddy > 0 && deltaPaddy > 0 && t("{list} together: {p} of Vietnam's paddy.", { list: deltaStates.map((s) => s.name).join(", "), p: pct(deltaPaddy / natPaddy, 0) })),
        cite: [C_NSO()] },
      { title: t("Low land"), lens: "low_lying", year: null, fit: DELTA, hl: DELTA,
        facts: facts(lowTop && t("{name}: on average {p} of each land hex lies at or below 2 m.", { name: lowTop.name, p: pct(lowTop.v, 0) }),
          t("ETOPO1 elevation (~1.8 km), no dykes, tides or storm surge: an exposure indicator, not a forecast.")),
        cite: [cite("ETOPO1", ETOPO)] },
      { title: t("If the sea rose 1 m"), lens: null, year: null, layers: ["sealevel"], fit: DELTA, hl: DELTA,
        facts: facts(sl1 && t("{a} km² of Vietnam's land lies at or below 1 m above the sea; {b} km² of it in these five provinces.", { a: int(sl1.all), b: int(sl1.delta) }),
          t("Global elevation models overstate the height of low deltas such as the Mekong's, so the real area is likely larger.")),
        cite: [cite("ETOPO1", ETOPO)] },
      { title: t("One delta, five provinces"), lens: null, year: 2025, replay: "merger", fit: DELTA,
        facts: facts(deltaMerge.length && t("Since {date}: {list}.", { date: fmtDate(D.merger?.date || T.merger?.date), list: deltaMerge.join("; ") })),
        cite: [cite("Resolution 202/2025/QH15", hist.get("res_202_2025")?.cite || WIKI.units.url)] },
    ],
  };

  // --- 3. Typhoon Yagi --------------------------------------------------------------------------------------------
  const remote = new Set(raw.remote || []);
  const s24 = (T.storms || []).filter((s) => s.season === 2024 && !(s.cells.length && s.cells.every((c) => remote.has(c))));
  const yagiIdx = (T.storms || []).findIndex((s) => s.season === 2024 && s.name === "Yagi");
  const top24 = s24.reduce((a, s) => ((s.max_kt || 0) > (a?.max_kt || 0) ? s : a), null);
  const dis = D.disasters?.typhoons;
  const yagiD = dis?.national?.strongest?.find((s) => s.name === "Yagi" && s.season === 2024)
    || dis?.national?.recent?.find((s) => s.name === "Yagi" && s.season === 2024) || null;
  const yagiProv = (yagiD?.provinces || []).filter((a) => byAbbr.has(a));
  const W = WIKI.yagi;
  const yagiCh = {
    id: "yagi", title: t("Typhoon Yagi, 2024"), blurb: t("The real IBTrACS track, and what it cost"),
    steps: [
      { title: t("The 2024 storm season"), lens: "disasters", year: 2024, cam: stAt("QNI", 0.8),
        facts: facts(s24.length && t("{n} storms passed within 100 km of Vietnam in 2024 (IBTrACS).", { n: s24.length }),
          top24?.max_kt && t("The strongest was {name}: {kt} kt near the coast (JMA 10-minute wind).", { name: top24.name, kt: int(top24.max_kt) })),
        cite: [cite("IBTrACS", IBTRACS)] },
      { title: t("Yagi's track"), lens: "disasters", year: 2024, replay: "storm", storm: yagiIdx, fit: yagiProv.length ? yagiProv : null,
        facts: facts(t("It made landfall over Hải Phòng and Quảng Ninh on 7 September 2024."),
          yagiD && t("Its 100 km reach covered {hexes} hexes in {n} provinces.", { hexes: int(yagiD.hexes), n: yagiProv.length })),
        cite: [cite("IBTrACS", IBTRACS), cite("Wikipedia: Typhoon Yagi", W.url)] },
      { title: t("The cost"), lens: "disasters", year: 2024, fit: yagiProv.length ? yagiProv : null, hl: ["QNI"],
        facts: facts(t("In Vietnam {d} people died and {m} went missing, most in landslides; over {s} buildings were affected.", { d: int(W.deaths), m: int(W.missing), s: int(W.structures) }),
          t("The government put the cost above {v} trillion đồng (US${b} billion) and called Yagi the strongest typhoon to hit Vietnam in 70 years; Quảng Ninh was hardest hit.", { v: fixed(W.cost_trillion_vnd, 3), b: fixed(W.cost_busd, 2) })),
        cite: [cite("Wikipedia: Typhoon Yagi", W.url)] },
      { title: t("Storms since 1980"), lens: "disasters", year: null, cam: { x: null, y: null, z: 0 },
        facts: facts(dis?.national && t("{n} storms passed within 100 km of Vietnam from {y0} to {y1}; {k} of them at typhoon strength (64 kt or more).", { n: int(dis.national.storms), y0: dis.since, y1: Math.max(...dis.national.by_year.map((b) => b.year)), k: int(dis.national.strong) }),
          t("The lens counts storm passages, not damage.")),
        cite: [cite("IBTrACS", IBTRACS)] },
    ],
  };

  // --- 4. 34 provinces --------------------------------------------------------------------------------------------
  const MP = D.merger?.provinces || [];
  const formerMerged = MP.reduce((a, p) => a + p.members.length, 0);
  const ev = (id) => hist.get(id) || null;
  const NEW_CITY = ["dong_nai_city", "quang_ninh_city", "bac_ninh_city"].map(ev).filter(Boolean)
    .map((e) => ({ e, st: states.find((s) => String(e.title).startsWith(s.name)) })).filter((o) => o.st);
  const newAbbr = new Set(NEW_CITY.map((o) => o.st.abbr));
  const cities9 = states.filter((s) => kindOf(s.abbr) === kindOf("HN")); // format.js: the nine centrally governed cities
  const six = cities9.filter((s) => !newAbbr.has(s.abbr));
  const U = WIKI.units, res202 = ev("res_202_2025"), m25 = (T.events || []).find((e) => e.id === "merger_2025");
  const cityStep = ({ e, st }, last) => ({
    title: t(e.title), lens: null, year: null, fit: [st.abbr], hl: [st.abbr],
    facts: facts(dated(e),
      last && t("As of 20 September 2026 Vietnam has {n} province-level units: {p} provinces and {c} centrally governed cities.", { n: U.sep2026.units, p: U.sep2026.provinces, c: U.sep2026.cities })),
    cite: [cite("Wikipedia", e.cite || U.url)].concat(last ? [cite("Wikipedia: Đơn vị hành chính cấp tỉnh", U.url)] : []),
  });
  const p34 = {
    id: "p34", title: t("34 new provinces, 2025"), blurb: t("The 63 → 34 merger and the new centrally governed cities"),
    steps: [
      { title: t("63 provinces"), lens: null, year: 2024, cam: { x: null, y: null, z: 0 },
        facts: facts(t("At the end of 2024 Vietnam had {n} province-level units: {p} provinces and {c} centrally governed cities.", { n: U.end2024.units, p: U.end2024.provinces, c: U.end2024.cities }),
          res202 && dated(res202)),
        cite: [cite("Wikipedia: Đơn vị hành chính cấp tỉnh", U.url)] },
      { title: t("1 July 2025: 34 provinces"), lens: null, year: 2025, replay: "merger", cam: { x: null, y: null, z: 0 },
        facts: facts(MP.length && t("{m} new provinces were formed from {k} former ones; the other {u} kept their borders.", { m: MP.length, k: formerMerged, u: states.length - MP.length }),
          m25 && t(m25.text)),
        cite: [cite("Resolution 202/2025/QH15", res202?.cite || U.url)] },
      { title: t("Six centrally governed cities"), lens: null, year: null, fit: six.map((s) => s.abbr), hl: six.map((s) => s.abbr),
        facts: facts(six.length && t("Centrally governed cities in July 2025: {list}.", { list: six.map((s) => s.name).join(", ") }),
          ev("hue_city") && dated(ev("hue_city"))),
        cite: [cite("Wikipedia: Đơn vị hành chính cấp tỉnh", U.url)] },
      ...NEW_CITY.map((o, i) => cityStep(o, i === NEW_CITY.length - 1)),
    ],
  };

  return [doimoi, mekong, yagiCh, p34].map((ch) => ({ ...ch, steps: ch.steps.map((s) => ({ layers: [], cam: null, fit: null, hl: null, replay: null, ...s })) }));
}
