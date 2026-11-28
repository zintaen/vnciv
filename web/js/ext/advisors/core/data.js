// The advisors' data model: three "levels" (states = provinces, metros = cities, counties = former provinces) of rows with typed fields, plus the links
// between rows and the hex map (row → highlight, cell → row). Built once from app.data (counties.json optional).
//
//   level = {id, label, noun, rows: [row], fields: [field], field(key), value(row, key),
//            highlight(rows, opts) → app.state.highlight, rowAtCell(cell) → row | null, focus(row), byKey: Map}
//   row   = {key, name, sub, level, ref, v: {fieldKey: value}}
//   field = {key, label, format, unit, higher_is, source, description, lens?, group, derived?}
import { fin, ratio } from "./util.js";
import { frameBox } from "./frame.js";
import { fixed } from "../../../format.js";
import { t as tr } from "../../../i18n.js";
import { yearOf, yearPlain, plainYear, vnRef } from "./years.js";

// The three levels for Vietnam: "states" = the 34 provinces of 2025, "metros" = the 63 cities, each standing for its
// whole former province (pre-July 2025), and "counties" = those 63 former provinces (counties.json). Level ids keep
// the original names so the views and the map layers stay compatible; labels and nouns are Vietnamese-map words.
const LAND_KEYS = ["forest", "crop", "pasture", "grass", "shrub", "wetland", "developed"];
const LAND_EN = {
  forest: "Forest", crop: "Cropland", pasture: "Pasture", grass: "Grassland", shrub: "Shrubland", wetland: "Wetland & mangrove", developed: "Built-up",
};
// Translated labels (for display).
export const LAND_LABEL = Object.fromEntries(Object.entries(LAND_EN).map(([k, v]) => [k, tr(v)]));
// "Share of the land in ..." phrases, one per cover.
const LAND_DESC = {
  forest: "Share of the land in forest (ESA WorldCover 2021, mean over the area's hexes).",
  crop: "Share of the land in cropland (ESA WorldCover 2021, mean over the area's hexes).",
  pasture: "Share of the land in pasture (ESA WorldCover 2021, mean over the area's hexes).",
  grass: "Share of the land in grassland (ESA WorldCover 2021, mean over the area's hexes).",
  shrub: "Share of the land in shrubland (ESA WorldCover 2021, mean over the area's hexes).",
  wetland: "Share of the land in wetland & mangrove (ESA WorldCover 2021, mean over the area's hexes).",
  developed: "Share of the land in built-up (ESA WorldCover 2021, mean over the area's hexes).",
};
export const LAND_COLOR = {
  forest: "#3f7a3a", crop: "#d2c457", pasture: "#93b852", grass: "#b9b06a", shrub: "#c9a874", wetland: "#4f9a86", developed: "#9a8f9e",
};
export { LAND_KEYS };
// counties.json columns copied onto each city (one city = one former province).
const COUNTY_ONTO_CITY = ["forest", "crop", "developed", "disasters"];

