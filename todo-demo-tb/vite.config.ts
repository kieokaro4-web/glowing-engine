import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// TrailBase serves its REST records + realtime API under /api/* on port 4000.
// The browser talks to Vite on 5175 (same-origin) and Vite forwards /api to
// TrailBase, mirroring the Supabase (/rest/v1) and Nhost (/nhost/*) demos.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5175,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          // Realtime uses a long-lived text/event-stream response. Disable
          // proxy-side buffering/timeouts so SSE frames flush straight through.
          proxy.on('proxyReq', (proxyReq) => proxyReq.setHeader('X-Accel-Buffering', 'no'))
        },
      },
    },
  },
})
