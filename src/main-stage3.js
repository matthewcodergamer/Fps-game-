import * as THREE from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { AudioManager } from './audio/AudioManager.js';
import { AssetManager } from './assets/AssetManager.js';
import { detectDevicePreset,QualityManager } from './rendering/QualityManager.js';
import { createCinematicPipeline } from './rendering/CinematicPipeline.js';
import { GamepadInput } from './input/GamepadInput.js';
import { FPSViewModel } from './weapons/FPSViewModel.js';
import { createStage3Arena } from './world/Stage3Arena.js';
import { mountRoadmap } from './ui/RoadmapUI.js';

const $=s=>document.querySelector(s);mountRoadmap();
const canvas=$('#game'),playBtn=$('#playBtn'),renderStatus=$('#renderStatus');
const mobile=matchMedia('(pointer:coarse)').matches,preset=detectDevicePreset();
const gpuNative=!!navigator.gpu,cinematic=gpuNative&&!mobile&&(navigator.deviceMemory||8)>=6;
playBtn.disabled=true;playBtn.textContent='LOADING';
if(renderStatus)renderStatus.textContent='Starting renderer…';

const renderer=new THREE.WebGPURenderer({canvas,antialias:!mobile,powerPreference:'high-performance',outputBufferType:mobile?THREE.UnsignedByteType:THREE.HalfFloatType});
renderer.lighting=new ClusteredLighting(mobile?96:256,32,mobile?12:20,mobile?20:48);
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.02;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
renderer.setPixelRatio(Math.min(devicePixelRatio,mobile?1.05:1.5));renderer.setSize(innerWidth,innerHeight,false);
await renderer.init();

const scene=new THREE.Scene();scene.background=new THREE.Color(0x53636b);scene.fog=new THREE.FogExp2(0x5f6e74,mobile?.009:.0075);
const camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.04,260);camera.rotation.order='YXZ';
const clock=new THREE.Clock(),assets=new AssetManager(renderer),audio=new AudioManager(),gamepad=new GamepadInput();
const quality=new QualityManager(renderer,{targetFps:60,minScale:mobile?.58:.7,maxScale:1});

const roomEnv=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);scene.environment=pmrem.fromScene(roomEnv,.04).texture;scene.environmentIntensity=mobile?.42:.56;roomEnv.dispose();pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xbdd9ff,0x2a2522,mobile?.72:.62));
const sun=new THREE.DirectionalLight(0xffe7c7,mobile?3.6:4.5);sun.position.set(-28,34,12);sun.castShadow=true;sun.shadow.mapSize.set(preset.shadowMap,preset.shadowMap);sun.shadow.camera.left=-45;sun.shadow.camera.right=45;sun.shadow.camera.top=45;sun.shadow.camera.bottom=-45;sun.shadow.bias=-.00025;scene.add(sun);

if(renderStatus)renderStatus.textContent='Loading map, weapons and operator…';
const arena=await createStage3Arena(scene,assets,{mobile});
const view=new FPSViewModel(camera,assets);scene.add(camera);
const WEAPONS=[
  {id:'m4',name:'M4A1',model:'./game-assets/models/weapons/rifles/colt_m4a1_carbine.glb',bank:'lmg_combat',mag:30,reserve:120,fireRate:700,damage:34,recoil:1,viewLength:.92},
  {id:'pistol',name:'SERVICE PISTOL',model:'./game-assets/models/weapons/pistols/service_pistol.glb',bank:'ptl_pistol',mag:17,reserve:68,fireRate:420,damage:28,recoil:1.25,viewLength:.45},
  {id:'ak74',name:'AK-74',model:'./game-assets/models/weapons/rifles/ak74.glb',bank:'lmg_mg_player',mag:30,reserve:120,fireRate:600,damage:38,recoil:1.35,viewLength:.9},
  {id:'mp5',name:'MP5A5',model:'./game-assets/models/weapons/smgs/mp5a5.glb',bank:'smg_smg',mag:30,reserve:150,fireRate:800,damage:24,recoil:.82,viewLength:.7},
  {id:'awm',name:'AWM',model:'./game-assets/models/weapons/snipers/awm.glb',bank:'snp_rifle',mag:5,reserve:25,fireRate:48,damage:100,recoil:2.3,viewLength:1.05}
];
let weaponIndex=0,current={...WEAPONS[0],ammo:WEAPONS[0].mag,currentReserve:WEAPONS[0].reserve};
await Promise.allSettled([view.loadArms('./game-assets/models/characters/first_person_arms/free_fps_arms_gameready_-_rigged.glb'),view.loadWeapon(current)]);

