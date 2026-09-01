import * as THREE from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { RepositoryAudio } from './audio/RepositoryAudio.js';
import { AssetManager } from './assets/AssetManager.js';
import { WEAPON_CATALOG,DEFAULT_ARMS,GRENADE_ASSETS,ANIMATION_PACKS } from './assets/GameAssetCatalog.js';
import { detectDevicePreset,QualityManager } from './rendering/QualityManager.js';
import { createCinematicPipeline } from './rendering/CinematicPipeline.js';
import { GamepadInput } from './input/GamepadInput.js';
import { FPSViewModel } from './weapons/FPSViewModel.js';
import { createStage3Arena } from './world/Stage3Arena.js';
import { CombatEffects,RecoilController,ScopeController,FootstepController,GrenadeController } from './gameplay/CombatSystems.js';
import { mountRoadmap } from './ui/RoadmapUI.js';

const $=s=>document.querySelector(s);mountRoadmap();
const canvas=$('#game'),playBtn=$('#playBtn'),renderStatus=$('#renderStatus'),runtimeError=$('#runtimeError');
const mobile=matchMedia('(pointer:coarse)').matches,preset=detectDevicePreset(),gpuNative=!!navigator.gpu;
const cinematic=gpuNative&&!mobile&&(navigator.deviceMemory||8)>=6;
playBtn.disabled=true;playBtn.textContent='LOADING';
if(renderStatus)renderStatus.textContent='Starting safe renderer…';

function showRuntimeError(message){
  console.error(message);
  if(runtimeError){runtimeError.textContent=`Renderer recovered · ${String(message).slice(0,130)}`;runtimeError.classList.add('show');setTimeout(()=>runtimeError.classList.remove('show'),5500)}
}
addEventListener('error',e=>showRuntimeError(e.error?.message||e.message||'runtime error'));
addEventListener('unhandledrejection',e=>showRuntimeError(e.reason?.message||e.reason||'promise error'));

async function makeRenderer(){
  const options={canvas,antialias:!mobile,powerPreference:'high-performance',outputBufferType:mobile?THREE.UnsignedByteType:THREE.HalfFloatType,forceWebGL:mobile||!gpuNative};
  try{const r=new THREE.WebGPURenderer(options);await r.init();return r}
  catch(first){
    console.warn('Primary renderer failed, retrying forced WebGL2.',first);
    const r=new THREE.WebGPURenderer({...options,forceWebGL:true,outputBufferType:THREE.UnsignedByteType});await r.init();showRuntimeError('WebGPU unavailable; using stable WebGL2');return r
  }
}
const renderer=await makeRenderer();
if(gpuNative&&!mobile)renderer.lighting=new ClusteredLighting(256,32,20,48);
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.06;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
renderer.setPixelRatio(Math.min(devicePixelRatio,mobile?1.05:1.5));renderer.setSize(innerWidth,innerHeight,false);

const scene=new THREE.Scene();scene.background=new THREE.Color(0x536871);scene.fog=new THREE.FogExp2(0x60747c,mobile?.0085:.0068);
const camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.035,280);camera.rotation.order='YXZ';
const clock=new THREE.Clock(),assets=new AssetManager(renderer),audio=new RepositoryAudio(),gamepad=new GamepadInput();
const quality=new QualityManager(renderer,{targetFps:60,minScale:mobile?.58:.7,maxScale:1});

try{
  const roomEnv=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);
  scene.environment=pmrem.fromScene(roomEnv,.04).texture;scene.environmentIntensity=mobile?.46:.6;roomEnv.dispose();pmrem.dispose()
}catch(e){console.info('PMREM environment fallback',e)}
scene.add(new THREE.HemisphereLight(0xc7ddff,0x2b2522,mobile?.86:.7));
const sun=new THREE.DirectionalLight(0xffe4bf,mobile?3.7:4.7);sun.position.set(-28,34,12);sun.castShadow=true;sun.shadow.mapSize.set(preset.shadowMap,preset.shadowMap);sun.shadow.camera.left=-48;sun.shadow.camera.right=48;sun.shadow.camera.top=48;sun.shadow.camera.bottom=-48;sun.shadow.bias=-.00025;scene.add(sun);

