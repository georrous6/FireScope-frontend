export const SOURCE_COLORS = {
  MODIS: '#f59e0b',
  VIIRS: '#60a5fa',
  DEFAULT: '#a78bfa',
};

export function getSourceColor(source) {
  const value = String(source ?? 'Unknown source').toUpperCase();
  if (value.includes('VIIRS')) return SOURCE_COLORS.VIIRS;
  if (value.includes('MODIS')) return SOURCE_COLORS.MODIS;
  return SOURCE_COLORS.DEFAULT;
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
