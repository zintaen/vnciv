// City View data model: everything the city screen and its map layer show, derived from cities.json,
// nation.json, lenses.json, world.json and resources.json. Pure functions over app.data / app.w (no DOM).

import { t } from "../../i18n.js";

// Industry → short label, district colour (the medallion behind its icon) and icon id (icons.js i-<key>).
export const INDUSTRY = {
  agriculture: { short: "Agriculture", color: "#4f7a2a" },
  mining: { short: "Mining", color: "#6a5038" },
  construction: { short: "Construction", color: "#8a5426" },
  manufacturing: { short: "Manufacturing", color: "#9a5a22" },
  wholesale: { short: "Wholesale", color: "#7a6420" },
  retail: { short: "Retail", color: "#8a6a1e" },
  transportation: { short: "Logistics", color: "#3d5f73" },
  utilities: { short: "Utilities", color: "#2a5f86" },
  information: { short: "Information", color: "#25557e" },
  finance: { short: "Finance", color: "#7a6420" },
  real_estate: { short: "Real estate", color: "#6b4a2f" },
  professional: { short: "Professional", color: "#2b4f8a" },
  management: { short: "Management", color: "#4a4a7a" },
  admin: { short: "Admin services", color: "#4b5a68" },
  education: { short: "Education", color: "#2a3f7a" },
  health: { short: "Health care", color: "#7a2f2f" },
  arts: { short: "Arts", color: "#5b3a7e" },
  accommodation: { short: "Hospitality", color: "#6e3a5e" },
  other: { short: "Other services", color: "#4b4b4b" },
  public_admin: { short: "Government", color: "#3a5a4a" },
  government: { short: "Government", color: "#3a5a4a" },
};
export const industryIcon = (k) => `i-${k === "government" ? "public_admin" : k}`;

// Land-use groups shown as a hex's "tile yield" (world.json pct keys → group). Cover ids give the map colour.
export const LAND = [
  { key: "built", label: "Built-up", icon: "l-developed", cover: 9, keys: ["developed"] },
  { key: "farm", label: "Farmland", icon: "l-farmland", cover: 7, keys: ["crop", "pasture"] },
  { key: "forest", label: "Forest", icon: "l-forest", cover: 3, keys: ["forest"] },
  { key: "open", label: "Open land", icon: null, cover: 4, keys: ["grass", "shrub", "wetland"] },
];

const sum = (o) => Object.values(o || {}).reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0);
const HEX_AREA = (R) => (3 * Math.sqrt(3) / 2) * R * R; // area of a hex of radius R

/** Industries by jobs (city.jobs, where residents work) with location quotients vs the nation; [] without jobs. */
export function jobIndustries(city, nation) {
  const n = nation.nation;
  const total = city.employed || sum(city.jobs) || 1;
  const nTotal = n.employed || sum(n.jobs) || 1;
  return Object.entries(city.jobs || {})
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .map(([key, jobs]) => {
      const share = jobs / total;
      const natShare = (n.jobs?.[key] || 0) / nTotal;
      return {
        key, jobs, share, natShare, lq: natShare > 0 ? share / natShare : null,
        label: t(nation.industries?.[key] || key), short: t(INDUSTRY[key]?.short || key),
        color: INDUSTRY[key]?.color || "#3a4a5e", icon: industryIcon(key),
      };
    })
    .sort((a, b) => b.jobs - a.jobs);
}