export function buildData(app) {
  const { cities = [], states = [], nation = {}, counties, resources, sources = [] } = app.data;
  const w = app.w;
  const grid = w.grid;
  const owner = w.raw.owner;
  const countyOf = w.raw.county || [];
  const n = grid.size;

  // --- cell indexes ---------------------------------------------------------------------------------------------
  const stateCells = new Map();
  const countyCells = new Map();
  const remote = new Set(w.raw.remote || []); // far-offshore islands (Hoàng Sa, Trường Sa): left out of province framing
  for (let i = 0; i < n; i++) {
    const o = owner[i];
    if (!(o >= 0) || remote.has(i)) continue;
    if (!stateCells.has(o)) stateCells.set(o, []);
    stateCells.get(o).push(i);
    const c = countyOf[i];
    if (c >= 0) {
      if (!countyCells.has(c)) countyCells.set(c, []);
      countyCells.get(c).push(i);
    }
  }
  // cell → city: footprints, smaller cities first so a bigger city's majority wins; then every city's own cell.
  const cellMetro = new Map();
  for (let k = cities.length - 1; k >= 0; k--) for (const cell of cities[k].footprint || []) cellMetro.set(cell, cities[k]);
  for (const c of cities) if (c.cell != null) cellMetro.set(c.cell, c);

  const srcTitle = new Map(sources.map((s) => [s.id, s]));
  const nat = nation.nation || {};
  const vintage = nation.vintage || "NSO Statistical Yearbook";
  const countyVintage = counties?.vintage || vintage;
  const mainYear = String(nation.year || nat.gdp_year || "");
  const fxYear = nation.currency?.fx_year || "";
  const NSO = "nso_yearbook";
  const lensMeta = new Map((app.data.lenses?.lenses || []).map((l) => [l.id, l]));

  // --- fields ---------------------------------------------------------------------------------------------------
  // Label, unit and group are translated here (static English or data-file text); descriptions arrive translated.
  // Each field carries the year of its figures on that level (records' `years`); the label shows it when it is not
  // the main year, or when the year differs between the provinces and the cities (HDI, FDI, enterprises).
  const F = (key, label, format, o = {}) => ({ key, label: o.raw ? label : tr(label), format, unit: tr(o.unit) || null, higher_is: o.higher_is || "neutral", source: o.source || "", description: o.description || "", lens: o.lens || null, group: tr(o.group || "Economy"), derived: !!o.derived, year: o.year || null });
  const sample = { states: states[0], metros: cities[0] };
  const varies = (k) => plainYear(yearOf(states[0], k)) !== plainYear(yearOf(cities[0], k));
  // Lens ids of the fields that have one (a lens is linked only when it shows the same level and year).
  const LENS_OF = {
    population: "density", density: "density", urban: "urban", growth: "growth", gdp_pc: "gdp_pc", median_income: "income", poverty: "poverty",
    gini: "gini", unemployment: "unemployment", productivity: "productivity", trained: "trained", literacy: "literacy", hdi: "hdi", fdi: "fdi",
    pci: "pci", internet: "internet", clean_water: "clean_water", housing: "housing", it_skills: "it_skills", enterprises_pk: "enterprises",
    growth_9m2026: "growth_2026", industry_jobs_2026: "industry_jobs_2026", doctors_pk: "doctors", road_deaths: "road_deaths",
    pupils_per_teacher: "pupils_per_teacher", forest_cover: "forest_cover",
  };
  const vnFields = (lv) => {
    const rec = sample[lv];
    const lensFor = (k) => {
      const l = lensMeta.get(LENS_OF[k]);
      if (!l) return null;
      if (l.level === "34" && lv !== "states") return null;
      if (l.year && k !== "population" && k !== "density" && plainYear(l.year) !== plainYear(yearOf(rec, k))) return null;
      return l;
    };
    // f(key, label, format, o): o.d = description template with {v} (the year and NSO), or o.lensDesc to use the lens's.
    const f = (key, label, format, o = {}) => {
      const y = yearOf(rec, key);
      const yt = yearPlain(y);
      const l = lensFor(key);
      const tag = y && !o.noTag && (plainYear(y) !== mainYear || varies(key)) ? ` (${yt})` : "";
      const description = o.lensDesc && l ? tr(l.description) : o.d ? tr(o.d, { v: yt ? tr("NSO, {y}", { y: yt }) : tr("NSO") }) : "";
      return F(key, `${tr(label)}${tag}`, format, { ...o, raw: true, source: o.source || NSO, description, lens: o.noLens ? null : l?.id || null, year: y });
    };
    const list = [
      f("population", "Population", "int", { unit: "people", group: "People", d: "Average population ({v})." }),
      f("growth", "Population growth", "signed", { unit: "population change", group: "People", d: "Population change ({v}), NSO average population on today's borders." }),
      f("density", "Density", "int", { unit: "people / km²", group: "People", d: "Residents ÷ natural area ({v})." }),
      f("urban", "Urban share", "pct", { unit: "of residents", group: "People", d: "Share of residents living in urban areas ({v})." }),
      f("gdp", "GRDP", "money", { unit: "$ per year", d: "GRDP at current prices ({v}), US dollars at the World Bank rate." }),
      f("gdp_pc", "GRDP per person", "usd", { unit: "$ per resident", higher_is: "good", d: "GRDP ÷ residents ({v})." }),
      f("grdp_growth", "GRDP growth", "signed", { unit: "vs the year before, constant prices", higher_is: "good", d: "GRDP growth over the year before at constant prices ({v}, estimate)." }),
      f("median_income", "Income", "usd", { unit: "$ per person per year", higher_is: "good", group: "Prosperity", d: "Average income per person per year ({v}, household living standards survey)." }),
      f("income_worker", "Worker income", "usd", { unit: "$ per worker per year", higher_is: "good", group: "Prosperity", d: "Average income of an employed worker per year ({v}, labour force survey)." }),
      f("poverty", "Poverty", "pct", { unit: "of households", higher_is: "bad", group: "Prosperity", d: "Share of households under the multidimensional poverty standard ({v})." }),
      f("gini", "Gini", "float", { unit: "0–1", higher_is: "bad", group: "Prosperity", d: "Gini index of income inequality ({v})." }),
      f("unemployment", "Unemployment", "pct", { unit: "of the labour force", higher_is: "bad", group: "Work", d: "Unemployed ÷ labour force aged 15+ ({v})." }),
      f("labour_force", "Labour force", "int", { unit: "people 15+", group: "Work", d: "Labour force aged 15 and over ({v})." }),
      f("employed", "Employed", "int", { unit: "workers", group: "Work", d: "Employed workers aged 15+, where they live ({v})." }),
      f("productivity", "Productivity", "usd", { unit: "$ GRDP per worker", higher_is: "good", group: "Work", d: "GRDP per employed worker ({v})." }),
      f("trained", "Trained workers", "pct", { unit: "of the labour force", higher_is: "good", group: "Knowledge", d: "Share of the labour force with vocational or higher training and a certificate ({v})." }),
      f("literacy", "Literacy", "pct", { unit: "of people 15+", higher_is: "good", group: "Knowledge", d: "Literacy rate of people aged 15+ ({v})." }),
      f("it_skills", "IT skills", "pct", { unit: "people with information-technology skills", higher_is: "good", group: "Knowledge", lensDesc: true }),
      f("students", "University students", "int", { unit: "students", group: "Knowledge", d: "Students enrolled in the area's universities ({v})." }),
      f("lecturers", "University lecturers", "int", { unit: "lecturers", group: "Knowledge", d: "University teaching staff ({v})." }),
      f("hdi", "HDI", "float", { unit: "0–1", higher_is: "good", group: "Quality of life", d: "Human Development Index ({v})." }),
      f("internet", "Internet users", "pct", { unit: "people using the internet", higher_is: "good", group: "Quality of life", lensDesc: true }),
      f("computer", "Households with a computer", "pct", { unit: "of households", higher_is: "good", group: "Quality of life", d: "Share of households with a computer ({v})." }),
      f("clean_water", "Clean water", "pct", { unit: "population using a hygienic water source", higher_is: "good", group: "Quality of life", lensDesc: true }),
      f("housing", "Permanent housing", "pct", { unit: "households living in a permanent house", higher_is: "good", group: "Quality of life", lensDesc: true }),
      f("fdi", "FDI", "money", { unit: "$ registered", higher_is: "good", d: "Foreign direct investment newly registered ({v}).", noLens: lv !== "states" }),
      f("fdi_projects", "FDI projects", "int", { unit: "projects", d: "New FDI projects licensed ({v})." }),
      f("enterprises_pk", "Enterprises", "float", { unit: "active enterprises per 1,000 residents", higher_is: "good", d: "Active enterprises per 1,000 residents ({v})." }),
      f("retail", "Retail sales", "money", { unit: "$ per year", d: "Retail sales of goods and services ({v})." }),
      f("tourism", "Travel & tours", "money", { unit: "$ per year", d: "Turnover of travel agencies and tour operators ({v})." }),
      f("paddy", "Paddy rice", "int", { unit: "tonnes", group: "Land", d: "Paddy rice harvested ({v})." }),
      f("pci", "PCI", "float", { unit: "0–100", higher_is: "good", source: "pci", group: "Work", d: "Provincial Competitiveness Index (VCCI, {v}): how business-friendly the provincial government is." }),
      f("area_km2", "Area", "km2", { unit: "km²", group: "Land", d: "Natural area ({v})." }),
    ];
    // Published for the 34 provinces only (since 2025): on the province level.
    if (lv === "states") list.push(
      f("growth_9m2026", "Growth, 9 months 2026 (est.)", "signed", { noTag: true, unit: "GRDP growth vs the first 9 months of 2025", higher_is: "good", source: "nso_monthly_2026", lensDesc: true }),
      f("industry_jobs_2026", "Factory jobs 2026 (est.)", "signed", { noTag: true, unit: "industrial-enterprise jobs vs a year earlier", higher_is: "good", source: "nso_monthly_2026", lensDesc: true }),
      f("doctors", "Doctors", "int", { unit: "doctors (State sector)", group: "Quality of life", d: "Doctors working in State-sector health facilities ({v})." }),
      f("doctors_pk", "Doctors per 10,000", "float", { unit: "doctors per 10,000 people (State sector)", higher_is: "good", group: "Quality of life", lensDesc: true }),
      f("road_deaths", "Road deaths", "float", { unit: "road traffic deaths per 100,000 people", higher_is: "bad", group: "Quality of life", lensDesc: true }),
      f("pupils_per_teacher", "Pupils per teacher", "float", { unit: "pupils per teacher (general education)", higher_is: "bad", group: "Knowledge", lensDesc: true }),
      f("forest_cover", "Forest cover (official)", "pct", { unit: "forest cover", group: "Land", lensDesc: true }),
    );
    return list;
  };
  const keysOf = (lv) => vnFields(lv).map((f) => f.key);
  const vnValues = (o, keys) => {
    const v = Object.fromEntries(keys.map((k) => [k, o[k] ?? null]));
    v.gdp = o.gdp ?? o.yields?.gold ?? null;
    v.gdp_pc = ratio(v.gdp, o.population);
    return v;
  };

  // --- counties.json rows by geoid --------------------------------------------------------------------------------
  const cRows = [];
  let col = {};
  if (counties) {
    col = Object.fromEntries(counties.columns.map((k, j) => [k, j]));
    counties.rows.forEach((r, i) => cRows.push({ r, i }));
  }
  const cRowByGeoid = new Map(cRows.map(({ r }) => [r[col.geoid], r]));

  // --- resources by place ---------------------------------------------------------------------------------------
  const items = resources?.items || [];
  const typeById = new Map((resources?.types || []).map((t) => [t.id, t]));
  const mwByMetro = new Map();
  items.forEach((it) => {
    if (typeById.get(it.type)?.unit !== "MW" || !fin(it.value) || !it.cbsa) return;
    mwByMetro.set(it.cbsa, (mwByMetro.get(it.cbsa) || 0) + it.value);
  });

  // --- provinces (states) ---------------------------------------------------------------------------------------
  const stateKeys = keysOf("states"), cityKeys = keysOf("metros");
  const stateRows = (Array.isArray(states) ? states : []).map((s, idx) => ({
    key: s.abbr, name: s.name, sub: s.abbr, level: "states", ref: idx,
    v: {
      name: s.name, abbr: s.abbr, former: (s.former || []).join(", "), ...vnValues(s, stateKeys),
      ...Object.fromEntries(LAND_KEYS.map((k) => [`land_${k}`, s.land?.[k] ?? null])),
      energy_mw: s.energy ? s.energy.total : null,
    },
  }));
  const landFields = LAND_KEYS.map((k) => F(`land_${k}`, LAND_EN[k], "pct", { unit: "share of land", source: "worldcover", group: "Land", description: tr(LAND_DESC[k]), lens: k === "forest" ? "forest" : k === "developed" ? "developed" : k === "crop" ? "farmland" : k === "wetland" ? "wetland" : null }));
  const energyField = F("energy_mw", "Mapped power", "mw", { unit: "MW of mapped plants", source: "osm_power", group: "Energy", description: tr("Capacity of the power plants mapped as resources (OpenStreetMap, each type above its size threshold): not the total generating capacity.") });
  const states_ = makeLevel({
    id: "states", label: tr("Provinces"), noun: tr("province"),
    rows: stateRows,
    fields: [F("name", "Province", "text", { group: "Name" }), F("former", "Merged from", "text", { group: "Name", description: tr("The former provinces merged into this one on 1 July 2025.") }), ...vnFields("states"), ...landFields, energyField],
    highlight: (rows) => ({ states: new Set(rows.map((r) => r.ref)) }),
    rowAtCell: (cell) => (owner[cell] >= 0 ? stateRows[owner[cell]] || null : null),
    focus: (row) => app.selectState(row.ref, { fly: true }),
    cellsOf: (row) => stateCells.get(row.ref) || [],
  });

  // --- cities (metros) --------------------------------------------------------------------------------------------
  const cityExtra = (c) => {
    const r = cRowByGeoid.get((c.counties || [])[0]);
    return Object.fromEntries(COUNTY_ONTO_CITY.map((k) => [k, r && col[k] != null ? r[col[k]] ?? null : null]));
  };
  const metroRows = cities.map((c) => ({
    key: c.id, name: c.name, sub: (c.states || []).join("–"), level: "metros", ref: c,
    v: {
      name: c.name, states: (c.states || []).join("–"), former: c.province_old || null,
      ...vnValues(c, cityKeys), ...cityExtra(c), energy_mw: mwByMetro.get(c.id) ?? 0,
    },
  }));
  const countyField = (k) => counties?.fields.find((f) => f.key === k);
  const cityCountyFields = COUNTY_ONTO_CITY.map(countyField).filter(Boolean).map((f) => F(f.key, f.label, f.format, { unit: f.unit, higher_is: f.higher_is, source: f.source, description: tr("{d} (of the former province the city stands for)", { d: tr(f.description) }), lens: f.lens, group: groupOf(f.key) }));
  const metroByCity = new Map(metroRows.map((r) => [r.ref, r]));
  const metros = makeLevel({
    id: "metros", label: tr("Cities"), noun: tr("city"),
    rows: metroRows,
    fields: [F("name", "City", "text", { group: "Name" }), F("states", "Province", "text", { group: "Name", description: tr("The 2025 province the city is in.") }), F("former", "Former province", "text", { group: "Name", description: tr("The pre-2025 province whose seat this city is; the city stands for all of it.") }), ...vnFields("metros"), ...cityCountyFields, energyField],
    highlight: (rows, o = {}) => {
      const cells = new Set();
      for (const r of rows) for (const c of r.ref.footprint || [r.ref.cell]) cells.add(c);
      return { cells, cities: rows.length <= (o.ringMax ?? 30) ? new Set(rows.map((r) => r.key)) : undefined };
    },
    rowAtCell: (cell) => { const c = cellMetro.get(cell); return c ? metroByCity.get(c) : null; },
    focus: (row) => app.selectCity(row.ref, { fly: true }),
    cellsOf: (row) => row.ref.footprint || [row.ref.cell],
  });

  // --- former provinces (counties) ----------------------------------------------------------------------------------
  let counties_ = null;
  if (counties) {
    const cols = counties.columns;
    const cityName = new Map(cities.map((c) => [c.id, c.name]));
    const countyRows = cRows.map(({ r, i }) => {
      const v = {};
      cols.forEach((k, j) => (v[k] = r[j]));
      v.metro = v.cbsa ? cityName.get(v.cbsa) || null : null;
      return { key: v.geoid, name: v.name, full: v.name, sub: v.state, level: "counties", ref: i, v };
    });
    // counties.json rows follow world.json counties; map by geoid anyway in case they ever diverge.
    const worldIdx = new Map((w.raw.counties || []).map((c, k) => [c.geoid, k]));
    for (const row of countyRows) row.ref = worldIdx.get(row.key) ?? row.ref;
    const rowByWorld = new Map(countyRows.map((r) => [r.ref, r]));
    const cellsOfRow = (r) => (countyCells.get(r.ref) || (Number.isInteger(r.v.cell) ? [r.v.cell] : [])).filter((c) => !remote.has(c));
    const fields = counties.fields.filter((f) => f.key !== "cbsa" && f.key !== "geoid" && f.key !== "cell").map((f) => ({
      ...F(f.key, f.key === "name" ? "Former province" : f.label, f.format, { unit: f.unit, higher_is: f.higher_is, source: f.source, description: tr(f.description), lens: f.lens, group: groupOf(f.key) }),
    }));
    fields.splice(2, 0, F("metro", "City", "text", { group: "Name", description: tr("The city (the former province's seat) that stands for it on the map.") }));
    counties_ = makeLevel({
      id: "counties", label: tr("Former provinces"), noun: tr("former province"),
      rows: countyRows, fields,
      highlight: (rows) => {
        const cells = new Set();
        for (const r of rows) for (const c of cellsOfRow(r)) cells.add(c);
        return { cells };
      },
      rowAtCell: (cell) => (countyOf[cell] >= 0 ? rowByWorld.get(countyOf[cell]) || null : null),
      focus: (row) => {
        const cells = cellsOfRow(row);
        if (!cells.length) return app.selectState(row.v.state, { fly: true });
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const c of cells) {
          const x = grid.cx(c), y = grid.cy(c);
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
        const R = grid.R * 3;
        frameBox(app, { x0: x0 - R, y0: y0 - R, x1: x1 + R, y1: y1 + R }, { pad: 24, maxScale: 2.4 });
      },
      cellsOf: (row) => cellsOfRow(row),
    });
  }

  const countiesOffMap = counties_ ? counties_.rows.filter((r) => !counties_.cellsOf(r).length).length : 0; // no hex, not even a stand-in
  return {
    app, nation, nat, vintage, countyVintage, countiesOffMap, mainYear, fxYear,
    /** Vietnam's figure of `key` for the year of a row's figure ({v, year}), or null. */
    vn: (row, key) => vnRef(nation, row.level === "states" ? states[row.ref] : row.level === "metros" ? row.ref : null, key),
    levels: { states: states_, metros, counties: counties_ },
    stateCells, countyCells, cellMetro, metroByCity,
    items, typeById,
    source: (id) => srcTitle.get(id) || null,
  };
}

