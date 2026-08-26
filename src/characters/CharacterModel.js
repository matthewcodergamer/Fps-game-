import * as THREE from 'three';

export class CharacterModel extends THREE.Group{
  constructor(assetManager,definition){super();this.assets=assetManager;this.definition=definition;this.mixer=null;this.clips=[];this.model=null;this.weaponSocket=null;this.state='idle'}
  async load(){
    const gltf=await this.assets.loadGLB(this.definition.model,{clone:true});this.model=gltf.scene;this.clips=gltf.animations||[];this.add(this.model);this.mixer=new THREE.AnimationMixer(this.model);
    this.weaponSocket=this.model.getObjectByName('RightHandSocket')||this.model.getObjectByName('hand.R')||this.model.getObjectByName('RightHand')||null;
    this.model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true}});return this
  }
  setState(name){if(name===this.state||!this.mixer)return;this.state=name;const clip=THREE.AnimationClip.findByName(this.clips,name);if(!clip)return;for(const a of this.mixer._actions)a.fadeOut(.12);const a=this.mixer.clipAction(clip);a.reset().fadeIn(.12).play()}
  attachWeapon(object){if(this.weaponSocket)this.weaponSocket.add(object);else this.add(object)}
  update(dt){this.mixer?.update(dt)}
}
