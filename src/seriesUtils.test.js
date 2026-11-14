import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSeriesGroups, getSourceColor } from './seriesUtils.js';

test('buildSeriesGroups groups monthly values by source and preserves time order', () => {
  const series = {
    points: [
      { month: '2024-01-01', detections: 4, source: 'VIIRS' },
      { month: '2024-02-01', detections: 7, source: 'MODIS' },
      { month: '2024-03-01', detections: 5, source: 'VIIRS' },
      { month: '2024-04-01', detections: 3, source: 'MODIS' },
    ],
  };

  const groups = buildSeriesGroups(series, 'detections');

  assert.deepEqual(groups.map((group) => group.source), ['VIIRS', 'MODIS']);
  assert.deepEqual(groups[0].points.map((point) => point.value), [4, 5]);
  assert.deepEqual(groups[1].points.map((point) => point.value), [7, 3]);
});

test('getSourceColor gives stable colors by source name', () => {
  assert.equal(getSourceColor('MODIS'), '#f59e0b');
  assert.equal(getSourceColor('VIIRS'), '#60a5fa');
  assert.equal(getSourceColor('VIIRS S-NPP'), '#60a5fa');
  assert.equal(getSourceColor('Unknown source'), '#a78bfa');
});