/** Former-province names are short already; kept for the views that still call it. */
export function shortCounty(name) {
  return String(name || "");
}

function groupOf(k) {
  if (["population", "density", "urban", "growth"].includes(k)) return "People";
  if (["income", "gdp_pc", "poverty", "gini"].includes(k)) return "Prosperity";
  if (["hdi", "internet", "clean_water", "housing"].includes(k)) return "Quality of life";
  if (["trained", "literacy", "it_skills", "students"].includes(k)) return "Knowledge";
  if (["unemployment", "productivity", "pci"].includes(k)) return "Work";
  if (["fdi", "grdp_growth"].includes(k)) return "Economy";
  if (["forest", "crop", "developed", "land_km2", "paddy"].includes(k)) return "Land";
  if (["name", "state", "metro"].includes(k)) return "Name";
  if (["disasters"].includes(k)) return "Hazards";
  return "Other";
}

function makeLevel(def) {
  const fieldByKey = new Map(def.fields.map((f) => [f.key, f]));
  const byKey = new Map(def.rows.map((r) => [r.key, r]));
  return {
    ...def,
    byKey,
    field: (k) => fieldByKey.get(k) || null,
    value: (row, k) => row.v[k] ?? null,
    numericFields: () => def.fields.filter((f) => f.format !== "text"),
    /** Add fields after the fact (optional files that load on demand); a key already present is skipped. */
    addFields(list) {
      for (const f of list) {
        if (fieldByKey.has(f.key)) continue;
        def.fields.push(f);
        fieldByKey.set(f.key, f);
      }
    },
  };
}

