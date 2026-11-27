import { t, lang } from "./i18n.js";

// Numbers follow the page language: English 9,543,600 / 1.5M; Vietnamese 9.543.600 / 1,5M (thousands ".", decimal ",").
const VI = lang === "vi";
const LOCALE = VI ? "vi-VN" : "en-US";
/** A plain number string ("1.5", "-0.04") with the language's decimal mark. */
export const dec = (x) => (VI ? String(x).replace(".", ",") : String(x));
/** x.toFixed(d) with the language's decimal mark. */
export const fixed = (x, d = 0) => dec(x.toFixed(d));

const UNITS = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
// A value that rounds up to 1000 of a unit reads as 1 of the next one ("1.0M", not "1000K"; e.g. 999,600 people).
function rollover(n, fmt) {
  const s = fmt(n);
  const m = /^-?1000(?:\.0+)?([KMB])$/.exec(s);
  if (!m) return s;
  const i = UNITS.findIndex(([, u]) => u === m[1]);
  return fmt(Math.sign(n) * UNITS[i - 1][0]);
}

function compactEn(n) {
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(a >= 1e13 ? 1 : 2) + "T";
  if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e11 ? 0 : 1) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(Math.round(n));
}
export function compact(n) {
  if (n == null || Number.isNaN(n)) return "–";
  return dec(rollover(n, compactEn));
}

const neg = (n, f) => (n < 0 ? "−" + f(-n) : f(n)); // "−$2", not "$-2"
export const money = (n) => (n == null || Number.isNaN(n) ? "–" : neg(n, (v) => "$" + compact(v)));
export const int = (n) => (n == null || Number.isNaN(n) ? "–" : Math.round(n).toLocaleString(LOCALE));
export const dollars = (n) => (n == null || Number.isNaN(n) ? "–" : neg(Math.round(n), (v) => "$" + int(v)));
export const pct = (x, d = 1) => (x == null ? "–" : fixed(x * 100, d) + "%");

export function yieldValue(y, v) {
  return y.unit === "usd" ? money(v) : y.unit === "tonnes" ? (v == null ? "–" : compact(v) + " t") : compact(v);
}

function popShortEn(n) {
  if (n >= 1e7) return Math.round(n / 1e6) + "M";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  return Math.round(n / 1e3) + "K";
}
export const popShort = (n) => dec(rollover(n, popShortEn));

/** A resource site's second line: operator, opening year, farm count (data fields, words via t()). Plain text;
 *  siteDetailHtml marks the operator (a proper name) translate="no". */
export function siteDetailHtml(it) {
  const rest = siteDetail({ ...it, detail: null });
  const op = it.detail ? `<span translate="no">${esc(it.detail)}</span>` : "";
  return [op, esc(rest)].filter(Boolean).join(", ");
}

export function siteDetail(it) {
  const parts = [];
  if (it.detail) parts.push(it.detail);
  if (it.since) parts.push(t("since {y}", { y: it.since }));
  if (it.farms) parts.push(t(it.farms === 1 ? "1 farm" : "{n} farms", { n: it.farms }));
  return parts.join(", ");
}

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// The six centrally-run cities (thành phố trực thuộc trung ương) are provinces in the data but not "tỉnh".
const CENTRAL = new Set(["HN", "HCM", "HPH", "DNA", "CTH", "HUE"]);
/** What one province is called: "Tỉnh" / "Thành phố" (vi), "Province" / "Municipality" (en). Takes a state or abbr. */
export function kindOf(s) {
  const city = CENTRAL.has(typeof s === "string" ? s : s?.abbr);
  return VI ? (city ? "Thành phố" : "Tỉnh") : city ? "Municipality" : "Province";
}
