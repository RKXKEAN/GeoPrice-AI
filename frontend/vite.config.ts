import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  optimizeDeps: {
    include: [
      'leaflet',
      'leaflet-draw',
      'react-leaflet',
      '@react-leaflet/core',
      '@turf/turf',
    ],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: [
      'laptop-7uu9pl8q.tail3654bb.ts.net',
      '.ts.net',
    ],
    proxy: {
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
        ws: true,
      },
    },
    watch: {
      usePolling: true,
      interval: 300,
    },
  }
})
