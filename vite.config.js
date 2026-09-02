import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Para GitHub Pages: cambiar 'bea-estimaciones-app' por el nombre de tu repositorio de GitHub
export default defineConfig({
  plugins: [react()],
  base: '/bea-estimaciones-app/',
})
