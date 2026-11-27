// The advisors' data model: three "levels" (states = provinces, metros = cities, counties = former provinces) of rows with typed fields, plus the links
// between rows and the hex map (row → highlight, cell → row). Built once from app.data (counties.json optional).
//
//   level = {id, label, noun, rows: [row], fields: [field], field(key), value(row, key),
//            highlight(rows, opts) → app.state.highlight, rowAtCell(cell) → row | null, focus(row), byKey: Map}
//   row   = {key, name, sub, level, ref, v: {fieldKey: value}}
//   field = {key, label, format, unit, higher_is, source, description, lens?, group, derived?}
import { fin, ratio } from "./util.js";
import { frameBox } from "./frame.js";
import { t as tr } from "../../../i18n.js";

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
  const vintage = nation.vintage || "NSO Statistical Yearbook 2024";
  const countyVintage = counties?.vintage || vintage;
  const yrs = (nat.growth_years || []).join("–");
  const V = tr(vintage);
  const NSO = "nso_yearbook";

  // --- fields ---------------------------------------------------------------------------------------------------
  // Label, unit and group are translated here (static English or data-file text); descriptions arrive translated.
  const F = (key, label, format, o = {}) => ({ key, label: tr(label), format, unit: tr(o.unit) || null, higher_is: o.higher_is || "neutral", source: o.source || "", description: o.description || "", lens: o.lens || null, group: tr(o.group || "Economy"), derived: !!o.derived });
  const vnFields = () => [
    F("population", "Population", "int", { unit: "people", source: NSO, group: "People", description: tr("Average population ({v}).", { v: V }), lens: "density" }),
    F("growth", "Growth", "signed", { unit: "population change", source: NSO, group: "People", description: tr("Population change {yrs} (NSO average population, on today's borders).", { yrs }), lens: "growth" }),
    F("density", "Density", "int", { unit: "people / km²", source: NSO, group: "People", description: tr("Residents ÷ natural area ({v}).", { v: V }), lens: "density" }),
    F("urban", "Urban share", "pct", { unit: "of residents", source: NSO, group: "People", description: tr("Share of residents living in urban areas ({v}).", { v: V }), lens: "urban" }),
    F("gdp", "GRDP", "money", { unit: "$ per year", source: NSO, description: tr("{v}; US dollars at the World Bank 2024 rate.", { v: tr(nation.gdp_vintage || "NSO GRDP") }) }),
    F("gdp_pc", "GRDP per person", "usd", { unit: "$ per resident", higher_is: "good", source: NSO, description: tr("GRDP ÷ residents ({v}).", { v: V }), lens: "gdp_pc" }),
    F("median_income", "Income", "usd", { unit: "$ per person per year", higher_is: "good", source: NSO, group: "Prosperity", description: tr("Average income per person per year ({v}, household living standards survey).", { v: V }), lens: "income" }),
    F("income_worker", "Worker income", "usd", { unit: "$ per worker per year", higher_is: "good", source: NSO, group: "Prosperity", description: tr("Average income of an employed worker per year ({v}, labour force survey).", { v: V }) }),
    F("poverty", "Poverty", "pct", { unit: "of households", higher_is: "bad", source: NSO, group: "Prosperity", description: tr("Share of households under the multidimensional poverty standard ({v}).", { v: V }), lens: "poverty" }),
    F("gini", "Gini", "float", { unit: "0–1", higher_is: "bad", source: NSO, group: "Prosperity", description: tr("Gini index of income inequality ({v}).", { v: V }), lens: "gini" }),
    F("unemployment", "Unemployment", "pct", { unit: "of the labour force", higher_is: "bad", source: NSO, group: "Work", description: tr("Unemployed ÷ labour force aged 15+ ({v}).", { v: V }), lens: "unemployment" }),
    F("labour_force", "Labour force", "int", { unit: "people 15+", source: NSO, group: "Work", description: tr("Labour force aged 15 and over ({v}).", { v: V }) }),
    F("employed", "Employed", "int", { unit: "workers", source: NSO, group: "Work", description: tr("Employed workers aged 15+, where they live ({v}).", { v: V }) }),
    F("productivity", "Productivity", "usd", { unit: "$ GRDP per worker", higher_is: "good", source: NSO, group: "Work", description: tr("GRDP per employed worker ({v}).", { v: V }), lens: "productivity" }),
    F("trained", "Trained workers", "pct", { unit: "of the labour force", higher_is: "good", source: NSO, group: "Knowledge", description: tr("Share of the labour force with vocational or higher training and a certificate ({v}).", { v: V }), lens: "trained" }),
    F("literacy", "Literacy", "pct", { unit: "of people 15+", higher_is: "good", source: NSO, group: "Knowledge", description: tr("Literacy rate of people aged 15+ ({v}).", { v: V }), lens: "literacy" }),
    F("hdi", "HDI", "float", { unit: "0–1", higher_is: "good", source: NSO, group: "Knowledge", description: tr("Human Development Index ({v}).", { v: V }), lens: "hdi" }),
    F("students", "University students", "int", { unit: "students", source: NSO, group: "Knowledge", description: tr("Students enrolled in the area's universities, 2023 ({v}).", { v: V }) }),
    F("lecturers", "University lecturers", "int", { unit: "lecturers", source: NSO, group: "Knowledge", description: tr("University teaching staff, 2023 ({v}).", { v: V }) }),
    F("fdi", "FDI 2024", "money", { unit: "$ registered", higher_is: "good", source: NSO, description: tr("Foreign direct investment newly registered in 2024 ({v}).", { v: V }), lens: "fdi" }),
    F("fdi_projects", "FDI projects", "int", { unit: "projects", source: NSO, description: tr("New FDI projects licensed in 2024 ({v}).", { v: V }) }),
    F("retail", "Retail sales", "money", { unit: "$ per year", source: NSO, description: tr("Retail sales of goods and services ({v}).", { v: V }) }),
    F("tourism", "Travel & tours", "money", { unit: "$ per year", source: NSO, description: tr("Turnover of travel agencies and tour operators ({v}).", { v: V }) }),
    F("paddy", "Paddy rice", "int", { unit: "tonnes", source: NSO, group: "Land", description: tr("Paddy rice harvested in 2024 ({v}, preliminary).", { v: V }) }),
    F("pci", "PCI 2022", "float", { unit: "0–100", higher_is: "good", source: "pci", group: "Work", description: tr("Provincial Competitiveness Index 2022 (VCCI): how business-friendly the provincial government is."), lens: "pci" }),
    F("area_km2", "Area", "km2", { unit: "km²", source: NSO, group: "Land", description: tr("Natural area ({v}).", { v: V }) }),
  ];
  const VN_KEYS = vnFields().map((f) => f.key);
  const vnValues = (o) => {
    const v = Object.fromEntries(VN_KEYS.map((k) => [k, o[k] ?? null]));
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
  const stateRows = (Array.isArray(states) ? states : []).map((s, idx) => ({
    key: s.abbr, name: s.name, sub: s.abbr, level: "states", ref: idx,
    v: {
      name: s.name, abbr: s.abbr, former: (s.former || []).join(", "), ...vnValues(s),
      ...Object.fromEntries(LAND_KEYS.map((k) => [`land_${k}`, s.land?.[k] ?? null])),
      energy_mw: s.energy ? s.energy.total : null,
    },
  }));
  const landFields = LAND_KEYS.map((k) => F(`land_${k}`, LAND_EN[k], "pct", { unit: "share of land", source: "worldcover", group: "Land", description: tr(LAND_DESC[k]), lens: k === "forest" ? "forest" : k === "developed" ? "developed" : k === "crop" ? "farmland" : k === "wetland" ? "wetland" : null }));
  const energyField = F("energy_mw", "Mapped power", "mw", { unit: "MW of mapped plants", source: "gppd", group: "Energy", description: tr("Capacity of the power plants mapped as resources (each type above its size threshold, data as of 2021): not the total generating capacity.") });
  const states_ = makeLevel({
    id: "states", label: tr("Provinces"), noun: tr("province"),
    rows: stateRows,
    fields: [F("name", "Province", "text", { group: "Name" }), F("former", "Merged from", "text", { group: "Name", description: tr("The former provinces merged into this one on 1 July 2025.") }), ...vnFields(), ...landFields, energyField],
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
      ...vnValues(c), ...cityExtra(c), energy_mw: mwByMetro.get(c.id) ?? 0,
    },
  }));
  const countyField = (k) => counties?.fields.find((f) => f.key === k);
  const cityCountyFields = COUNTY_ONTO_CITY.map(countyField).filter(Boolean).map((f) => F(f.key, f.label, f.format, { unit: f.unit, higher_is: f.higher_is, source: f.source, description: tr("{d} (of the former province the city stands for)", { d: tr(f.description) }), lens: f.lens, group: groupOf(f.key) }));
  const metroByCity = new Map(metroRows.map((r) => [r.ref, r]));
  const metros = makeLevel({
    id: "metros", label: tr("Cities"), noun: tr("city"),
    rows: metroRows,
    fields: [F("name", "City", "text", { group: "Name" }), F("states", "Province", "text", { group: "Name", description: tr("The 2025 province the city is in.") }), F("former", "Former province", "text", { group: "Name", description: tr("The pre-2025 province whose seat this city is; the city stands for all of it.") }), ...vnFields(), ...cityCountyFields, energyField],
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
    app, nation, nat, vintage, countyVintage, countiesOffMap,
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
  if (["trained", "literacy", "hdi", "students"].includes(k)) return "Knowledge";
  if (["unemployment", "productivity", "pci"].includes(k)) return "Work";
  if (["fdi"].includes(k)) return "Economy";
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
  const vint = d.vintage || "NSO Statistical Yearbook 2024";
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
  const vint = cz.vintage || "NSO Statistical Yearbook 2024";
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
    r.v.cz_specialist = sp ? `${tr(label.get(`${sp.row}.${sp.key}`) || sp.key)} ×${sp.ratio.toFixed(2)}` : null;
  }
}

/** The highlight for a set of rows of one level, with defaults (gold outline, other land dimmed when asked). */
export function rowsHighlight(level, rows, opts = {}) {
  if (!level || !rows || !rows.length) return null;
  const one = rows.length === 1 ? rows[0] : null;
  const label = opts.label ?? (one ? (one.level === "states" ? one.name : `${one.full || one.name}${one.sub ? `, ${one.sub}` : ""}`) : "");
  return { ...level.highlight(rows, opts), dimOthers: !!opts.dim, color: opts.color, label };
}