// --- fields from files that load on demand ------------------------------------------------------------------------
// extendData(data, names) loads the named files (districts, citizens) through app.loadData and adds their columns to
// the levels once per data model. Missing files (null) add nothing. Returns the loaded files by name.
const F4 = (key, label, format, o = {}) => ({ key, label: tr(label), format, unit: tr(o.unit) || null, higher_is: o.higher_is || "neutral", source: o.source || "", description: o.description || "", lens: o.lens || null, group: tr(o.group || "Other"), derived: !!o.derived });

export async function extendData(data, names) {
  const app = data.app;
  const files = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await app.loadData(n).catch(() => null)])));
  data.extended ??= new Set();
  for (const n of names) {
    if (data.extended.has(n) || !files[n]) continue;
    data.extended.add(n);
    try {
      if (n === "districts") extendDistricts(data, files[n]);
      if (n === "citizens") extendCitizens(data, files[n]);
    } catch (err) {
      console.error(`advisors: could not add the ${n} columns`, err);
    }
  }
  return files;
}

function extendDistricts(data, d) {
  const { metros } = data.levels;
  const cat = new Map((d.catalog || []).map((c) => [c.id, c]));
  const vint = d.vintage || "NSO Statistical Yearbook";
  metros.addFields([
    F4("city_type", "City type", "text", { source: "nso_yearbook", group: "Districts", description: tr("The city's badge, named after its strongest district ({v}). Blank: no district passes.", { v: tr(vint) }) }),
    F4("districts", "Districts", "text", { source: "nso_yearbook", group: "Districts", description: `${tr("Districts the city qualifies for, strongest first.")} ${tr(d.rule?.text || "")}` }),
    F4("n_districts", "Number of districts", "int", { source: "nso_yearbook", group: "Districts", description: tr("How many districts pass the rule (up to 5).") }),
    F4("top_lq", "Strongest location quotient", "lq", { unit: "× Vietnam's figure per resident", source: "nso_yearbook", group: "Districts", description: tr("The highest location quotient among the city's measured districts (students, retail, FDI, tourism per resident ÷ Vietnam's).") }),
  ]);
  for (const r of metros.rows) {
    const c = d.cities?.[r.key];
    const lqs = (c?.districts || []).map((x) => x.lq).filter(fin);
    Object.assign(r.v, {
      city_type: c?.badge?.label != null ? tr(c.badge.label) : null,
      districts: c ? (c.districts || []).map((x) => tr(cat.get(x.id)?.name || x.id)).join(", ") || null : null,
      n_districts: c ? (c.districts || []).length : null,
      top_lq: lqs.length ? Math.max(...lqs) : null,
    });
  }
}

