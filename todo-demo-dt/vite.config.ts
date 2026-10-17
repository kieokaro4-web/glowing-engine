import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/items': {
        target: 'http://127.0.0.1:8055',
        changeOrigin: true,
      },
      '/websocket': {
        target: 'ws://127.0.0.1:8055',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
