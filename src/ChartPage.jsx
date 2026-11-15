import { useEffect, useState } from 'react';

import {
  fetchHarmonizedCellForecast,
  fetchHarmonizedCellSeries,
} from './api';
import { TimeSeriesChart } from './TimeSeriesChart';

const formatCoordinate = (value) => Number(value).toFixed(3);
const FORECAST_SOURCE = 'Forecast';

const monthKey = (value) => String(value ?? '').slice(0, 7);

const getMonthSpanInclusive = (startMonth, endMonth) => {
  const start = new Date(`${monthKey(startMonth)}-01T00:00:00Z`);
  const end = new Date(`${monthKey(endMonth)}-01T00:00:00Z`);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start > end
  ) {
    return 0;
  }

  return (
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth()) +
    1
  );
};

export function ChartPage() {
  const params = new URLSearchParams(window.location.search);

  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));

  const validCoordinates =
    params.get('lat') !== null &&
    params.get('lon') !== null &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180;

  const [metric, setMetric] = useState('detections');
  const [series, setSeries] = useState(null);
  const [loadingMetric, setLoadingMetric] = useState('detections');
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!validCoordinates) return undefined;

    const controller = new AbortController();

    setLoadingMetric(metric);
    setError(null);
    setSeries(null);

    fetchHarmonizedCellSeries(lat, lon, metric, controller.signal)
      .then((data) => {
        setSeries(data);
        setLoadingMetric(null);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;

        setError(err.message);
        setLoadingMetric(null);
      });

    return () => controller.abort();
  }, [lat, lon, metric, retryCount, validCoordinates]);

  const handleRunForecast = async ({
    metric: selectedMetric,
    startMonth,
    endMonth,
  }) => {
    const horizon = getMonthSpanInclusive(startMonth, endMonth);

    if (!horizon) {
      throw new Error('Invalid forecast month range.');
    }

    const response = await fetchHarmonizedCellForecast(
      lat,
      lon,
      selectedMetric,
      Math.min(12, Math.max(1, horizon)),
    );

    const forecastPoints = Array.isArray(response?.forecast)
      ? response.forecast
          .filter((point) => {
            const month = monthKey(point?.month);

            return (
              month &&
              month >= monthKey(startMonth) &&
              month <= monthKey(endMonth)
            );
          })
          .map((point) => ({
            month: point.month,
            source: FORECAST_SOURCE,

            detections:
              selectedMetric === 'detections'
                ? Number(point.value)
                : null,

            frp_mw:
              selectedMetric === 'frp'
                ? Number(point.value)
                : null,

            // Preserve the forecast confidence interval.
            lower_bound:
              point.lower_bound == null
                ? null
                : Number(point.lower_bound),

            upper_bound:
              point.upper_bound == null
                ? null
                : Number(point.upper_bound),
          }))
      : [];

    if (!forecastPoints.length) {
      throw new Error('Forecast service returned no points.');
    }

    setSeries((current) => {
      const existingPoints = Array.isArray(current?.points)
        ? current.points
        : [];

      // Keep historical data and replace any previous forecast.
      const pointsWithoutForecast = existingPoints.filter(
        (point) => String(point?.source ?? '') !== FORECAST_SOURCE,
      );

      return {
        ...(current ?? {}),
        gx: response?.gx ?? current?.gx,
        gy: response?.gy ?? current?.gy,
        lat: response?.lat ?? current?.lat,
        lon: response?.lon ?? current?.lon,
        points: [...pointsWithoutForecast, ...forecastPoints],
      };
    });
  };

  if (!validCoordinates) {
    return (
      <main className="chart-page">
        <section className="chart-page__message">
          <h1>Invalid chart location</h1>
          <p>
            The URL does not contain valid latitude and longitude coordinates.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="chart-page">
      {loadingMetric && (
        <section className="chart-page__message" aria-live="polite">
          <h1>Loading monthly series</h1>
          <p>
            Retrieving data for {formatCoordinate(lat)},{' '}
            {formatCoordinate(lon)}…
          </p>
        </section>
      )}

      {error && (
        <section className="chart-page__message" role="alert">
          <h1>Could not load monthly series</h1>
          <p>{error}</p>

          <div className="chart-page__actions">
            <button
              type="button"
              onClick={() => setRetryCount((count) => count + 1)}
            >
              Retry
            </button>
          </div>
        </section>
      )}

      {!loadingMetric && !error && series && (
        <TimeSeriesChart
          metric={metric}
          series={series}
          onMetricChange={setMetric}
          onRunForecast={handleRunForecast}
          loadingMetric={loadingMetric}
          error={error}
          title="Monthly series"
          subtitle={`${formatCoordinate(lat)}, ${formatCoordinate(lon)}`}
        />
      )}
    </main>
  );
}