if(renderStatus)renderStatus.textContent='Loading Project Strike assets…';
const arena=await createStage3Arena(scene,assets,{mobile});
const view=new FPSViewModel(camera,assets);scene.add(camera);
let weaponIndex=0,current={...WEAPON_CATALOG[0],ammo:WEAPON_CATALOG[0].mag,currentReserve:WEAPON_CATALOG[0].reserve};
await Promise.allSettled([view.loadArms(DEFAULT_ARMS),view.loadWeapon(current)]);

const pipeline=createCinematicPipeline(renderer,scene,camera,{cinematic,mobile,onFallback:e=>showRuntimeError(e?.message||'post-processing fallback')});
const scope=new ScopeController($('#scopeOverlay')),effects=new CombatEffects(scene,{mobile}),recoil=new RecoilController(),footsteps=new FootstepController(audio);
const grenades=new GrenadeController(scene,assets,audio,effects,{flashElement:$('#flashOverlay'),mobile});
grenades.init(GRENADE_ASSETS).catch(()=>{});
if(renderStatus)renderStatus.textContent=`${mobile?'WebGL2 safe':gpuNative?'WebGPU':'WebGL2'} · ${pipeline.mode} · ${preset.preset}`;
$('#stageBadge').textContent='S4 PLAYABLE';

const player={pos:new THREE.Vector3(0,1.72,10),vel:new THREE.Vector3(),moveVel:new THREE.Vector3(),yaw:0,pitch:0,height:1.72,crouch:false,slide:0,grounded:true,reloading:false,ads:false,cooldown:0};
const keys={},touch={joy:{x:0,y:0},joyId:null,look:null},casings=[];
let started=false,firing=false,pointerADS=false,authoredPacksStarted=false;

function updateHUD(){
  const a=$('#ammo'),tail=document.querySelector('.ammo span');if(a)a.textContent=current.ammo;if(tail)tail.textContent='/ '+current.currentReserve;
  const name=$('#weaponName');if(name)name.textContent=current.name
}
updateHUD();

function collides(pos){
  const r=.33,feet=pos.y-player.height,b=new THREE.Box3(new THREE.Vector3(pos.x-r,feet,pos.z-r),new THREE.Vector3(pos.x+r,pos.y+.12,pos.z+r));
  return arena.colliders.some(c=>c.intersectsBox(b))
}
function jump(){if(player.grounded&&!player.crouch){player.grounded=false;player.vel.y=6.2}}
function slideOrCrouch(){const moving=player.moveVel.length()>.9||keys.KeyW||Math.hypot(touch.joy.x,touch.joy.y)>.7;if(moving&&!player.crouch){player.slide=.58;player.crouch=true}else player.crouch=!player.crouch}

async function equip(index){
  if(player.reloading)return;
  weaponIndex=(index+WEAPON_CATALOG.length)%WEAPON_CATALOG.length;const next=WEAPON_CATALOG[weaponIndex];
  current={...next,ammo:next.mag,currentReserve:next.reserve};recoil.reset(next.id);$('#statusText').textContent=`EQUIP ${next.name}`;
  const ok=await view.loadWeapon(current);$('#statusText').textContent=ok?'READY':'MODEL FALLBACK';audio.preloadWeapon(next.bank).catch(()=>{});updateHUD()
}
function switchWeapon(){equip(weaponIndex+1)}
function throwGrenade(type){view.playAuthored(/grenade|throw/i);grenades.throw(type,camera)}
function reload(){
  if(player.reloading||current.ammo===current.mag||current.currentReserve<=0)return;
  player.reloading=true;recoil.reset(current.id);$('#statusText').textContent='RELOADING';
  view.reload(event=>{
    if(event==='magOut'||event==='magIn'||event==='bolt')audio.playWeaponMechanical(current.bank,{gain:event==='bolt'?.28:.2});
    if(event==='complete'){const take=Math.min(current.mag-current.ammo,current.currentReserve);current.ammo+=take;current.currentReserve-=take;player.reloading=false;$('#statusText').textContent='READY';updateHUD()}
  })
}
function hitmarker(head=false){const h=$('#hitmarker');h.textContent=head?'✕':'×';h.classList.add('show');setTimeout(()=>h.classList.remove('show'),95)}

