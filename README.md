# FireScope frontend

React + Vite + MapLibre map of MODIS and VIIRS wildfire hotspots, fed by the
FireScope backend (FastAPI + PostGIS).

## Run (development)

You need two terminals: one for the backend, one for this app.

**1. Backend**, in the backend folder:
```bash
uvicorn app.main:app --reload
```

**2. Frontend**, in this folder:
```bash
npm install      # first time only
npm run dev
```
Open the address Vite prints (usually http://localhost:5173).

During development, Vite forwards every `/api/...` request to the backend at
`http://127.0.0.1:8000` (see `vite.config.js`), so there is no CORS setup to do.
If the backend runs elsewhere, create a `.env` file here with:
```
BACKEND_URL=http://127.0.0.1:9000
```

## How it gets data

All API calls are in `src/api.js`:

| When | Endpoint | Used for |
|---|---|---|
| On start | `/api/v1/detections/coverage` | Timeline range (first and last year) |
| On start | `/api/v1/detections/timeseries?interval=year` | Hotspot count and total FRP per year and sensor |
| Each year shown | `/api/v1/detections?start_date=…&end_date=…` | The points on the map |

Each year is fetched once and cached; while playing, the next year is
prefetched so the animation does not stall.

## Production build

```bash
npm run build
```
The `dist/` folder has no proxy, so tell it where the API is, and allow the
site's address in the backend's `CORS_ORIGINS`:
```
# .env (frontend), before building
VITE_API_URL=https://api.your-domain.example
```

## Sample data

`make-sample-data.mjs` and `public/fires.geojson` are the old random test
data. The app no longer uses them.
