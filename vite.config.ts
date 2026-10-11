import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // Relative so the build works under the GitHub Pages project path.
  base: './',
  plugins: [react()],
})
