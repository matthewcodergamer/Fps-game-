import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

const MODEL_EXT = /\.([a-z0-9]+)(?:[?#].*)?$/i;

function extensionOf(url) {
  return String(url).match(MODEL_EXT)?.[1]?.toLowerCase() || '';
}

function runtimeUrl(url) {
  const value = String(url || '');
  if (
    globalThis.__PROJECT_STRIKE_SOURCE_MODE__ &&
    (value.startsWith('./game-assets/') || value.startsWith('game-assets/'))
  ) {
    return value.startsWith('./')
      ? value.replace('./game-assets/', './public/game-assets/')
      : value.replace('game-assets/', 'public/game-assets/');
  }
  return value;
}

function cloneMaterial(material, anisotropy) {
  const next = material.clone();
  for (const key of ['map', 'emissiveMap']) {
    if (!next[key]) continue;
    next[key].colorSpace = THREE.SRGBColorSpace;
    next[key].anisotropy = anisotropy;
  }
  for (const key of ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
    if (next[key]) next[key].anisotropy = anisotropy;
  }
  if ('envMapIntensity' in next) next.envMapIntensity = Math.max(.7, next.envMapIntensity || 1);
  next.needsUpdate = true;
  return next;
}

function timeoutError(url, timeoutMs) {
  const error = new Error(`Timed out after ${Math.round(timeoutMs / 100) / 10}s while loading ${url}`);
  error.name = 'AssetTimeoutError';
  return error;
}

/**
 * Runtime translation layer for repository models.
 *
 * Production assets use GLB, while FBX is supported for source inspection and
 * development fallbacks. Both paths return the same normalized asset contract.
 * Every network/model wait is bounded so one broken response cannot hold the
 * entire boot screen forever.
 */
export class AssetManager {
  constructor(renderer, { onProgress = null, timeoutMs = 7000 } = {}) {
    this.renderer = renderer;
    this.onProgress = onProgress;
    this.timeoutMs = timeoutMs;
    this.cache = new Map();
    this.gltf = new GLTFLoader();
    this.gltf.setMeshoptDecoder(MeshoptDecoder);
    this.fbx = new FBXLoader();
    this.anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
  }

  withTimeout(promise, url, timeoutMs = this.timeoutMs) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
    let timer = 0;
    const guard = new Promise((_, reject) => {
      timer = setTimeout(() => reject(timeoutError(url, timeoutMs)), timeoutMs);
    });
    return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
  }

  async parseModel(url, { timeoutMs = this.timeoutMs } = {}) {
    const ext = extensionOf(url);
    this.onProgress?.({ type: 'model', url, state: 'loading' });
    let asset;
    if (ext === 'glb' || ext === 'gltf') {
      const pending = this.gltf.loadAsync(url, event => {
        this.onProgress?.({ type: 'model', url, state: 'loading', loaded: event.loaded, total: event.total || 0 });
      });
      const gltf = await this.withTimeout(pending, url, timeoutMs);
      asset = { ...gltf, scene: gltf.scene, animations: gltf.animations || [], format: ext };
    } else if (ext === 'fbx') {
      const pending = this.fbx.loadAsync(url, event => {
        this.onProgress?.({ type: 'model', url, state: 'loading', loaded: event.loaded, total: event.total || 0 });
      });
      const scene = await this.withTimeout(pending, url, timeoutMs);
      asset = { scene, animations: scene.animations || [], format: 'fbx', parser: null };
    } else {
      throw new Error(`Unsupported model format for ${url}. Expected GLB, glTF, or FBX.`);
    }

    const report = this.inspect(asset.scene, asset.animations);
    if (!report.meshes) throw new Error(`Model contains no renderable meshes: ${url}`);
    this.onProgress?.({ type: 'model', url, state: 'ready', report });
    return { ...asset, url, report };
  }

  inspect(root, animations = []) {
    const materials = new Set();
    let meshes = 0;
    let skinnedMeshes = 0;
    let bones = 0;
    let triangles = 0;
    root.traverse(node => {
      if (node.isBone) bones++;
      if (!node.isMesh) return;
      meshes++;
      if (node.isSkinnedMesh) skinnedMeshes++;
      const geometry = node.geometry;
      triangles += geometry?.index ? geometry.index.count / 3 : (geometry?.attributes?.position?.count || 0) / 3;
      for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
        if (material) materials.add(material.uuid);
      }
    });
    const bounds = new THREE.Box3().setFromObject(root);
    return {
      meshes,
      skinnedMeshes,
      bones,
      materials: materials.size,
      animations: animations.length,
      triangles: Math.round(triangles),
      bounds: bounds.isEmpty() ? null : {
        min: bounds.min.toArray(),
        max: bounds.max.toArray(),
        size: bounds.getSize(new THREE.Vector3()).toArray()
      }
    };
  }

  prepare(root, { world = false } = {}) {
    root.traverse(node => {
      if (!node.isMesh) return;
      node.frustumCulled = world;
      node.castShadow = world;
      node.receiveShadow = world;
      if (Array.isArray(node.material)) node.material = node.material.map(m => cloneMaterial(m, this.anisotropy));
      else if (node.material) node.material = cloneMaterial(node.material, this.anisotropy);
    });
    return root;
  }

  async loadModel(url, { clone = false, world = false, timeoutMs = this.timeoutMs } = {}) {
    const resolvedUrl = runtimeUrl(url);
    if (!this.cache.has(resolvedUrl)) {
      const pending = this.parseModel(resolvedUrl, { timeoutMs }).catch(error => {
        this.cache.delete(resolvedUrl);
        this.onProgress?.({ type: 'model', url: resolvedUrl, state: 'error', error });
        throw error;
      });
      this.cache.set(resolvedUrl, pending);
    }
    const source = await this.withTimeout(this.cache.get(resolvedUrl), resolvedUrl, timeoutMs);
    if (!clone) return source;
    const scene = this.prepare(skeletonClone(source.scene), { world });
    return { ...source, scene, animations: source.animations.map(clip => clip.clone()) };
  }

  async loadFirst(candidates, options = {}) {
    const errors = [];
    for (const url of candidates.filter(Boolean)) {
      try {
        return await this.loadModel(url, options);
      } catch (error) {
        errors.push(`${url}: ${error.message}`);
      }
    }
    throw new Error(`No model candidate loaded. ${errors.join(' | ')}`);
  }

  loadGLB(url, options = {}) {
    return this.loadModel(url, options);
  }

  async loadJSON(url, { timeoutMs = this.timeoutMs } = {}) {
    const resolvedUrl = runtimeUrl(url);
    if (!this.cache.has(resolvedUrl)) {
      const pending = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(timeoutError(resolvedUrl, timeoutMs)), timeoutMs);
        try {
          const response = await fetch(resolvedUrl, { cache: 'no-cache', signal: controller.signal });
          if (!response.ok) throw new Error(`${response.status} ${resolvedUrl}`);
          return response.json();
        } finally {
          clearTimeout(timer);
        }
      })().catch(error => {
        this.cache.delete(resolvedUrl);
        throw error;
      });
      this.cache.set(resolvedUrl, pending);
    }
    return this.withTimeout(this.cache.get(resolvedUrl), resolvedUrl, timeoutMs);
  }

  dispose() {
    this.cache.clear();
  }
}