const pipeline=createCinematicPipeline(renderer,scene,camera,{cinematic,mobile});
if(renderStatus)renderStatus.textContent=`${gpuNative?'WebGPU':'WebGL2 fallback'} · ${pipeline.mode} · ${preset.preset}`;
$('#stageBadge').textContent='S3 PLAYABLE';

const player={pos:new THREE.Vector3(0,1.72,10),vel:new THREE.Vector3(),moveVel:new THREE.Vector3(),yaw:0,pitch:0,height:1.72,crouch:false,slide:0,grounded:true,reloading:false,ads:false,cooldown:0};
const keys={},touch={joy:{x:0,y:0},joyId:null,look:null},casings=[],particles=[];
let started=false,firing=false,pointerADS=false;

function updateHUD(){const a=$('#ammo'),tail=document.querySelector('.ammo span');if(a)a.textContent=current.ammo;if(tail)tail.textContent='/ '+current.currentReserve;const name=$('#weaponName');if(name)name.textContent=current.name}
updateHUD();
function collides(pos){const r=.33,feet=pos.y-player.height,b=new THREE.Box3(new THREE.Vector3(pos.x-r,feet,pos.z-r),new THREE.Vector3(pos.x+r,pos.y+.12,pos.z+r));return arena.colliders.some(c=>c.intersectsBox(b))}
function jump(){if(player.grounded&&!player.crouch){player.grounded=false;player.vel.y=6.2}}
function slideOrCrouch(){const moving=player.moveVel.length()>.9||keys.KeyW||Math.hypot(touch.joy.x,touch.joy.y)>.7;if(moving&&!player.crouch){player.slide=.58;player.crouch=true}else player.crouch=!player.crouch}
function switchWeapon(){if(player.reloading)return;weaponIndex=(weaponIndex+1)%WEAPONS.length;const next=WEAPONS[weaponIndex];current={...next,ammo:next.mag,currentReserve:next.reserve};$('#statusText').textContent=`EQUIP ${next.name}`;view.loadWeapon(current).then(()=>{$('#statusText').textContent='READY'});audio.preloadWeapon(next.bank).catch(()=>{});updateHUD()}
function reload(){if(player.reloading||current.ammo===current.mag||current.currentReserve<=0)return;player.reloading=true;$('#statusText').textContent='RELOADING';view.reload(event=>{if(event==='magOut'||event==='magIn'||event==='bolt')audio.playWeaponMechanical(current.bank,{gain:event==='bolt'?.28:.2});if(event==='complete'){const take=Math.min(current.mag-current.ammo,current.currentReserve);current.ammo+=take;current.currentReserve-=take;player.reloading=false;$('#statusText').textContent='READY';updateHUD()}})}
function hitmarker(head=false){const h=$('#hitmarker');h.textContent=head?'✕':'×';h.classList.add('show');setTimeout(()=>h.classList.remove('show'),95)}
function muzzleBurst(){const light=new THREE.PointLight(0xffb05f,mobile?8:18,4,2);light.position.set(.22,-.18,-.92);camera.add(light);setTimeout(()=>camera.remove(light),30);for(let i=0;i<(mobile?2:4);i++){const m=new THREE.Mesh(new THREE.SphereGeometry(.008,5,4),new THREE.MeshBasicMaterial({color:i?0xffb45a:0xffffff}));const p=new THREE.Vector3(.22+(Math.random()-.5)*.03,-.18+(Math.random()-.5)*.03,-.98-Math.random()*.08);camera.localToWorld(p);m.position.copy(p);scene.add(m);particles.push({mesh:m,life:.065,vel:new THREE.Vector3((Math.random()-.5)*.35,(Math.random()-.5)*.2,-1.3).applyQuaternion(camera.quaternion)})}}
function casing(){const m=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.045,7),new THREE.MeshStandardMaterial({color:0xc29243,roughness:.28,metalness:.92}));m.rotation.z=Math.PI/2;const p=new THREE.Vector3(.33,-.2,-.42);camera.localToWorld(p);m.position.copy(p);scene.add(m);casings.push({mesh:m,life:2,vel:new THREE.Vector3(1.05+Math.random()*.45,.75+Math.random()*.45,.12-Math.random()*.3).applyQuaternion(camera.quaternion)})}
function impactFx(point,normal){for(let i=0;i<(mobile?2:5);i++){const m=new THREE.Mesh(new THREE.SphereGeometry(.006,4,3),new THREE.MeshBasicMaterial({color:0xffc27a}));m.position.copy(point);scene.add(m);const tangent=new THREE.Vector3(Math.random()-.5,Math.random()*.8,Math.random()-.5).normalize();particles.push({mesh:m,life:.16+Math.random()*.12,vel:tangent.multiplyScalar(1.2+Math.random()*2).addScaledVector(normal,.8)})}}
function shoot(){if(!started||player.reloading||player.cooldown>0||current.ammo<=0)return;player.cooldown=60/current.fireRate;current.ammo--;updateHUD();view.recoil(current.recoil);gamepad.pulse(.22*current.recoil,38);audio.playWeaponShot(current.bank,{gain:.78});muzzleBurst();casing();player.pitch=Math.max(-1.45,player.pitch-.0095*current.recoil);const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(0,0),camera);const live=arena.targets.filter(t=>t.userData.alive),hits=ray.intersectObjects(live,true),hit=hits.find(h=>h.object.userData.target);if(!hit)return;const target=hit.object.userData.target,head=hit.object.userData.hitZone==='head';target.userData.health-=head?100:current.damage;hitmarker(head);impactFx(hit.point,hit.face?.normal?.clone().transformDirection(hit.object.matrixWorld)||new THREE.Vector3(0,1,0));if(target.userData.health<=0){target.userData.alive=false;target.visible=false;target.userData.respawn=2.8;$('#statusText').textContent=head?'HEADSHOT':'TARGET DOWN';setTimeout(()=>{if(started)$('#statusText').textContent='READY'},500)}}

