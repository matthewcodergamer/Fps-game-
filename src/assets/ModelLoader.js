import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export class ModelLoader {
  constructor(renderer, { basePath = '/game-assets/' } = {}) {
    this.renderer = renderer;
    this.basePath = basePath;
    this.gltf = new GLTFLoader();

    this.draco = new DRACOLoader();
    this.draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    this.gltf.setDRACOLoader(this.draco);
    this.gltf.setMeshoptDecoder(MeshoptDecoder);

    this.ktx2 = new KTX2Loader();
    this.ktx2.setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/basis/');
    this.ktx2.detectSupport(renderer);
    this.gltf.setKTX2Loader(this.ktx2);
  }

  async load(url, options = {}) {
    const gltf = await this.gltf.loadAsync(url);
    const root = gltf.scene;

    root.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = options.castShadow ?? true;
      node.receiveShadow = options.receiveShadow ?? true;
      node.frustumCulled = true;
    });

    const report = this.inspect(gltf);
    if (options.requireSkin && report.skinnedMeshes === 0) {
      throw new Error(`Model ${url} has no skinned meshes`);
    }

    return { gltf, root, animations: gltf.animations, report };
  }

  inspect(gltf) {
    let meshes = 0;
    let skinnedMeshes = 0;
    let triangles = 0;
    let materials = new Set();
    let bones = new Set();

    gltf.scene.traverse((node) => {
      if (node.isMesh) {
        meshes++;
        if (node.isSkinnedMesh) skinnedMeshes++;
        const geometry = node.geometry;
        const count = geometry.index ? geometry.index.count : geometry.attributes.position?.count || 0;
        triangles += Math.floor(count / 3);
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        mats.filter(Boolean).forEach((m) => materials.add(m.uuid));
      }
      if (node.isBone) bones.add(node.name || node.uuid);
    });

    return {
      meshes,
      skinnedMeshes,
      triangles,
      materials: materials.size,
      bones: bones.size,
      animations: gltf.animations.length,
      animationNames: gltf.animations.map((clip) => clip.name),
    };
  }

  dispose() {
    this.ktx2.dispose();
    this.draco.dispose();
  }
}
