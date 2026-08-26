import * as THREE from 'three';

export class LODSystem{
  constructor(assetManager){this.assets=assetManager;this.items=[];this.animationItems=[]}
  async createModelLOD(levels,{position=new THREE.Vector3(),rotation=new THREE.Euler(),scale=1}={}){
    const lod=new THREE.LOD();
    for(const level of levels){
      const gltf=await this.assets.loadGLB(level.url,{clone:true});
      const root=gltf.scene;root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true}});lod.addLevel(root,level.distance??0)
    }
    lod.position.copy(position);lod.rotation.copy(rotation);lod.scale.setScalar(scale);this.items.push(lod);return lod;
  }
  registerAnimation(mixer,object){this.animationItems.push({mixer,object,acc:0})}
  update(dt,camera){
    for(const lod of this.items)lod.update(camera);
    for(const a of this.animationItems){
      const d=camera.position.distanceTo(a.object.position);const hz=d<6?60:d<18?30:d<40?15:8;a.acc+=dt;const step=1/hz;if(a.acc>=step){a.mixer.update(a.acc);a.acc=0}
    }
  }
}
