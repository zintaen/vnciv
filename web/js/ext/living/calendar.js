// Pure date logic for the living map (no DOM; tested by living.test.mjs in node).
//   vnParts(ms)            Vietnam wall-clock parts (UTC+7, no daylight saving): {y, m (1-12), d, h (fractional hour)}
//   rice stage of a month  from a region's seasons (living.json crop_calendar)
//   Tết eve                from living.json tet (Gregorian date of mùng 1 Tết per year, Vietnam's calendar)

const VN_OFFSET_MS = 7 * 3600e3;

/** Vietnam wall-clock parts of a UTC time. */
export function vnParts(ms) {
  const d = new Date(ms + VN_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours() + d.getUTCMinutes() / 60 };
}

const inMonths = (m, list) => list.includes(m);

/** Stage of the rice in month m (1-12) for a region: "plant" (flooded, transplanting / sowing), "grow" (green),
 *  "ripe" (the month before harvest starts), "harvest" (gold) or "fallow". When the region's seasons overlap the
 *  later stage wins (a staggered delta is harvesting somewhere while it plants elsewhere: gold reads best).
 *  seasons: [{plant: [months], harvest: [months]}]. */
const ORDER = ["fallow", "plant", "grow", "ripe", "harvest"];
export function riceStage(seasons, m) {
  let best = 0;
  for (const s of seasons || []) {
    const P = s.plant || [], H = s.harvest || [];
    if (!P.length || !H.length) continue;
    let st = 0;
    if (inMonths(m, H)) st = 4;
    else if (inMonths(m, P)) st = 1;
    else {
      // between the last planting month and the first harvest month (wrapping over the new year)
      const p1 = P[P.length - 1], h0 = H[0];
      const span = (h0 - p1 + 12) % 12, off = (m - p1 + 12) % 12;
      if (off > 0 && off < span) st = off === span - 1 ? 3 : 2;
    }
    if (st > best) best = st;
  }
  return ORDER[best];
}

/** Is the Vietnam clock on Tết eve (giao thừa): from 21:00 on the last day of the lunar year to 01:00 on mùng 1?
 *  tet: {year: "YYYY-MM-DD"}. Returns the Tết year or 0. */
export function tetEve(ms, tet) {
  const p = vnParts(ms);
  const day = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  const next = vnParts(ms + 864e5);
  const dayNext = `${next.y}-${String(next.m).padStart(2, "0")}-${String(next.d).padStart(2, "0")}`;
  if (tet?.[p.y] === dayNext && p.h >= 21) return p.y;
  if (tet?.[p.y] === day && p.h < 1) return p.y;
  return 0;
}

/** The next Tết on or after the Vietnam date of ms: {year, date} or null. */
export function nextTet(ms, tet) {
  const p = vnParts(ms);
  const today = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  for (const y of [p.y, p.y + 1]) if (tet?.[y] && tet[y] >= today) return { year: y, date: tet[y] };
  return null;
}

/** UTC ms of 23:59:30 Vietnam time on Tết eve of a year (the debug preview lands just before midnight). */
export function tetEveMs(year, tet) {
  const d = tet?.[year];
  if (!d) return null;
  return Date.parse(`${d}T00:00:00Z`) - VN_OFFSET_MS - 30e3;
}
