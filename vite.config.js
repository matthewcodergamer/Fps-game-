import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    assetsInlineLimit: 2048,
    chunkSizeWarningLimit: 1800
  }
});
