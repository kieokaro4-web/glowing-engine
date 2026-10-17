import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const serviceProxy = (target: string, prefix: string, websocket = false) => ({
  target,
  changeOrigin: true,
  secure: false,
  ws: websocket,
  rewrite: (path: string) => path.replace(prefix, ''),
})

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    proxy: {
      '/nhost/graphql': serviceProxy('https://local.graphql.local.nhost.run', '/nhost/graphql', true),
      '/nhost/auth': serviceProxy('https://local.auth.local.nhost.run', '/nhost/auth'),
      '/nhost/storage': serviceProxy('https://local.storage.local.nhost.run', '/nhost/storage'),
      '/nhost/functions': serviceProxy('https://local.functions.local.nhost.run', '/nhost/functions'),
    },
  },
})