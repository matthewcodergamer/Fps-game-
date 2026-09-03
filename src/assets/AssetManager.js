import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

const MODEL_EXT = /\.([a-z0-9]+)(?:[?#].*)?$/i;
const IOS_DEVICE = /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
const COARSE_POINTER = matchMedia('(any-pointer: coarse)').matches;
const MEMORY_SAFE = Boolean(IOS_DEVICE || COARSE_POINTER);

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

function clampProgress(event = {}) {
  const total = Number(event.total || 0);
  const loaded = Number(event.loaded || 0);
  if (!total) return { ...event, loaded };
  return { ...event, loaded: Math.min(loaded, total), total };
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
  if ('envMapIntensity' in next) next.envMapIntensity = Math.max(.72, next.envMapIntensity || 1);
  next.needsUpdate = true;
  return next;
}

function prepareSharedMaterial(material, anisotropy) {
  if (!material) return material;
  for (const key of ['map', 'emissiveMap']) {
    if (!material[key]) continue;
    material[key].colorSpace = THREE.SRGBColorSpace;
    material[key].anisotropy = anisotropy;
  }
  for (const key of ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
    if (material[key]) material[key].anisotropy = anisotropy;
  }
  if ('envMapIntensity' in material) material.envMapIntensity = Math.max(.66, material.envMapIntensity || 1);
  material.needsUpdate = true;
  return material;
}

function timeoutError(url, timeoutMs) {
  const error = new Error(`Timed out after ${Math.round(timeoutMs / 100) / 10}s while loading ${url}`);
  error.name = 'AssetTimeoutError';
  return error;
}

/**
 * Strict real-asset translation layer.
 *
 * V10 does not substitute procedural geometry when a GLB fails. On iPhone and
 * coarse-pointer devices, all model parses are serialized so Safari never has
 * several GLTFLoader decode graphs + image uploads peaking in memory together.
 */
export class AssetManager {
  constructor(renderer, { onProgress = null, timeoutMs = 45000 } = {}) {
    this.renderer = renderer;
    this.onProgress = onProgress;
    this.timeoutMs = MEMORY_SAFE ? Math.max(timeoutMs, 45000) : Math.max(timeoutMs, 20000);
    this.cache = new Map();
    this.gltf = new GLTFLoader();
    this.gltf.setMeshoptDecoder(MeshoptDecoder);
    this.fbx = new FBXLoader();
    this.anisotropy = Math.min(
      MEMORY_SAFE ? 2 : 8,
      renderer?.getMaxAnisotropy?.() || renderer?.capabilities?.getMaxAnisotropy?.() || 1
    );
    this.decodeTail = Promise.resolve();
    this.activeDecodes = 0;
    this.peakDecodes = 0;

    globalThis.__PROJECT_STRIKE_ASSET_MANAGER__ = {
      strictRealAssets: true,
      modelFallbacks: false,
      serializedDecoding: MEMORY_SAFE,
      maxConcurrentModelDecodes: MEMORY_SAFE ? 1 : null,
      activeDecodes: 0,
      peakDecodes: 0
    };
  }

  progress(event) {
    this.onProgress?.(clampProgress(event));
  }

  withTimeout(promise, url, timeoutMs = this.timeoutMs) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
    let timer = 0;
    const guard = new Promise((_, reject) => {
      timer = setTimeout(() => reject(timeoutError(url, timeoutMs)), timeoutMs);
    });
    return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
  }

  queueDecode(task) {
    if (!MEMORY_SAFE) return task();
    const run = this.decodeTail.then(async () => {
      this.activeDecodes++;
      this.peakDecodes = Math.max(this.peakDecodes, this.activeDecodes);
      if (globalThis.__PROJECT_STRIKE_ASSET_MANAGER__) {
        globalThis.__PROJECT_STRIKE_ASSET_MANAGER__.activeDecodes = this.activeDecodes;
        globalThis.__PROJECT_STRIKE_ASSET_MANAGER__.peakDecodes = this.peakDecodes;
      }
      try {
        // Yield once before each expensive GLB parse/upload so WebKit can retire
        // the previous frame's temporary GPU resources.
        await new Promise(resolve => requestAnimationFrame(() => resolve()));
        return await task();
      } finally {
        this.activeDecodes--;
        if (globalThis.__PROJECT_STRIKE_ASSET_MANAGER__) {
          globalThis.__PROJECT_STRIKE_ASSET_MANAGER__.activeDecodes = this.activeDecodes;
        }
      }
    });
    this.decodeTail = run.catch(() => {});
    return run;
  }

  async parseModel(url, { timeoutMs = this.timeoutMs } = {}) {
    const ext = extensionOf(url);
    this.progress({ type: 'model', url, state: 'loading' });
    let asset;

    if (ext === 'glb' || ext === 'gltf') {
      const pending = this.gltf.loadAsync(url, event => {
        this.progress({ type: 'model', url, state: 'loading', loaded: event.loaded, total: event.total || 0 });
      });
      const gltf = await this.withTimeout(pending, url, timeoutMs);
      asset = { ...gltf, scene: gltf.scene, animations: gltf.animations || [], format: ext };
    } else if (ext === 'fbx') {
      const pending = this.fbx.loadAsync(url, event => {
        this.progress({ type: 'model', url, state: 'loading', loaded: event.loaded, total: event.total || 0 });
      });
      const scene = await this.withTimeout(pending, url, timeoutMs);
      asset = { scene, animations: scene.animations || [], format: 'fbx', parser: null };
    } else {
      throw new Error(`Unsupported model format for ${url}. Expected GLB, glTF, or FBX.`);
    }

    const report = this.inspect(asset.scene, asset.animations);
    if (!report.meshes) throw new Error(`Model contains no renderable meshes: ${url}`);
    this.progress({ type: 'model', url, state: 'ready', report });
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
      triangles += geometry?.index
        ? geometry.index.count / 3
        : (geometry?.attributes?.position?.count || 0) / 3;
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
      node.castShadow = world && !MEMORY_SAFE;
      node.receiveShadow = world;
      if (MEMORY_SAFE) {
        if (Array.isArray(node.material)) node.material = node.material.map(m => prepareSharedMaterial(m, this.anisotropy));
        else if (node.material) node.material = prepareSharedMaterial(node.material, this.anisotropy);
      } else if (Array.isArray(node.material)) {
        node.material = node.material.map(m => cloneMaterial(m, this.anisotropy));
      } else if (node.material) {
        node.material = cloneMaterial(node.material, this.anisotropy);
      }
    });
    return root;
  }

  async loadModel(url, { clone = false, world = false, timeoutMs = this.timeoutMs } = {}) {
    const resolvedUrl = runtimeUrl(url);

    if (!this.cache.has(resolvedUrl)) {
      const pending = this.queueDecode(() => this.parseModel(resolvedUrl, { timeoutMs })).catch(error => {
        this.cache.delete(resolvedUrl);
        this.progress({ type: 'model', url: resolvedUrl, state: 'error', error });
        throw error;
      });
      this.cache.set(resolvedUrl, pending);
    }

    const source = await this.withTimeout(this.cache.get(resolvedUrl), resolvedUrl, timeoutMs);
    if (!clone) return source;

    const scene = this.prepare(skeletonClone(source.scene), { world });
    const result = {
      ...source,
      scene,
      animations: source.animations.map(clip => clip.clone())
    };

    if (MEMORY_SAFE) {
      // Keep only the live clone. The decoded source graph must not remain a
      // permanent second copy in Safari's JS heap/GPU resource graph.
      this.cache.delete(resolvedUrl);
    }
    return result;
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
    throw new Error(`No real model candidate loaded. ${errors.join(' | ')}`);
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
