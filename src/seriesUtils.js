const PALETTE = [
  '#4f46e5', 
  '#06b6d4', 
  '#f59e0b',
  '#10b981',  
  '#ef4444', 
  '#8b5cf6', 
  '#ec4899', 
  '#14b8a6', 
  '#f97316', 
  '#3b82f6', 
];

const normalizeMonth = (month) => {
  if (!month) return null;
  const value = String(month).slice(0, 7);
  if (!value || value.length < 7) return null;
  const date = new Date(`${value}-01T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : value;
};

const formatMonthKey = (date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};


function getSourceColor(source) {
  // Generate a consistent hash from the source string
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = source.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % PALETTE.length;
  return PALETTE[index];
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

  // Sort sources alphabetically first, then map them to sequential palette colors
  const sortedEntries = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return sortedEntries.map(([source, entries], index) => ({
    source,
    color: PALETTE[index % PALETTE.length], // Guarantees unique colors up to 10 sources
    points: entries
      .map((entry) => ({ month: entry.month, value: entry.value }))
      .sort((a, b) => new Date(a.month) - new Date(b.month)),
  }));
}

export function getDefaultMonthRange(months) {
  const values = Array.from(
    new Set((months ?? []).map((month) => normalizeMonth(month)).filter(Boolean)),
  ).sort();

  // If no months are available, fallback to empty strings
  if (!values.length) {
    return { start: '', end: '' };
  }

  // The last measurement is simply the last item in the sorted array
  const end = values[values.length - 1];

  // Go back 11 months from the last measurement for the start date
  const [year, month] = end.split('-').map(Number);
  const startDate = new Date(Date.UTC(year, month - 1 - 11, 1));
  const start = formatMonthKey(startDate);

  // Ensure start doesn't go further back than the earliest available measurement
  const finalStart = start < values[0] ? values[0] : start;

  return {
    start: finalStart,
    end,
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
