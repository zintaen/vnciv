// The stops of "Hành trình Việt Nam" and the facts on their cards. Every place, coordinate and number is read from the
// data files at runtime (cities.json, wonders.json, places.json, world.json, lenses.json); only the choice of stops and
// the sentence around each number are written here. A fact whose data is missing is left out; a stop without a place
// is skipped. Pure (no DOM): tour.test.mjs runs it in node against web/data.
import { t, lang } from "../../i18n.js";
import { int, fixed } from "../../format.js";
import { mapToLonLat } from "../daynight/sun.js";

const EN = lang === "en";

/** D = {cities, wonders, places, world (raw world.json), lenses (lenses.json), grid (hex.js makeGrid)} → stops. */
export function buildStops(D) {
  const cities = new Map((D.cities || []).map((c) => [c.id, c]));
  const wonders = new Map((D.wonders?.wonders || []).map((w) => [w.id, w]));
  const lenses = new Map((D.lenses?.lenses || []).map((l) => [l.id, l]));
  const towns = D.places?.towns || [], islands = D.places?.islands || [];
  const arch = new Map((D.places?.archipelagos || []).map((a) => [a.id, a]));
  const world = D.world || {}, grid = D.grid;
  const heritage = [...wonders.values()].filter((w) => w.rule === "world_heritage" && w.metrics?.inscribed);
  const firstWH = Math.min(...heritage.map((w) => w.metrics.inscribed));

  const wname = (w) => (EN && w.name_en) || w.name;
  const at = (o) => (o && Number.isFinite(o.x) && Number.isFinite(o.y) ? { x: o.x, y: o.y } : null);
  const coord = (o) => {
    const [lon, lat] = mapToLonLat(o.x, o.y);
    return t("{lat}° N, {lon}° E", { lat: fixed(lat, 2), lon: fixed(lon, 2) });
  };
  const popYear = (c) => Math.max(...Object.keys(c.pop_series || {}).map(Number).filter(Number.isFinite));
  function pop(id) {
    const c = cities.get(id);
    if (!c?.population) return null;
    const y = popYear(c);
    return t("Population of {name}: {pop} ({year})", { name: c.province_old || c.name, pop: int(c.population), year: Number.isFinite(y) ? y : "" });
  }
  function merged(id) {
    const c = cities.get(id);
    return c?.province_old && c.province_new && c.province_old !== c.province_new
      ? t("Part of {name} since the 2025 merger", { name: c.province_new }) : null;
  }
  function wh(id) {
    const w = wonders.get(id), y = w?.metrics?.inscribed;
    if (!y) return null;
    return y === firstWH
      ? t("{site}: Vietnam's first UNESCO World Heritage site, inscribed in {year}", { site: wname(w), year: y })
      : t("{site}: UNESCO World Heritage site since {year}", { site: wname(w), year: y });
  }
  function park(id) {
    const w = wonders.get(id), a = w?.metrics?.area_km2;
    return a ? t("{park} covers {area} km²", { park: wname(w), area: fixed(a, 1) }) : null;
  }
  function lensAt(id, cell, phrase) {
    const l = lenses.get(id), v = l?.values?.[cell];
    return Number.isFinite(v) ? t(phrase, { v: fixed(v, 1), year: l.year || "" }) : null;
  }
  const town = (name) => towns.find((x) => x.name === name) || null;
  const island = (name) => islands.find((x) => x.name === name) || null;
  function islandList(group, names) {
    const got = names.filter((n) => islands.some((i) => i.group === group && i.name === n));
    return got.length ? t("Among them: {list}", { list: got.join(", ") }) : null;
  }
  function archFact(id) {
    const a = arch.get(id);
    return a ? t("{n} islands and reefs on the map, part of {owner}", { n: a.islands, owner: a.owner }) : null;
  }
  // Highest Vietnamese hex (world.json elev_max, ETOPO1 samples): the camera's Sa Pa target. A neighbour's hex (Yunnan)
  // is higher, so the card says "of Vietnam".
  let top = -1;
  for (let i = 0; i < (world.elev_max || []).length; i++) {
    if (world.owner?.[i] >= 0 && world.elev_max[i] != null && (top < 0 || world.elev_max[i] > world.elev_max[top])) top = i;
  }
  const densest = [...cities.values()].reduce((a, c) => (c.density > (a?.density ?? -1) ? c : a), null);
  const city = (id) => cities.get(id);
  const sg = city("SG");

  const S = [
    { id: "lungcu", z: 2.7, place: wonders.get("lm-Q28197259"),
      title: (p) => wname(p),
      facts: (p) => [coord(p), pop(p.county), merged(p.county)] },
    { id: "sapa", z: 2.5, place: top >= 0 && grid ? { x: grid.cx(top), y: grid.cy(top) } : town("Sa Pa"),
      title: () => t("Sa Pa and the Hoàng Liên Sơn range"),
      facts: () => [top >= 0 ? t("Highest hex of Vietnam on the map: {m} m (ETOPO1)", { m: int(world.elev_max[top]) }) : null, park("np-Q1137913")] },
    { id: "halong", z: 2.5, place: wonders.get("wh-672"),
      title: (p) => wname(p), facts: (p) => [wh(p.id), pop("13")] },
    { id: "hanoi", z: 2.9, place: city("HN"),
      title: () => t("Hà Nội, the capital"), facts: () => [pop("HN"), wh("wh-1328")] },
    { id: "hue", z: 2.8, place: wonders.get("wh-678"),
      title: () => "Huế", facts: (p) => [wh(p.id), pop("26")] },
    { id: "hoian", z: 2.6, place: mid(city("DN"), wonders.get("wh-948")),
      title: () => t("Đà Nẵng and Hội An"), facts: () => [wh("wh-948"), wh("wh-949"), pop("DN")] },
    { id: "hoangsa", z: 1.7, place: arch.get("hoang_sa"), slogan: true,
      title: (p) => p.name, facts: () => [archFact("hoang_sa"), islandList("hoang_sa", ["Đảo Hoàng Sa", "Đảo Phú Lâm", "Đảo Tri Tôn"])] },
    { id: "truongsa", z: 1.5, place: arch.get("truong_sa"),
      title: (p) => p.name, facts: () => [archFact("truong_sa"), islandList("truong_sa", ["Đảo Trường Sa Lớn", "Đảo Song Tử Tây", "Đảo Sinh Tồn"])] },
    { id: "dalat", z: 2.8, place: city("35"),
      title: () => "Đà Lạt",
      facts: (p) => [world.elev?.[p.cell] != null ? t("Average height of its hex: {m} m above sea level", { m: int(world.elev[p.cell]) }) : null,
        lensAt("temperature", p.cell, "Mean temperature {v} °C ({year} average)"), pop("35")] },
    { id: "hcmc", z: 2.9, place: sg,
      title: () => t("Ho Chi Minh City"),
      facts: () => [pop("SG"), sg?.density ? (densest === sg
        ? t("{d} people per km², the densest of the 63 former provinces", { d: int(sg.density) })
        : t("{d} people per km²", { d: int(sg.density) })) : null] },
    { id: "mekong", z: 2.4, place: city("CT"),
      title: () => t("The Mekong Delta: Cần Thơ"),
      facts: (p) => [lensAt("crop_rice", p.cell, "Rice harvest: {v} tonnes per km² of the province ({year})"), pop("CT")] },
    { id: "phuquoc", z: 2.6, place: island("Đảo Phú Quốc"),
      title: () => "Phú Quốc", facts: () => [park("np-Q1749599"), pop("47"), merged("47")] },
    { id: "camau", z: 2.6, place: wonders.get("np-Q125333"),
      title: () => t("Cape Cà Mau"), facts: (p) => [park(p.id), pop("59")] }, // no coordinate: the data has the park's point, not the cape's tip
  ];
  const out = [];
  for (const s of S) {
    const p = s.place, pt = at(p);
    if (!pt) continue;
    out.push({ id: s.id, x: pt.x, y: pt.y, z: s.z, title: s.title(p), facts: s.facts(p).filter(Boolean).slice(0, 2),
      slogan: s.slogan && D.places?.slogan ? (EN ? D.places.slogan.en : D.places.slogan.text) : null });
  }
  return out;
}

function mid(a, b) {
  return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a || b || null;
}
