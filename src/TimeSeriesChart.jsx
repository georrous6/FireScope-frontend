import { useEffect, useMemo, useRef, useState } from 'react';

import {
  buildSeriesGroups,
  filterSeriesForMonthRange,
  getDefaultMonthRange,
} from './seriesUtils';

const monthKey = (value) => String(value ?? '').slice(0, 7);

const monthListBetween = (startMonth, endMonth) => {
  if (!startMonth || !endMonth) return [];

  const start = new Date(`${startMonth}-01T00:00:00Z`);
  const end = new Date(`${endMonth}-01T00:00:00Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }

  const months = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));

  while (cursor <= end) {
    months.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return months;
};

const fmtMonthLabel = (month, options = { month: 'short', year: 'numeric' }) => {
  if (!month) return '—';

  const date = new Date(`${monthKey(month)}-01T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? month
    : date.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
};

const formatValue = (value, metric) => {
  if (!Number.isFinite(value)) return '—';

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: metric === 'frp' ? 1 : 0,
  }).format(value);
};

const getPointValueMap = (group) =>
  new Map(
    group.points.map((point) => [
      monthKey(point.month),
      Number(point.value),
    ]),
  );

export function TimeSeriesChart({
  metric,
  series,
  onMetricChange,
  loadingMetric,
  error,
  title = 'Monthly series',
  subtitle,
  onClose,
}) {
  const monthOptions = useMemo(() => {
    const points = Array.isArray(series?.points) ? series.points : [];
    return Array.from(
      new Set(points.map((point) => monthKey(point.month)).filter(Boolean)),
    ).sort();
  }, [series]);

  const defaultRange = useMemo(
    () => getDefaultMonthRange(monthOptions, new Date()),
    [monthOptions],
  );

  const [range, setRange] = useState(defaultRange);
  const [visibleSources, setVisibleSources] = useState({});
  const [panelSize, setPanelSize] = useState({ width: 560, height: 300 });
  const [hoveredMonthIndex, setHoveredMonthIndex] = useState(null);

  const resizeRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!monthOptions.length) return;

    setRange((current) => {
      if (
        current?.start &&
        current?.end &&
        monthOptions.includes(current.start) &&
        monthOptions.includes(current.end) &&
        current.start <= current.end
      ) {
        return current;
      }

      return defaultRange;
    });
  }, [defaultRange, monthOptions]);

  useEffect(() => {
    const sources = Array.from(
      new Set(
        (series?.points ?? []).map((point) =>
          String(point?.source ?? 'Unknown source'),
        ),
      ),
    );

    setVisibleSources((current) => {
      const next = {};
      for (const source of sources) {
        next[source] = current[source] ?? true;
      }
      return next;
    });
  }, [series]);

  const filteredSeries = useMemo(
    () => filterSeriesForMonthRange(series, range.start, range.end),
    [series, range.start, range.end],
  );

  const groups = useMemo(
    () => buildSeriesGroups(filteredSeries, metric === 'frp' ? 'frp_mw' : 'detections'),
    [filteredSeries, metric],
  );

  const visibleGroups = groups.filter(
    (group) => visibleSources[group.source] !== false,
  );

  const monthList = useMemo(
    () => monthListBetween(range.start, range.end),
    [range.start, range.end],
  );

  const valueMaps = useMemo(
    () => new Map(groups.map((group) => [group.source, getPointValueMap(group)])),
    [groups],
  );

  const allValues = useMemo(
    () =>
      visibleGroups.flatMap((group) => {
        const valueMap = valueMaps.get(group.source);
        return monthList
          .map((month) => valueMap?.get(monthKey(month)))
          .filter((value) => value !== undefined && Number.isFinite(value));
      }),
    [monthList, valueMaps, visibleGroups],
  );

  const width = panelSize.width;
  const height = Math.max(panelSize.height - 112, 108);
  const padding = { top: 18, right: 22, bottom: 30, left: 48 };

  const minY = Math.min(0, ...(allValues.length ? allValues : [0]));
  const maxY = Math.max(...(allValues.length ? allValues : [1]), 1);
  const yRange = Math.max(maxY - minY, 1);

  const xAt = (index, total) => {
    if (total <= 1) return padding.left + (width - padding.left - padding.right) / 2;
    return padding.left + (index / (total - 1)) * (width - padding.left - padding.right);
  };

  const yAt = (value) =>
    height -
    padding.bottom -
    ((value - minY) / yRange) * (height - padding.top - padding.bottom);

  const handleChartPointerMove = (event) => {
    if (!chartRef.current || !monthList.length) return;

    const rect = chartRef.current.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const viewBoxX = (localX / rect.width) * width;
    const plotWidth = width - padding.left - padding.right;
    const clampedX = Math.max(padding.left, Math.min(width - padding.right, viewBoxX));
    const ratio = plotWidth > 0 ? (clampedX - padding.left) / plotWidth : 0;
    const index = monthList.length <= 1
      ? 0
      : Math.round(ratio * (monthList.length - 1));

    setHoveredMonthIndex(Math.max(0, Math.min(monthList.length - 1, index)));
  };

  const handleSourceToggle = (source) => {
    setVisibleSources((current) => ({
      ...current,
      [source]: !(current[source] ?? true),
    }));
    setHoveredMonthIndex(null);
  };

  const handleMonthChange = (field, value) => {
    setRange((current) => {
      const next = { ...current, [field]: value };

      if (next.start && next.end && next.start > next.end) {
        if (field === 'start') next.end = value;
        else next.start = value;
      }

      return next;
    });
    setHoveredMonthIndex(null);
  };

  const hasSeries = Boolean(
    series && Array.isArray(series.points) && series.points.length,
  );

  useEffect(() => {
    const handlePointerMove = (event) => {
      if (!resizeRef.current) return;

      const { startX, startY, startWidth, startHeight } = resizeRef.current;

      setPanelSize({
        width: Math.max(360, startWidth + (event.clientX - startX)),
        height: Math.max(220, startHeight + (event.clientY - startY)),
      });
    };

    const handlePointerUp = () => {
      resizeRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  const hoveredMonth =
    hoveredMonthIndex === null ? null : monthList[hoveredMonthIndex];

  const tooltipValues = hoveredMonth
    ? visibleGroups
        .map((group) => ({
          source: group.source,
          color: group.color,
          value: valueMaps.get(group.source)?.get(monthKey(hoveredMonth)),
        }))
        .filter(({ value }) => value !== undefined && Number.isFinite(value))
    : [];

  const tooltipLeft =
    hoveredMonthIndex === null || monthList.length <= 1
      ? 50
      : Math.max(
          25,
          Math.min(75, (xAt(hoveredMonthIndex, monthList.length) / width) * 100),
        );

  if (!hasSeries) {
    return (
      <div className="series-window series-window--empty">
        <div className="series-window__header">
          <div>
            <div className="series-window__title">{title}</div>
            {subtitle && <div className="series-window__subtitle">{subtitle}</div>}
          </div>
          {onClose && (
            <button
              type="button"
              className="series-window__close"
              onClick={onClose}
              aria-label="Close chart"
            >
              ×
            </button>
          )}
        </div>
        <p className="notice">No monthly series available for this location.</p>
      </div>
    );
  }

  return (
    <div
      className="series-window"
      style={{ width: `${panelSize.width}px`, height: `${panelSize.height}px` }}
    >
      <div className="series-window__header">
        <div>
          <div className="series-window__title">{title}</div>
          {subtitle && <div className="series-window__subtitle">{subtitle}</div>}
        </div>
        {onClose && (
          <button
            type="button"
            className="series-window__close"
            onClick={onClose}
            aria-label="Close chart"
          >
            ×
          </button>
        )}
      </div>

      <div className="series-window__toolbar">
        <div className="segmented point-series-toggle" role="group" aria-label="Monthly series metric">
          <button
            type="button"
            className={metric === 'detections' ? 'is-active' : ''}
            aria-pressed={metric === 'detections'}
            onClick={() => {
              onMetricChange?.('detections');
              setHoveredMonthIndex(null);
            }}
          >
            Detections
          </button>
          <button
            type="button"
            className={metric === 'frp' ? 'is-active' : ''}
            aria-pressed={metric === 'frp'}
            onClick={() => {
              onMetricChange?.('frp');
              setHoveredMonthIndex(null);
            }}
          >
            FRP
          </button>
        </div>

        <div className="series-window__range" aria-label="Month range selector">
          <label>
            <span>Start</span>
            <select
              value={range.start ?? monthOptions[0] ?? ''}
              onChange={(event) => handleMonthChange('start', event.target.value)}
              disabled={!monthOptions.length}
            >
              {monthOptions.map((month) => (
                <option key={month} value={month}>{fmtMonthLabel(month)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>End</span>
            <select
              value={range.end ?? monthOptions.at(-1) ?? ''}
              onChange={(event) => handleMonthChange('end', event.target.value)}
              disabled={!monthOptions.length}
            >
              {monthOptions.map((month) => (
                <option key={month} value={month}>{fmtMonthLabel(month)}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error && <p className="notice notice-error">Could not load {metric}: {error}</p>}
      {loadingMetric && <p className="notice">Loading {metric}…</p>}

      {!loadingMetric && visibleGroups.length > 0 && monthList.length > 0 && (
        <div className="series-window__body">
          <div className="series-window__chart-wrap">
            <svg
              ref={chartRef}
              viewBox={`0 0 ${width} ${height}`}
              className="series-window__chart"
              role="img"
              aria-label="Monthly time series chart. Move the pointer over the chart to inspect monthly values."
              onPointerMove={handleChartPointerMove}
              onPointerLeave={() => setHoveredMonthIndex(null)}
            >
              {[0, 0.5, 1].map((t) => {
                const value = minY + yRange * t;
                const y = yAt(value);

                return (
                  <g key={t}>
                    <line
                      x1={padding.left}
                      x2={width - padding.right}
                      y1={y}
                      y2={y}
                      className="series-grid-line"
                    />
                    <text
                      x={padding.left - 8}
                      y={y + 4}
                      className="series-axis-label"
                      textAnchor="end"
                    >
                      {formatValue(value, metric)}
                    </text>
                  </g>
                );
              })}

              {visibleGroups.map((group) => {
                const valueMap = valueMaps.get(group.source);
                let path = '';
                let isStarted = false;

                monthList.forEach((month, index) => {
                  const value = valueMap?.get(monthKey(month));

                  if (value === undefined || !Number.isFinite(value)) {
                    isStarted = false;
                    return;
                  }

                  const x = xAt(index, monthList.length);
                  const y = yAt(value);

                  path += isStarted ? ` L ${x} ${y}` : ` M ${x} ${y}`;
                  isStarted = true;
                });

                return (
                  <g key={group.source}>
                    <path
                      d={path.trim()}
                      fill="none"
                      stroke={group.color}
                      strokeWidth="2.25"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      className="series-line"
                    />

                    {monthList.map((month, index) => {
                      const value = valueMap?.get(monthKey(month));
                      if (value === undefined || !Number.isFinite(value)) return null;

                      return (
                        <circle
                          key={`${group.source}-${month}`}
                          cx={xAt(index, monthList.length)}
                          cy={yAt(value)}
                          r={hoveredMonthIndex === index ? 4.5 : 2.2}
                          fill={group.color}
                          className="series-point"
                        />
                      );
                    })}
                  </g>
                );
              })}

              {hoveredMonthIndex !== null && (
                <g className="series-crosshair" pointerEvents="none">
                  <line
                    x1={xAt(hoveredMonthIndex, monthList.length)}
                    x2={xAt(hoveredMonthIndex, monthList.length)}
                    y1={padding.top}
                    y2={height - padding.bottom}
                    className="series-crosshair-line"
                  />
                  {tooltipValues.map(({ source, color, value }) => (
                    <circle
                      key={source}
                      cx={xAt(hoveredMonthIndex, monthList.length)}
                      cy={yAt(value)}
                      r="5"
                      fill={color}
                      className="series-crosshair-marker"
                    />
                  ))}
                </g>
              )}

              {monthList.map((month, index) => {
                const interval = Math.max(1, Math.ceil(monthList.length / 5));
                const shouldLabel =
                  index === 0 ||
                  index === monthList.length - 1 ||
                  index % interval === 0;

                if (!shouldLabel) return null;

                return (
                  <text
                    key={month}
                    x={xAt(index, monthList.length)}
                    y={height - 8}
                    className="series-axis-label series-x-label"
                    textAnchor="middle"
                  >
                    {fmtMonthLabel(month, { month: 'short', year: '2-digit' })}
                  </text>
                );
              })}
            </svg>

            {hoveredMonth && (
              <div
                className="series-chart-tooltip"
                style={{ left: `${tooltipLeft}%` }}
                role="status"
                aria-live="polite"
              >
                <div className="series-chart-tooltip__month">
                  {fmtMonthLabel(hoveredMonth)}
                </div>
                <div className="series-chart-tooltip__metric">
                  {metric === 'frp' ? 'Fire Radiative Power' : 'Detections'}
                </div>
                {tooltipValues.length ? (
                  <div className="series-chart-tooltip__values">
                    {tooltipValues.map(({ source, color, value }) => (
                      <div className="series-chart-tooltip__row" key={source}>
                        <span className="series-chart-tooltip__source">
                          <i style={{ background: color }} />
                          {source}
                        </span>
                        <strong>
                          {formatValue(value, metric)}
                          {metric === 'frp' ? ' MW' : ''}
                        </strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="series-chart-tooltip__empty">
                    No measurements for this month.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {!loadingMetric && visibleGroups.length === 0 && (
        <div className="series-window__empty-chart">
          No data sources selected. Enable a source below to display its series.
        </div>
      )}

      {!loadingMetric && (
        <div className="series-window__legend" aria-label="Data source legend">
          {groups.map((group) => (
            <label key={group.source} className="series-window__legend-item">
              <input
                type="checkbox"
                checked={visibleSources[group.source] !== false}
                onChange={() => handleSourceToggle(group.source)}
              />
              <span
                className="series-swatch"
                style={{ background: group.color }}
                aria-hidden="true"
              />
              <span>{group.source}</span>
            </label>
          ))}
        </div>
      )}

      <div
        className="series-window__resize"
        aria-label="Resize chart window"
        role="presentation"
        onPointerDown={(event) => {
          resizeRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            startWidth: panelSize.width,
            startHeight: panelSize.height,
          };
          event.preventDefault();
        }}
      />
    </div>
  );
}
