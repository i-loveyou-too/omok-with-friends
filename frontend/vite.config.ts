import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/omokwithfriend/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/omokwithfriend/api': 'http://127.0.0.1:8000',
      '/omokwithfriend/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
      },
    },
  },
})

