import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/**
 * Stable WebGL post-processing with a direct-render recovery path.
 *
 * The previous WebGPU/MRT graph could fail before the first frame on desktop.
 * This pipeline always has a verified WebGL render path and renders the weapon
 * scene after clearing world depth so the gun and hands remain visible.
 */
export function createCinematicPipeline(renderer, scene, camera, {
  mobile = false,
  viewModel = null,
  onFallback = null
} = {}) {
  let composer = null;
  let failed = false;
  let mode = mobile ? 'direct PBR · mobile' : 'direct PBR';

  if (!mobile) {
    try {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .28, .48, .9);
      bloom.threshold = .9;
      bloom.strength = .28;
      bloom.radius = .48;
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      mode = 'PBR + restrained neon bloom';
    } catch (error) {
      composer = null;
      failed = true;
      mode = 'direct PBR · recovered';
      onFallback?.(error);
    }
  }

  function renderWorld() {
    if (!composer || failed) {
      renderer.render(scene, camera);
      return;
    }
    try {
      composer.render();
    } catch (error) {
      failed = true;
      mode = 'direct PBR · runtime recovery';
      try { composer.dispose(); } catch {}
      composer = null;
      onFallback?.(error);
      renderer.render(scene, camera);
    }
  }

  function renderViewModel() {
    if (!viewModel) return;
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    viewModel.render(renderer);
    renderer.autoClear = oldAutoClear;
  }

  return {
    get mode() { return mode; },
    get failed() { return failed; },
    render() {
      renderWorld();
      renderViewModel();
    },
    resize(width, height, pixelRatio = 1) {
      if (!composer || failed) return;
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
    },
    dispose() {
      try { composer?.dispose(); } catch {}
    }
  };
}
