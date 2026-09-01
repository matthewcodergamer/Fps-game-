import * as THREE from 'three/webgpu';
import { retargetClip } from 'three/addons/utils/SkeletonUtils.js';

const PART_HINTS={
  slide:/slide/i,
  bolt:/bolt|charging.?handle/i,
  magazine:/mag|clip/i,
  trigger:/trigger/i,
  muzzle:/muzzle|barrel.?end/i,
  ejection:/eject|shell|brass/i,
  leftHand:/lefthand.?socket|left.?hand.?socket|grip.?l/i,
  rightHand:/righthand.?socket|right.?hand.?socket|grip.?r/i,
  optic:/optic|scope.?socket|sight.?socket/i
};
const BONE_HINTS={
  leftHand:/hand.?l|left.?hand|mixamorigleftHand/i,
  rightHand:/hand.?r|right.?hand|mixamorigrightHand/i
};

function clipBy(clips,re){return clips.find(c=>re.test(c.name||''))||null}
function setAction(mixer,clip,{loop=false,fade=.06}={}){
  if(!mixer||!clip)return null;
  const a=mixer.clipAction(clip);
  a.reset().enabled=true;
  a.setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);
  a.clampWhenFinished=!loop;
  a.fadeIn(fade).play();
  return a;
}

export class FPSViewModel {
  constructor(camera,assets){
    this.camera=camera;this.assets=assets;
    this.root=new THREE.Group();this.root.name='FPSViewModelRoot';camera.add(this.root);
    this.weaponRoot=new THREE.Group();this.armRoot=new THREE.Group();this.attachmentRoot=new THREE.Group();
    this.root.add(this.armRoot,this.weaponRoot);this.weaponRoot.add(this.attachmentRoot);
    this.weapon=null;this.arms=null;this.parts={};this.bones={};this.rest=new Map();this.sockets={};
    this.weaponClips=[];this.armClips=[];this.externalArmClips=[];this.weaponMixer=null;this.armMixer=null;
    this.ads=false;this.reloading=false;this.reloadT=0;this.reloadDuration=1.55;this.reloadEvents=new Set();this.onReloadEvent=null;
    this.recoilKick=0;this.recoilYaw=0;this.inertiaX=0;this.inertiaY=0;this.lastYaw=0;this.lastPitch=0;
    this.baseHip=new THREE.Vector3(.28,-.23,-.48);this.baseAds=new THREE.Vector3(0,-.13,-.36);
    this._tmpA=new THREE.Vector3();this._tmpB=new THREE.Vector3();
  }
  clear(group){while(group.children.length)group.remove(group.children[0])}
  prepMeshes(root){root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=false;o.frustumCulled=false;if(o.material){o.material.depthTest=true;o.material.depthWrite=true}}})}
  alignLongAxis(root,targetLength=.92){
    root.updateMatrixWorld(true);let box=new THREE.Box3().setFromObject(root),size=box.getSize(new THREE.Vector3());
    if(size.x>=size.y&&size.x>=size.z)root.rotation.y=Math.PI/2;
    else if(size.y>=size.x&&size.y>=size.z)root.rotation.x=-Math.PI/2;
    root.updateMatrixWorld(true);box=new THREE.Box3().setFromObject(root);size=box.getSize(new THREE.Vector3());
    const longest=Math.max(size.x,size.y,size.z,.0001);root.scale.multiplyScalar(targetLength/longest);
    root.updateMatrixWorld(true);box=new THREE.Box3().setFromObject(root);const center=box.getCenter(new THREE.Vector3());root.position.sub(center)
  }
  mapBones(){
    this.bones={};
    this.arms?.traverse(o=>{if(!o.isBone)return;for(const[k,re]of Object.entries(BONE_HINTS))if(!this.bones[k]&&re.test(o.name||''))this.bones[k]=o});
  }
  async loadArms(url){
    try{
      const gltf=await this.assets.loadGLB(url,{clone:true});this.clear(this.armRoot);
      this.arms=gltf.scene;this.prepMeshes(this.arms);this.alignLongAxis(this.arms,1.15);
      this.arms.position.set(-.02,-.38,-.30);this.arms.rotation.z=.02;this.armRoot.add(this.arms);
      this.armClips=gltf.animations||[];this.armMixer=new THREE.AnimationMixer(this.arms);this.mapBones();
      const idle=clipBy(this.armClips,/idle|aim|hold/i)||this.armClips[0];if(idle)setAction(this.armMixer,idle,{loop:true,fade:0});
      return true
    }catch(e){console.warn('FPS arms load failed',e);return false}
  }
  async loadAnimationPack(url){
    if(!this.arms)return 0;
    try{
      const gltf=await this.assets.loadGLB(url);
      let added=0;
      for(const clip of gltf.animations||[]){
        try{
          const r=retargetClip(this.arms,gltf.scene,clip,{fps:30,useFirstFramePosition:false});
          if(r?.tracks?.length){r.name=`retarget:${clip.name}`;this.externalArmClips.push(r);added++}
        }catch{}
      }
      return added;
    }catch(e){console.info('Animation pack skipped',url,e);return 0}
  }
  clearAttachment(){this.clear(this.attachmentRoot)}
  async loadAttachment(url){
    this.clearAttachment();if(!url)return false;
    try{
      const g=await this.assets.loadGLB(url,{clone:true}),obj=g.scene;this.prepMeshes(obj);this.alignLongAxis(obj,.16);
      this.attachmentRoot.position.set(0,.075,-.13);this.attachmentRoot.quaternion.identity();
      const socket=this.sockets.optic;if(socket){
        this.weaponRoot.updateMatrixWorld(true);socket.updateMatrixWorld(true);
        const wp=socket.getWorldPosition(new THREE.Vector3()),wq=socket.getWorldQuaternion(new THREE.Quaternion()),rq=this.weaponRoot.getWorldQuaternion(new THREE.Quaternion()).invert();
        this.weaponRoot.worldToLocal(wp);this.attachmentRoot.position.copy(wp);this.attachmentRoot.quaternion.copy(rq.multiply(wq));
      }
      obj.position.set(0,0,0);obj.rotation.set(0,0,0);this.attachmentRoot.add(obj);return true;
    }catch(e){console.info('Optic attachment unavailable',url,e);return false}
  }
  buildSockets(){
    this.sockets={};
    this.weapon?.traverse(o=>{for(const[k,re]of Object.entries(PART_HINTS))if(!this.parts[k]&&re.test(o.name||'')){this.parts[k]=o;this.rest.set(o,{position:o.position.clone(),rotation:o.rotation.clone()})}});
    for(const k of ['muzzle','ejection','leftHand','rightHand','optic'])if(this.parts[k])this.sockets[k]=this.parts[k];
    const make=(name,pos)=>{const o=new THREE.Object3D();o.name=`Synthetic${name}Socket`;o.position.copy(pos);this.weaponRoot.add(o);this.sockets[name]=o};
    if(!this.sockets.muzzle)make('muzzle',new THREE.Vector3(0,.015,-.46));
    if(!this.sockets.ejection)make('ejection',new THREE.Vector3(.075,.02,-.12));
    if(!this.sockets.leftHand)make('leftHand',new THREE.Vector3(-.06,-.055,-.28));
    if(!this.sockets.rightHand)make('rightHand',new THREE.Vector3(.045,-.04,.02));
    if(!this.sockets.optic)make('optic',new THREE.Vector3(0,.075,-.12));
  }
  async loadWeapon(def){
    try{
      const gltf=await this.assets.loadGLB(def.model,{clone:true});this.clear(this.weaponRoot);this.weaponRoot.add(this.attachmentRoot);this.clearAttachment();
      this.parts={};this.rest.clear();this.sockets={};this.weapon=gltf.scene;this.prepMeshes(this.weapon);this.alignLongAxis(this.weapon,def.viewLength||.9);
      this.weapon.position.set(0,0,0);this.weaponRoot.add(this.weapon);this.weaponRoot.add(this.attachmentRoot);
      this.weaponClips=gltf.animations||[];this.weaponMixer=new THREE.AnimationMixer(this.weapon);this.buildSockets();
      this.weaponRoot.position.copy(this.baseHip);this.weaponRoot.rotation.set(.015,-.03,-.015);
      const idle=clipBy(this.weaponClips,/idle|hold/i);if(idle)setAction(this.weaponMixer,idle,{loop:true,fade:0});
      await this.loadAttachment(def.optic);
      this.playAuthored(/equip|draw|raise/i);
      return true
    }catch(e){console.warn('Weapon model load failed',def?.model,e);return false}
  }
  socketWorld(name,out=new THREE.Vector3()){
    const s=this.sockets[name];if(!s)return this.camera.getWorldPosition(out);return s.getWorldPosition(out)
  }
  muzzleWorld(out=new THREE.Vector3()){return this.socketWorld('muzzle',out)}
  ejectionWorld(out=new THREE.Vector3()){return this.socketWorld('ejection',out)}
  playAuthored(re){
    const wc=clipBy(this.weaponClips,re),ac=clipBy(this.armClips,re)||clipBy(this.externalArmClips,re);
    const wa=setAction(this.weaponMixer,wc),aa=setAction(this.armMixer,ac);
    return{duration:Math.max(wc?.duration||0,ac?.duration||0),weapon:wa,arms:aa,found:!!(wc||ac)}
  }
  setADS(v){this.ads=!!v}
  recoil(amount=1){
    this.recoilKick=Math.min(.14,this.recoilKick+.038*amount);this.recoilYaw+=(Math.random()-.5)*.018*amount;
    const p=this.parts.slide||this.parts.bolt;if(p){const r=this.rest.get(p);if(r)p.position.z=r.position.z+.035}
    this.playAuthored(/fire|shoot/i);
  }
  reload(onEvent){
    if(this.reloading)return false;this.reloading=true;this.reloadT=0;this.reloadEvents.clear();this.onReloadEvent=onEvent||null;
    const authored=this.playAuthored(/reload|mag.?change|magazine/i);this.reloadDuration=THREE.MathUtils.clamp(authored.duration||1.55,.75,3.4);return true
  }
  emitReload(name){if(this.reloadEvents.has(name))return;this.reloadEvents.add(name);this.onReloadEvent?.(name)}
  updateHandAlignment(dt){
    if(!this.arms)return;
    const l=this.bones.leftHand,r=this.bones.rightHand;if(!l&&!r)return;
    const delta=this._tmpA.set(0,0,0);let n=0;
    for(const [bone,key,weight] of [[l,'leftHand',.7],[r,'rightHand',.3]]){
      if(!bone||!this.sockets[key])continue;
      const target=this.sockets[key].getWorldPosition(new THREE.Vector3()),hand=bone.getWorldPosition(new THREE.Vector3());
      this.camera.worldToLocal(target);this.camera.worldToLocal(hand);delta.addScaledVector(target.sub(hand),weight);n+=weight;
    }
    if(n>0){
      delta.divideScalar(n);delta.clampLength(0,.025);
      this.armRoot.position.x=THREE.MathUtils.damp(this.armRoot.position.x,this.armRoot.position.x+delta.x,8,dt);
      this.armRoot.position.y=THREE.MathUtils.damp(this.armRoot.position.y,this.armRoot.position.y+delta.y,8,dt);
      this.armRoot.position.z=THREE.MathUtils.damp(this.armRoot.position.z,this.armRoot.position.z+delta.z,8,dt);
    }
  }
  update(dt,{time=0,speed=0,sprint=false,crouch=false,slide=0,yaw=0,pitch=0}={}){
    this.weaponMixer?.update(dt);this.armMixer?.update(dt);
    const yawDelta=THREE.MathUtils.clamp(yaw-this.lastYaw,-.08,.08),pitchDelta=THREE.MathUtils.clamp(pitch-this.lastPitch,-.08,.08);
    this.lastYaw=yaw;this.lastPitch=pitch;
    this.inertiaX=THREE.MathUtils.damp(this.inertiaX,-yawDelta*1.15,13,dt);this.inertiaY=THREE.MathUtils.damp(this.inertiaY,pitchDelta*.85,13,dt);
    const moving=Math.min(1,speed/6),freq=sprint?12.5:8.5,bobY=Math.sin(time*freq)*.014*moving,bobX=Math.cos(time*freq*.5)*.011*moving,target=this.ads?this.baseAds:this.baseHip;
    this.weaponRoot.position.x=THREE.MathUtils.damp(this.weaponRoot.position.x,target.x+bobX+this.inertiaX,16,dt);
    this.weaponRoot.position.y=THREE.MathUtils.damp(this.weaponRoot.position.y,target.y+bobY+this.inertiaY+(crouch?-.03:0),16,dt);
    this.weaponRoot.position.z=THREE.MathUtils.damp(this.weaponRoot.position.z,target.z+this.recoilKick+(sprint?.08:0),18,dt);
    const slideTilt=slide>0?-.14*(slide/.58):0;this.weaponRoot.rotation.z=THREE.MathUtils.damp(this.weaponRoot.rotation.z,slideTilt+(sprint?.08:0)+this.recoilYaw,13,dt);
    const authoredReload=!!clipBy(this.weaponClips,/reload|mag/i)||!!clipBy(this.armClips,/reload|mag/i)||!!clipBy(this.externalArmClips,/reload|mag/i);
    this.weaponRoot.rotation.x=THREE.MathUtils.damp(this.weaponRoot.rotation.x,this.reloading&&!authoredReload?-.15:.015-this.recoilKick*.7,17,dt);
    this.recoilKick=THREE.MathUtils.damp(this.recoilKick,0,22,dt);this.recoilYaw=THREE.MathUtils.damp(this.recoilYaw,0,18,dt);
    const movingPart=this.parts.slide||this.parts.bolt;if(movingPart&&!this.reloading){const r=this.rest.get(movingPart);if(r)movingPart.position.lerp(r.position,1-Math.exp(-32*dt))}
    if(this.reloading){
      this.reloadT+=dt;const t=this.reloadT/this.reloadDuration;
      const mag=this.parts.magazine,r=mag&&this.rest.get(mag);
      if(!authoredReload){
        this.weaponRoot.rotation.z=-Math.sin(Math.min(1,t)*Math.PI)*.42;
        if(mag&&r){const drop=t<.46?Math.max(0,(t-.12)/.34):Math.max(0,1-(t-.46)/.34);mag.position.copy(r.position);mag.position.y-=drop*.25}
      }
      if(t>.12)this.emitReload('magOut');if(t>.50)this.emitReload('magIn');if(t>.76)this.emitReload('bolt');
      if(t>=1){this.reloading=false;this.weaponRoot.rotation.z=0;if(mag&&r)mag.position.copy(r.position);this.emitReload('complete')}
    }
    this.armRoot.position.x=THREE.MathUtils.damp(this.armRoot.position.x,bobX*.7,14,dt);this.armRoot.position.y=THREE.MathUtils.damp(this.armRoot.position.y,bobY*.7,14,dt);
    this.updateHandAlignment(dt);
  }
}