import { WebGPURenderer } from 'three/webgpu';

const INSTALL_KEY = '__PROJECT_STRIKE_WEBGPU_HOTSWAP_GUARD__';

export function installWebGPUHotSwapGuard() {
  if (globalThis[INSTALL_KEY]?.installed) return globalThis[INSTALL_KEY];

  const prototype = WebGPURenderer?.prototype;
  const originalAsync = prototype?.compileAsync;
  const originalSync = prototype?.compile;
  const compiledScenes = new WeakSet();
  const state = {
    installed: Boolean(prototype),
    initialCompiles: 0,
    repeatedCompilesSkipped: 0,
    mode: 'compile-each-scene-once-then-lazy-hot-swap'
  };

  if (prototype && typeof originalAsync === 'function') {
    prototype.compileAsync = async function projectStrikeCompileOnce(scene, camera, ...rest) {
      if (scene && compiledScenes.has(scene)) {
        state.repeatedCompilesSkipped++;
        return;
      }
      const result = await originalAsync.call(this, scene, camera, ...rest);
      if (scene) compiledScenes.add(scene);
      state.initialCompiles++;
      return result;
    };
  }

  if (prototype && typeof originalSync === 'function') {
    prototype.compile = function projectStrikeCompileOnceSync(scene, camera, ...rest) {
      if (scene && compiledScenes.has(scene)) {
        state.repeatedCompilesSkipped++;
        return;
      }
      const result = originalSync.call(this, scene, camera, ...rest);
      if (scene) compiledScenes.add(scene);
      state.initialCompiles++;
      return result;
    };
  }

  globalThis[INSTALL_KEY] = state;
  return state;
}
