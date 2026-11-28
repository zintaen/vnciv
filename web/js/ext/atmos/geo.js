// Pure helpers for the live-weather layer (no DOM; tested by geo.test.mjs and tests/test_atmos.py).
import { mapToLonLat } from "../daynight/sun.js";

// lon/lat → map units: pipeline/geo.py MapProjection (Albers equal-area, lat1 11°, lat2 21°, lat0 16°, lon0 106°,
// R 6371.0088 km) with pipeline/build/world.py FRAME min_x / max_y and MARGIN, 5 map units per km — the forward of
// daynight/sun.js mapToLonLat. Keep in sync with those files.
const R = 6371.0088, UNIT = 5, MARGIN = 200, MIN_X = -801.2961167935589, MAX_Y = 822.7997851038526;
const RAD = Math.PI / 180;
const P1 = 11 * RAD, P2 = 21 * RAD, P0 = 16 * RAD, LON0 = 106 * RAD;
const N = (Math.sin(P1) + Math.sin(P2)) / 2;
const C = Math.cos(P1) ** 2 + 2 * N * Math.sin(P1);
const RHO0 = (R * Math.sqrt(C - 2 * N * Math.sin(P0))) / N;

export function lonLatToMap(lon, lat) {
  const rho = (R * Math.sqrt(C - 2 * N * Math.sin(lat * RAD))) / N, th = N * (lon * RAD - LON0);
  const x = rho * Math.sin(th), y = RHO0 - rho * Math.cos(th);
  return [(x - MIN_X) * UNIT + MARGIN, (MAX_Y - y) * UNIT + MARGIN];
}
export { mapToLonLat };

export const STEP = 0.75; // grid spacing in degrees (~80 km)

/** The sample points: a STEP° lat/lon grid over the map's frame, kept where `keep(x, y)` (Vietnam's land). Rounded
 *  to 2 decimals so the request URL is short and stable (the same URL every visit). */
export function gridPoints(W, H, keep) {
  const pts = [];
  for (let lat = 7.5; lat <= 23.6; lat += STEP) {
    for (let lon = 102; lon <= 117.5; lon += STEP) {
      const la = Math.round(lat * 100) / 100, lo = Math.round(lon * 100) / 100;
      const [x, y] = lonLatToMap(lo, la);
      if (x >= 0 && y >= 0 && x <= W && y <= H && keep(x, y)) pts.push({ lat: la, lon: lo, x, y });
    }
  }
  return pts;
}

// WMO weather interpretation codes (Open-Meteo's "weather_code") → an English label (translated by the caller) and
// whether it is wet. https://open-meteo.com/en/docs ("WMO Weather interpretation codes").
const WMO = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Freezing fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Dense drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Light showers", 81: "Showers", 82: "Violent showers", 85: "Snow showers", 86: "Snow showers",
  95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with hail",
};
export const wmoLabel = (code) => WMO[code] || "Unknown";
export const WMO_LABELS = [...new Set([...Object.values(WMO), "Unknown"])];

/** 0 = dry, else rain strength 0.3 … 1, from the code and the precipitation of the last 15 minutes (mm). */
export function rainLevel(code, mm) {
  const wet = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
  if (!wet && !(mm > 0)) return 0;
  const byCode = code >= 95 || code === 65 || code === 82 ? 1 : code === 63 || code === 81 || code === 55 ? 0.65 : 0.35;
  return Math.max(byCode, Math.min(1, (mm || 0) / 2));
}

/** Open-Meteo's array (or one object for a single point) → [{t, mm, cloud, code, ws, wd, time}] in point order. */
export function parseCurrent(json, n) {
  const arr = Array.isArray(json) ? json : [json];
  if (arr.length !== n) throw new Error(`expected ${n} locations, got ${arr.length}`);
  return arr.map((o) => {
    const c = o?.current;
    if (!c || !Number.isFinite(c.temperature_2m)) throw new Error("no current data");
    return { t: c.temperature_2m, mm: c.precipitation ?? 0, cloud: c.cloud_cover ?? 0, code: c.weather_code ?? -1,
      ws: c.wind_speed_10m ?? 0, wd: c.wind_direction_10m ?? 0, time: c.time };
  });
}
