import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapGL, { Source, Layer, NavigationControl, Popup } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

import {
  YEAR_LIMIT,
  fetchCoverage,
  fetchHarmonizedCellSeries,
  fetchYear,
  fetchYearlyTotals,
} from './api';
import { buildSeriesGroups } from './seriesUtils';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// Used until the API says which years exist.
const FALLBACK_MIN_YEAR = 2000;
const FALLBACK_MAX_YEAR = 2026;
const STEP_MS = 900; // time each year stays on screen while playing

const INITIAL_VIEW = { longitude: 23.7, latitude: 38.5, zoom: 6 };

const SENSOR_OPTIONS = [
  { key: 'ALL', label: 'All data', value: null },
  { key: 'MODIS', label: 'MODIS', value: 'MODIS' },
  { key: 'VIIRS', label: 'VIIRS', value: 'VIIRS' },
];

const SENSOR_NAMES = {
  MODIS: 'MODIS (1 km)',
  VIIRS: 'VIIRS (375 m)',
};

const VIIRS_CONFIDENCE = { l: 'Low', n: 'Nominal', h: 'High' };

const SERIES_LABELS = {
  detections: 'detections',
  frp: 'FRP',
};

const formatCoordKey = (lat, lon) => `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;

// Radius grows with FRP; the whole curve is scaled up as you zoom in.
const radiusByFrp = (k) => [
  'interpolate', ['linear'], ['coalesce', ['get', 'frp'], 0],
  0, 3 * k,
  20, 5 * k,
  100, 9 * k,
  500, 15 * k,
];

const FIRE_LAYER_PAINT = {
  'circle-radius': [
    'interpolate', ['linear'], ['zoom'],
    4, radiusByFrp(0.6),
    10, radiusByFrp(2),
  ],
  'circle-color': [
    'interpolate', ['linear'], ['coalesce', ['get', 'frp'], 0],
    0, '#ffeda0',
    30, '#feb24c',
    150, '#f03b20',
  ],
  'circle-opacity': 0.85,
  'circle-stroke-width': 0.5,
  'circle-stroke-color': 'rgba(0, 0, 0, 0.35)',
};

// Draw the most intense fires on top of weaker ones.
const FIRE_LAYER_LAYOUT = { 'circle-sort-key': ['coalesce', ['get', 'frp'], 0] };

const fmt = (n, digits = 0) =>
  n === null || n === undefined || Number.isNaN(Number(n))
    ? '–'
    : Number(n).toLocaleString('en-US', {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });

// "2024-08-20T02:26:00+00:00" -> "2024-08-20 02:26 UTC"
const fmtDateTime = (iso) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : '–');

const fmtConfidence = (p) => {
  if (p.confidence === null || p.confidence === undefined) return '–';
  if (p.sensor === 'VIIRS') return VIIRS_CONFIDENCE[p.confidence] ?? p.confidence;
  return `${p.confidence}%`;
};

const yearOf = (isoDate) => Number(String(isoDate).slice(0, 4));

function TimeSeriesChart({ metric, series }) {
  const groups = useMemo(
    () => buildSeriesGroups(series, metric === 'frp' ? 'frp_mw' : 'detections'),
    [metric, series],
  );

  if (!series || !Array.isArray(series.points) || !series.points.length || !groups.length) {
    return <p className="notice">No monthly series available for this location.</p>;
  }

  const width = 270;
  const height = 150;
  const padding = 16;
  const allValues = groups.flatMap((group) => group.points.map((point) => point.value));
  const minY = Math.min(0, ...allValues);
  const maxY = Math.max(...allValues, 1);
  const yRange = Math.max(maxY - minY, 1);

  const xAt = (index, total) => {
    if (total <= 1) return padding + width / 2 - padding;
    return padding + (index / (total - 1)) * (width - padding * 2);
  };

  const yAt = (value) => height - padding - ((value - minY) / yRange) * (height - padding * 2);

  const axisLabels = groups[0]?.points ?? [];

  return (
    <div className="series-chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="series-chart" role="img" aria-label={`${SERIES_LABELS[metric]} series plot`}>
        {[0, 0.5, 1].map((t) => {
          const value = minY + yRange * t;
          const y = yAt(value);
          return (
            <g key={t}>
              <line x1={padding} x2={width - padding} y1={y} y2={y} stroke="rgba(255,255,255,0.12)" strokeDasharray="3 4" />
              <text x={4} y={y + 4} fontSize="9" fill="rgba(253,246,227,0.7)" textAnchor="start">{fmt(value, 0)}</text>
            </g>
          );
        })}

        {groups.map((group) => {
          const d = group.points
            .map((point, index) => {
              const x = xAt(index, group.points.length);
              const y = yAt(point.value);
              return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
            })
            .join(' ');

          return <path key={group.source} d={d} fill="none" stroke={group.color} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />;
        })}

        {axisLabels.length > 0 && (
          <g>
            {axisLabels.map((point, index) => {
              const shouldLabel = index === 0 || index === axisLabels.length - 1 || index === Math.floor(axisLabels.length / 2);
              if (!shouldLabel) return null;
              const x = xAt(index, axisLabels.length);
              return (
                <text key={`${point.month}-${index}`} x={x} y={height - 4} fontSize="9" fill="rgba(253,246,227,0.7)" textAnchor="middle">
                  {new Date(point.month).toLocaleDateString('en-US', { month: 'short' })}
                </text>
              );
            })}
          </g>
        )}
      </svg>

      <div className="series-legend" aria-label="Time series legend">
        {groups.map((group) => (
          <div key={group.source} className="series-legend-item">
            <span className="series-swatch" style={{ background: group.color }} aria-hidden="true" />
            <span>{group.source}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FireMap() {
  // Data range and per-year totals from the API.
  const [meta, setMeta] = useState({ status: 'loading' });
  // The year currently drawn on the map (lags `year` while it loads).
  const [shown, setShown] = useState(null);
  const [yearError, setYearError] = useState(null);

  const [year, setYear] = useState(null);
  const [sensorKey, setSensorKey] = useState('ALL');
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState(null);
  const [selectionMode, setSelectionMode] = useState('pan');
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [cursor, setCursor] = useState('');

  const sensor = SENSOR_OPTIONS.find((s) => s.key === sensorKey);
  const minYear = meta.minYear ?? FALLBACK_MIN_YEAR;
  const maxYear = meta.maxYear ?? FALLBACK_MAX_YEAR;

  const pointSeriesCache = useRef(new Map());
  const pointSeriesRequestCache = useRef(new Map());

  const loadPointSeries = useCallback((lat, lon, metric) => {
    const key = formatCoordKey(lat, lon);
    const cached = pointSeriesCache.current.get(key) ?? {};
    if (cached[metric]) return Promise.resolve(cached[metric]);

    const pending = pointSeriesRequestCache.current.get(key) ?? {};
    if (pending[metric]) return pending[metric];

    const request = fetchHarmonizedCellSeries(lat, lon, metric)
      .then((data) => {
        const next = pointSeriesCache.current.get(key) ?? {};
        next[metric] = data;
        pointSeriesCache.current.set(key, next);

        const inFlight = pointSeriesRequestCache.current.get(key) ?? {};
        inFlight[metric] = null;
        pointSeriesRequestCache.current.set(key, inFlight);
        return data;
      })
      .catch((error) => {
        const inFlight = pointSeriesRequestCache.current.get(key) ?? {};
        inFlight[metric] = null;
        pointSeriesRequestCache.current.set(key, inFlight);
        throw error;
      });

    pending[metric] = request;
    pointSeriesRequestCache.current.set(key, pending);
    return request;
  }, []);

  // ---- Cache of year -> Promise<GeoJSON>, so each year is fetched once ----
  const cache = useRef(new Map());
  const loadYear = useCallback((y) => {
    if (!cache.current.has(y)) {
      const request = fetchYear(y).catch((err) => {
        cache.current.delete(y); // allow a retry later
        throw err;
      });
      cache.current.set(y, request);
    }
    return cache.current.get(y);
  }, []);

  useEffect(() => {
    if (selectionMode === 'pan') return;
    setSelected(null);
  }, [selectionMode]);

  // ---- On start: which years exist, and totals for the stats panel ----
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([fetchCoverage(controller.signal), fetchYearlyTotals(controller.signal)])
      .then(([coverage, yearly]) => {
        if (!coverage.total) {
          setMeta({ status: 'empty' });
          return;
        }
        const totals = {};
        for (const row of yearly) {
          const y = yearOf(row.period);
          totals[y] ??= {};
          totals[y][row.sensor] = { count: row.count, frp: row.total_frp ?? 0 };
        }
        const first = yearOf(coverage.first_date);
        const last = yearOf(coverage.last_date);
        setMeta({ status: 'ready', minYear: first, maxYear: last, totals });
        setYear(last); // open on the most recent year
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        console.error('Could not reach the FireScope API:', err);
        setMeta({ status: 'error', message: err.message });
      });
    return () => controller.abort();
  }, []);

  // ---- Fetch the selected year (and quietly prefetch the next one) ----
  useEffect(() => {
    if (meta.status !== 'ready' || year === null) return undefined;
    let current = true;
    loadYear(year)
      .then((geojson) => {
        if (current) setShown({ year, geojson });
      })
      .catch((err) => {
        if (!current) return;
        console.error(`Could not load ${year}:`, err);
        setYearError({ year, message: `Could not load ${year} (${err.message}).` });
        setPlaying(false);
      });
    if (year < maxYear) loadYear(year + 1).catch(() => {});
    return () => {
      current = false;
    };
  }, [meta.status, year, maxYear, loadYear]);

  // ---- Play: step to the next year once the current one is on screen ----
  const yearReady = shown?.year === year;
  useEffect(() => {
    if (!playing || !yearReady) return undefined;
    const id = setTimeout(() => {
      setYear((y) => (y >= maxYear ? minYear : y + 1));
    }, STEP_MS);
    return () => clearTimeout(id);
  }, [playing, yearReady, minYear, maxYear]);

  // ---- Stats for the selected year + sensor (exact totals from the API) ----
  const stats = useMemo(() => {
    const byS = meta.totals?.[year];
    if (!byS) return { count: 0, totalFrp: 0 };
    const sensors = sensor.value ? [sensor.value] : Object.keys(byS);
    let count = 0;
    let totalFrp = 0;
    for (const s of sensors) {
      count += byS[s]?.count ?? 0;
      totalFrp += byS[s]?.frp ?? 0;
    }
    return { count, totalFrp };
  }, [meta.totals, year, sensor]);

  // ---- MapLibre filter: each year is its own dataset, so only the sensor ----
  const layerFilter = useMemo(
    () => (sensor.value ? ['==', ['get', 'sensor'], sensor.value] : ['has', 'sensor']),
    [sensor],
  );

  // Hide the popup automatically if its fire is no longer displayed.
  const popup =
    selected &&
    selected.year === shown?.year &&
    (!sensor.value || selected.properties.sensor === sensor.value)
      ? selected
      : null;

  const handleFireClick = (e) => {
    const feature = e.features?.[0];
    if (!feature || !shown) {
      setSelected(null);
      return;
    }
    const [longitude, latitude] = feature.geometry.coordinates;
    setSelected({ longitude, latitude, year: shown.year, properties: feature.properties });
  };

  const handlePointSelect = (e) => {
    const { lat, lng } = e.lngLat;
    const key = formatCoordKey(lat, lng);
    const existing = pointSeriesCache.current.get(key) ?? {};
    setSelectedPoint({
      key,
      lat,
      lon: lng,
      metric: 'detections',
      loadingMetric: existing.detections ? null : 'detections',
      detections: existing.detections ?? null,
      frp: existing.frp ?? null,
      error: null,
    });
    setSelected(null);

    if (existing.detections) return;
    loadPointSeries(lat, lng, 'detections')
      .then((data) => {
        setSelectedPoint((current) =>
          current && current.key === key
            ? { ...current, detections: data, loadingMetric: null, error: null }
            : current,
        );
      })
      .catch((err) => {
        setSelectedPoint((current) =>
          current && current.key === key
            ? { ...current, loadingMetric: null, error: err.message }
            : current,
        );
      });
  };

  const handleMetricSwitch = useCallback(
    (metric) => {
      if (!selectedPoint) return;
      const { lat, lon, key } = selectedPoint;
      const cached = pointSeriesCache.current.get(key) ?? {};
      if (cached[metric]) {
        setSelectedPoint((current) =>
          current && current.key === key ? { ...current, metric, loadingMetric: null, error: null } : current,
        );
        return;
      }

      setSelectedPoint((current) =>
        current && current.key === key ? { ...current, metric, loadingMetric: metric, error: null } : current,
      );

      loadPointSeries(lat, lon, metric)
        .then((data) => {
          setSelectedPoint((current) =>
            current && current.key === key
              ? { ...current, [metric]: data, loadingMetric: null, error: null }
              : current,
          );
        })
        .catch((err) => {
          setSelectedPoint((current) =>
            current && current.key === key
              ? { ...current, loadingMetric: null, error: err.message }
              : current,
          );
        });
    },
    [loadPointSeries, selectedPoint],
  );

  const activePointSeries = selectedPoint ? selectedPoint[selectedPoint.metric] : null;

  const handleSlider = (e) => {
    setPlaying(false);
    setYear(Number(e.target.value));
  };

  const ready = meta.status === 'ready' && year !== null;
  const errorForYear = yearError?.year === year ? yearError.message : null;
  const displayYear = year ?? maxYear;

  return (
    <div className="fire-map">
      <MapGL
        initialViewState={INITIAL_VIEW}
        style={{ width: '100%', height: '100%' }}
        mapStyle={MAP_STYLE}
        interactiveLayerIds={selectionMode === 'pan' ? ['fire-layer'] : []}
        cursor={selectionMode === 'select' ? 'crosshair' : cursor}
        dragPan={selectionMode === 'pan'}
        onClick={selectionMode === 'select' ? handlePointSelect : handleFireClick}
        onMouseEnter={() => setCursor('pointer')}
        onMouseLeave={() => setCursor('')}
      >
        <NavigationControl position="top-right" />

        {shown && (
          <Source id="fires" type="geojson" data={shown.geojson}>
            <Layer
              id="fire-layer"
              type="circle"
              filter={layerFilter}
              layout={FIRE_LAYER_LAYOUT}
              paint={FIRE_LAYER_PAINT}
            />
          </Source>
        )}

        {selectionMode === 'select' && selectedPoint ? (
          <Popup
            longitude={selectedPoint.lon}
            latitude={selectedPoint.lat}
            anchor="bottom"
            offset={12}
            closeOnClick={false}
            onClose={() => setSelectedPoint(null)}
            maxWidth="320px"
          >
            <div className="point-popup">
              <div className="point-popup-header">
                <strong>Monthly series</strong>
                <span>
                  {selectedPoint.lat.toFixed(3)}, {selectedPoint.lon.toFixed(3)}
                </span>
              </div>

              <div className="segmented point-series-toggle" role="group" aria-label="Monthly series metric">
                <button
                  type="button"
                  className={selectedPoint.metric === 'detections' ? 'is-active' : ''}
                  aria-pressed={selectedPoint.metric === 'detections'}
                  onClick={() => handleMetricSwitch('detections')}
                >
                  Detections
                </button>
                <button
                  type="button"
                  className={selectedPoint.metric === 'frp' ? 'is-active' : ''}
                  aria-pressed={selectedPoint.metric === 'frp'}
                  onClick={() => handleMetricSwitch('frp')}
                >
                  FRP
                </button>
              </div>

              {selectedPoint.error && (
                <p className="notice notice-error">Could not load {SERIES_LABELS[selectedPoint.metric]}: {selectedPoint.error}</p>
              )}

              {selectedPoint.loadingMetric && (
                <p className="notice">Loading {SERIES_LABELS[selectedPoint.loadingMetric]}…</p>
              )}

              {!selectedPoint.loadingMetric && activePointSeries && (
                <TimeSeriesChart metric={selectedPoint.metric} series={activePointSeries} />
              )}
            </div>
          </Popup>
        ) : null}

        {popup && (
          <Popup
            longitude={popup.longitude}
            latitude={popup.latitude}
            anchor="bottom"
            offset={12}
            closeOnClick={false}
            onClose={() => setSelected(null)}
            maxWidth="260px"
          >
            <dl className="popup">
              <div><dt>Date</dt><dd>{fmtDateTime(popup.properties.acq_datetime)}</dd></div>
              <div><dt>FRP</dt><dd>{fmt(popup.properties.frp, 1)} MW</dd></div>
              <div><dt>Brightness</dt><dd>{fmt(popup.properties.brightness, 1)} K</dd></div>
              <div><dt>Confidence</dt><dd>{fmtConfidence(popup.properties)}</dd></div>
              <div>
                <dt>Source</dt>
                <dd>
                  {SENSOR_NAMES[popup.properties.sensor] ?? popup.properties.sensor}
                  {popup.properties.satellite ? ` · ${popup.properties.satellite}` : ''}
                </dd>
              </div>
              <div>
                <dt>Time of day</dt>
                <dd>{popup.properties.daynight === 'N' ? 'Night' : 'Day'}</dd>
              </div>
            </dl>
          </Popup>
        )}
      </MapGL>

      {/* ---------- Top-left card: sensor filter + live metrics ---------- */}
      <section className="panel panel-info" aria-label="Sensor filter and summary">
        <h1 className="panel-title">Greece wildfire hotspots</h1>

        <div className="segmented" role="group" aria-label="Sensor source">
          {SENSOR_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={opt.key === sensorKey ? 'is-active' : ''}
              aria-pressed={opt.key === sensorKey}
              onClick={() => setSensorKey(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="segmented map-mode" role="group" aria-label="Map interaction mode">
          <button
            type="button"
            className={selectionMode === 'pan' ? 'is-active' : ''}
            aria-pressed={selectionMode === 'pan'}
            onClick={() => setSelectionMode('pan')}
          >
            Pan
          </button>
          <button
            type="button"
            className={selectionMode === 'select' ? 'is-active' : ''}
            aria-pressed={selectionMode === 'select'}
            onClick={() => setSelectionMode('select')}
          >
            Select point
          </button>
        </div>

        <div className="stats" aria-live="polite">
          <div>
            <span className="stat-value">{ready ? fmt(stats.count) : '–'}</span>
            <span className="stat-label">Active hotspots in {displayYear}</span>
          </div>
          <div>
            <span className="stat-value">
              {ready ? fmt(stats.totalFrp, 1) : '–'}
              <small> MW</small>
            </span>
            <span className="stat-label">Total fire radiative power</span>
          </div>
        </div>

        <div className="legend">
          <div className="legend-bar" />
          <div className="legend-scale">
            <span>Low FRP</span>
            <span>High FRP</span>
          </div>
        </div>

        {meta.status === 'loading' && <p className="notice">Connecting to the FireScope API…</p>}
        {meta.status === 'error' && (
          <p className="notice notice-error">
            Can&apos;t reach the FireScope API ({meta.message}). Is the backend running? Start it
            with <code>uvicorn app.main:app --reload</code>.
          </p>
        )}
        {meta.status === 'empty' && (
          <p className="notice notice-error">
            The database has no detections yet. Load data with{' '}
            <code>python -m app.data.ingest</code>.
          </p>
        )}
        {ready && !yearReady && !errorForYear && (
          <p className="notice">Loading {year}…</p>
        )}
        {errorForYear && <p className="notice notice-error">{errorForYear}</p>}
        {yearReady && shown.geojson.truncated && (
          <p className="notice">
            Showing the {fmt(YEAR_LIMIT)} most recent detections of {year}.
          </p>
        )}
      </section>

      {/* ---------- Bottom bar: timeline ---------- */}
      <section className="panel panel-timeline" aria-label="Timeline">
        <button
          type="button"
          className="play-btn"
          onClick={() => setPlaying((p) => !p)}
          disabled={!ready}
          aria-label={playing ? 'Pause animation' : 'Play animation'}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
              <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" />
            </svg>
          )}
        </button>

        <div className="timeline">
          <input
            type="range"
            min={minYear}
            max={maxYear}
            step={1}
            value={displayYear}
            onChange={handleSlider}
            disabled={!ready}
            aria-label="Year"
          />
          <div className="timeline-ends">
            <span>{minYear}</span>
            <span>{maxYear}</span>
          </div>
        </div>

        <output className="year-readout">{displayYear}</output>
      </section>
    </div>
  );
}
