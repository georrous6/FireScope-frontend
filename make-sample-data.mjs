// Generates public/fires.geojson with random test data over Greece.
// Run from the project root:  node make-sample-data.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const CLUSTERS = [
  [23.7, 38.0], [22.5, 38.7], [22.9, 40.6], [21.7, 37.7], [25.1, 35.3], [24.0, 39.0],
];

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pad = (n) => String(n).padStart(2, '0');

const features = [];
let id = 1;

for (let year = 2000; year <= 2026; year++) {
  const perYear = Math.round(rand(60, 220));
  for (let i = 0; i < perYear; i++) {
    const [cx, cy] = pick(CLUSTERS);
    const harmonized = Math.random() < 0.5;
    const frp = Math.min(900, Math.exp(rand(0.8, 5.2))); // skewed: mostly low, a few huge
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [+(cx + rand(-0.9, 0.9)).toFixed(4), +(cy + rand(-0.7, 0.7)).toFixed(4)],
      },
      properties: {
        id: id++,
        frp: +frp.toFixed(1),
        brightness: +rand(310, 400).toFixed(1),
        acq_date: `${year}-${pad(Math.floor(rand(6, 10)))}-${pad(Math.floor(rand(1, 28)))}`,
        year,
        sensor: harmonized ? 'HARMONIZED_375M' : 'MODIS_RAW',
        confidence: Math.floor(rand(30, 100)),
      },
    });
  }
}

mkdirSync('public', { recursive: true });
writeFileSync('public/fires.geojson', JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`Wrote public/fires.geojson with ${features.length} features`);
