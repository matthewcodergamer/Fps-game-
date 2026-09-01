import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

/** Production asset loader for GLB/glTF + Draco + Meshopt + KTX2. */
export class AssetManager {
  constructor(renderer){this.renderer=renderer;this.cache=new Map();this.gltf=new GLTFLoader();this.draco=new DRACOLoader();this.draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/draco/');this.gltf.setDRACOLoader(this.draco);this.gltf.setMeshoptDecoder(MeshoptDecoder);this.ktx2=new KTX2Loader();this.ktx2.setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/basis/');this.ktx2.detectSupport(renderer);this.gltf.setKTX2Loader(this.ktx2)}
  async loadGLB(url,{clone=false}={}){if(!this.cache.has(url))this.cache.set(url,this.gltf.loadAsync(url));const gltf=await this.cache.get(url);if(!clone)return gltf;return{...gltf,scene:skeletonClone(gltf.scene)}}
  async loadJSON(url){if(!this.cache.has(url))this.cache.set(url,fetch(url).then(r=>{if(!r.ok)throw new Error(`${r.status} ${url}`);return r.json()}));return this.cache.get(url)}
  async loadTexture(url){if(this.cache.has(url))return this.cache.get(url);const p=/\.ktx2(?:\?|$)/i.test(url)?this.ktx2.loadAsync(url):new THREE.TextureLoader().loadAsync(url);this.cache.set(url,p);return p}
  dispose(){this.draco.dispose();this.ktx2.dispose();this.cache.clear()}
}
