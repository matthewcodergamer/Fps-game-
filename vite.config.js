import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  // Havok resolves its .wasm next to its own module; pre-bundling moves the JS into .vite/deps and the wasm 404s.
  optimizeDeps: { exclude: ['@babylonjs/havok'] },
  build: {
    target: 'es2022',
    sourcemap: true,
    assetsInlineLimit: 2048,
    chunkSizeWarningLimit: 1800
  }
});
