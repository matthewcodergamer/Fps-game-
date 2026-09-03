import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const threeWebGPU = fileURLToPath(new URL('./node_modules/three/build/three.webgpu.js', import.meta.url));

export default defineConfig({
  base: './',
  resolve: {
    // Three addons import the bare `three` specifier internally. Route both the
    // bare specifier and explicit `three/webgpu` imports to the same module so
    // V10 does not ship two independent Three runtimes to memory-constrained
    // Safari/WebGPU devices.
    alias: [
      { find: /^three$/, replacement: threeWebGPU },
      { find: /^three\/webgpu$/, replacement: threeWebGPU }
    ]
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1800
  }
});
