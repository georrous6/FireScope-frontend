import { useEffect, useMemo, useRef, useState } from 'react';

import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

import {
  buildSeriesGroups,
  filterSeriesForMonthRange,
  getDefaultMonthRange,
} from './seriesUtils';

const monthKey = (value) => String(value ?? '').slice(0, 7);

const MONTH_SELECT_OPTIONS = [
  { value: '01', label: 'Jan' },
  { value: '02', label: 'Feb' },
  { value: '03', label: 'Mar' },
  { value: '04', label: 'Apr' },
  { value: '05', label: 'May' },
  { value: '06', label: 'Jun' },
  { value: '07', label: 'Jul' },
  { value: '08', label: 'Aug' },
  { value: '09', label: 'Sep' },
  { value: '10', label: 'Oct' },
  { value: '11', label: 'Nov' },
  { value: '12', label: 'Dec' },
];

const MONTH_LABEL_BY_VALUE = new Map(
  MONTH_SELECT_OPTIONS.map((option) => [option.value, option.label]),
);

const parseMonthParts = (value) => {
  const key = monthKey(value);
  const match = key.match(/^(\d{4})-(\d{2})$/);

  if (!match) return null;

  return {
    year: match[1],
    month: match[2],
  };
};

const monthListBetween = (startMonth, endMonth) => {
  if (!startMonth || !endMonth) return [];

  const start = new Date(`${startMonth}-01T00:00:00Z`);
  const end = new Date(`${endMonth}-01T00:00:00Z`);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start > end
  ) {
    return [];
  }

  const months = [];
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  );

  while (cursor <= end) {
    months.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return months;
};

