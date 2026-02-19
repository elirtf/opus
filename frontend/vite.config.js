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
      '/api': 'http://localhost:5000',
      '/go2rtc': 'http://localhost:80',
    }
  }
})