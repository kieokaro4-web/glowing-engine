import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Appwrite's Traefik gateway routes by hostname, so the proxied request must
// present Host: localhost (matching _APP_DOMAIN) to reach the API. Both the
// REST calls (/v1/tablesdb/...) and the Realtime WebSocket (/v1/realtime) share
// the /v1 prefix, so one ws-enabled proxy entry covers them and keeps the
// browser same-origin (no CORS, cookies scoped to localhost).
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5175,
    strictPort: true,
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:80',
        changeOrigin: false,
        secure: false,
        ws: true,
        headers: { host: 'localhost' },
      },
    },
  },
})
