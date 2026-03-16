import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.WEBMUX_PROXY_TARGET || 'http://127.0.0.1:4317',
        changeOrigin: true,
        secure: true,
      },
      '/ws': {
        target: (process.env.WEBMUX_PROXY_TARGET || 'http://127.0.0.1:4317').replace('https://', 'wss://').replace('http://', 'ws://'),
        ws: true,
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
