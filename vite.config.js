import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const webgpuThree = fileURLToPath(new URL('./node_modules/three/build/three.webgpu.js', import.meta.url));

export default defineConfig({
  base: './',
  resolve: {
    // Existing modules and Three.js addons still import bare `three`. Route
    // that exact package specifier to the WebGPU build so the entire runtime
    // shares one object/type universe instead of mixing WebGL and WebGPU builds.
    alias: [
      { find: /^three$/, replacement: webgpuThree }
    ]
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2200
  }
});
