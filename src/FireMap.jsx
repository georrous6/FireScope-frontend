import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapGL, { Source, Layer, NavigationControl, Popup } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

import panIcon from './assets/pan.svg';
import selectIcon from './assets/cross.svg';

import {
  YEAR_LIMIT,
  fetchCoverage,
  fetchYear,
  fetchYearlyTotals,
} from './api';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// Used until the API says which years exist.
const FALLBACK_MIN_YEAR = 2000;
const FALLBACK_MAX_YEAR = 2026;
const STEP_MS = 2000;

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

const FIRE_LAYER_LAYOUT = {
  'circle-sort-key': ['coalesce', ['get', 'frp'], 0],
};

const fmt = (n, digits = 0) =>
  n === null || n === undefined || Number.isNaN(Number(n))
    ? '–'
    : Number(n).toLocaleString('en-US', {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });

const fmtDateTime = (iso) =>
  iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : '–';

const fmtConfidence = (p) => {
  if (p.confidence === null || p.confidence === undefined) return '–';
  if (p.sensor === 'VIIRS') return VIIRS_CONFIDENCE[p.confidence] ?? p.confidence;
  return `${p.confidence}%`;
};

const yearOf = (isoDate) => Number(String(isoDate).slice(0, 4));

export function FireMap() {
  const [meta, setMeta] = useState({ status: 'loading' });
  const [shown, setShown] = useState(null);
  const [yearError, setYearError] = useState(null);

  const [year, setYear] = useState(null);
  const [sensorKey, setSensorKey] = useState('ALL');
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState(null);

  // Select point is the default interaction mode.
  const [selectionMode, setSelectionMode] = useState('select');

  const [chartOpenError, setChartOpenError] = useState(null);

  // Coordinates displayed while hovering in Select point mode.
  const [hoverCoordinates, setHoverCoordinates] = useState(null);

  const sensor = SENSOR_OPTIONS.find((s) => s.key === sensorKey);
  const minYear = meta.minYear ?? FALLBACK_MIN_YEAR;
  const maxYear = meta.maxYear ?? FALLBACK_MAX_YEAR;

  // ---- Cache of year -> Promise<GeoJSON>, so each year is fetched once ----
  const cache = useRef(new Map());

  const loadYear = useCallback((y) => {
    if (!cache.current.has(y)) {
      const request = fetchYear(y).catch((err) => {
        cache.current.delete(y);
        throw err;
      });

      cache.current.set(y, request);
    }

    return cache.current.get(y);
  }, []);

  useEffect(() => {
    if (selectionMode === 'pan') {
      setSelected(null);
      setHoverCoordinates(null);
    }
  }, [selectionMode]);

  // ---- On start: which years exist, and totals for the stats panel ----
  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      fetchCoverage(controller.signal),
      fetchYearlyTotals(controller.signal),
    ])
      .then(([coverage, yearly]) => {
        if (!coverage.total) {
          setMeta({ status: 'empty' });
          return;
        }

        const totals = {};

        for (const row of yearly) {
          const y = yearOf(row.period);

          totals[y] ??= {};
          totals[y][row.sensor] = {
            count: row.count,
            frp: row.total_frp ?? 0,
          };
        }

        const first = yearOf(coverage.first_date);
        const last = yearOf(coverage.last_date);

        setMeta({
          status: 'ready',
          minYear: first,
          maxYear: last,
          totals,
        });

        setYear(last);
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

        setYearError({
          year,
          message: `Could not load ${year} (${err.message}).`,
        });

        setPlaying(false);
      });

    if (year < maxYear) {
      loadYear(year + 1).catch(() => {});
    }

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

  // ---- Stats for the selected year + sensor ----
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

  // ---- MapLibre filter ----
  const layerFilter = useMemo(
    () => (sensor.value
      ? ['==', ['get', 'sensor'], sensor.value]
      : ['has', 'sensor']),
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

    setSelected({
      longitude,
      latitude,
      year: shown.year,
      properties: feature.properties,
    });
  };

  // Update the fixed coordinate readout while hovering over the map.
  const handleMapMouseMove = (e) => {
    if (selectionMode !== 'select') return;

    const { lat, lng } = e.lngLat;

    setHoverCoordinates({
      latitude: lat,
      longitude: lng,
    });
  };

  const handleMapMouseLeave = () => {
    setHoverCoordinates(null);
  };

  // Open the monthly time-series chart in a separate browser tab.
  const handlePointSelect = (e) => {
    const { lat, lng } = e.lngLat;

    const chartUrl = new URL(window.location.href);

    // Remove existing query parameters and hash.
    chartUrl.search = '';
    chartUrl.hash = '';

    chartUrl.searchParams.set('view', 'chart');
    chartUrl.searchParams.set('lat', String(lat));
    chartUrl.searchParams.set('lon', String(lng));

    const chartWindow = window.open(chartUrl.toString(), '_blank');

    if (chartWindow) {
      chartWindow.opener = null;
      setChartOpenError(null);
    } else {
      setChartOpenError(
        'Your browser blocked the new tab. Allow pop-ups for FireScope and try again.',
      );
    }

    setSelected(null);
  };

  const handleSlider = (e) => {
    setPlaying(false);
    setYear(Number(e.target.value));
  };

  const handleSelectMode = () => {
    setChartOpenError(null);
    setHoverCoordinates(null);
    setSelectionMode('select');
  };

  const handlePanMode = () => {
    setSelectionMode('pan');
  };

  const ready = meta.status === 'ready' && year !== null;
  const errorForYear = yearError?.year === year ? yearError.message : null;
  const displayYear = year ?? maxYear;

  return (
    <div className="fire-map">
      <style>
        {`
          .fire-map .maplibregl-ctrl-top-right {
            top: calc(50% - 10px) !important;
            right: 10px !important;
            transform: none !important;
          }

          .fire-map .maplibregl-ctrl-top-right .maplibregl-ctrl {
            margin: 0 !important;
          }

          .fire-map .maplibregl-ctrl-group {
            overflow: hidden;
            border-radius: 4px;
            box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.1);
          }

          .fire-map .map-interaction-controls {
            position: absolute;
            top: calc(50% - 76px);
            right: 10px;
            z-index: 2;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            border-radius: 4px;
            box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.1);
          }

          .fire-map .map-interaction-controls button {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 29px;
            height: 29px;
            padding: 0;
            border: 0;
            background: #fff;
            color: #333;
            cursor: pointer;
          }

          .fire-map .map-interaction-controls button + button {
            border-top: 1px solid #ddd;
          }

          .fire-map .map-interaction-controls button:hover {
            background: #f0f0f0;
          }

          .fire-map .map-interaction-controls button.is-active {
            background: #e1e1e1;
          }

          .fire-map .map-interaction-controls button:focus-visible {
            position: relative;
            z-index: 1;
            outline: 2px solid #2684ff;
            outline-offset: -2px;
          }

          .fire-map .map-interaction-controls img {
            display: block;
            width: 17px;
            height: 17px;
            object-fit: contain;
            pointer-events: none;
          }
        `}
      </style>

      <MapGL
        initialViewState={INITIAL_VIEW}
        style={{ width: '100%', height: '100%' }}
        mapStyle={MAP_STYLE}
        interactiveLayerIds={selectionMode === 'pan' ? ['fire-layer'] : []}
        cursor={selectionMode === 'select' ? 'crosshair' : ''}
        dragPan={selectionMode === 'pan'}
        onClick={selectionMode === 'select' ? handlePointSelect : handleFireClick}
        onMouseMove={handleMapMouseMove}
        onMouseLeave={handleMapMouseLeave}
      >
        <NavigationControl
          position="top-right"
          showZoom
          showCompass
          visualizePitch
        />

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
              <div>
                <dt>Date</dt>
                <dd>{fmtDateTime(popup.properties.acq_datetime)}</dd>
              </div>

              <div>
                <dt>FRP</dt>
                <dd>{fmt(popup.properties.frp, 1)} MW</dd>
              </div>

              <div>
                <dt>Brightness</dt>
                <dd>{fmt(popup.properties.brightness, 1)} K</dd>
              </div>

              <div>
                <dt>Confidence</dt>
                <dd>{fmtConfidence(popup.properties)}</dd>
              </div>

              <div>
                <dt>Source</dt>
                <dd>
                  {SENSOR_NAMES[popup.properties.sensor] ?? popup.properties.sensor}
                  {popup.properties.satellite
                    ? ` · ${popup.properties.satellite}`
                    : ''}
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

      {/* ---------- Top-right: coordinate readout ---------- */}
      {selectionMode === 'select' && (
        <div
          className="map-coordinate-readout"
          aria-live="polite"
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            zIndex: 2,
            width: '190px',
            boxSizing: 'border-box',
            padding: '9px 12px',
            borderRadius: '6px',
            background: 'rgba(20, 25, 32, 0.92)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            color: '#fdf6e3',
            fontSize: '12px',
            lineHeight: 1.6,
            boxShadow: '0 3px 12px rgba(0, 0, 0, 0.25)',
            pointerEvents: 'none',
          }}
        >
          {hoverCoordinates ? (
            <>
              <div>
                <span style={{ opacity: 0.65 }}>Latitude </span>
                <strong>{hoverCoordinates.latitude.toFixed(5)}°</strong>
              </div>

              <div>
                <span style={{ opacity: 0.65 }}>Longitude </span>
                <strong>{hoverCoordinates.longitude.toFixed(5)}°</strong>
              </div>
            </>
          ) : (
            <span style={{ opacity: 0.7 }}>
              Move over the map to inspect coordinates.
            </span>
          )}
        </div>
      )}

      {/* ---------- Right side: Pan / Select controls ---------- */}
      <div
        className="map-interaction-controls"
        role="group"
        aria-label="Map interaction mode"
      >
        <button
          type="button"
          className={selectionMode === 'pan' ? 'is-active' : ''}
          aria-pressed={selectionMode === 'pan'}
          aria-label="Pan map"
          title="Pan map"
          onClick={handlePanMode}
        >
          <img src={panIcon} alt="" />
        </button>

        <button
          type="button"
          className={selectionMode === 'select' ? 'is-active' : ''}
          aria-pressed={selectionMode === 'select'}
          aria-label="Select point"
          title="Select point"
          onClick={handleSelectMode}
        >
          <img src={selectIcon} alt="" />
        </button>
      </div>

      {/* ---------- Top-left: sensor filter + live metrics ---------- */}
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

        <div className="stats" aria-live="polite">
          <div>
            <span className="stat-value">
              {ready ? fmt(stats.count) : '–'}
            </span>
            <span className="stat-label">
              Active hotspots in {displayYear}
            </span>
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

        {meta.status === 'loading' && (
          <p className="notice">Connecting to the FireScope API…</p>
        )}

        {meta.status === 'error' && (
          <p className="notice notice-error">
            Can&apos;t reach the FireScope API ({meta.message}). Is the backend
            running? Start it with{' '}
            <code>uvicorn app.main:app --reload</code>.
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

        {errorForYear && (
          <p className="notice notice-error">{errorForYear}</p>
        )}

        {yearReady && shown.geojson.truncated && (
          <p className="notice">
            Showing the {fmt(YEAR_LIMIT)} most recent detections of {year}.
          </p>
        )}

        {chartOpenError && (
          <p className="notice notice-error">{chartOpenError}</p>
        )}

        {selectionMode === 'select' && (
          <p className="notice">
            Click anywhere on the map to open its monthly chart in a new tab.
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
              <path
                d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"
                fill="currentColor"
              />
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