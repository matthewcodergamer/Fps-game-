import * as THREE from 'three/webgpu';
import { clone as skeletonClone, retargetClip } from 'three/addons/utils/SkeletonUtils.js';
import { ENVIRONMENT_ASSETS, ANIMATION_PACKS } from '../assets/GameAssetCatalog.js';

function fitObject(root,{size=4,height=null}={}){
  root.updateMatrixWorld(true);let box=new THREE.Box3().setFromObject(root),s=box.getSize(new THREE.Vector3());
  const denom=height?s.y:Math.max(s.x,s.y,s.z),scale=(height||size)/Math.max(.0001,denom);
  root.scale.multiplyScalar(scale);root.updateMatrixWorld(true);box=new THREE.Box3().setFromObject(root);
  const c=box.getCenter(new THREE.Vector3());root.position.sub(c);root.updateMatrixWorld(true);return root
}
function findClip(clips,re){return clips.find(c=>re.test(c.name||''))||null}
function playClip(target,clip,{loop=false,fade=.08}={}){
  if(!target?.userData?.mixer||!clip)return null;
  const a=target.userData.mixer.clipAction(clip);a.reset().enabled=true;a.setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);a.clampWhenFinished=!loop;a.fadeIn(fade).play();return a
}

export async function createStage3Arena(scene,assets,{mobile=false}={}){
  const root=new THREE.Group();root.name='Stage3Arena';scene.add(root);
  const colliders=[],targets=[],surfaceMeshes=[];
  const wet=new THREE.MeshPhysicalMaterial({color:0x202a2f,roughness:.24,metalness:.05,clearcoat:.78,clearcoatRoughness:.12});
  const concrete=new THREE.MeshStandardMaterial({color:0x667074,roughness:.86,metalness:.03});
  const dark=new THREE.MeshStandardMaterial({color:0x252b2f,roughness:.62,metalness:.2});
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(110,110),wet);floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;floor.userData.surface='concrete';root.add(floor);surfaceMeshes.push(floor);

  function block(x,y,z,sx,sy,sz,mat=concrete,visible=true){
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),mat);mesh.position.set(x,y,z);mesh.castShadow=!mobile;mesh.receiveShadow=true;mesh.visible=visible;mesh.userData.surface=mat===dark?'metal':'concrete';
    root.add(mesh);surfaceMeshes.push(mesh);colliders.push(new THREE.Box3(new THREE.Vector3(x-sx/2,y-sy/2,z-sz/2),new THREE.Vector3(x+sx/2,y+sy/2,z+sz/2)));return mesh
  }

  block(0,2,-25,52,4,2);block(0,2,25,52,4,2);block(-26,2,0,2,4,52);block(26,2,0,2,4,52);
  block(-10,1.5,-10,10,3,1,dark);block(10,1.5,-10,10,3,1,dark);block(-12,1.5,6,1,3,14);block(12,1.5,6,1,3,14);block(0,1.5,14,15,3,1);block(0,1.5,1,8,3,1);
  block(-19,1,-14,5,2,6,dark,false);block(18,1,14,5,2,6,dark,false);block(-18,1,18,4,2,4,dark,false);block(18,1,-18,4,2,4,dark,false);

  const puddleMat=new THREE.MeshPhysicalMaterial({color:0x172126,roughness:.06,metalness:.02,clearcoat:1,clearcoatRoughness:.035,transparent:true,opacity:.72,depthWrite:false});
  for(let i=0;i<(mobile?10:22);i++){
    const p=new THREE.Mesh(new THREE.CircleGeometry(1,18),puddleMat);p.rotation.x=-Math.PI/2;p.position.set((Math.random()-.5)*43,.008,(Math.random()-.5)*43);p.scale.set(.8+Math.random()*2.6,.35+Math.random()*1.1,1);root.add(p)
  }

  const cyan=new THREE.MeshStandardMaterial({color:0x071419,emissive:0x24d8ff,emissiveIntensity:4.6,roughness:.32});
  const amber=new THREE.MeshStandardMaterial({color:0x1a0d04,emissive:0xff7425,emissiveIntensity:3.8,roughness:.38});
  for(const[x,z,c]of[[-25,-8,cyan],[25,8,amber],[-9,-24,amber],[11,24,cyan],[-25,15,amber],[25,-15,cyan]]){
    const strip=new THREE.Mesh(new THREE.BoxGeometry(.08,1.5,4.5),c);strip.position.set(x,2.4,z);root.add(strip);
    const light=new THREE.PointLight(c===cyan?0x37c9ff:0xff8c3b,mobile?9:20,11,2);light.position.set(x+(x<0?.8:-.8),2.7,z);root.add(light)
  }

  const rainCount=mobile?180:520,rainGeo=new THREE.BufferGeometry(),rainPos=new Float32Array(rainCount*3);
  for(let i=0;i<rainCount;i++){rainPos[i*3]=(Math.random()-.5)*70;rainPos[i*3+1]=Math.random()*24;rainPos[i*3+2]=(Math.random()-.5)*70}
  rainGeo.setAttribute('position',new THREE.BufferAttribute(rainPos,3));
  const rainMat=new THREE.PointsMaterial({color:0xbfd9e4,size:mobile?.025:.035,transparent:true,opacity:.28,depthWrite:false});
  const rain=new THREE.Points(rainGeo,rainMat);root.add(rain);

  async function place(url,pos,{size=4,height=null,rot=0,surface='concrete'}={}){
    try{
      const g=await assets.loadGLB(url,{clone:true}),holder=new THREE.Group(),model=g.scene;model.traverse(o=>{if(o.isMesh){o.castShadow=!mobile;o.receiveShadow=true;o.userData.surface=surface;surfaceMeshes.push(o)}});
      fitObject(model,{size,height});holder.add(model);holder.position.copy(pos);holder.rotation.y=rot;root.add(holder);return holder
    }catch(e){console.warn('Arena asset failed',url,e);return null}
  }

  const jobs=[
    place(ENVIRONMENT_ASSETS.cover[0],new THREE.Vector3(-19,0,-14),{size:4.8,rot:.15}),
    place(ENVIRONMENT_ASSETS.cover[1],new THREE.Vector3(18,0,14),{size:3.8,rot:-.4,surface:'wood'}),
    place(ENVIRONMENT_ASSETS.terrain[0],new THREE.Vector3(-18,0,18),{size:4.2,rot:.6})
  ];
  ENVIRONMENT_ASSETS.buildings.forEach((url,i)=>{
    const angle=i/ENVIRONMENT_ASSETS.buildings.length*Math.PI*2,r=34+(i%3)*2.3;
    jobs.push(place(url,new THREE.Vector3(Math.cos(angle)*r,3,Math.sin(angle)*r),{height:8+(i%4),rot:-angle+Math.PI/2,surface:'metal'}))
  });

  let operatorSource=null,operatorAnimations=[];
  try{const g=await assets.loadGLB('./game-assets/models/characters/operators/bamen_military_soldier_animated.glb');operatorSource=g.scene;operatorAnimations=g.animations||[]}
  catch(e){console.warn('Operator asset unavailable',e)}
  function fallbackTarget(){
    const g=new THREE.Group(),body=new THREE.Mesh(new THREE.CapsuleGeometry(.42,.95,4,8),dark),head=new THREE.Mesh(new THREE.SphereGeometry(.27,14,10),new THREE.MeshStandardMaterial({color:0x78685d,roughness:.8}));
    body.position.y=1.15;head.position.y=2.02;g.add(body,head);head.userData.hitZone='head';return g
  }
  for(const[x,z,r]of[[0,-17,0],[-17,7,1.2],[17,-5,-1.1],[6,19,3.1],[-7,15,-2.2],[15,8,2.4]]){
    const visual=operatorSource?skeletonClone(operatorSource):fallbackTarget();if(operatorSource)fitObject(visual,{height:1.82});
    const t=new THREE.Group();t.position.set(x,0,z);t.rotation.y=r;t.add(visual);
    t.userData={health:100,alive:true,respawn:0,mixer:null,visual,clips:[...operatorAnimations],fall:0,fallDir:new THREE.Vector3(),home:new THREE.Vector3(x,0,z),homeRot:r};
    root.add(t);visual.traverse(o=>{if(o.isMesh){o.castShadow=!mobile;o.userData.target=t;if(/head|helmet|skull/i.test(o.name||''))o.userData.hitZone='head'}});
    if(operatorAnimations.length){const mixer=new THREE.AnimationMixer(visual);t.userData.mixer=mixer;const clip=findClip(operatorAnimations,/idle|stand/i)||operatorAnimations[0];if(clip)playClip(t,clip,{loop:true,fade:0})}
    targets.push(t)
  }

  (async()=>{
    for(const url of ANIMATION_PACKS){
      try{
        const g=await assets.loadGLB(url);
        for(const t of targets){
          if(!t.userData.mixer)continue;
          for(const c of g.animations||[]){
            if(!/idle|hit|death|fall|shoot|pistol|walk|run/i.test(c.name||''))continue;
            try{const rc=retargetClip(t.userData.visual,g.scene,c,{fps:30,useFirstFramePosition:false});if(rc?.tracks?.length){rc.name=`retarget:${c.name}`;t.userData.clips.push(rc)}}catch{}
          }
        }
      }catch(e){console.info('Optional animation pack skipped',url,e)}
    }
  })();

  await Promise.allSettled(jobs);

  function killTarget(t,dir=new THREE.Vector3(0,0,1)){
    if(!t?.userData?.alive)return;t.userData.alive=false;t.userData.respawn=3.3;t.userData.fall=0;t.userData.fallDir.copy(dir);
    const death=findClip(t.userData.clips,/death|die|fall/i);
    if(death){t.userData.mixer.stopAllAction();playClip(t,death,{loop:false,fade:.05})}
  }
  function respawnTarget(t){
    t.userData.health=100;t.userData.alive=true;t.userData.fall=0;t.visible=true;t.position.copy(t.userData.home);t.rotation.set(0,t.userData.homeRot,0);
    const idle=findClip(t.userData.clips,/idle|stand/i)||t.userData.clips[0];if(t.userData.mixer){t.userData.mixer.stopAllAction();if(idle)playClip(t,idle,{loop:true,fade:.05})}
  }

  return{
    root,colliders,targets,surfaceMeshes,killTarget,respawnTarget,
    update(dt){
      const a=rain.geometry.attributes.position.array;
      for(let i=0;i<rainCount;i++){a[i*3+1]-=(mobile?15:19)*dt;if(a[i*3+1]<.1){a[i*3+1]=18+Math.random()*8;a[i*3]=(Math.random()-.5)*70;a[i*3+2]=(Math.random()-.5)*70}}
      rain.geometry.attributes.position.needsUpdate=true;
      for(const t of targets){
        t.userData.mixer?.update(dt);
        if(!t.userData.alive){
          t.userData.respawn-=dt;t.userData.fall+=dt;
          if(!findClip(t.userData.clips,/death|die|fall/i)){
            t.rotation.z=THREE.MathUtils.damp(t.rotation.z,Math.sign(t.userData.fallDir.x||1)*1.35,5,dt);
            t.position.y=THREE.MathUtils.damp(t.position.y,-.25,4,dt)
          }
          if(t.userData.respawn<=0)respawnTarget(t)
        }
      }
    }
  }
}