function casing(){
  const m=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.045,7),new THREE.MeshStandardMaterial({color:0xc29243,roughness:.28,metalness:.92}));
  m.rotation.z=Math.PI/2;const p=view.ejectionWorld(new THREE.Vector3());m.position.copy(p);scene.add(m);
  const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion),up=new THREE.Vector3(0,1,0);
  casings.push({mesh:m,life:2,vel:right.multiplyScalar(1+Math.random()*.55).addScaledVector(up,.65+Math.random()*.5)})
}
function rayShot(spread=.0){
  const dir=new THREE.Vector3();camera.getWorldDirection(dir);
  if(spread){dir.x+=(Math.random()-.5)*spread;dir.y+=(Math.random()-.5)*spread;dir.z+=(Math.random()-.5)*spread;dir.normalize()}
  const ray=new THREE.Raycaster(camera.position,dir,.02,260);
  const live=arena.targets.filter(t=>t.userData.alive),hits=ray.intersectObjects([...arena.surfaceMeshes,...live],true);
  return hits[0]||null
}
function shoot(){
  if(!started||player.reloading||player.cooldown>0||current.ammo<=0)return;
  player.cooldown=60/current.fireRate;current.ammo--;updateHUD();view.recoil(current.recoil);gamepad.pulse(.20*current.recoil,38);
  audio.playWeaponShot(current.bank,{gain:current.suppressed?.58:.8});
  const kick=recoil.shot(current);player.pitch=Math.max(-1.45,player.pitch-kick.pitch);player.yaw-=kick.yaw;
  const muzzle=view.muzzleWorld(new THREE.Vector3()),dir=new THREE.Vector3();camera.getWorldDirection(dir);effects.muzzle(muzzle,dir);casing();

  const pellets=current.pellets||1,spread=current.class==='shotgun'?.055:player.ads?.0015:.004;
  let confirmedTarget=null,headshot=false;
  for(let i=0;i<pellets;i++){
    const hit=rayShot(spread);if(!hit)continue;
    const target=hit.object.userData.target;
    const normal=hit.face?.normal?.clone().transformDirection(hit.object.matrixWorld)||new THREE.Vector3(0,1,0);
    if(target){
      const head=hit.object.userData.hitZone==='head';const damage=head?Math.max(100,current.damage*2.4):current.damage;
      target.userData.health-=damage;confirmedTarget=target;headshot=headshot||head;effects.impact(hit.point,normal,{kind:'body',decal:true});
      if(target.userData.health<=0)arena.killTarget(target,dir)
    }else{
      effects.impact(hit.point,normal,{kind:hit.object.userData.surface||'concrete',decal:true})
    }
  }
  if(confirmedTarget){hitmarker(headshot);$('#statusText').textContent=headshot?'HEADSHOT':confirmedTarget.userData.alive?'HIT':'TARGET DOWN';setTimeout(()=>{if(started&&!player.reloading)$('#statusText').textContent='READY'},450)}
}

function startAuthoredPacks(){
  if(authoredPacksStarted)return;authoredPacksStarted=true;
  const load=async()=>{for(const url of ANIMATION_PACKS){const n=await view.loadAnimationPack(url);if(n)console.info(`Project Strike retargeted ${n} clips from ${url}`)}};
  if('requestIdleCallback'in window)requestIdleCallback(()=>load(),{timeout:2500});else setTimeout(load,700)
}

