// Compare two provinces: the 34 provinces' fields from states.json (NSO), each row with its year, as a table plus
// paired bars. Pure (no DOM): pairRows() is tested in node by story.test.mjs.
import { t } from "../../i18n.js";
import { int, fixed, pct, money, dollars, yieldValue } from "../../format.js";
import { fmtDate } from "./chapters.js";

const f1 = (x) => fixed(x, 1);
// [field, label (shared with the province panel), format, higher is good (true / false / null)]
export const ROWS = [
  ["population", "Population", int, null],
  ["area_km2", "Area", (v) => `${int(v)} km²`, null],
  ["density", "Density", (v) => `${int(v)} /km²`, null],
  ["urban", "Urban residents", (v) => pct(v, 0), null],
  ["gdp", "GRDP", money, null],
  ["gdp_pc", "GRDP per person", dollars, true],
  ["median_income", "Income per person / year", dollars, true],
  ["poverty", "Households in poverty", (v) => pct(v), false],
  ["hdi", "Human development (HDI)", (v) => fixed(v, 3), true],
  ["unemployment", "Unemployment", (v) => pct(v), false],
  ["trained", "Trained workers", (v) => pct(v, 0), true],
  ["internet", "Internet users", (v) => pct(v, 0), true],
  ["literacy", "Literacy", (v) => pct(v), true],
  ["fdi", "FDI registered", money, null],
  ["doctors_pk", "Doctors per 10,000 people (State sector)", f1, true],
  ["forest_cover", "Forest cover", (v) => pct(v), null],
  ["road_deaths", "Road deaths per 100,000 people", f1, false],
  ["paddy", "Rice", (v) => yieldValue({ unit: "tonnes" }, v), null],
];
const YEAR_KEY = { median_income: "income", gdp: "gdp", gdp_pc: "gdp", density: "population" }; // density = population ÷ area
const value = (s, f) => (f === "gdp_pc" ? (s.gdp > 0 && s.population > 0 ? s.gdp / s.population : null) : s[f]);
const yearOf = (s, f) => {
  const y = s.years?.[YEAR_KEY[f] || f] ?? (f.startsWith("gdp") && s.gdp_year ? String(s.gdp_year) : null);
  return y == null ? null : fmtDate(y); // "2024-12-31" → 31/12/2024; a plain year stays
};

/** rows for provinces a and b (states.json records): [{field, label, year, a: {v, text, w}, b, better}] */
export function pairRows(a, b) {
  return ROWS.map(([f, label, fmt, good]) => {
    const va = value(a, f), vb = value(b, f);
    if (va == null && vb == null) return null;
    const max = Math.max(Math.abs(va || 0), Math.abs(vb || 0)) || 1;
    const side = (v) => ({ v, text: v == null ? "–" : fmt(v), w: v == null ? 0 : Math.abs(v) / max });
    const ya = yearOf(a, f), yb = yearOf(b, f);
    let better = null;
    if (good != null && va != null && vb != null && va !== vb) better = (va > vb) === good ? "a" : "b";
    return { field: f, label: t(label), year: ya === yb ? ya : [ya, yb].filter(Boolean).join(" / "), a: side(va), b: side(vb), better };
  }).filter(Boolean);
}