const fmtMonthLabel = (
  month,
  options = { month: 'short', year: 'numeric' },
) => {
  if (!month) return '—';

  const date = new Date(`${monthKey(month)}-01T00:00:00Z`);

  return Number.isNaN(date.getTime())
    ? month
    : date.toLocaleDateString('en-US', {
        ...options,
        timeZone: 'UTC',
      });
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

const formatAxisValue = (value, metric) => {
  if (!Number.isFinite(value)) return '';

  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: metric === 'frp' ? 1 : 0,
  }).format(value);
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

    return Array.from(
      new Set(points.map((point) => monthKey(point.month)).filter(Boolean)),
    ).sort();
  }, [series]);

  const defaultRange = useMemo(
    () => getDefaultMonthRange(monthOptions, new Date()),
    [monthOptions],
  );

  const monthsByYear = useMemo(() => {
    const map = new Map();

    for (const option of monthOptions) {
      const parts = parseMonthParts(option);

      if (!parts) continue;

      const bucket = map.get(parts.year) ?? [];

      if (!bucket.includes(parts.month)) {
        bucket.push(parts.month);
      }

      map.set(parts.year, bucket.sort());
    }

    return map;
  }, [monthOptions]);

  const yearOptions = useMemo(
    () => Array.from(monthsByYear.keys()).sort(),
    [monthsByYear],
  );

  const [range, setRange] = useState(defaultRange);
  const [visibleSources, setVisibleSources] = useState({});

  const [panelSize, setPanelSize] = useState({
    width: 640,
    height: 430,
  });

  // Position of the floating chart relative to its original location.
  const [panelPosition, setPanelPosition] = useState({
    x: 0,
    y: 0,
  });

  const [isDragging, setIsDragging] = useState(false);

  const [hoveredMonthIndex, setHoveredMonthIndex] = useState(null);
  const [tooltipLeft, setTooltipLeft] = useState(50);

  const resizeRef = useRef(null);
  const dragRef = useRef(null);

  const chartHostRef = useRef(null);
  const chartInstanceRef = useRef(null);

  // Keep the selected month range valid when new data arrives.
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

  // Initialize visibility for newly available sources.
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
    () =>
      buildSeriesGroups(
        filteredSeries,
        metric === 'frp' ? 'frp_mw' : 'detections',
      ),
    [filteredSeries, metric],
  );

  const visibleGroups = useMemo(
    () => groups.filter((group) => visibleSources[group.source] !== false),
    [groups, visibleSources],
  );

  const monthList = useMemo(
    () => monthListBetween(range.start, range.end),
    [range.start, range.end],
  );

  const valueMaps = useMemo(
    () =>
      new Map(
        groups.map((group) => [
          group.source,
          getPointValueMap(group),
        ]),
      ),
    [groups],
  );

  const hasSeries = Boolean(
    series && Array.isArray(series.points) && series.points.length,
  );

  const hoveredMonth =
    hoveredMonthIndex === null ? null : monthList[hoveredMonthIndex];

  const tooltipValues = hoveredMonth
    ? visibleGroups
        .map((group) => ({
          source: group.source,
          color: group.color,
          value: valueMaps.get(group.source)?.get(monthKey(hoveredMonth)),
        }))
        .filter(
          ({ value }) => value !== undefined && Number.isFinite(value),
        )
    : [];

  const startSelection = useMemo(() => {
    const fallback = monthOptions[0];
    const parts = parseMonthParts(range.start ?? fallback);

    if (parts) return parts;

    const year = yearOptions[0] ?? '';
    const month = monthsByYear.get(year)?.[0] ?? '01';

    return { year, month };
  }, [monthOptions, monthsByYear, range.start, yearOptions]);

  const endSelection = useMemo(() => {
    const fallback = monthOptions.at(-1);
    const parts = parseMonthParts(range.end ?? fallback);

    if (parts) return parts;

    const year = yearOptions.at(-1) ?? '';
    const month = monthsByYear.get(year)?.at(-1) ?? '12';

    return { year, month };
  }, [monthOptions, monthsByYear, range.end, yearOptions]);

  const startMonthOptions = monthsByYear.get(startSelection.year) ?? [];
  const endMonthOptions = monthsByYear.get(endSelection.year) ?? [];

  // Create and manage the uPlot instance.
  useEffect(() => {
    const host = chartHostRef.current;

    if (
      !host ||
      loadingMetric ||
      !visibleGroups.length ||
      !monthList.length
    ) {
      return undefined;
    }

    const xValues = monthList.map((_, index) => index);

    const chartData = [
      xValues,
      ...visibleGroups.map((group) => {
        const valueMap = valueMaps.get(group.source);

        return monthList.map((month) => {
          const value = valueMap?.get(monthKey(month));

          return value !== undefined && Number.isFinite(value)
            ? value
            : null;
        });
      }),
    ];

    const getChartSize = () => ({
      width: Math.max(280, Math.floor(host.clientWidth)),
      height: Math.max(180, Math.floor(host.clientHeight)),
    });

    const initialSize = getChartSize();

    const chartOptions = {
      width: initialSize.width,
      height: initialSize.height,

      class: 'firescope-uplot',

      scales: {
        x: {
          time: false,
          range: () => {
            if (monthList.length <= 1) {
              return [-0.5, 0.5];
            }

            return [0, monthList.length - 1];
          },
        },
        y: {
          auto: true,
        },
      },

      axes: [
        {
          stroke: 'rgba(253, 246, 227, 0.68)',
          grid: {
            show: false,
          },
          ticks: {
            show: false,
          },
          size: 34,
          font: '10px Schibsted Grotesk, sans-serif',
          values: (u, splits) =>
            splits.map((value) => {
              const index = Math.round(value);

              if (index < 0 || index >= monthList.length) return '';

              return fmtMonthLabel(monthList[index], {
                month: 'short',
                year: '2-digit',
              });
            }),
        },
        {
          stroke: 'rgba(253, 246, 227, 0.68)',
          grid: {
            stroke: 'rgba(255, 255, 255, 0.12)',
            width: 1,
            dash: [3, 4],
          },
          ticks: {
            show: false,
          },
          size: 52,
          font: '10px Schibsted Grotesk, sans-serif',
          values: (u, splits) =>
            splits.map((value) => formatAxisValue(value, metric)),
        },
      ],

      series: [
        {
          label: 'Month',
        },
        ...visibleGroups.map((group) => ({
          label: group.source,
          stroke: group.color,
          width: 2.25,
          points: {
            show: false,
            size: 5,
            width: 1,
            stroke: group.color,
            fill: group.color,
          },
          spanGaps: false,
        })),
      ],

      cursor: {
        show: true,
        x: true,
        y: false,

        points: {
          show: true,
          size: 7,
          width: 2,
          stroke: '#1c1511',
          fill: (u, seriesIndex) =>
            visibleGroups[seriesIndex - 1]?.color ?? '#ffeda0',
        },

        drag: {
          x: false,
          y: false,
        },
      },

      legend: {
        show: false,
      },

      hooks: {
        setCursor: [
          (u) => {
            const cursorLeft = u.cursor.left;

            if (!Number.isFinite(cursorLeft)) {
              setHoveredMonthIndex(null);
              return;
            }

            // Convert the cursor position to the closest data index.
            const index = u.posToIdx(cursorLeft, false);

            if (
              index === null ||
              index === undefined ||
              index < 0 ||
              index >= monthList.length
            ) {
              setHoveredMonthIndex(null);
              return;
            }

            // Get the exact position of the selected month.
            const snappedLeft = u.valToPos(index, 'x', false);

            if (!Number.isFinite(snappedLeft)) {
              setHoveredMonthIndex(null);
              return;
            }

            // Update tooltip content for the selected month.
            setHoveredMonthIndex((current) =>
              current === index ? current : index,
            );

            // Position the tooltip relative to the chart plot area.
            const plotWidth = Math.max(u.bbox.width, 1);
            const percentage = (snappedLeft / plotWidth) * 100;

            setTooltipLeft(
              Math.max(5, Math.min(95, percentage)),
            );

            // Snap the vertical cursor to the selected data point.
            if (Math.abs(cursorLeft - snappedLeft) > 0.5) {
              u.setCursor(
                {
                  left: snappedLeft,
                  top: u.cursor.top ?? 0,
                },
                false,
              );
            }
          },
        ],
      },
    };

    const chart = new uPlot(chartOptions, chartData, host);
    chartInstanceRef.current = chart;

    const resizeObserver = new ResizeObserver(() => {
      if (chartInstanceRef.current !== chart) return;

      chart.setSize(getChartSize());
    });

    resizeObserver.observe(host);

    return () => {
      resizeObserver.disconnect();
      chart.destroy();

      if (chartInstanceRef.current === chart) {
        chartInstanceRef.current = null;
      }
    };
  }, [loadingMetric, visibleGroups, monthList, valueMaps, metric]);

  // Handle dragging and resizing of the floating chart window.
  useEffect(() => {
    const handlePointerMove = (event) => {
      // Move the chart window.
      if (dragRef.current) {
        const {
          startX,
          startY,
          initialX,
          initialY,
        } = dragRef.current;

        setPanelPosition({
          x: initialX + (event.clientX - startX),
          y: initialY + (event.clientY - startY),
        });

        return;
      }

      // Resize the chart window.
      if (resizeRef.current) {
        const {
          startX,
          startY,
          startWidth,
          startHeight,
        } = resizeRef.current;

        setPanelSize({
          width: Math.max(
            360,
            startWidth + (event.clientX - startX),
          ),
          height: Math.max(
            300,
            startHeight + (event.clientY - startY),
          ),
        });
      }
    };

    const handlePointerUp = () => {
      resizeRef.current = null;
      dragRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  // Start dragging when the chart header is pressed.
  const handleHeaderPointerDown = (event) => {
    // Do not start dragging when the close button is clicked.
    if (event.target.closest('button')) return;

    // Only respond to the primary mouse button.
    if (event.button !== 0) return;

    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      initialX: panelPosition.x,
      initialY: panelPosition.y,
    };

    setIsDragging(true);

    event.preventDefault();
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
        if (field === 'start') {
          next.end = value;
        } else {
          next.start = value;
        }
      }

      return next;
    });

    setHoveredMonthIndex(null);
  };

  const handleYearPartChange = (field, nextYear) => {
    const isStart = field === 'start';
    const current = isStart ? startSelection : endSelection;
    const months = monthsByYear.get(nextYear) ?? [];

    if (!months.length) return;

    const fallbackMonth = months.includes(current.month)
      ? current.month
      : isStart
        ? months[0]
        : months.at(-1);

    handleMonthChange(field, `${nextYear}-${fallbackMonth}`);
  };

  const handleMonthPartChange = (field, nextMonth) => {
    const current = field === 'start' ? startSelection : endSelection;

    if (!current.year) return;

    handleMonthChange(field, `${current.year}-${nextMonth}`);
  };

  if (!hasSeries) {
    return (
      <div className="series-window series-window--empty">
        <div className="series-window__header">
          <div>
            <div className="series-window__title">{title}</div>
            {subtitle && (
              <div className="series-window__subtitle">{subtitle}</div>
            )}
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

        <p className="notice">
          No monthly series available for this location.
        </p>
      </div>
    );
  }

  return (
    <div
      className="series-window"
      style={{
        width: `${panelSize.width}px`,
        height: `${panelSize.height}px`,
        transform: `translate3d(${panelPosition.x}px, ${panelPosition.y}px, 0)`,
      }}
    >
      <div
        className="series-window__header"
        onPointerDown={handleHeaderPointerDown}
        style={{
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        <div>
          <div className="series-window__title">{title}</div>
          {subtitle && (
            <div className="series-window__subtitle">{subtitle}</div>
          )}
        </div>

        {onClose && (
          <button
            type="button"
            className="series-window__close"
            onClick={onClose}
            aria-label="Close chart"
            style={{
              cursor: 'pointer',
              touchAction: 'auto',
            }}
          >
            ×
          </button>
        )}
      </div>

      <div className="series-window__toolbar">
        <div
          className="segmented point-series-toggle"
          role="group"
          aria-label="Monthly series metric"
        >
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

        <div
          className="series-window__range"
          aria-label="Month range selector"
        >
          <div className="series-window__range-group">
            <span>Start</span>

            <div className="series-window__range-picker">
              <select
                value={startSelection.month}
                onChange={(event) =>
                  handleMonthPartChange('start', event.target.value)
                }
                disabled={!startMonthOptions.length}
                aria-label="Start month"
              >
                {startMonthOptions.map((month) => (
                  <option key={month} value={month}>
                    {MONTH_LABEL_BY_VALUE.get(month) ?? month}
                  </option>
                ))}
              </select>

              <select
                value={startSelection.year}
                onChange={(event) =>
                  handleYearPartChange('start', event.target.value)
                }
                disabled={!yearOptions.length}
                aria-label="Start year"
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="series-window__range-group">
            <span>End</span>

            <div className="series-window__range-picker">
              <select
                value={endSelection.month}
                onChange={(event) =>
                  handleMonthPartChange('end', event.target.value)
                }
                disabled={!endMonthOptions.length}
                aria-label="End month"
              >
                {endMonthOptions.map((month) => (
                  <option key={month} value={month}>
                    {MONTH_LABEL_BY_VALUE.get(month) ?? month}
                  </option>
                ))}
              </select>

              <select
                value={endSelection.year}
                onChange={(event) =>
                  handleYearPartChange('end', event.target.value)
                }
                disabled={!yearOptions.length}
                aria-label="End year"
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <p className="notice notice-error">
          Could not load {metric}: {error}
        </p>
      )}

      {loadingMetric && (
        <p className="notice">Loading {metric}…</p>
      )}

      {!loadingMetric && visibleGroups.length > 0 && monthList.length > 0 && (
        <div className="series-window__body">
          <div className="series-window__chart-wrap">
            <div
              ref={chartHostRef}
              className="series-window__chart"
              role="img"
              aria-label="Monthly time series chart. Move the pointer over the chart to inspect monthly values."
            />

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
                  {metric === 'frp'
                    ? 'Fire Radiative Power'
                    : 'Detections'}
                </div>

                {tooltipValues.length > 0 ? (
                  <div className="series-chart-tooltip__values">
                    {tooltipValues.map(({ source, color, value }) => (
                      <div
                        className="series-chart-tooltip__row"
                        key={source}
                      >
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
          No data sources selected. Enable a source below to display its
          series.
        </div>
      )}

      {!loadingMetric && (
        <div
          className="series-window__legend"
          aria-label="Data source legend"
        >
          {groups.map((group) => (
            <label
              key={group.source}
              className="series-window__legend-item"
            >
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
          event.stopPropagation();
        }}
      />
    </div>
  );
}