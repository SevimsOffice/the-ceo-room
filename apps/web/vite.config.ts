import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages project site: https://sevimsoffice.github.io/the-ceo-room/
export default defineConfig({
  base: '/the-ceo-room/',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: false },
  preview: { port: 4173, strictPort: true },
});
