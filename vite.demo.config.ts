import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Single-bundle build of the editor only, used for the hosted demo page.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'demo-dist', chunkSizeWarningLimit: 1200, modulePreload: false, rollupOptions: { output: { inlineDynamicImports: true } } },
});
