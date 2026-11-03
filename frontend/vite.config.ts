import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Three.js (about 150 kB gzipped) is its own lazy chunk: the page and list load first.
    chunkSizeWarningLimit: 700,
  },
})