/** GDP by industry (city.gdp_by_industry) with shares and location quotients vs national shares; [] without. */
export function gdpIndustries(city, nation) {
  const g = city.gdp_by_industry;
  const ng = nation.nation.gdp_by_industry || {};
  if (!g) return [];
  // Shares of the metro's whole GDP (not of the disclosed industries only), so a withheld sector cannot inflate
  // the others.
  const total = Number.isFinite(city.gdp) && city.gdp > 0 ? city.gdp : sum(g) || 1;
  const nTotal = Number.isFinite(nation.nation.gdp) && nation.nation.gdp > 0 ? nation.nation.gdp : sum(ng) || 1;
  const est = new Set(city.gdp_estimated || []);
  const rows = Object.entries(g)
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .map(([key, value]) => {
      const share = value / total, natShare = (ng[key] || 0) / nTotal;
      return {
        key, value, share, natShare, lq: natShare > 0 ? share / natShare : null, estimated: est.has(key),
        label: t(key === "government" ? "Government" : nation.industries?.[key] || key),
        short: t(INDUSTRY[key]?.short || key), color: INDUSTRY[key]?.color || "#3a4a5e", icon: industryIcon(key),
      };
    })
    .sort((a, b) => b.value - a.value);
  // What the source withholds, as its own grey row.
  const und = Number.isFinite(city.gdp_undisclosed) ? city.gdp_undisclosed
    : Object.values(g).some((v) => v == null) && Number.isFinite(city.gdp) ? Math.max(0, city.gdp - sum(g)) : 0;
  if (und > 0) {
    const missing = Object.entries(g).filter(([, v]) => v == null).map(([k]) => k);
    rows.push({
      key: "undisclosed", value: und, share: und / total, natShare: 0, lq: null, undisclosed: true, missing,
      label: t("Undisclosed"), short: t("Undisclosed"), color: "#4a5260", icon: "lock",
    });
  }
  return rows;
}

function landOf(w, cell) {
  if (!w.pct) return null;
  let best = null, tot = 0;
  for (const g of LAND) {
    const v = g.keys.reduce((a, k) => a + (w.pct[k]?.[cell] || 0), 0);
    tot += v;
    if (!best || v > best.share) best = { ...g, share: v };
  }
  if (!best || tot <= 0) return null;
  return { ...best, share: best.share / 100 };
}

/**
 * Everything the City View shows for one city.
 * Per footprint hex: estimated residents (lens "density" value × hex area: an estimate, not a count) and the
 * dominant land-use group with its share of the hex's land.
 */
export function buildModel(app, city) {
  const { w } = app;
  const { nation, cities, resources, lenses } = app.data;
  const grid = w.grid;
  const N = cities.length;
  const owner = w.raw.owner;
  const stateIdx = city.cell != null ? owner[city.cell] : -1;
  const stateRGB = w.stateColor[stateIdx] || [201, 164, 92];

  const footprint = (Array.isArray(city.footprint) && city.footprint.length ? city.footprint : [city.cell])
    .filter((c) => c != null && c >= 0);
  const mask = new Set(footprint);

  // Resource sites of the former province (resources.json items tagged with this city's id), biggest first per type.
  const items = resources?.items || [];
  const typeById = new Map((resources?.types || []).map((t) => [t.id, t]));
  const sites = [];
  items.forEach((it, index) => {
    if (it.cbsa === city.id) sites.push({ item: it, index, type: typeById.get(it.type) || null });
  });
  const catRank = { energy: 0, mineral: 1, agri: 2 };
  sites.sort((a, b) => (catRank[a.type?.category] ?? 3) - (catRank[b.type?.category] ?? 3)
    || (b.item.value ?? 0) - (a.item.value ?? 0));
  const siteCells = new Map(); // cell -> [site]
  for (const s of sites) {
    if (s.item.cell == null) continue;
    if (!siteCells.has(s.item.cell)) siteCells.set(s.item.cell, []);
    siteCells.get(s.item.cell).push(s);
  }

  // Per-hex tile yields.
  const density = lenses?.lenses?.find((l) => l.id === "density");
  // Map units are not km: world.json's km_per_unit scales them (Vietnam: 0.32, a 25-unit hex ≈ 8 km radius).
  const area = HEX_AREA(grid.R * (w.raw.km_per_unit || 1)); // km²
  // Far-offshore islands (Hoàng Sa, Trường Sa) stay in the footprint but get no plaque, pill or frame.
  const remote = new Set(w.raw.remote || []);
  const tiles = footprint.map((cell) => {
    const d = density?.values?.[cell];
    return {
      cell, x: grid.cx(cell), y: grid.cy(cell),
      residents: Number.isFinite(d) ? d * area : null,
      land: landOf(w, cell),
      isCity: cell === city.cell,
      remote: remote.has(cell),
    };
  });

  // Industries and GDP by industry (empty when the data has none). The map's districts are the real ones from
  // districts.json, placed by placeDistricts() once that file arrives; until then there are none.
  const inds = jobIndustries(city, nation);
  const gdpInds = gdpIndustries(city, nation);
  // District plaques go on footprint hexes near the centre that have no resource site and no other city; the rest
  // (small footprints) sit in a row inside the city's own hex.
  const cx = grid.cx(city.cell), cy = grid.cy(city.cell);
  // The city's banner stands over the hexes just north of it, so those come after the other near hexes.
  const R = grid.R;
  const cost = (c) => {
    const dx = grid.cx(c) - cx, dy = grid.cy(c) - cy;
    return Math.hypot(dx, dy) + (dy < -0.5 * R && dy > -3.2 * R && Math.abs(dx) < 3 * R ? 3 * R : 0);
  };
  const free = footprint
    .filter((c) => c !== city.cell && !remote.has(c) && !siteCells.has(c) && !w.cityByCell.has(c))
    .sort((a, b) => cost(a) - cost(b) || a - b);

  // Bounding box of the footprint (map units).
  const framed = footprint.filter((c) => !remote.has(c));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of framed.length ? framed : footprint) {
    const x = grid.cx(c), y = grid.cy(c);
    x0 = Math.min(x0, x - grid.R); x1 = Math.max(x1, x + grid.R);
    y0 = Math.min(y0, y - grid.R); y1 = Math.max(y1, y + grid.R);
  }

  const peers = (city.peers || []).map((id) => app.cityById.get(id)).filter(Boolean);
  const states = (city.states || []).map((abbr) => {
    const i = w.raw.states.findIndex((s) => s.abbr === abbr);
    return { abbr, index: i, name: i >= 0 ? (app.data.states?.[i]?.name || w.raw.states[i].name) : abbr };
  });
  const residentsSum = tiles.reduce((a, t) => a + (t.residents || 0), 0);

  return {
    city, N, nation, stateIdx, hexArea: area, stateRGB, states, footprint, mask, tiles, residentsSum,
    sites, siteCells, inds, gdpInds, free, districts: [], placed: [], inCity: [],
    bbox: Number.isFinite(x0) ? { x0, y0, x1, y1 } : null,
    peers,
  };
}

