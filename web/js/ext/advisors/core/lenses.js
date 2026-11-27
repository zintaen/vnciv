// Map colourings the advisors add beside the built-in lenses (lenses.json has no per-city growth or students lens).
// Each is an ordinary lens object ({id, name, ramp, domain, scale, format, values: per cell}) that app.setLens()
// accepts; they are built once per data model and cached, so the lens dock's histogram cache stays valid.
import { fin, quantile } from "./util.js";
import { t as tr } from "../../../i18n.js";
// Names and units stay English (the lens dock translates them where it shows them); descriptions built from data
// (years, yield labels) are translated here, since no dictionary key could match the filled-in sentence.

// Diverging: shrinking (brick) ← no change (parchment) → growing (teal). Dark ends so the extremes read on the map.
const GROWTH_RAMP = ["#7a1f2b", "#c2463d", "#e8a07a", "#efe6d2", "#8fcbb8", "#2e9c8a", "#0f5e57"];
const SCIENCE_RAMP = ["#0a1a33", "#173a6b", "#2f63a8", "#4f93d6", "#8cc2ee", "#e4f3ff"];

const cache = new WeakMap();

function memo(data, key, make) {
  let m = cache.get(data);
  if (!m) cache.set(data, (m = new Map()));
  if (!m.has(key)) m.set(key, make());
  return m.get(key);
}

const symDomain = (vals, q = 0.03) => {
  const s = vals.filter(fin).map(Math.abs).sort((a, b) => a - b);
  const d = s.length ? quantile(s, 1 - q) : 0.05;
  const r = Math.max(0.005, Math.round(d * 200) / 200); // to half a percent
  return [-r, r];
};
const robust = (vals, q = 0.02) => {
  const s = vals.filter(fin).sort((a, b) => a - b);
  return s.length ? [quantile(s, q), quantile(s, 1 - q)] : [0, 1];
};

/** Population growth per hex: by city (its former province's hexes) or by province. */
export function growthLens(data, by = "metros") {
  return memo(data, `growth-${by}`, () => {
    const { app, cellMetro } = data;
    const n = app.w.grid.size, owner = app.w.raw.owner;
    const values = new Array(n).fill(null);
    const yrs = (data.nat.growth_years || []).join("–");
    let vals;
    if (by === "states") {
      const rows = data.levels.states.rows;
      for (let i = 0; i < n; i++) if (owner[i] >= 0) values[i] = rows[owner[i]]?.v.growth ?? null;
      vals = rows.map((r) => r.v.growth);
    } else {
      for (const [cell, city] of cellMetro) if (owner[cell] >= 0 && fin(city.growth)) values[cell] = city.growth;
      vals = data.levels.metros.rows.map((r) => r.v.growth);
    }
    return {
      id: `adv-growth-${by}`, group: "people", name: by === "states" ? "Growth by province" : "Growth by former province",
      icon: "l-people", emoji: "📈", unit: "population change", format: "pct", scale: "linear",
      domain: symDomain(vals), ramp: GROWTH_RAMP, higher_is: "neutral", source: "nso_yearbook",
      description: by === "states"
        ? tr("Population change {yrs} by 2025 province (NSO average population).", { yrs })
        : tr("Population change {yrs} by former province (NSO average population).", { yrs }),
      values,
    };
  });
}

/** University students (the Science yield) per resident, by former province. */
export function scienceLens(data) {
  return memo(data, "science", () => {
    const { app, cellMetro } = data;
    const n = app.w.grid.size, owner = app.w.raw.owner;
    const values = new Array(n).fill(null);
    const share = (c) => (fin(c.yields?.science) && c.population > 0 ? c.yields.science / c.population : null);
    for (const [cell, city] of cellMetro) if (owner[cell] >= 0) values[cell] = share(city);
    const sci = app.data.nation?.yields?.find((y) => y.key === "science");
    return {
      id: "adv-science-share", group: "knowledge", name: "University students",
      icon: "l-degrees", emoji: "🔬", unit: "of residents", format: "pct", scale: "linear",
      domain: robust(data.levels.metros.rows.map((r) => share(r.ref))), ramp: SCIENCE_RAMP, higher_is: "neutral", source: "nso_yearbook",
      description: tr("University students (the {y} yield, 2023) as a share of residents, by former province.", { y: tr(sci?.label || "Science") }),
      values,
    };
  });
}

/**
 * A county column as a map lens (each hex takes the value of the county at its centre). For counties.json columns
 * that have no lens in lenses.json (e.g. typhoon counts). opts: {name, ramp, format, unit, description, source,
 * emoji, icon, group, domain?}
 */
export function countyLens(data, key, opts = {}) {
  return memo(data, `county-${key}`, () => {
    const lv = data.levels.counties;
    const n = data.app.w.grid.size;
    const values = new Array(n).fill(null);
    if (lv) for (let i = 0; i < n; i++) { const r = lv.rowAtCell(i); const v = r ? r.v[key] : null; if (fin(v)) values[i] = v; }
    const f = lv?.field(key);
    return {
      id: `adv-county-${key}`, group: opts.group || "people", name: opts.name || f?.label || key,
      icon: opts.icon || "layers", emoji: opts.emoji || "🗺️", unit: opts.unit || f?.unit || "", format: opts.format || f?.format || "float",
      scale: "linear", domain: opts.domain || robust(lv ? lv.rows.map((r) => r.v[key]) : []), ramp: opts.ramp || SCIENCE_RAMP,
      higher_is: f?.higher_is || "neutral", source: opts.source || f?.source || "", description: opts.description || f?.description || "",
      ...(opts.note ? { note: opts.note } : {}),
      values,
    };
  });
}

/** A per-state value as a map lens. valueOf(abbr) → number | null. opts as countyLens plus id. */
export function stateLens(data, id, valueOf, opts = {}) {
  return memo(data, `state-${id}`, () => {
    const app = data.app;
    const n = app.w.grid.size, owner = app.w.raw.owner;
    const rows = data.levels.states.rows;
    const byIdx = rows.map((r) => valueOf(r.key));
    const values = new Array(n).fill(null);
    for (let i = 0; i < n; i++) if (owner[i] >= 0 && fin(byIdx[owner[i]])) values[i] = byIdx[owner[i]];
    return {
      id: `adv-state-${id}`, group: opts.group || "people", name: opts.name || id, icon: opts.icon || "layers", emoji: opts.emoji || "🗺️",
      unit: opts.unit || "", format: opts.format || "float", scale: "linear", domain: opts.domain || robust(byIdx, 0),
      ramp: opts.ramp || SCIENCE_RAMP, higher_is: opts.higher_is || "neutral", source: opts.source || "", description: opts.description || "",
      ...(opts.note ? { note: opts.note } : {}),
      values,
    };
  });
}
