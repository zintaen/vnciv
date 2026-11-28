// Pure helpers of ext/explore (no DOM; tested by geom.test.mjs in node and tests/test_explore.py).
import { mapToLonLat } from "../daynight/sun.js";

export const EARTH_KM = 6371.0088; // mean radius, as pipeline/geo.py MapProjection
const RAD = Math.PI / 180;

/** Great-circle distance in km (haversine). */
export function haversineKm(lon1, lat1, lon2, lat2) {
  const dLat = (lat2 - lat1) * RAD, dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Great-circle km between two map points (map units), through the map's projection. */
export function mapKm(ax, ay, bx, by) {
  const [lo1, la1] = mapToLonLat(ax, ay), [lo2, la2] = mapToLonLat(bx, by);
  return haversineKm(lo1, la1, lo2, la2);
}

/** Total great-circle km along [[x, y], …] (map units), leg by leg. */
export function pathKm(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += mapKm(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  return s;
}

/** Cumulative planar length of a polyline (map units): [0, …, total]. */
export function cumulative(pts) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return c;
}

/** The point at planar arc length s along pts (cum from cumulative()). */
export function pointAt(pts, cum, s) {
  const n = pts.length;
  if (s <= 0) return [pts[0][0], pts[0][1]];
  if (s >= cum[n - 1]) return [pts[n - 1][0], pts[n - 1][1]];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const k = (s - cum[lo]) / (cum[hi] - cum[lo] || 1);
  return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * k, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * k];
}

/** Evenly spaced points every `step` (map units) along pts, then a moving average over ±k points (ends kept), so a
 *  route through hex centres reads as a smooth camera path. */
export function smoothPath(pts, step, k = 4) {
  const cum = cumulative(pts), L = cum[cum.length - 1];
  const n = Math.max(2, Math.ceil(L / step) + 1), even = [];
  for (let i = 0; i < n; i++) even.push(pointAt(pts, cum, (L * i) / (n - 1)));
  if (k <= 0) return even;
  return even.map((p, i) => {
    if (i === 0 || i === n - 1) return p;
    const r = Math.min(k, i, n - 1 - i);
    let x = 0, y = 0;
    for (let j = i - r; j <= i + r; j++) { x += even[j][0]; y += even[j][1]; }
    return [x / (2 * r + 1), y / (2 * r + 1)];
  });
}

// --- Commons photos ------------------------------------------------------------------------------------------------

/** Free licences the place card shows: CC0, public domain, CC BY, CC BY-SA (any version / port). Not NC, ND, GFDL-only,
 *  fair use or "attribution" without a CC licence. */
export function isFreeLicense(short) {
  const s = String(short || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return false;
  if (/\b(nc|nd)\b/.test(s)) return false;
  return /^cc0\b/.test(s) || /^cc[- ]zero\b/.test(s) || /^public domain\b/.test(s) || /^pd(\b|-)/.test(s)
    || /^cc[- ]by(-sa)? \d(\.\d)?\b/.test(s);
}

// File names of maps, logos, flags, diagrams and other non-photos (English and Vietnamese words).
const UNSUITABLE = new RegExp(`(^|[^\\p{L}\\p{N}])(map|maps|karte|carte|locator|location|logo|flag|flags|coat of arms|emblem|seal|diagram|chart|graph|plan|scheme|icon|symbol|signature|bản đồ|lá cờ|quốc kỳ|biểu tượng|huy hiệu|sơ đồ|biểu đồ|con dấu)(?=$|[^\\p{L}\\p{N}])`, "iu");
export const unsuitableTitle = (title) => UNSUITABLE.test(String(title || "").replace(/^File:/i, "").replace(/[_.-]/g, " "));

/** Plain text of an extmetadata HTML value (authors are often links). */
export function stripHtml(s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

// "Hạ Long Bay - panoramio (2).jpg" and "… (1).jpg" are one view: compare names without the counter and extension
const stem = (title) => String(title).replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, "").replace(/\s*[([]?\d{1,4}[)\]]?\s*$/, "").trim().toLowerCase();

/** A Commons API answer (formatversion=2, prop=imageinfo with extmetadata) → photos that pass the filters, in the
 *  answer's order (`index`: search relevance or geosearch distance): [{title, thumb, w, h, page, author, license}]. */
export function parsePhotos(json) {
  const pages = json?.query?.pages;
  if (!Array.isArray(pages)) return [];
  const out = [];
  for (const p of [...pages].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
    const ii = p?.imageinfo?.[0];
    if (!ii || !/^image\/(jpeg|png)$/.test(ii.mime || "") || unsuitableTitle(p.title)) continue;
    const m = ii.extmetadata || {};
    const license = stripHtml(m.LicenseShortName?.value);
    if (!isFreeLicense(license) || !ii.thumburl) continue;
    out.push({ title: p.title, thumb: ii.thumburl, w: ii.thumbwidth, h: ii.thumbheight, page: ii.descriptionurl,
      author: stripHtml(m.Artist?.value).replace(/\(\s*more photos\s*\)/i, "").trim() || "", license });
  }
  return out;
}

/** Merge photo lists in priority order, dropping repeats (same file or the same view numbered), up to n. */
export function mergePhotos(lists, n = 4) {
  const seen = new Set(), out = [];
  for (const list of lists) for (const p of list || []) {
    const k = stem(p.title);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (out.length >= n) return out;
  }
  return out;
}

/** Index of the month (1–12) n steps after m. */
export const addMonth = (y, m, n) => { const k = y * 12 + (m - 1) + n; return [Math.floor(k / 12), (k % 12) + 1]; };
