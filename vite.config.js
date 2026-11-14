import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Where the FastAPI backend runs during development.
  // 127.0.0.1 (not "localhost") avoids Windows resolving to IPv6 ::1,
  // which uvicorn does not listen on by default.
  const backend = env.BACKEND_URL || 'http://127.0.0.1:8000'

  return {
    plugins: [react()],
    server: {
      // Requests to /api/... are forwarded to the backend, so the browser
      // only ever talks to the Vite dev server (no CORS needed).
      proxy: {
        '/api': { target: backend, changeOrigin: true },
      },
    },
  }
})
