// Thin client for the FireScope backend.
//
// In development, Vite forwards /api to the backend (see vite.config.js),
// so API_BASE stays empty. For a deployed build where the API lives on
// another domain, set VITE_API_URL (e.g. https://api.firescope.example).
const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const API = `${API_BASE}/api/v1`;

async function getJson(path, params = {}, signal) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    for (const v of [].concat(value)) query.append(key, v);
  }
  const qs = query.toString();
  const res = await fetch(`${API}${path}${qs ? `?${qs}` : ''}`, { signal });
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* body was not JSON */
    }
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return res.json();
}

/** Totals, first/last dates and map extent of the loaded data. */
export const fetchCoverage = (signal) => getJson('/detections/coverage', {}, signal);

/** Count and total FRP per year and sensor: [{ period, sensor, count, total_frp }]. */
export const fetchYearlyTotals = (signal) =>
  getJson('/detections/timeseries', { interval: 'year' }, signal);

/** Max points per request (the backend allows up to 50,000). */
export const YEAR_LIMIT = 50000;

/** All detections of one calendar year (UTC) as a GeoJSON FeatureCollection. */
export const fetchYear = (year, signal) =>
  getJson(
    '/detections',
    { start_date: `${year}-01-01`, end_date: `${year}-12-31`, limit: YEAR_LIMIT },
    signal,
  );
