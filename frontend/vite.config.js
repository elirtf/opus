import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    // During local dev, proxy API calls to Flask
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        timeout: 600_000, // discovery scans can run for minutes
      },
      // Match nginx: strip /go2rtc prefix and forward to go2rtc API (split dev: compose publishes :1984)
      '/go2rtc': {
        target: 'http://localhost:1984',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/go2rtc/, '') || '/',
      },
    }
  }
})