function updatePlayer(dt,gp){
  if(gp.connected){player.yaw-=gp.lookX*2.35*dt;player.pitch=THREE.MathUtils.clamp(player.pitch-gp.lookY*1.9*dt,-1.45,1.45);if(gp.jump)jump();if(gp.slide)slideOrCrouch();if(gp.reload)reload();if(gp.switchWeapon)switchWeapon()}
  player.ads=pointerADS||gp.ads;
  const forward=new THREE.Vector3(-Math.sin(player.yaw),0,-Math.cos(player.yaw)),right=new THREE.Vector3(Math.cos(player.yaw),0,-Math.sin(player.yaw));let x=(keys.KeyD?1:0)-(keys.KeyA?1:0)+touch.joy.x+gp.moveX,y=(keys.KeyW?1:0)-(keys.KeyS?1:0)-touch.joy.y-gp.moveY;const inputLen=Math.hypot(x,y);if(inputLen>1){x/=inputLen;y/=inputLen}
  const dir=right.multiplyScalar(x).add(forward.multiplyScalar(y)),sprint=(keys.ShiftLeft||keys.ShiftRight||gp.sprint||inputLen>.93)&&y>.15&&!player.ads;let speed=player.crouch?2.55:sprint?7.1:4.45;if(player.slide>0){speed=9*(player.slide/.58);player.slide=Math.max(0,player.slide-dt);if(player.slide<=0&&player.crouch)player.crouch=false}
  const desired=dir.multiplyScalar(speed),accel=desired.lengthSq()>player.moveVel.lengthSq()?15:10;player.moveVel.x=THREE.MathUtils.damp(player.moveVel.x,desired.x,accel,dt);player.moveVel.z=THREE.MathUtils.damp(player.moveVel.z,desired.z,accel,dt);const next=player.pos.clone().addScaledVector(player.moveVel,dt),nx=new THREE.Vector3(next.x,player.pos.y,player.pos.z);if(!collides(nx))player.pos.x=next.x;else player.moveVel.x=0;const nz=new THREE.Vector3(player.pos.x,player.pos.y,next.z);if(!collides(nz))player.pos.z=next.z;else player.moveVel.z=0;
  if(!player.grounded){player.vel.y-=18.5*dt;player.pos.y+=player.vel.y*dt;if(player.pos.y<=player.height){player.pos.y=player.height;player.vel.y=0;player.grounded=true}}player.height=THREE.MathUtils.damp(player.height,player.crouch?1.18:1.72,13,dt);if(player.grounded)player.pos.y=player.height;
  camera.position.copy(player.pos);camera.rotation.y=player.yaw;camera.rotation.x=player.pitch;camera.rotation.z=THREE.MathUtils.damp(camera.rotation.z,player.slide>0?-.055:THREE.MathUtils.clamp(-x*.008,-.012,.012),9,dt);const moving=player.moveVel.length(),t=performance.now()*.001,bob=moving>.3?Math.sin(t*(sprint?13:8.5))*(sprint?.016:.008):0;camera.position.y+=bob;camera.fov=THREE.MathUtils.damp(camera.fov,player.ads?56:sprint?80:75,11,dt);camera.updateProjectionMatrix();view.setADS(player.ads);view.update(dt,{time:t,speed:moving,sprint,crouch:player.crouch,slide:player.slide,yaw:player.yaw,pitch:player.pitch})
}

