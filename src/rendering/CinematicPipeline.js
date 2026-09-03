import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

/**
 * V10 WebGPU-only cinematic pipeline.
 *
 * Mobile intentionally renders the PBR scene directly to keep the iPhone 11
 * memory budget predictable. Desktop uses Three.js' native WebGPU/TSL bloom
 * stack. There is no WebGL EffectComposer and no recovery/fallback renderer.
 */
export function createCinematicPipeline(renderer, scene, camera, {
  mobile = false,
  viewModel = null
} = {}) {
  if (!renderer?.isWebGPURenderer || renderer.coordinateSystem !== THREE.WebGPUCoordinateSystem) {
    throw new Error('Project Strike V10 requires a real WebGPU renderer.');
  }

  let renderPipeline = null;
  let bloomPass = null;
  let mode = 'WebGPU direct PBR · mobile';

  if (!mobile) {
    renderPipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    const sceneColor = scenePass.getTextureNode('output');
    bloomPass = bloom(sceneColor);
    bloomPass.threshold.value = .88;
    bloomPass.strength.value = .24;
    bloomPass.radius.value = .42;
    renderPipeline.outputNode = sceneColor.add(bloomPass);
    mode = 'WebGPU PBR + TSL bloom';
  }

  function renderWorld() {
    if (renderPipeline) renderPipeline.render();
    else renderer.render(scene, camera);
  }

  function renderViewModel() {
    if (!viewModel) return;
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    // Renderer.clear(color, depth, stencil) is part of the common WebGPU
    // renderer interface. Clear only depth so foreground arms/weapon remain
    // crisp without erasing the world color buffer.
    renderer.clear(false, true, false);
    viewModel.render(renderer);
    renderer.autoClear = oldAutoClear;
  }

  return {
    mode,
    backend: 'WebGPU',
    bloom: Boolean(bloomPass),
    render() {
      renderWorld();
      renderViewModel();
    },
    resize() {
      // WebGPU RenderPipeline tracks renderer output size; renderer.setSize()
      // is the authoritative resize operation.
    },
    dispose() {
      renderPipeline?.dispose?.();
    }
  };
}
