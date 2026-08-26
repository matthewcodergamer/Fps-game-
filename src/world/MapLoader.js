import * as THREE from 'three';

export class MapLoader{
  constructor(scene,assets,physics){this.scene=scene;this.assets=assets;this.physics=physics;this.current=null;this.chunks=new Map()}
  async load(manifestUrl){this.unload();const m=await this.assets.loadJSON(manifestUrl);this.current=m;for(const c of m.chunks||[])if(c.preload!==false)await this.loadChunk(c);return m}
  async loadChunk(chunk){if(this.chunks.has(chunk.id))return this.chunks.get(chunk.id);const root=new THREE.Group();root.name=`chunk:${chunk.id}`;for(const item of chunk.models||[]){const gltf=await this.assets.loadGLB(item.url,{clone:true});const o=gltf.scene;o.position.fromArray(item.position||[0,0,0]);if(item.rotation)o.rotation.set(...item.rotation);if(item.scale)Array.isArray(item.scale)?o.scale.fromArray(item.scale):o.scale.setScalar(item.scale);root.add(o)}this.scene.add(root);this.chunks.set(chunk.id,root);return root}
  unloadChunk(id){const root=this.chunks.get(id);if(!root)return;this.scene.remove(root);this.chunks.delete(id)}
  unload(){for(const id of [...this.chunks.keys()])this.unloadChunk(id);this.current=null}
  updateStreaming(playerPosition){if(!this.current?.chunks)return;for(const c of this.current.chunks){if(!c.center||!c.radius)continue;const center=new THREE.Vector3(...c.center),d=center.distanceTo(playerPosition);if(d<c.radius*1.25&&!this.chunks.has(c.id))this.loadChunk(c).catch(console.error);if(d>c.radius*1.8&&this.chunks.has(c.id)&&!c.alwaysLoaded)this.unloadChunk(c.id)}}
}
