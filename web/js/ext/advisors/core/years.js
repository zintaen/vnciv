// Data years. Every city / state / nation record has `years: {field: label}` ("2025", "2025 (prel.)", "2024",
// "2025-12-31", "9M2026", "2026-10-01"); growth spans `growth_years`. nation.cities_basis holds Vietnam's 2024 HDI
// and FDI, to compare the cities' (63 former provinces') 2024 values with. Shared by the advisors and the City View.
import { t as tr, lang } from "../../../i18n.js";
import { esc } from "../../../format.js";

const fin = Number.isFinite;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Field keys whose year lives under another name in `years`.
const YEAR_KEY = { median_income: "income", density: "population", gdp_per_capita: "gdp_pc" };

/** The year label of `key` on a record ("2019–2025" for growth), or null. */
export function yearOf(rec, key) {
  if (!rec) return null;
  if (key === "growth") {
    const g = rec.growth_years;
    return Array.isArray(g) && g.length === 2 ? `${g[0]}–${g[1]}` : null;
  }
  return rec.years?.[YEAR_KEY[key] || key] ?? null;
}

/** A year label without its "(prel.)"/"(est.)" note: the part two labels must share to be compared. */
export const plainYear = (y) => (y == null ? "" : String(y).replace(/\s*\(.*\)\s*$/, ""));

/** A year label for display as plain text (for textContent, or text that is escaped later): "31/12/2025" (vi) or
 *  "31 Dec 2025" (en), "9 months 2026", "2025 (prel.)". */
export function yearPlain(y, { note = false } = {}) {
  if (y == null || y === "") return "";
  const raw = String(y);
  let s = plainYear(raw), m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) s = lang === "vi" ? `${+m[3]}/${+m[2]}/${m[1]}` : `${+m[3]} ${MON[+m[2] - 1]} ${m[1]}`;
  else if ((m = /^(\d{1,2})M(\d{4})$/.exec(s))) s = tr("{n} months {y}", { n: m[1], y: m[2] });
  const nm = /\((prel|est)\.\)/.exec(raw);
  return note && nm ? `${s} (${tr(nm[1] === "prel" ? "preliminary" : "estimate")})` : s;
}

/** yearPlain, HTML-escaped (the label is data): for building innerHTML. */
export const yearText = (y, o) => esc(yearPlain(y, o));

/** The calendar year a label falls in ("2025-12-31" → "2025"), for picking a population of the same year. */
export const calYear = (y) => (/(\d{4})/.exec(String(y ?? "")) || [])[1] || null;

/** A record's population in a given year (pop_series), else its latest. */
export function popIn(rec, y) {
  const v = rec?.pop_series?.[calYear(y)];
  return fin(v) ? v : rec?.population ?? null;
}

/**
 * Vietnam's figure of `key` for the same year as the record's: NSO's national row when its year matches, else
 * nation.cities_basis (2024 HDI and FDI for the former provinces), else null (no national figure for that year, so
 * no comparison). → {v, year}
 */
export function vnRef(nation, rec, key) {
  const nat = nation?.nation || nation || {};
  const y = plainYear(yearOf(rec, key));
  const ny = yearOf(nat, key);
  if (fin(nat[key]) && (!y || plainYear(ny) === y)) return { v: nat[key], year: ny || y || null };
  const b = nat.cities_basis;
  if (b && fin(b[key]) && plainYear(b.year) === y) return { v: b[key], year: b.year };
  return null;
}

/** "VN 2025" / "VN 2024": the comparison label with its year. */
export const vnLabel = (ref) => (ref?.year ? `VN ${yearText(ref.year)}` : "VN");
