import * as THREE from 'three';

const SOCKETS=['MuzzleSocket','EjectionSocket','MagazineSocket','OpticSocket','MuzzleAttachmentSocket','UnderbarrelSocket','LeftHandSocket','RightHandSocket'];

export class WeaponModel extends THREE.Group{
  constructor(assetManager,definition){super();this.assets=assetManager;this.definition=definition;this.sockets={};this.clips=[];this.mixer=null;this.model=null}
  async load(){
    if(!this.definition.model)return this;
    const gltf=await this.assets.loadGLB(this.definition.model,{clone:true});this.model=gltf.scene;this.add(this.model);this.clips=gltf.animations||[];if(this.clips.length)this.mixer=new THREE.AnimationMixer(this.model);
    this.model.traverse(o=>{if(SOCKETS.includes(o.name))this.sockets[o.name]=o;if(o.isMesh){o.castShadow=true;o.receiveShadow=true}});
    return this;
  }
  socket(name){return this.sockets[name]||this.getObjectByName(name)||null}
  play(name,{loop=THREE.LoopOnce,fade=.08}={}){if(!this.mixer)return null;const clip=THREE.AnimationClip.findByName(this.clips,name);if(!clip)return null;const a=this.mixer.clipAction(clip);a.reset().setLoop(loop,loop===THREE.LoopOnce?1:Infinity);a.clampWhenFinished=true;a.fadeIn(fade).play();return a}
  update(dt){this.mixer?.update(dt)}
}