function updatePlayer(dt,gp){
  if(gp.connected){
    player.yaw-=gp.lookX*2.35*dt;player.pitch=THREE.MathUtils.clamp(player.pitch-gp.lookY*1.9*dt,-1.45,1.45);
    if(gp.jump)jump();if(gp.slide)slideOrCrouch();if(gp.reload)reload();if(gp.switchWeapon)switchWeapon()
  }
  player.ads=pointerADS||gp.ads;
  const forward=new THREE.Vector3(-Math.sin(player.yaw),0,-Math.cos(player.yaw)),right=new THREE.Vector3(Math.cos(player.yaw),0,-Math.sin(player.yaw));
  let x=(keys.KeyD?1:0)-(keys.KeyA?1:0)+touch.joy.x+gp.moveX,y=(keys.KeyW?1:0)-(keys.KeyS?1:0)-touch.joy.y-gp.moveY;
  const inputLen=Math.hypot(x,y);if(inputLen>1){x/=inputLen;y/=inputLen}
  const dir=right.multiplyScalar(x).add(forward.multiplyScalar(y)),sprint=(keys.ShiftLeft||keys.ShiftRight||gp.sprint||inputLen>.93)&&y>.15&&!player.ads;
  let speed=player.crouch?2.55:sprint?7.1:4.45;if(player.slide>0){speed=9*(player.slide/.58);player.slide=Math.max(0,player.slide-dt);if(player.slide<=0&&player.crouch)player.crouch=false}
  const desired=dir.multiplyScalar(speed),accel=desired.lengthSq()>player.moveVel.lengthSq()?15:10;
  player.moveVel.x=THREE.MathUtils.damp(player.moveVel.x,desired.x,accel,dt);player.moveVel.z=THREE.MathUtils.damp(player.moveVel.z,desired.z,accel,dt);
  const next=player.pos.clone().addScaledVector(player.moveVel,dt),nx=new THREE.Vector3(next.x,player.pos.y,player.pos.z);if(!collides(nx))player.pos.x=next.x;else player.moveVel.x=0;
  const nz=new THREE.Vector3(player.pos.x,player.pos.y,next.z);if(!collides(nz))player.pos.z=next.z;else player.moveVel.z=0;
  if(!player.grounded){player.vel.y-=18.5*dt;player.pos.y+=player.vel.y*dt;if(player.pos.y<=player.height){player.pos.y=player.height;player.vel.y=0;player.grounded=true}}
  player.height=THREE.MathUtils.damp(player.height,player.crouch?1.18:1.72,13,dt);if(player.grounded)player.pos.y=player.height;
  camera.position.copy(player.pos);camera.rotation.y=player.yaw;camera.rotation.x=player.pitch;camera.rotation.z=THREE.MathUtils.damp(camera.rotation.z,player.slide>0?-.055:THREE.MathUtils.clamp(-x*.008,-.012,.012),9,dt);
  const moving=player.moveVel.length(),t=performance.now()*.001,bob=moving>.3?Math.sin(t*(sprint?13:8.5))*(sprint?.016:.008):0;camera.position.y+=bob;
  const scoped=current.scope&&player.ads;camera.fov=THREE.MathUtils.damp(camera.fov,scoped?22:player.ads?55:sprint?80:75,scoped?15:11,dt);camera.updateProjectionMatrix();
  view.setADS(player.ads);view.update(dt,{time:t,speed:moving,sprint,crouch:player.crouch,slide:player.slide,yaw:player.yaw,pitch:player.pitch});
  scope.update(current,player.ads);footsteps.update(dt,{speed:moving,sprint,crouch:player.crouch,grounded:player.grounded})
}

