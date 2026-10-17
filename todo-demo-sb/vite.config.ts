import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/rest/v1': {
        target: 'http://127.0.0.1:54321',
        changeOrigin: true,
      },
      '/auth/v1': {
        target: 'http://127.0.0.1:54321',
        changeOrigin: true,
      },
      '/storage/v1': {
        target: 'http://127.0.0.1:54321',
        changeOrigin: true,
      },
      '/functions/v1': {
        target: 'http://127.0.0.1:54321',
        changeOrigin: true,
      },
      '/realtime/v1': {
        target: 'ws://127.0.0.1:54321',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})