// Citizens: the shares behind the City View's person icons (NSO province figures).
const CZ = [
  ["residence", "urban", "City dwellers"], ["work", "informal", "Informal jobs"], ["households", "poor", "Poor households"],
];
function extendCitizens(data, cz) {
  const { metros } = data.levels;
  const vint = cz.vintage || "NSO Statistical Yearbook";
  const rowDesc = cz.rows || {};
  metros.addFields([
    ...CZ.filter(([row, key]) => !(row === "residence" && key === "urban")).map(([row, key, lbl]) => F4(`cz_${key}`, lbl, "pct", {
      unit: rowDesc[row] || row, source: "nso_yearbook", group: "Citizens",
      description: tr("{label}: share of {of} ({v}).", { label: tr(lbl), of: tr(rowDesc[row] || row).toLowerCase(), v: tr(vint) }),
    })).map((f) => ({ ...f, unit: f.unit && f.unit.toLowerCase() })),
    F4("cz_life", "Life expectancy", "years", { unit: "years at birth", source: "nso_yearbook", group: "Citizens", description: tr("Life expectancy at birth ({v}).", { v: tr(vint) }) }),
    F4("cz_net_migration", "Net migration", "float", { unit: "per 1,000 residents", source: "nso_yearbook", group: "Citizens", description: tr("In-migrants minus out-migrants per 1,000 residents ({v}).", { v: tr(vint) }) }),
    F4("cz_specialist", "Stands out in", "text", { source: "nso_yearbook", group: "Citizens", description: `${tr("The category furthest from Vietnam's share.")} ${tr(cz.rule?.text || "")}` }),
  ]);
  const label = new Map(Object.entries(cz.groups || {}).flatMap(([row, list]) => list.map((g) => [`${row}.${g.key}`, g.label])));
  for (const r of metros.rows) {
    const c = cz.cities?.[r.key];
    for (const [row, key] of CZ) if (!(row === "residence" && key === "urban")) r.v[`cz_${key}`] = c?.[row]?.shares?.[key] ?? null;
    r.v.cz_life = c?.life_expectancy ?? null;
    r.v.cz_net_migration = c?.migration?.net ?? null;
    const sp = (c?.specialists || [])[0];
    r.v.cz_specialist = sp ? `${tr(label.get(`${sp.row}.${sp.key}`) || sp.key)} ×${fixed(sp.ratio, 2)}` : null;
  }
}

/** The highlight for a set of rows of one level, with defaults (gold outline, other land dimmed when asked). */
export function rowsHighlight(level, rows, opts = {}) {
  if (!level || !rows || !rows.length) return null;
  const one = rows.length === 1 ? rows[0] : null;
  const label = opts.label ?? (one ? (one.level === "states" ? one.name : `${one.full || one.name}${one.sub ? `, ${one.sub}` : ""}`) : "");
  return { ...level.highlight(rows, opts), dimOthers: !!opts.dim, color: opts.color, label };
}
