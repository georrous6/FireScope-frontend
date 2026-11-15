import { useEffect, useMemo, useRef, useState } from 'react';

import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

import {
  buildSeriesGroups,
  filterSeriesForMonthRange,
  getDefaultMonthRange,
} from './seriesUtils';

const FORECAST_SOURCE = 'Forecast';
const FORECAST_MONTH_COUNT = 12;

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

const COLOR_STOPS = [
  { position: 0, color: '#fdf6e3' },
  { position: 0.33, color: '#ffeda0' },
  { position: 0.66, color: '#feb24c' },
  { position: 1, color: '#f03b20' },
];

const parseMonthParts = (value) => {
  const key = monthKey(value);
  const match = key.match(/^(\d{4})-(\d{2})$/);

  if (!match) return null;

  return {
    year: match[1],
    month: match[2],
  };
};

const shiftMonth = (value, offset) => {
  const parts = parseMonthParts(value);

  if (!parts) return null;

  const date = new Date(
    Date.UTC(Number(parts.year), Number(parts.month) - 1 + offset, 1),
  );

  return date.toISOString().slice(0, 7);
};

const monthListBetween = (startMonth, endMonth) => {
  if (!startMonth || !endMonth) return [];

  const start = new Date(`${monthKey(startMonth)}-01T00:00:00Z`);
  const end = new Date(`${monthKey(endMonth)}-01T00:00:00Z`);

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

const buildMonthsByYear = (months) => {
  const map = new Map();

  for (const month of months) {
    const parts = parseMonthParts(month);

    if (!parts) continue;

    const bucket = map.get(parts.year) ?? [];

    if (!bucket.includes(parts.month)) {
      bucket.push(parts.month);
    }

    map.set(parts.year, bucket.sort());
  }

  return map;
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

/*
 * Maps each forecast month to its lower and upper prediction bounds.
 */
const getForecastMetadataMap = (points) =>
  new Map(
    points
      .filter(
        (point) =>
          String(point?.source ?? '') === FORECAST_SOURCE,
      )
      .map((point) => [
        monthKey(point.month),
        {
          lowerBound:
            point.lower_bound == null ||
            !Number.isFinite(Number(point.lower_bound))
              ? null
              : Number(point.lower_bound),

          upperBound:
            point.upper_bound == null ||
            !Number.isFinite(Number(point.upper_bound))
              ? null
              : Number(point.upper_bound),
        },
      ]),
  );

const formatAxisValue = (value, metric) => {
  if (!Number.isFinite(value)) return '';

  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: metric === 'frp' ? 1 : 0,
  }).format(value);
};

const hexToRgb = (hex) => ({
  r: Number.parseInt(hex.slice(1, 3), 16),
  g: Number.parseInt(hex.slice(3, 5), 16),
  b: Number.parseInt(hex.slice(5, 7), 16),
});

const rgbToHex = ({ r, g, b }) =>
  `#${[r, g, b]
    .map((value) =>
      Math.round(value).toString(16).padStart(2, '0'),
    )
    .join('')}`;

const interpolateColor = (start, end, amount) => {
  const a = hexToRgb(start);
  const b = hexToRgb(end);

  return rgbToHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  });
};

const getMetricColor = (value, min, max) => {
  if (!Number.isFinite(value)) return 'transparent';

  const normalized =
    max === min
      ? 0.5
      : Math.max(0, Math.min(1, (value - min) / (max - min)));

  for (let index = 0; index < COLOR_STOPS.length - 1; index += 1) {
    const current = COLOR_STOPS[index];
    const next = COLOR_STOPS[index + 1];

    if (
      normalized >= current.position &&
      normalized <= next.position
    ) {
      const amount =
        (normalized - current.position) /
        (next.position - current.position);

      return interpolateColor(current.color, next.color, amount);
    }
  }

  return COLOR_STOPS.at(-1).color;
};