function bindInput(){addEventListener('keydown',e=>{keys[e.code]=true;if(e.code==='Space')jump();if(e.code==='KeyR')reload();if(e.code==='KeyC'||e.code==='ControlLeft')slideOrCrouch();if(e.code==='Digit1'||e.code==='Digit2'||e.code==='KeyQ')switchWeapon()});addEventListener('keyup',e=>keys[e.code]=false);addEventListener('mousedown',e=>{if(e.button===0)firing=true;if(e.button===2)pointerADS=true});addEventListener('mouseup',e=>{if(e.button===0)firing=false;if(e.button===2)pointerADS=false});addEventListener('contextmenu',e=>e.preventDefault());addEventListener('mousemove',e=>{if(document.pointerLockElement===canvas){player.yaw-=e.movementX*.00205;player.pitch=THREE.MathUtils.clamp(player.pitch-e.movementY*.00205,-1.45,1.45)}});const pad=$('#leftPad'),stick=pad.querySelector('.stick'),reset=()=>{touch.joy={x:0,y:0};stick.style.transform='translate(0,0)'};pad.addEventListener('touchstart',e=>{touch.joyId=e.changedTouches[0].identifier;e.preventDefault()},{passive:false});pad.addEventListener('touchmove',e=>{e.preventDefault();const p=[...e.changedTouches].find(v=>v.identifier===touch.joyId);if(!p)return;const r=pad.getBoundingClientRect(),dx=p.clientX-(r.left+r.width/2),dy=p.clientY-(r.top+r.height/2),m=Math.min(44,Math.hypot(dx,dy)),a=Math.atan2(dy,dx);touch.joy={x:Math.cos(a)*m/44,y:Math.sin(a)*m/44};stick.style.transform=`translate(${touch.joy.x*44}px,${touch.joy.y*44}px)`},{passive:false});pad.addEventListener('touchend',reset);pad.addEventListener('touchcancel',reset);const look=$('#lookZone');look.addEventListener('touchstart',e=>{const p=e.changedTouches[0];touch.look={id:p.identifier,x:p.clientX,y:p.clientY};e.preventDefault()},{passive:false});look.addEventListener('touchmove',e=>{e.preventDefault();const p=[...e.changedTouches].find(v=>v.identifier===touch.look?.id);if(!p)return;const dx=p.clientX-touch.look.x,dy=p.clientY-touch.look.y;touch.look.x=p.clientX;touch.look.y=p.clientY;player.yaw-=dx*.00415;player.pitch=THREE.MathUtils.clamp(player.pitch-dy*.00415,-1.45,1.45)},{passive:false});look.addEventListener('touchend',()=>touch.look=null);const hold=(el,on,off)=>{el?.addEventListener('pointerdown',e=>{e.preventDefault();on()});el?.addEventListener('pointerup',e=>{e.preventDefault();off?.()});el?.addEventListener('pointercancel',()=>off?.())};hold($('#fireBtn'),()=>firing=true,()=>firing=false);hold($('#adsBtn'),()=>pointerADS=true,()=>pointerADS=false);$('#reloadBtn').onclick=reload;$('#jumpBtn').onclick=jump;$('#slideBtn').onclick=slideOrCrouch;$('#switchBtn').onclick=switchWeapon}
bindInput();

