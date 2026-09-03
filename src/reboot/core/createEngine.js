import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine.js';

export async function createStrikeEngine(canvas, profile) {
  if (!navigator.gpu) throw new Error('Project Strike Reboot requires WebGPU. This build intentionally has no hidden WebGL renderer fallback.');
  const engine = new WebGPUEngine(canvas, {
    antialias: profile.tier !== 'MOBILE',
    adaptToDeviceRatio: false,
    powerPreference: 'high-performance',
  });
  await engine.initAsync();
  engine.setHardwareScalingLevel(profile.hardwareScale);
  engine.resize();
  return engine;
}
