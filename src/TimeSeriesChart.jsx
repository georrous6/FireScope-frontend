import { useEffect, useMemo, useRef, useState } from 'react';

import { buildSeriesGroups, filterSeriesForMonthRange, getDefaultMonthRange } from './seriesUtils';

const monthKey = (value) => String(value ?? '').slice(0, 7);

const monthListBetween = (startMonth, endMonth) => {
  if (!startMonth || !endMonth) return [];

  const start = new Date(`${startMonth}T00:00:00Z`);
  const end = new Date(`${endMonth}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  const months = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));

  while (cursor <= end) {
    months.push(new Date(cursor).toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return months;
};

const fmtMonthLabel = (month) => {
  if (!month) return '—';
  const date = new Date(`${month}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? month
    : date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};

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
    const months = points.map((point) => monthKey(point.month)).filter(Boolean);
    return Array.from(new Set(months)).sort();
  }, [series]);

  const defaultRange = useMemo(() => getDefaultMonthRange(monthOptions, new Date()), [monthOptions]);
  const [range, setRange] = useState(defaultRange);
  const [visibleSources, setVisibleSources] = useState({});
  const [panelSize, setPanelSize] = useState({ width: 560, height: 300 });
  const resizeRef = useRef(null);

  useEffect(() => {
    if (!monthOptions.length) return;
    setRange((current) => {
      if (current?.start && current?.end) return current;
      return defaultRange;
    });
  }, [defaultRange, monthOptions]);

  useEffect(() => {
    const sources = Array.from(
      new Set((series?.points ?? []).map((point) => String(point?.source ?? 'Unknown source'))),
    );

    setVisibleSources((current) => {
      const next = { ...current };
      for (const source of sources) {
        next[source] ??= true;
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

  const visibleGroups = groups.filter((group) => visibleSources[group.source] !== false);
  const monthList = useMemo(() => monthListBetween(range.start, range.end), [range.start, range.end]);

  const allValues = useMemo(
    () =>
      visibleGroups.flatMap((group) => {
        const valueMap = new Map(group.points.map((point) => [monthKey(point.month), Number(point.value)]));
        return monthList
          .map((month) => valueMap.get(monthKey(month)))
          .filter((val) => val !== undefined && !Number.isNaN(val));
      }),
    [monthList, visibleGroups],
  );

  const width = panelSize.width;
  const height = panelSize.height - 112;
  const minY = Math.min(0, ...(allValues.length ? allValues : [0]));
  const maxY = Math.max(...(allValues.length ? allValues : [1]), 1);
  const yRange = Math.max(maxY - minY, 1);
  const padding = 22;

  const xAt = (index, total) => {
    if (total <= 1) return padding + (width - padding * 2) / 2;
    return padding + (index / (total - 1)) * (width - padding * 2);
  };

  const yAt = (value) => height - padding - ((value - minY) / yRange) * (height - padding * 2);

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

  const handleSourceToggle = (source) => {
    setVisibleSources((current) => ({
      ...current,
      [source]: !(current[source] ?? true),
    }));
  };

  const handleMonthChange = (field, value) => {
    setRange((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const hasSeries = Boolean(series && Array.isArray(series.points) && series.points.length);

  if (!hasSeries) {
    return (
      <div className="series-window series-window--empty">
        <div className="series-window__header">
          <div>
            <div className="series-window__title">{title}</div>
            {subtitle && <div className="series-window__subtitle">{subtitle}</div>}
          </div>
          {onClose && (
            <button type="button" className="series-window__close" onClick={onClose} aria-label="Close chart">
              ×
            </button>
          )}
        </div>
        <p className="notice">No monthly series available for this location.</p>
      </div>
    );
  }

  return (
    <div className="series-window" style={{ width: `${panelSize.width}px`, height: `${panelSize.height}px` }}>
      <div className="series-window__header">
        <div>
          <div className="series-window__title">{title}</div>
          {subtitle && <div className="series-window__subtitle">{subtitle}</div>}
        </div>
        {onClose && (
          <button type="button" className="series-window__close" onClick={onClose} aria-label="Close chart">
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
            onClick={() => onMetricChange?.('detections')}
          >
            Detections
          </button>
          <button
            type="button"
            className={metric === 'frp' ? 'is-active' : ''}
            aria-pressed={metric === 'frp'}
            onClick={() => onMetricChange?.('frp')}
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
                <option key={month} value={month}>
                  {fmtMonthLabel(month)}
                </option>
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
                <option key={month} value={month}>
                  {fmtMonthLabel(month)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error && <p className="notice notice-error">Could not load {metric}: {error}</p>}
      {loadingMetric && <p className="notice">Loading {metric}…</p>}

      {!loadingMetric && visibleGroups.length > 0 && (
        <div className="series-window__body">
          <svg viewBox={`0 0 ${width} ${height}`} className="series-window__chart" role="img" aria-label="Monthly time series chart">
            {[0, 0.5, 1].map((t) => {
              const value = minY + yRange * t;
              const y = yAt(value);
              return (
                <g key={t}>
                  <line x1={padding} x2={width - padding} y1={y} y2={y} stroke="rgba(255,255,255,0.12)" strokeDasharray="3 4" />
                  <text x={4} y={y + 4} fontSize="9" fill="rgba(253,246,227,0.7)" textAnchor="start">
                    {Math.round(value)}
                  </text>
                </g>
              );
            })}

            {visibleGroups.map((group) => {
              const valueMap = new Map(group.points.map((point) => [monthKey(point.month), Number(point.value)]));
              
              let d = '';
              let isStarted = false;

              monthList.forEach((month, index) => {
                const value = valueMap.get(monthKey(month));
                
                if (value === undefined || Number.isNaN(value)) {
                  isStarted = false; // Break the path if data is missing for this month
                  return;
                }

                const x = xAt(index, monthList.length || 1);
                const y = yAt(value);

                if (!isStarted) {
                  d += ` M ${x} ${y}`;
                  isStarted = true;
                } else {
                  d += ` L ${x} ${y}`;
                }
              });

              return (
                <path
                  key={group.source}
                  d={d.trim()}
                  fill="none"
                  stroke={group.color}
                  strokeWidth="2.25"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              );
            })}

            {monthList.length > 0 && (
              <g>
                {monthList.map((month, index) => {
                  const shouldLabel = index === 0 || index === monthList.length - 1 || index % Math.ceil(monthList.length / 4) === 0;
                  if (!shouldLabel) return null;
                  const x = xAt(index, monthList.length || 1);
                  return (
                    <text key={month} x={x} y={height - 4} fontSize="9" fill="rgba(253,246,227,0.7)" textAnchor="middle">
                      {fmtMonthLabel(month).split(' ')[0]}
                    </text>
                  );
                })}
              </g>
            )}
          </svg>
        </div>
      )}

      {!loadingMetric && (
        <div className="series-window__legend" aria-label="Data source legend">
          {groups.map((group) => (
            <label key={group.source} className="series-window__legend-item">
              <input type="checkbox" checked={visibleSources[group.source] !== false} onChange={() => handleSourceToggle(group.source)} />
              <span className="series-swatch" style={{ background: group.color }} aria-hidden="true" />
              <span>{group.source}</span>
            </label>
          ))}
        </div>
      )}

      <div
        className="series-window__resize"
        aria-label="Resize chart window"
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