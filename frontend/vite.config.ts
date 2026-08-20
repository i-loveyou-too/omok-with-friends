import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/omok/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/omok/api': 'http://127.0.0.1:8000',
      '/omok/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
      },
    },
  },
})

