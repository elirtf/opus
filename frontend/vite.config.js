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
      '/go2rtc': 'http://localhost:80',
    }
  }
})