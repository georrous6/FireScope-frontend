export const SOURCE_COLORS = {
  MODIS: '#f59e0b',
  VIIRS: '#60a5fa',
  DEFAULT: '#a78bfa',
};

const normalizeMonth = (month) => {
  if (!month) return null;
  const value = String(month).slice(0, 7);
  if (!value || value.length < 7) return null;
  const date = new Date(`${value}-01T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : value;
};

const formatMonthKey = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10);

export function getSourceColor(source) {
  const value = String(source ?? 'Unknown source').toUpperCase();
  if (value.includes('VIIRS')) return SOURCE_COLORS.VIIRS;
  if (value.includes('MODIS')) return SOURCE_COLORS.MODIS;
  return SOURCE_COLORS.DEFAULT;
}

export function getDefaultMonthRange(months, today = new Date()) {
  const values = Array.from(
    new Set((months ?? []).map((month) => normalizeMonth(month)).filter(Boolean)),
  ).sort();

  if (!values.length) {
    const date = new Date(today);
    date.setUTCDate(1);
    date.setUTCHours(0, 0, 0, 0);
    return {
      start: formatMonthKey(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 11, 1))),
      end: formatMonthKey(date),
    };
  }

  const reference = new Date(today);
  reference.setUTCDate(1);
  reference.setUTCHours(0, 0, 0, 0);

  const endDate = new Date(reference);
  const startDate = new Date(reference);
  startDate.setUTCMonth(startDate.getUTCMonth() - 11);

  return {
    start: formatMonthKey(startDate),
    end: formatMonthKey(endDate),
  };
}

export function filterSeriesForMonthRange(series, startMonth, endMonth) {
  const points = Array.isArray(series?.points) ? series.points : [];
  if (!startMonth || !endMonth) return series;

  const rawStart = normalizeMonth(startMonth);
  const rawEnd = normalizeMonth(endMonth);
  if (!rawStart || !rawEnd) return series;

  const startKey = rawStart < rawEnd ? rawStart : rawEnd;
  const endKey = rawStart < rawEnd ? rawEnd : rawStart;

  const filtered = points.filter((point) => {
    const pointKey = normalizeMonth(point?.month);
    return pointKey && pointKey >= startKey && pointKey <= endKey;
  });

  return {
    ...series,
    points: filtered.sort((a, b) => new Date(a.month) - new Date(b.month)),
  };
}

export function buildSeriesGroups(series, valueKey = 'detections') {
  const points = Array.isArray(series?.points) ? series.points : [];
  const groups = new Map();

  for (const point of points) {
    const source = String(point?.source ?? 'Unknown source');
    const entry = groups.get(source) ?? [];
    entry.push({
      month: point.month,
      value: Number(point?.[valueKey] ?? 0),
    });
    groups.set(source, entry);
  }

  return [...groups.entries()]
    .map(([source, entries]) => ({
      source,
      color: getSourceColor(source),
      points: entries
        .map((entry) => ({ month: entry.month, value: entry.value }))
        .sort((a, b) => new Date(a.month) - new Date(b.month)),
    }))
    .sort((a, b) => a.source.localeCompare(b.source));
}
