import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine.js';

const WEBGPU_REQUIRED = 'Project Strike Reboot requires WebGPU. This build intentionally has no hidden WebGL renderer fallback.\n\niPhone: use Safari on iOS 26 or newer (Settings > General > Software Update).\nDesktop: use Chrome or Edge 113+, or Safari 26+.';

/**
 * WebGPU-only engine. Resolution is driven by profile.render.pixelRatio (CSS-pixel multiplier) through the hardware
 * scaling level, which the PerformanceGovernor keeps adjusting at runtime. No snapshot rendering (the scene graph
 * changes every frame), uniform buffers left at the engine default.
 */
export async function createStrikeEngine(canvas, profile) {
  if (typeof navigator === 'undefined' || !navigator.gpu || profile?.webgpu === false) throw new Error(WEBGPU_REQUIRED);
  const msaa = profile?.render?.msaa ?? 1;
  const pixelRatio = profile?.render?.pixelRatio > 0 ? profile.render.pixelRatio : 1;
  const engine = new WebGPUEngine(canvas, {
    antialias: msaa > 1,
    adaptToDeviceRatio: false,
    powerPreference: 'high-performance',
    stencil: true,
  });
  engine.enableOfflineSupport = false;
  try {
    await engine.initAsync();
  } catch (error) {
    try { engine.dispose(); } catch { /* half-initialised engine */ }
    throw new Error(`${WEBGPU_REQUIRED} (${String(error?.message || error)})`);
  }
  engine.setHardwareScalingLevel(1 / pixelRatio); // also resizes the swap chain
  return engine;
}
