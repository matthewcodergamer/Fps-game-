import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

const MODEL_EXT = /\.([a-z0-9]+)(?:[?#].*)?$/i;
const IOS_DEVICE = /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
const COARSE_POINTER = matchMedia('(any-pointer: coarse)').matches;
const MEMORY_SAFE = Boolean(globalThis.__PROJECT_STRIKE_MOBILE_SAFE__ || (IOS_DEVICE && COARSE_POINTER));
const TEXTURE_KEYS = [
  'map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
  'alphaMap', 'bumpMap', 'displacementMap', 'lightMap', 'clearcoatMap',
  'clearcoatNormalMap', 'clearcoatRoughnessMap', 'sheenColorMap',
  'sheenRoughnessMap', 'specularColorMap', 'specularIntensityMap',
  'transmissionMap', 'thicknessMap', 'iridescenceMap', 'iridescenceThicknessMap'
];

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

function configureTexture(texture, anisotropy, { color = false, mobile = false } = {}) {
  if (!texture?.isTexture) return;
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  if (mobile) {
    // Do not ask WebGPU to generate mip chains on memory-constrained mobile
    // devices. Besides reducing transient GPU memory, this avoids the newer
    // texture-view swizzle mipmap path that is not implemented consistently by
    // every Safari/Chromium WebGPU backend yet. This changes filtering only;
    // the real source texture and real 3D model remain authoritative.
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
  }
  texture.needsUpdate = true;
}

function cloneMaterial(material, anisotropy) {
  const next = material.clone();
  for (const key of TEXTURE_KEYS) {
    configureTexture(next[key], anisotropy, { color: key === 'map' || key === 'emissiveMap' });
  }
  if ('envMapIntensity' in next) next.envMapIntensity = Math.max(.7, next.envMapIntensity || 1);
  next.needsUpdate = true;
  return next;
}

function prepareSharedMaterial(material, anisotropy) {
  if (!material) return material;
  for (const key of TEXTURE_KEYS) {
    configureTexture(material[key], anisotropy, {
      color: key === 'map' || key === 'emissiveMap',
      mobile: true
    });
  }
  if ('envMapIntensity' in material) material.envMapIntensity = Math.max(.62, material.envMapIntensity || 1);
  material.needsUpdate = true;
  return material;
}

function timeoutError(url, timeoutMs) {
  const error = new Error(`Timed out after ${Math.round(timeoutMs / 100) / 10}s while loading ${url}`);
  error.name = 'AssetTimeoutError';
  return error;
}

/**
 * Runtime translation layer for repository models.
 *
 * On memory-constrained iOS devices cloned source GLBs are treated as transient:
 * the clone remains alive in the world/viewmodel, but the decoded source graph is
 * evicted from the loader cache so Safari does not keep both copies reachable.
 */
export class AssetManager {
  constructor(renderer, { onProgress = null, timeoutMs = 7000 } = {}) {
    this.renderer = renderer;
    this.onProgress = onProgress;
    this.timeoutMs = MEMORY_SAFE ? Math.min(timeoutMs, 6000) : timeoutMs;
    this.cache = new Map();
    this.gltf = new GLTFLoader();
    this.gltf.setMeshoptDecoder(MeshoptDecoder);
    this.fbx = new FBXLoader();
    this.anisotropy = Math.min(MEMORY_SAFE ? 2 : 8, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
  }

  progress(event) {
    const next = clampProgress(event);
    const optional = /\/grenades\/|\/attachments\//i.test(String(next.url || ''));
    if (globalThis.__PROJECT_STRIKE_CORE_READY__ && optional && next.state === 'loading') return;
    this.onProgress?.(next);
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
      const pending = this.parseModel(resolvedUrl, { timeoutMs }).catch(error => {
        this.cache.delete(resolvedUrl);
        this.progress({ type: 'model', url: resolvedUrl, state: 'error', error });
        throw error;
      });
      this.cache.set(resolvedUrl, pending);
    }
    const source = await this.withTimeout(this.cache.get(resolvedUrl), resolvedUrl, timeoutMs);
    if (!clone) return source;
    const scene = this.prepare(skeletonClone(source.scene), { world });
    const result = { ...source, scene, animations: source.animations.map(clip => clip.clone()) };
    if (MEMORY_SAFE) {
      // Concurrent callers already hold the same promise; deleting here only
      // removes the long-lived cache reference after the clone is ready.
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