playBtn.disabled=false;playBtn.textContent='DEPLOY';
playBtn.onclick=async()=>{started=true;$('#boot').classList.add('hidden');$('#hud').classList.remove('hidden');await audio.unlock();await audio.loadPermanent();audio.preloadWeapon(current.bank).catch(()=>{});if(matchMedia('(pointer:fine)').matches)canvas.requestPointerLock?.();$('#statusText').textContent='READY'};
$('#audioZip').onchange=async e=>{const files=[...e.target.files];if(!files.length)return;const status=$('#audioStatus');await audio.unlock();let total=0,failed=0;for(let i=0;i<files.length;i++){status.textContent=`Importing audio ${i+1}/${files.length}…`;try{const r=await audio.importZip(files[i]);total+=r.loaded;failed+=r.failed||0}catch(err){failed++;console.error(err)}}status.textContent=`Audio ready · ${total} decoded${failed?` · ${failed} skipped`:''}`};

let frames=0,elapsed=0,lastFps=performance.now();
function updateEffects(dt){for(let i=casings.length-1;i>=0;i--){const c=casings[i];c.life-=dt;c.vel.y-=7*dt;c.mesh.position.addScaledVector(c.vel,dt);c.mesh.rotation.x+=8*dt;c.mesh.rotation.z+=12*dt;if(c.mesh.position.y<.025){c.mesh.position.y=.025;c.vel.y=Math.abs(c.vel.y)*.22;c.vel.x*=.72;c.vel.z*=.72}if(c.life<=0){scene.remove(c.mesh);c.mesh.geometry.dispose();c.mesh.material.dispose();casings.splice(i,1)}}for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;p.vel.y-=2.5*dt;p.mesh.position.addScaledVector(p.vel,dt);p.mesh.scale.multiplyScalar(1+dt*2.5);p.mesh.material.opacity=Math.max(0,p.life/.25);p.mesh.material.transparent=true;if(p.life<=0){scene.remove(p.mesh);p.mesh.geometry.dispose();p.mesh.material.dispose();particles.splice(i,1)}}}
function loop(){const dt=Math.min(.034,clock.getDelta()),gp=gamepad.update();if(started){player.cooldown=Math.max(0,player.cooldown-dt);if(firing||gp.fire)shoot();updatePlayer(dt,gp);arena.update(dt);updateEffects(dt);for(const t of arena.targets){if(!t.userData.alive){t.userData.respawn-=dt;if(t.userData.respawn<=0){t.userData.health=100;t.userData.alive=true;t.visible=true}}}quality.update(dt)}pipeline.render();frames++;elapsed+=dt;const now=performance.now();if(now-lastFps>500){$('#fps').textContent=`${Math.round(frames/Math.max(.001,elapsed))} FPS`;const c=$('#controllerStatus');if(c)c.textContent=gp.connected?'PAD':'TOUCH/MOUSE';frames=0;elapsed=0;lastFps=now}}
renderer.setAnimationLoop(loop);
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight,false);pipeline.resize()});
addEventListener('visibilitychange',()=>{if(document.hidden){firing=false;pointerADS=false;touch.joy={x:0,y:0}}});
