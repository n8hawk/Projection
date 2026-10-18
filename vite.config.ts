import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        output: resolve(__dirname, 'output.html'),
      },
    },
  },
});
