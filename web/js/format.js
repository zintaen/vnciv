import { t } from "./i18n.js";
export function compact(n) {
  if (n == null || Number.isNaN(n)) return "–";
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(a >= 1e13 ? 1 : 2) + "T";
  if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e11 ? 0 : 1) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(Math.round(n));
}

export const money = (n) => (n == null ? "–" : "$" + compact(n));
export const dollars = (n) => (n == null ? "–" : "$" + Math.round(n).toLocaleString("en-US"));
export const int = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));
export const pct = (x, d = 1) => (x == null ? "–" : (x * 100).toFixed(d) + "%");

export function yieldValue(y, v) {
  return y.unit === "usd" ? money(v) : y.unit === "tonnes" ? (v == null ? "–" : compact(v) + " t") : compact(v);
}

export function popShort(n) {
  if (n >= 1e7) return Math.round(n / 1e6) + "M";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  return Math.round(n / 1e3) + "K";
}

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