/**
 * Put the metro's districts on the map (schematic positions): the first ones on the free footprint hexes nearest
 * the city, the rest in a row inside the city's own hex. list = [{id, short, mapLq, color, icon, …}] (districts.js
 * cityDistricts). Sets m.districts, m.placed and m.inCity; the map layer reads them on its next frame.
 */
export function placeDistricts(m, list) {
  const ds = (list || []).map((d) => ({ ...d, lq: d.mapLq ?? null }));
  m.districts = ds;
  m.placed = [];
  m.inCity = [];
  ds.forEach((d, k) => {
    if (k < m.free.length) m.placed.push({ ...d, cell: m.free[k] });
    else m.inCity.push(d);
  });
}

/** Population series [{year, value}] from pop_series (null years dropped). */
export function popSeries(city) {
  const s = city.pop_series;
  if (!s || typeof s !== "object") return [];
  return Object.entries(s)
    .filter(([, v]) => Number.isFinite(v))
    .map(([y, v]) => ({ year: +y, value: v }))
    .sort((a, b) => a.year - b.year);
}

/** How many cities have a non-null rank for this key (the "of N"). */
export function rankCount(cities, key) {
  let n = 0;
  for (const c of cities) if (c.ranks?.[key] != null) n++;
  return n;
}

/** A resource value with its unit, short ("3.9 GW", "878 jobs"). */
export function resourceValue(item, type, compact) {
  const v = item.value;
  if (!Number.isFinite(v)) return "";
  const u = type?.unit || "";
  if (u === "MW") return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} GW` : `${Math.round(v)} MW`;
  if (u === "employees") return t("{n} workers", { n: compact(v) });
  if (/tons/.test(u)) return t("{n} t/yr", { n: compact(v) });
  if (/km²/.test(u)) return t("{n} km² play", { n: compact(v) });
  return `${compact(v)} ${u ? t(u) : ""}`.trim();
}
