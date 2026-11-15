import { useEffect, useState } from 'react';

import { fetchHarmonizedCellSeries } from './api';
import { TimeSeriesChart } from './TimeSeriesChart';

const formatCoordinate = (value) => Number(value).toFixed(3);

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

  const handleClose = () => {
    window.close();

    // If the browser does not allow scripts to close this tab,
    // return to the main map.
    window.setTimeout(() => {
      if (!window.closed) {
        const mapUrl = new URL(window.location.href);
        mapUrl.search = '';
        mapUrl.hash = '';
        window.location.replace(mapUrl.toString());
      }
    }, 150);
  };

  if (!validCoordinates) {
    return (
      <main className="chart-page">
        <section className="chart-page__message">
          <h1>Invalid chart location</h1>
          <p>
            The URL does not contain valid latitude and longitude coordinates.
          </p>
          <button type="button" onClick={handleClose}>
            Close
          </button>
        </section>
      </main>
    );
  }

  if (loadingMetric) {
    return (
      <main className="chart-page">
        <section className="chart-page__message" aria-live="polite">
          <h1>Loading monthly series</h1>
          <p>
            Retrieving data for {formatCoordinate(lat)},{' '}
            {formatCoordinate(lon)}…
          </p>
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main className="chart-page">
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

            <button type="button" onClick={handleClose}>
              Close
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="chart-page">
      <TimeSeriesChart
        metric={metric}
        series={series}
        onMetricChange={setMetric}
        loadingMetric={loadingMetric}
        error={error}
        title="Monthly series"
        subtitle={`${formatCoordinate(lat)}, ${formatCoordinate(lon)}`}
        onClose={handleClose}
      />
    </main>
  );
}