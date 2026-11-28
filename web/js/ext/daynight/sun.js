// Sun position and map coordinates, pure functions (no DOM; tested by sun.test.mjs in node).

// Map units → lon/lat: the inverse of pipeline/geo.py MapProjection (Albers equal-area, lat1 11°, lat2 21°, lat0 16°,
// lon0 106°, R 6371.0088 km) with pipeline/build/world.py FRAME min_x / max_y and MARGIN, 5 map units per km.
// Keep in sync with those two files.
const R = 6371.0088, UNIT = 5, MARGIN = 200, MIN_X = -801.2961167935589, MAX_Y = 822.7997851038526;
const RAD = Math.PI / 180;
const P1 = 11 * RAD, P2 = 21 * RAD, P0 = 16 * RAD, LON0 = 106 * RAD;
const N = (Math.sin(P1) + Math.sin(P2)) / 2;
const C = Math.cos(P1) ** 2 + 2 * N * Math.sin(P1);
const RHO0 = (R * Math.sqrt(C - 2 * N * Math.sin(P0))) / N;

/** Map units (x, y down) → [lon, lat] in degrees. */
export function mapToLonLat(x, y) {
  const ax = (x - MARGIN) / UNIT + MIN_X, ay = MAX_Y - (y - MARGIN) / UNIT;
  const dy = RHO0 - ay, rho = Math.hypot(ax, dy), theta = Math.atan2(ax, dy);
  const s = (C - ((rho * N) / R) ** 2) / (2 * N);
  return [(LON0 + theta / N) / RAD, Math.asin(Math.max(-1, Math.min(1, s))) / RAD];
}

/** The sun's declination (radians) and the equation of time (minutes) for a UTC time: NOAA's solar calculator
 *  (Meeus, "Astronomical Algorithms", low-precision sun; ~0.01° over 1950–2050). */
export function sunState(ms) {
  const T = (ms / 864e5 + 2440587.5 - 2451545) / 36525; // Julian centuries since J2000
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) * RAD;
  const M = (357.52911 + T * (35999.05029 - 0.0001537 * T)) * RAD;
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Cq = Math.sin(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M) * (0.019993 - 0.000101 * T) + Math.sin(3 * M) * 0.000289;
  const om = (125.04 - 1934.136 * T) * RAD;
  const lambda = L0 + (Cq - 0.00569 - 0.00478 * Math.sin(om)) * RAD; // apparent longitude
  const eps = (23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(om)) * RAD;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const y = Math.tan(eps / 2) ** 2;
  const eqt = (4 / RAD) * (y * Math.sin(2 * L0) - 2 * e * Math.sin(M) + 4 * e * y * Math.sin(M) * Math.cos(2 * L0)
    - 0.5 * y * y * Math.sin(4 * L0) - 1.25 * e * e * Math.sin(2 * M));
  const utcMin = (((ms % 864e5) + 864e5) % 864e5) / 6e4;
  return { decl, eqt, utcMin };
}

/** Geometric solar elevation (degrees, no refraction) at lat / lon (degrees) for state = sunState(ms). */
export function elevationAt(lat, lon, st) {
  const ha = ((st.utcMin + st.eqt + 4 * lon) / 4 - 180) * RAD; // hour angle from true solar time
  const p = lat * RAD;
  const cz = Math.sin(p) * Math.sin(st.decl) + Math.cos(p) * Math.cos(st.decl) * Math.cos(ha);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cz))) / RAD;
}

export const sunElevation = (lat, lon, ms) => elevationAt(lat, lon, sunState(ms));

/** 0 = full day, 1 = full night: civil twilight to past nautical (sun +3° … −10°), smoothstep. */
export function nightness(elev) {
  const u = Math.max(0, Math.min(1, (3 - elev) / 13));
  return u * u * (3 - 2 * u);
}