function bindInput(){
  addEventListener('keydown',e=>{
    keys[e.code]=true;if(e.code==='Space')jump();if(e.code==='KeyR')reload();if(e.code==='KeyC'||e.code==='ControlLeft')slideOrCrouch();
    if(e.code==='KeyQ')switchWeapon();if(/^Digit[1-9]$/.test(e.code))equip(Number(e.code.slice(5))-1);
    if(e.code==='KeyG')throwGrenade('frag');if(e.code==='KeyV')throwGrenade('flash')
  });
  addEventListener('keyup',e=>keys[e.code]=false);
  addEventListener('mousedown',e=>{if(e.button===0)firing=true;if(e.button===2)pointerADS=true});
  addEventListener('mouseup',e=>{if(e.button===0)firing=false;if(e.button===2)pointerADS=false});
  addEventListener('contextmenu',e=>e.preventDefault());
  addEventListener('mousemove',e=>{if(document.pointerLockElement===canvas){player.yaw-=e.movementX*.00205;player.pitch=THREE.MathUtils.clamp(player.pitch-e.movementY*.00205,-1.45,1.45)}});

  const pad=$('#leftPad'),stick=pad.querySelector('.stick'),reset=()=>{touch.joy={x:0,y:0};stick.style.transform='translate(0,0)'};
  pad.addEventListener('touchstart',e=>{touch.joyId=e.changedTouches[0].identifier;e.preventDefault()},{passive:false});
  pad.addEventListener('touchmove',e=>{e.preventDefault();const p=[...e.changedTouches].find(v=>v.identifier===touch.joyId);if(!p)return;const r=pad.getBoundingClientRect(),dx=p.clientX-(r.left+r.width/2),dy=p.clientY-(r.top+r.height/2),m=Math.min(44,Math.hypot(dx,dy)),a=Math.atan2(dy,dx);touch.joy={x:Math.cos(a)*m/44,y:Math.sin(a)*m/44};stick.style.transform=`translate(${touch.joy.x*44}px,${touch.joy.y*44}px)`},{passive:false});
  pad.addEventListener('touchend',reset);pad.addEventListener('touchcancel',reset);
  const look=$('#lookZone');look.addEventListener('touchstart',e=>{const p=e.changedTouches[0];touch.look={id:p.identifier,x:p.clientX,y:p.clientY};e.preventDefault()},{passive:false});
  look.addEventListener('touchmove',e=>{e.preventDefault();const p=[...e.changedTouches].find(v=>v.identifier===touch.look?.id);if(!p)return;const dx=p.clientX-touch.look.x,dy=p.clientY-touch.look.y;touch.look.x=p.clientX;touch.look.y=p.clientY;player.yaw-=dx*.00415;player.pitch=THREE.MathUtils.clamp(player.pitch-dy*.00415,-1.45,1.45)},{passive:false});
  look.addEventListener('touchend',()=>touch.look=null);
  const hold=(el,on,off)=>{el?.addEventListener('pointerdown',e=>{e.preventDefault();on()});el?.addEventListener('pointerup',e=>{e.preventDefault();off?.()});el?.addEventListener('pointercancel',()=>off?.())};
  hold($('#fireBtn'),()=>firing=true,()=>firing=false);hold($('#adsBtn'),()=>pointerADS=true,()=>pointerADS=false);
  $('#reloadBtn').onclick=reload;$('#jumpBtn').onclick=jump;$('#slideBtn').onclick=slideOrCrouch;$('#switchBtn').onclick=switchWeapon;
  $('#fragBtn').onclick=()=>throwGrenade('frag');$('#flashBtn').onclick=()=>throwGrenade('flash')
}
bindInput();

playBtn.disabled=false;playBtn.textContent='DEPLOY';
playBtn.onclick=async()=>{
  started=true;$('#boot').classList.add('hidden');$('#hud').classList.remove('hidden');
  await audio.unlock();await audio.loadPermanent();audio.prewarm(current.bank).catch(()=>{});startAuthoredPacks();
  if(matchMedia('(pointer:fine)').matches)canvas.requestPointerLock?.();$('#statusText').textContent='READY'
};

let frames=0,elapsed=0,lastFps=performance.now();
function updateCasings(dt){
  for(let i=casings.length-1;i>=0;i--){const c=casings[i];c.life-=dt;c.vel.y-=7*dt;c.mesh.position.addScaledVector(c.vel,dt);c.mesh.rotation.x+=8*dt;c.mesh.rotation.z+=12*dt;
    if(c.mesh.position.y<.025){c.mesh.position.y=.025;c.vel.y=Math.abs(c.vel.y)*.22;c.vel.x*=.72;c.vel.z*=.72}
    if(c.life<=0){scene.remove(c.mesh);c.mesh.geometry.dispose();c.mesh.material.dispose();casings.splice(i,1)}
  }
}
function loop(){
  const dt=Math.min(.034,clock.getDelta()),gp=gamepad.update();
  if(started){
    player.cooldown=Math.max(0,player.cooldown-dt);if(firing||gp.fire)shoot();updatePlayer(dt,gp);arena.update(dt);effects.update(dt);grenades.update(dt,arena,player.pos);updateCasings(dt);quality.update(dt)
  }
  pipeline.render();frames++;elapsed+=dt;const now=performance.now();
  if(now-lastFps>500){$('#fps').textContent=`${Math.round(frames/Math.max(.001,elapsed))} FPS`;const c=$('#controllerStatus');if(c)c.textContent=gp.connected?'PAD':mobile?'TOUCH':'MOUSE';frames=0;elapsed=0;lastFps=now}
}
renderer.setAnimationLoop(loop);

addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight,false);pipeline.resize()});
addEventListener('visibilitychange',()=>{if(document.hidden){firing=false;pointerADS=false;touch.joy={x:0,y:0}}});