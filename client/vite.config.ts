import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { medicareServiceWorker } from './pwa/build.ts'

export default defineConfig({
  plugins: [react(), medicareServiceWorker()],

  server: {
    port: 5173,
    strictPort: true,

    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: false,
        secure: false,
      },
    },
  },
})