export function TimeSeriesChart({
  metric,
  series,
  onMetricChange,
  onRunForecast,
  loadingMetric,
  error,
  title = 'Monthly series',
  subtitle,
}) {
  const metricKey = metric === 'frp' ? 'frp_mw' : 'detections';

  const rawPoints = Array.isArray(series?.points) ? series.points : [];

  const historicalPoints = useMemo(
    () =>
      rawPoints.filter(
        (point) =>
          String(point?.source ?? '') !== FORECAST_SOURCE,
      ),
    [rawPoints],
  );

  const forecastPoints = useMemo(
    () =>
      rawPoints.filter(
        (point) =>
          String(point?.source ?? '') === FORECAST_SOURCE,
      ),
    [rawPoints],
  );

  const monthOptions = useMemo(
    () =>
      Array.from(
        new Set(
          historicalPoints
            .map((point) => monthKey(point.month))
            .filter((month) => parseMonthParts(month)),
        ),
      ).sort(),
    [historicalPoints],
  );

  const defaultRange = useMemo(
    () => getDefaultMonthRange(monthOptions),
    [monthOptions],
  );

  const monthsByYear = useMemo(
    () => buildMonthsByYear(monthOptions),
    [monthOptions],
  );

  const yearOptions = useMemo(
    () => Array.from(monthsByYear.keys()).sort(),
    [monthsByYear],
  );

  const forecastStartMonth = useMemo(() => {
    if (!monthOptions.length) return null;

    const observedMonths = new Set(
      historicalPoints
        .filter((point) => {
          const value = point?.[metricKey];

          return (
            value !== null &&
            value !== undefined &&
            value !== '' &&
            Number.isFinite(Number(value))
          );
        })
        .map((point) => monthKey(point.month))
        .filter((month) => parseMonthParts(month)),
    );

    const historicalMonths = monthListBetween(
      monthOptions[0],
      monthOptions.at(-1),
    ).map(monthKey);

    const firstMissingMonth = historicalMonths.find(
      (month) => !observedMonths.has(month),
    );

    if (firstMissingMonth) return firstMissingMonth;

    return shiftMonth(monthOptions.at(-1), 1);
  }, [historicalPoints, monthOptions, metricKey]);

  const forecastMonthOptions = useMemo(() => {
    if (!forecastStartMonth) return [];

    return Array.from(
      { length: FORECAST_MONTH_COUNT },
      (_, index) => shiftMonth(forecastStartMonth, index),
    ).filter(Boolean);
  }, [forecastStartMonth]);

  const forecastMonthsByYear = useMemo(
    () => buildMonthsByYear(forecastMonthOptions),
    [forecastMonthOptions],
  );

  const forecastYearOptions = useMemo(
    () => Array.from(forecastMonthsByYear.keys()).sort(),
    [forecastMonthsByYear],
  );

  const [range, setRange] = useState(defaultRange);
  const [forecastEndMonth, setForecastEndMonth] = useState(null);
  const [forecastEndYear, setForecastEndYear] = useState('');
  const [forecastRequestError, setForecastRequestError] = useState('');
  const [isForecasting, setIsForecasting] = useState(false);

  const [visibleSources, setVisibleSources] = useState({});
  const [timeMode, setTimeMode] = useState('history');

  const [hoveredMonthIndex, setHoveredMonthIndex] = useState(null);
  const [tooltipLeft, setTooltipLeft] = useState(50);

  const chartHostRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const previousForecastStartRef = useRef(forecastStartMonth);

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
    if (previousForecastStartRef.current !== forecastStartMonth) {
      setForecastEndMonth(null);
      setForecastEndYear('');
      setForecastRequestError('');
      previousForecastStartRef.current = forecastStartMonth;
    }
  }, [forecastStartMonth]);

  useEffect(() => {
    const sources = Array.from(
      new Set(
        historicalPoints.map((point) =>
          String(point?.source ?? 'Unknown source'),
        ),
      ),
    );

    if (forecastPoints.length) {
      sources.push(FORECAST_SOURCE);
    }

    setVisibleSources((current) => {
      const next = {};

      for (const source of sources) {
        next[source] = current[source] ?? true;
      }

      return next;
    });
  }, [historicalPoints, forecastPoints]);

  const effectiveRange = useMemo(() => {
    if (timeMode === 'forecast') {
      return {
        start: forecastStartMonth,
        end: forecastEndMonth,
      };
    }

    return range;
  }, [timeMode, forecastStartMonth, forecastEndMonth, range]);

  /*
   * History mode displays historical data only.
   * Forecast mode displays forecast data only.
   */
  const displayedSeries = useMemo(() => {
    if (timeMode === 'forecast') {
      return {
        ...(series ?? {}),
        points: forecastPoints,
      };
    }

    return {
      ...(series ?? {}),
      points: historicalPoints,
    };
  }, [series, timeMode, forecastPoints, historicalPoints]);

  const filteredSeries = useMemo(
    () =>
      timeMode === 'forecast'
        ? displayedSeries
        : filterSeriesForMonthRange(
            displayedSeries,
            effectiveRange.start,
            effectiveRange.end,
          ),
    [displayedSeries, timeMode, effectiveRange],
  );

  const groups = useMemo(
    () => buildSeriesGroups(filteredSeries, metricKey),
    [filteredSeries, metricKey],
  );

  const visibleGroups = useMemo(
    () => groups.filter((group) => visibleSources[group.source] !== false),
    [groups, visibleSources],
  );

  const monthList = useMemo(
    () => monthListBetween(effectiveRange.start, effectiveRange.end),
    [effectiveRange.start, effectiveRange.end],
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

  const forecastMetadataMap = useMemo(
    () => getForecastMetadataMap(forecastPoints),
    [forecastPoints],
  );

  const hasSeries = historicalPoints.length > 0;

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

  /*
   * Confidence interval for the currently hovered forecast month.
   */
  const hoveredForecastMetadata =
    timeMode === 'forecast' && hoveredMonth
      ? forecastMetadataMap.get(monthKey(hoveredMonth))
      : null;

  const hasHoveredConfidenceInterval =
    Number.isFinite(hoveredForecastMetadata?.lowerBound) &&
    Number.isFinite(hoveredForecastMetadata?.upperBound);

  const startSelection = useMemo(() => {
    if (timeMode === 'forecast') {
      return (
        parseMonthParts(forecastStartMonth) ?? {
          year: '',
          month: '',
        }
      );
    }

    const fallback = monthOptions[0];
    const parts = parseMonthParts(range.start ?? fallback);

    if (parts) return parts;

    const year = yearOptions[0] ?? '';
    const month = monthsByYear.get(year)?.[0] ?? '01';

    return { year, month };
  }, [
    timeMode,
    forecastStartMonth,
    monthOptions,
    monthsByYear,
    range.start,
    yearOptions,
  ]);

  const endSelection = useMemo(() => {
    if (timeMode === 'forecast') {
      if (forecastEndMonth) {
        return (
          parseMonthParts(forecastEndMonth) ?? {
            year: '',
            month: '',
          }
        );
      }

      return {
        year: forecastEndYear,
        month: '',
      };
    }

    const fallback = monthOptions.at(-1);
    const parts = parseMonthParts(range.end ?? fallback);

    if (parts) return parts;

    const year = yearOptions.at(-1) ?? '';
    const month = monthsByYear.get(year)?.at(-1) ?? '12';

    return { year, month };
  }, [
    timeMode,
    forecastEndMonth,
    forecastEndYear,
    monthOptions,
    monthsByYear,
    range.end,
    yearOptions,
  ]);

  const startMonthOptions =
    timeMode === 'forecast'
      ? forecastMonthsByYear.get(startSelection.year) ?? []
      : monthsByYear.get(startSelection.year) ?? [];

  const endMonthOptions =
    timeMode === 'forecast'
      ? forecastMonthsByYear.get(endSelection.year) ?? []
      : monthsByYear.get(endSelection.year) ?? [];

  const startYearOptions =
    timeMode === 'forecast' ? forecastYearOptions : yearOptions;

  const endYearOptions =
    timeMode === 'forecast' ? forecastYearOptions : yearOptions;

  const canRunForecast = Boolean(
    forecastStartMonth &&
      forecastEndMonth &&
      forecastEndMonth >= forecastStartMonth &&
      forecastMonthOptions.includes(forecastEndMonth) &&
      !isForecasting,
  );

  const calendarEntries = useMemo(() => {
    const allValues = [];

    const entries = monthList
      .map((month) => {
        const values = visibleGroups
          .map((group) => {
            const value = valueMaps.get(group.source)?.get(monthKey(month));

            if (!Number.isFinite(value)) return null;

            allValues.push(value);

            return {
              source: group.source,
              value,
            };
          })
          .filter(Boolean);

        return { month, values };
      })
      .filter((entry) => entry.values.length > 0);

    const min = allValues.length ? Math.min(...allValues) : 0;
    const max = allValues.length ? Math.max(...allValues) : 0;

    return entries
      .map((entry) => ({
        ...entry,
        values: entry.values.map((item) => ({
          ...item,
          color: getMetricColor(item.value, min, max),
        })),
      }))
      .reverse();
  }, [monthList, visibleGroups, valueMaps]);

  /*
   * Build the forecast confidence band.
   * The bounds are aligned to the same month indices as the chart.
   */
  const forecastBand = useMemo(() => {
    if (timeMode !== 'forecast') return [];

    return monthList.map((month) => {
      const metadata = forecastMetadataMap.get(monthKey(month));

      return {
        lower: metadata?.lowerBound ?? null,
        upper: metadata?.upperBound ?? null,
      };
    });
  }, [timeMode, monthList, forecastMetadataMap]);

  /*
   * Create and manage the uPlot instance.
   */
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

    /*
     * Include the lower and upper bounds when determining the
     * Y-axis range. Otherwise, the confidence band could be clipped.
     */
    const chartValues = chartData
      .slice(1)
      .flat()
      .filter(Number.isFinite);

    const boundValues = forecastBand
      .flatMap(({ lower, upper }) => [lower, upper])
      .filter(Number.isFinite);

    const allYValues = [...chartValues, ...boundValues];

    const dataMin = allYValues.length ? Math.min(...allYValues) : 0;
    const dataMax = allYValues.length ? Math.max(...allYValues) : 1;
    const yPadding = (dataMax - dataMin) * 0.08 || 1;

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
          auto: false,
          range: () => [
            dataMin - yPadding,
            dataMax + yPadding,
          ],
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
          width: 2.5,
          dash: timeMode === 'forecast' ? [7, 4] : [],
          points: {
            show: true,
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
        /*
         * Draw the shaded confidence band before the data series.
         * This keeps the forecast line and points visible above it.
         */
        drawClear: [
          (u) => {
            if (timeMode !== 'forecast') return;

            const ctx = u.ctx;
            const bbox = u.bbox;

            ctx.save();

            ctx.beginPath();
            ctx.rect(
              bbox.left,
              bbox.top,
              bbox.width,
              bbox.height,
            );
            ctx.clip();

            let segment = [];

            const drawSegment = () => {
              if (segment.length < 2) {
                segment = [];
                return;
              }

              ctx.beginPath();

              // Trace the upper boundary from left to right.
              segment.forEach((point, index) => {
                const x = u.valToPos(point.index, 'x', true);
                const y = u.valToPos(point.upper, 'y', true);

                if (index === 0) {
                  ctx.moveTo(x, y);
                } else {
                  ctx.lineTo(x, y);
                }
              });

              // Trace the lower boundary from right to left.
              for (let index = segment.length - 1; index >= 0; index -= 1) {
                const point = segment[index];
                const x = u.valToPos(point.index, 'x', true);
                const y = u.valToPos(point.lower, 'y', true);

                ctx.lineTo(x, y);
              }

              ctx.closePath();

              ctx.fillStyle = 'rgba(254, 178, 76, 0.20)';
              ctx.fill();

              // Subtle upper and lower boundary lines.
              ctx.beginPath();

              segment.forEach((point, index) => {
                const x = u.valToPos(point.index, 'x', true);
                const y = u.valToPos(point.upper, 'y', true);

                if (index === 0) {
                  ctx.moveTo(x, y);
                } else {
                  ctx.lineTo(x, y);
                }
              });

              ctx.strokeStyle = 'rgba(254, 178, 76, 0.55)';
              ctx.lineWidth = 1;
              ctx.stroke();

              ctx.beginPath();

              segment.forEach((point, index) => {
                const x = u.valToPos(point.index, 'x', true);
                const y = u.valToPos(point.lower, 'y', true);

                if (index === 0) {
                  ctx.moveTo(x, y);
                } else {
                  ctx.lineTo(x, y);
                }
              });

              ctx.strokeStyle = 'rgba(254, 178, 76, 0.55)';
              ctx.lineWidth = 1;
              ctx.stroke();

              segment = [];
            };

            forecastBand.forEach(({ lower, upper }, index) => {
              if (
                !Number.isFinite(lower) ||
                !Number.isFinite(upper)
              ) {
                drawSegment();
                return;
              }

              segment.push({
                index,
                lower,
                upper,
              });
            });

            drawSegment();

            ctx.restore();
          },
        ],

        setCursor: [
          (u) => {
            const cursorLeft = u.cursor.left;

            if (!Number.isFinite(cursorLeft)) {
              setHoveredMonthIndex(null);
              return;
            }

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

            const snappedLeft = u.valToPos(index, 'x', false);

            if (!Number.isFinite(snappedLeft)) {
              setHoveredMonthIndex(null);
              return;
            }

            setHoveredMonthIndex((current) =>
              current === index ? current : index,
            );

            const plotWidth = Math.max(u.bbox.width, 1);
            const percentage = (snappedLeft / plotWidth) * 100;

            setTooltipLeft(
              Math.max(5, Math.min(95, percentage)),
            );

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
  }, [
    loadingMetric,
    visibleGroups,
    monthList,
    valueMaps,
    metric,
    timeMode,
    forecastBand,
  ]);

  const handleSourceToggle = (source) => {
    setVisibleSources((current) => ({
      ...current,
      [source]: !(current[source] ?? true),
    }));

    setHoveredMonthIndex(null);
  };

  const handleMonthChange = (field, value) => {
    if (timeMode === 'forecast') {
      if (field === 'end') {
        setForecastEndMonth(value);
        setForecastRequestError('');
      }

      setHoveredMonthIndex(null);
      return;
    }

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

    if (timeMode === 'forecast' && field === 'end') {
      setForecastEndYear(nextYear);
      setForecastEndMonth(null);
      setForecastRequestError('');
      setHoveredMonthIndex(null);
      return;
    }

    const monthMap =
      timeMode === 'forecast' ? forecastMonthsByYear : monthsByYear;

    const months = monthMap.get(nextYear) ?? [];

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

  const handleRunForecast = async () => {
    if (!canRunForecast) return;

    setForecastRequestError('');
    setHoveredMonthIndex(null);

    if (typeof onRunForecast !== 'function') {
      setForecastRequestError(
        'Forecast request handler is not configured.',
      );
      return;
    }

    setIsForecasting(true);

    try {
      await onRunForecast({
        metric,
        startMonth: forecastStartMonth,
        endMonth: forecastEndMonth,
      });
    } catch (requestError) {
      setForecastRequestError(
        requestError?.message || 'Could not generate the forecast.',
      );
    } finally {
      setIsForecasting(false);
    }
  };

  if (!hasSeries) {
    return (
      <section className="series-window series-window--empty">
        <div className="series-window__header">
          <div>
            <div className="series-window__title">{title}</div>
            {subtitle && (
              <div className="series-window__subtitle">{subtitle}</div>
            )}
          </div>
        </div>

        <p className="notice">
          No monthly series available for this location.
        </p>
      </section>
    );
  }

  const switchStyle = {
    display: 'flex',
    width: '180px',
    minWidth: '180px',
    maxWidth: '180px',
  };

  const switchButtonStyle = {
    flex: '1 1 0',
    width: '50%',
    minWidth: 0,
    padding: '6px 8px',
    fontSize: '12px',
    whiteSpace: 'nowrap',
    textAlign: 'center',
  };

  const toolbarStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '16px',
    width: '100%',
    flexWrap: 'wrap',
  };

  const switchesContainerStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '6px',
    flex: '0 0 auto',
  };

  const rangeContainerStyle = {
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'flex-end',
    gap: '8px',
    flex: '0 0 auto',
    marginLeft: 'auto',
  };

  const rangeGroupStyle = {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    flex: '0 0 auto',
    width: 'fit-content',
    minWidth: 0,
    padding: '7px 9px',
    boxSizing: 'border-box',
  };

  const forecastButtonStyle = {
    alignSelf: 'stretch',
    boxSizing: 'border-box',
    padding: '7px 16px',
    minWidth: '64px',
    fontSize: '12px',
    fontWeight: 700,
    color: '#ffffff',
    backgroundColor: canRunForecast ? '#2e9d50' : '#246b3b',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '10px',
    cursor: canRunForecast ? 'pointer' : 'not-allowed',
    opacity: canRunForecast ? 1 : 0.55,
    transition: 'background-color 150ms ease, opacity 150ms ease',
  };

  return (
    <section className="series-window series-window--fullscreen">
      <style>
        {`
          @keyframes firescope-forecast-spin {
            to {
              transform: rotate(360deg);
            }
          }

          @keyframes firescope-forecast-pulse {
            0%, 100% {
              opacity: 0.55;
            }
            50% {
              opacity: 1;
            }
          }

          .firescope-forecast-loading {
            position: absolute;
            inset: 0;
            z-index: 10;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 14px;
            background: rgba(18, 15, 13, 0.82);
            backdrop-filter: blur(4px);
            border-radius: 10px;
            color: #fdf6e3;
          }

          .firescope-forecast-spinner {
            width: 38px;
            height: 38px;
            border: 3px solid rgba(253, 246, 227, 0.2);
            border-top-color: #feb24c;
            border-radius: 50%;
            animation: firescope-forecast-spin 0.8s linear infinite;
          }

          .firescope-forecast-loading-text {
            font-size: 13px;
            font-weight: 600;
            letter-spacing: 0.02em;
            animation: firescope-forecast-pulse 1.5s ease-in-out infinite;
          }
        `}
      </style>

      <div className="series-window__main">
        <div className="series-window__header">
          <div>
            <div className="series-window__title">{title}</div>
            {subtitle && (
              <div className="series-window__subtitle">{subtitle}</div>
            )}
          </div>
        </div>

        <div
          className="series-window__toolbar"
          style={toolbarStyle}
        >
          <div
            className="series-window__toolbar-switches"
            style={switchesContainerStyle}
          >
            <div
              className="segmented point-series-toggle"
              role="group"
              aria-label="Time period"
              style={switchStyle}
            >
              <button
                type="button"
                className={timeMode === 'history' ? 'is-active' : ''}
                aria-pressed={timeMode === 'history'}
                onClick={() => {
                  setTimeMode('history');
                  setForecastRequestError('');
                  setHoveredMonthIndex(null);
                }}
                style={switchButtonStyle}
              >
                History
              </button>

              <button
                type="button"
                className={timeMode === 'forecast' ? 'is-active' : ''}
                aria-pressed={timeMode === 'forecast'}
                onClick={() => {
                  setTimeMode('forecast');
                  setForecastRequestError('');
                  setHoveredMonthIndex(null);
                }}
                style={switchButtonStyle}
                disabled={!forecastStartMonth}
              >
                Forecast
              </button>
            </div>

            <div
              className="segmented point-series-toggle"
              role="group"
              aria-label="Monthly series metric"
              style={switchStyle}
            >
              <button
                type="button"
                className={metric === 'detections' ? 'is-active' : ''}
                aria-pressed={metric === 'detections'}
                onClick={() => {
                  onMetricChange?.('detections');
                  setForecastEndMonth(null);
                  setForecastEndYear('');
                  setForecastRequestError('');
                  setHoveredMonthIndex(null);
                }}
                style={switchButtonStyle}
              >
                Detections
              </button>

              <button
                type="button"
                className={metric === 'frp' ? 'is-active' : ''}
                aria-pressed={metric === 'frp'}
                onClick={() => {
                  onMetricChange?.('frp');
                  setForecastEndMonth(null);
                  setForecastEndYear('');
                  setForecastRequestError('');
                  setHoveredMonthIndex(null);
                }}
                style={switchButtonStyle}
              >
                FRP
              </button>
            </div>
          </div>

          <div
            className="series-window__range"
            aria-label="Month range selector"
            style={rangeContainerStyle}
          >
            <div
              className="series-window__range-group"
              style={rangeGroupStyle}
            >
              <span>Start</span>

              <div className="series-window__range-picker">
                <select
                  value={startSelection.month}
                  onChange={(event) =>
                    handleMonthPartChange('start', event.target.value)
                  }
                  disabled={
                    timeMode === 'forecast' || !startMonthOptions.length
                  }
                  aria-label="Start month"
                  aria-readonly={timeMode === 'forecast'}
                  style={{
                    width: '62px',
                    minWidth: 0,
                    ...(timeMode === 'forecast'
                      ? { opacity: 0.65, cursor: 'not-allowed' }
                      : {}),
                  }}
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
                  disabled={
                    timeMode === 'forecast' || !startYearOptions.length
                  }
                  aria-label="Start year"
                  aria-readonly={timeMode === 'forecast'}
                  style={{
                    width: '68px',
                    minWidth: 0,
                    ...(timeMode === 'forecast'
                      ? { opacity: 0.65, cursor: 'not-allowed' }
                      : {}),
                  }}
                >
                  {startYearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div
              className="series-window__range-group"
              style={rangeGroupStyle}
            >
              <span>End</span>

              <div className="series-window__range-picker">
                <select
                  value={endSelection.month}
                  onChange={(event) =>
                    handleMonthPartChange('end', event.target.value)
                  }
                  disabled={
                    timeMode === 'forecast'
                      ? !endSelection.year
                      : !endMonthOptions.length
                  }
                  aria-label="End month"
                  style={{ width: '62px', minWidth: 0 }}
                >
                  {timeMode === 'forecast' && (
                    <option value="">Month</option>
                  )}

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
                  disabled={!endYearOptions.length}
                  aria-label="End year"
                  style={{ width: '68px', minWidth: 0 }}
                >
                  {timeMode === 'forecast' && (
                    <option value="">Year</option>
                  )}

                  {endYearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {timeMode === 'forecast' && (
              <button
                type="button"
                className="series-window__forecast-button"
                onClick={handleRunForecast}
                disabled={!canRunForecast}
                style={forecastButtonStyle}
              >
                {isForecasting ? 'Running…' : 'GO'}
              </button>
            )}
          </div>
        </div>

        {timeMode === 'forecast' && forecastRequestError && (
          <p className="notice notice-error">
            {forecastRequestError}
          </p>
        )}

        {error && (
          <p className="notice notice-error">
            Could not load {metric}: {error}
          </p>
        )}

        {loadingMetric && (
          <p className="notice">Loading {metric}…</p>
        )}

        {!loadingMetric && monthList.length > 0 && (
          <div className="series-window__body">
            <div
              className="series-window__chart-wrap"
              style={{ position: 'relative' }}
            >
              <div
                ref={chartHostRef}
                className="series-window__chart"
                role="img"
                aria-label={
                  timeMode === 'forecast'
                    ? 'Forecast chart with shaded prediction interval. Move the pointer over the chart to inspect predicted monthly values.'
                    : 'Historical time series chart. Move the pointer over the chart to inspect monthly values.'
                }
              />

              {isForecasting && (
                <div
                  className="firescope-forecast-loading"
                  role="status"
                  aria-live="polite"
                >
                  <div className="firescope-forecast-spinner" />
                  <div className="firescope-forecast-loading-text">
                    Generating forecast…
                  </div>
                </div>
              )}

              {hoveredMonth && !isForecasting && (
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

                  {hasHoveredConfidenceInterval && (
                    <div
                      className="series-chart-tooltip__confidence"
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '3px',
                        marginTop: '7px',
                        paddingTop: '6px',
                        borderTop: '1px solid rgba(253, 246, 227, 0.12)',
                        color: 'rgba(253, 246, 227, 0.58)',
                        fontSize: '10px',
                        fontWeight: 400,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: '16px',
                        }}
                      >
                        <span>Lower bound</span>
                        <span>
                          {formatValue(
                            hoveredForecastMetadata.lowerBound,
                            metric,
                          )}
                          {metric === 'frp' ? ' MW' : ''}
                        </span>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: '16px',
                        }}
                      >
                        <span>Upper bound</span>
                        <span>
                          {formatValue(
                            hoveredForecastMetadata.upperBound,
                            metric,
                          )}
                          {metric === 'frp' ? ' MW' : ''}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {!loadingMetric &&
          timeMode === 'forecast' &&
          !forecastEndMonth && (
            <div className="series-window__empty-chart">
              Select an end month and press GO to generate a forecast.
            </div>
          )}

        {!loadingMetric &&
          timeMode === 'forecast' &&
          forecastEndMonth &&
          !forecastPoints.length &&
          !isForecasting &&
          !forecastRequestError && (
            <div className="series-window__empty-chart">
              No forecast available yet. Press GO to generate a forecast.
            </div>
          )}

        {!loadingMetric &&
          visibleGroups.length === 0 &&
          !(timeMode === 'forecast' && !forecastEndMonth) &&
          !(timeMode === 'forecast' && isForecasting) && (
            <div className="series-window__empty-chart">
              {timeMode === 'forecast'
                ? 'No forecast points available for the selected period.'
                : 'No data sources selected. Enable a source in the legend to display its series.'}
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
      </div>

      <aside className="series-sidebar">
        <header className="series-sidebar__header">
          <div className="series-sidebar__title">Monthly values</div>

          <div className="series-sidebar__subtitle">
            {metric === 'frp'
              ? 'Fire Radiative Power (MW)'
              : 'Detections'}
          </div>
        </header>

        <div className="series-sidebar__scale">
          <span>Lowest</span>

          <div className="series-sidebar__scale-bar" />

          <span>Highest</span>
        </div>

        <div className="series-sidebar__list">
          {calendarEntries.map((entry) => (
            <section
              className="series-sidebar__month"
              key={entry.month}
            >
              <h3 className="series-sidebar__month-title">
                {fmtMonthLabel(entry.month)}
              </h3>

              <div className="series-sidebar__values">
                {entry.values.map((item) => (
                  <div
                    className="series-sidebar__value"
                    key={item.source}
                    style={{ backgroundColor: item.color }}
                    title={`${item.source}: ${formatValue(item.value, metric)}`}
                  >
                    <span className="series-sidebar__source">
                      {item.source}
                    </span>

                    <strong className="series-sidebar__number">
                      {formatValue(item.value, metric)}
                      {metric === 'frp' ? ' MW' : ''}
                    </strong>
                  </div>
                ))}
              </div>
            </section>
          ))}

          {calendarEntries.length === 0 && (
            <div className="series-sidebar__empty-list">
              {timeMode === 'forecast'
                ? 'No forecast values for the selected date range.'
                : 'No measurements for the selected sources and date range.'}
            </div>
          )}
        </div>
      </aside>
    </section>
  );
}